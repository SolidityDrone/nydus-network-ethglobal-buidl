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
// For Oasis TEE, the proxy should handle routing, but if it doesn't work, you may need to use a direct URL
const PROOF_SERVER_URL = process.env.NEXT_PUBLIC_PROOF_SERVER_URL || 'https://p3001.m1108.test-proxy-b.rofl.app';

// Log the configured URL (only in browser)
if (typeof window !== 'undefined') {
    console.log(`🔧 Proof server URL configured: ${PROOF_SERVER_URL}`);
}

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
    const url = `${PROOF_SERVER_URL}/api/proof/generate`;
    console.log(`🔐 Calling proof server: ${url}`);
    
    try {
        const response = await fetch(url, {
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
    } catch (error) {
        console.error(`❌ Proof server error (URL: ${url}):`, error);
        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new Error(`Failed to connect to proof server at ${PROOF_SERVER_URL}. Is the server running?`);
        }
        throw error;
    }
}

/**
 * Check if the proof server is available
 */
/**
 * Check if the proof server is available
 */
export async function checkProofServerStatus(): Promise<boolean> {
    const url = `${PROOF_SERVER_URL}/api/proof/status`;
    console.log(`🔍 Checking proof server status: ${url}`);
    
    try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        const isOk = response.ok;
        if (isOk) {
            console.log(`✅ Proof server is available at ${PROOF_SERVER_URL}`);
        } else {
            console.warn(`⚠️ Proof server returned status ${response.status} at ${PROOF_SERVER_URL}`);
        }
        return isOk;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.error(`❌ Proof server status check timed out (URL: ${url})`);
        } else {
            console.error(`❌ Proof server status check failed (URL: ${url}):`, error);
        }
        return false;
    }
}

