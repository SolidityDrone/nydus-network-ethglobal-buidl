/**
 * Helper to get a properly configured public client for Celo Sepolia
 * This ensures all contract reads use the correct RPC URL
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { celoSepolia, rpcUrl } from '@/config';

/**
 * Get a public client configured for Celo Sepolia with the correct RPC URL
 */
export function getCeloPublicClient(): PublicClient {
    return createPublicClient({
        chain: celoSepolia,
        transport: http(rpcUrl)
    });
}

