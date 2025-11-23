import { cookieStorage, createStorage, http } from '@wagmi/core'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { defineChain } from 'viem'

// Get RPC URL from environment variable
export const rpcUrl = process.env.NEXT_PUBLIC_CONTRACT_HOST_RPC || 'https://forno.celo-sepolia.celo-testnet.org'

// Celo Sepolia chain definition with custom RPC URL
export const celoSepolia = defineChain({
    id: 11142220,
    name: 'Celo Sepolia',
    nativeCurrency: {
        decimals: 18,
        name: 'CELO',
        symbol: 'CELO',
    },
    rpcUrls: {
        default: {
            http: [rpcUrl],
        },
        public: {
            http: [rpcUrl],
        },
    },
    blockExplorers: {
        default: { name: 'Blockscout', url: 'https://celo-sepolia.blockscout.com' },
    },
    testnet: true,
})

// Get projectId from https://cloud.reown.com
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID

if (!projectId) {
    throw new Error('Project ID is not defined')
}

export const networks = [celoSepolia]

//Set up the Wagmi Adapter (Config)
export const wagmiAdapter = new WagmiAdapter({
    storage: createStorage({
        storage: cookieStorage
    }),
    ssr: true,
    projectId,
    networks
})

export const config = wagmiAdapter.wagmiConfig

// Log the config to verify RPC URL is set
if (typeof window !== 'undefined') {
    console.log('Wagmi config chains:', config.chains);
}

// Helper function to get a properly configured public client for Celo Sepolia
export function getCeloPublicClient() {
    const { createPublicClient, http } = require('viem');
    return createPublicClient({
        chain: celoSepolia,
        transport: http(rpcUrl)
    });
}

// Ensure the config uses the correct RPC URL for Celo Sepolia
// The chain definition already includes the RPC URL, but we can verify it's being used
if (typeof window !== 'undefined') {
    console.log('Celo Sepolia RPC URL:', rpcUrl)
    console.log('Celo Sepolia Chain ID:', celoSepolia.id)
}
