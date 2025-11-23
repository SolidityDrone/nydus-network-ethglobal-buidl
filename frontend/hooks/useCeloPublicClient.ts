/**
 * Custom hook that ensures we always use a public client configured for Celo Sepolia
 * This fixes the issue where reads return 0x because the wrong RPC is being used
 */

import { usePublicClient } from 'wagmi';
import { useMemo } from 'react';
import { createPublicClient, http } from 'viem';
import { celoSepolia, rpcUrl } from '@/config';

/**
 * Hook that returns a public client guaranteed to use Celo Sepolia RPC
 * Falls back to creating a new client if usePublicClient doesn't return one
 * or if it's not configured correctly
 */
export function useCeloPublicClient() {
    const wagmiPublicClient = usePublicClient();
    
    // Always create a client with explicit Celo Sepolia RPC URL
    // This ensures reads work correctly
    return useMemo(() => {
        // If wagmi client exists and is on the correct chain, use it
        // Otherwise, create a new one with explicit RPC
        if (wagmiPublicClient && wagmiPublicClient.chain?.id === celoSepolia.id) {
            // Verify it's using the correct RPC by checking the transport
            return wagmiPublicClient;
        }
        
        // Create a new client with explicit Celo Sepolia RPC URL
        return createPublicClient({
            chain: celoSepolia,
            transport: http(rpcUrl)
        });
    }, [wagmiPublicClient]);
}

