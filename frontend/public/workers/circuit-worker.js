/**
 * Web Worker for background circuit compilation
 * This runs the heavy compilation work in a separate thread
 */

// Import the circuit (this will be bundled)
import circuit from '/circuits/nydus_entry.json';

let backend = null;
let noir = null;
let isCompiled = false;

// Listen for messages from main thread
self.onmessage = async function (e) {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'INITIALIZE':
                await initializeBackend();
                self.postMessage({
                    type: 'INITIALIZED',
                    success: true,
                    isCompiled
                });
                break;

            case 'EXECUTE':
                if (!noir) {
                    throw new Error('Backend not initialized');
                }
                const { witness } = await noir.execute(data.inputs);
                self.postMessage({
                    type: 'WITNESS_GENERATED',
                    witness
                });
                break;

            case 'GENERATE_PROOF':
                if (!backend || !data.witness) {
                    throw new Error('Backend or witness not available');
                }
                const proof = await backend.generateProof(data.witness);
                self.postMessage({
                    type: 'PROOF_GENERATED',
                    proof
                });
                break;

            default:
                throw new Error(`Unknown message type: ${type}`);
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: error.message
        });
    }
};

async function initializeBackend() {
    if (backend && noir) {
        return; // Already initialized
    }

    console.log('🔄 Initializing backend in worker...');

    // Dynamic import to avoid bundling issues
    const { UltraHonkBackend } = await import('@aztec/bb.js');
    const { Noir } = await import('@noir-lang/noir_js');

    // Initialize with optimal settings
    const threads = navigator.hardwareConcurrency || 1;
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

    backend = hasSharedArrayBuffer
        ? new UltraHonkBackend(circuit.bytecode, { threads })
        : new UltraHonkBackend(circuit.bytecode);

    noir = new Noir(circuit);

    // Pre-compile with dummy data
    try {
        const dummyInputs = {
            user_key: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            token_address: "0x0000000000000000000000000000000000000000000000000000000000000001",
            amount: "0x0000000000000000000000000000000000000000000000000000000000000001"
        };

        await noir.execute(dummyInputs);
        isCompiled = true;
        console.log('✅ Circuit pre-compiled in worker');
    } catch (error) {
        console.log('⚠️ Pre-compilation failed (expected):', error.message);
    }
}