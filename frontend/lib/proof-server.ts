/**
 * Client-side utility for calling the Nydus proof generation server
 * 
 * SECURITY NOTE:
 * - Uses HTTPS for encrypted data in transit
 * - Circuit inputs contain sensitive data (private keys, amounts, etc.)
 * - Proofs may contain sensitive information
 */

// Get proof server URL from env, default to Oasis TEE endpoint
// For local development, set NEXT_PUBLIC_PROOF_SERVER_URL=http://localhost:3001
const PROOF_SERVER_URL = process.env.NEXT_PUBLIC_PROOF_SERVER_URL || 'https://p3001.m1108.test-proxy-b.rofl.app';

// Validate that production URLs use HTTPS
if (typeof window !== 'undefined' && PROOF_SERVER_URL.startsWith('http://') && !PROOF_SERVER_URL.includes('localhost')) {
    console.warn('⚠️ SECURITY WARNING: Proof server URL uses HTTP instead of HTTPS. Circuit inputs and proofs will be sent unencrypted!');
}

export type CircuitType = 'entry' | 'deposit' | 'send' | 'withdraw' | 'absorb';

export interface ProofGenerationRequest {
    circuitType: CircuitType;
    inputs: any;
}

export interface ProofGenerationResponse {
    success: true;
    proof: string;
    publicInputs: string[];
    timing: {
        total: number;
        execution: number;
        proving: number;
    };
    timestamp: string;
}

export interface ProofGenerationError {
    success: false;
    error: string;
    timing?: {
        total: number;
    };
    timestamp: string;
}

/**
 * Generate a proof remotely using the proof server
 */
export async function generateProofRemote(
    circuitType: CircuitType,
    inputs: any
): Promise<ProofGenerationResponse> {
    const response = await fetch(`${PROOF_SERVER_URL}/api/proof/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            circuitType,
            inputs,
        }),
    });

    if (!response.ok) {
        const errorData: ProofGenerationError = await response.json();
        throw new Error(errorData.error || `Proof generation failed: ${response.statusText}`);
    }

    const data: ProofGenerationResponse = await response.json();
    
    if (!data.success) {
        throw new Error('Proof generation failed');
    }

    return data;
}

/**
 * Check if the proof server is available
 */
export async function checkProofServerStatus(): Promise<boolean> {
    try {
        const response = await fetch(`${PROOF_SERVER_URL}/api/proof/status`, {
            method: 'GET',
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

