import { Router, Request, Response } from 'express';
import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

const router = Router();

// Circuit cache
const circuitCache: Map<string, any> = new Map();
const backendCache: Map<string, UltraHonkBackend> = new Map();
const noirCache: Map<string, Noir> = new Map();

// Circuit file mapping
const CIRCUIT_FILES: Record<string, string> = {
    entry: 'nydus_entry.json',
    deposit: 'nydus_deposit.json',
    send: 'nydus_send.json',
    withdraw: 'nydus_withdraw.json',
    absorb: 'nydus_absorb.json',
};

// Public input counts for each circuit
const PUBLIC_INPUT_COUNTS: Record<string, number> = {
    entry: 16,
    deposit: 16,
    send: 28,
    withdraw: 28,
    absorb: 28,
};

/**
 * Load circuit from file system
 */
async function loadCircuit(circuitType: string): Promise<any> {
    if (circuitCache.has(circuitType)) {
        return circuitCache.get(circuitType);
    }

    const fileName = CIRCUIT_FILES[circuitType];
    if (!fileName) {
        throw new Error(`Unknown circuit type: ${circuitType}`);
    }

    const circuitPath = path.join(__dirname, '../../circuits', fileName);
    
    if (!fs.existsSync(circuitPath)) {
        throw new Error(`Circuit file not found: ${circuitPath}`);
    }

    const circuitData = JSON.parse(fs.readFileSync(circuitPath, 'utf-8'));
    circuitCache.set(circuitType, circuitData);
    
    logger.info(`✅ Loaded circuit: ${circuitType}`);
    return circuitData;
}

/**
 * Get or create backend for circuit
 */
async function getBackend(circuitType: string): Promise<UltraHonkBackend> {
    if (backendCache.has(circuitType)) {
        return backendCache.get(circuitType)!;
    }

    const circuit = await loadCircuit(circuitType);
    const backend = new UltraHonkBackend(circuit.bytecode);
    backendCache.set(circuitType, backend);
    
    logger.info(`✅ Created backend for: ${circuitType}`);
    return backend;
}

/**
 * Get or create Noir instance for circuit
 */
async function getNoir(circuitType: string): Promise<Noir> {
    if (noirCache.has(circuitType)) {
        return noirCache.get(circuitType)!;
    }

    const circuit = await loadCircuit(circuitType);
    const noir = new Noir(circuit);
    await noir.init();
    
    noirCache.set(circuitType, noir);
    
    logger.info(`✅ Initialized Noir for: ${circuitType}`);
    return noir;
}

/**
 * Preload all circuits on startup
 */
export async function preloadCircuits(): Promise<void> {
    logger.info('🔄 Preloading circuits...');
    const circuitTypes = Object.keys(CIRCUIT_FILES);
    
    for (const circuitType of circuitTypes) {
        try {
            await loadCircuit(circuitType);
            await getBackend(circuitType);
            await getNoir(circuitType);
            logger.info(`✅ Preloaded: ${circuitType}`);
        } catch (error) {
            logger.error(`❌ Failed to preload ${circuitType}:`, error);
        }
    }
    
    logger.info('✅ All circuits preloaded');
}

/**
 * Status endpoint
 */
router.get('/status', (req: Request, res: Response) => {
    res.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        circuits: Array.from(circuitCache.keys()),
        service: 'nydus-proof-server',
    });
});

/**
 * Generate proof endpoint
 */
router.post('/generate', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
        const { circuitType, inputs } = req.body;

        if (!circuitType || !inputs) {
            return res.status(400).json({
                success: false,
                error: 'Missing circuitType or inputs',
                timestamp: new Date().toISOString(),
            });
        }

        if (!CIRCUIT_FILES[circuitType]) {
            return res.status(400).json({
                success: false,
                error: `Unknown circuit type: ${circuitType}`,
                timestamp: new Date().toISOString(),
            });
        }

        logger.info(`🔐 Generating proof for: ${circuitType}`);

        // Get Noir and Backend instances
        const noir = await getNoir(circuitType);
        const backend = await getBackend(circuitType);

        // Execute circuit
        const executionStart = Date.now();
        // @ts-ignore
        const { witness } = await noir.execute(inputs, { keccak: true });
        const executionTime = Date.now() - executionStart;

        // Generate proof
        const provingStart = Date.now();
        // @ts-ignore
        const proofResult = await backend.generateProof(witness, { keccak: true });
        const provingTime = Date.now() - provingStart;

        // Convert proof to hex
        const proofHex = Buffer.from(proofResult.proof).toString('hex');

        // Extract and format public inputs
        const publicInputCount = PUBLIC_INPUT_COUNTS[circuitType] || proofResult.publicInputs.length;
        const publicInputsArray = (proofResult.publicInputs || []).slice(0, publicInputCount);
        const publicInputsHex = publicInputsArray.map((input: any) => {
            if (typeof input === 'string' && input.startsWith('0x')) {
                return input;
            }
            if (typeof input === 'bigint') {
                return `0x${input.toString(16).padStart(64, '0')}`;
            }
            const hex = BigInt(input).toString(16);
            return `0x${hex.padStart(64, '0')}`;
        });

        const totalTime = Date.now() - startTime;

        logger.info(`✅ Proof generated for ${circuitType} in ${totalTime}ms`);

        res.json({
            success: true,
            proof: proofHex,
            publicInputs: publicInputsHex,
            timing: {
                total: Math.round(totalTime),
                execution: Math.round(executionTime),
                proving: Math.round(provingTime),
            },
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        const totalTime = Date.now() - startTime;
        logger.error('❌ Proof generation error:', error);
        
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timing: {
                total: Math.round(totalTime),
            },
            timestamp: new Date().toISOString(),
        });
    }
});

export default router;

