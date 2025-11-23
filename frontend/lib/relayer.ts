/**
 * Client-side utility for calling the relayer API
 */

const RELAYER_API_URL = '/api/relayer';

export interface RelayerRequest {
    address: string;
    abi: any[] | readonly any[];
    functionName: string;
    args: any[];
}

export interface RelayerResponse {
    success: true;
    hash: string;
    relayerAddress: string;
    timestamp: string;
}

export interface RelayerError {
    success: false;
    error: string;
    timestamp: string;
}

/**
 * Relay a transaction using the server's private key
 */
export async function relayTransaction(
    request: RelayerRequest
): Promise<RelayerResponse> {
    const response = await fetch(RELAYER_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        const errorData: RelayerError = await response.json();
        throw new Error(errorData.error || `Relayer failed: ${response.statusText}`);
    }

    const data: RelayerResponse = await response.json();
    
    if (!data.success) {
        throw new Error('Transaction relay failed');
    }

    return data;
}

