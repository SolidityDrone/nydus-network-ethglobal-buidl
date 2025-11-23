import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, http, createPublicClient, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';

// Celo Sepolia chain definition
const celoSepolia = defineChain({
    id: 11142220,
    name: 'Celo Sepolia',
    nativeCurrency: {
        decimals: 18,
        name: 'CELO',
        symbol: 'CELO',
    },
    rpcUrls: {
        default: {
            http: [process.env.NEXT_PUBLIC_CONTRACT_HOST_RPC || 'https://forno.celo-sepolia.celo-testnet.org'],
        },
    },
    blockExplorers: {
        default: { name: 'Blockscout', url: 'https://celo-sepolia.blockscout.com' },
    },
});

export async function POST(request: NextRequest) {
    try {
        const { address, abi, functionName, args } = await request.json();

        if (!address || !abi || !functionName || !args) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields: address, abi, functionName, args' },
                { status: 400 }
            );
        }

        const PRIVATE_KEY = process.env.PRIVATE_KEY;
        if (!PRIVATE_KEY) {
            return NextResponse.json(
                { success: false, error: 'PRIVATE_KEY not configured on server' },
                { status: 500 }
            );
        }

        // Validate and normalize private key format
        let normalizedPrivateKey: `0x${string}`;
        try {
            // Ensure private key starts with 0x and is 66 characters (0x + 64 hex chars)
            if (PRIVATE_KEY.startsWith('0x')) {
                if (PRIVATE_KEY.length !== 66) {
                    throw new Error(`Invalid private key length: expected 66 characters (0x + 64 hex), got ${PRIVATE_KEY.length}`);
                }
                normalizedPrivateKey = PRIVATE_KEY as `0x${string}`;
            } else {
                // Add 0x prefix if missing
                if (PRIVATE_KEY.length !== 64) {
                    throw new Error(`Invalid private key length: expected 64 hex characters, got ${PRIVATE_KEY.length}`);
                }
                normalizedPrivateKey = `0x${PRIVATE_KEY}` as `0x${string}`;
            }
            
            // Validate hex format
            if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
                throw new Error('Invalid private key format: must be 64 hex characters');
            }
        } catch (error) {
            console.error('Private key validation error:', error);
            return NextResponse.json(
                { 
                    success: false, 
                    error: `Invalid private key format: ${error instanceof Error ? error.message : 'Unknown error'}` 
                },
                { status: 500 }
            );
        }

        // Create account from private key
        let account;
        try {
            account = privateKeyToAccount(normalizedPrivateKey);
        } catch (error) {
            console.error('Failed to create account from private key:', error);
            return NextResponse.json(
                { 
                    success: false, 
                    error: `Failed to create account: ${error instanceof Error ? error.message : 'Invalid private key'}` 
                },
                { status: 500 }
            );
        }

        // Create public client for reading chain data
        const publicClient = createPublicClient({
            chain: celoSepolia,
            transport: http(process.env.NEXT_PUBLIC_CONTRACT_HOST_RPC || 'https://forno.celo-sepolia.celo-testnet.org'),
        });

        // Create wallet client for signing transactions
        const walletClient = createWalletClient({
            account,
            chain: celoSepolia,
            transport: http(process.env.NEXT_PUBLIC_CONTRACT_HOST_RPC || 'https://forno.celo-sepolia.celo-testnet.org'),
        });

        // Encode function data
        const data = encodeFunctionData({
            abi: abi,
            functionName: functionName,
            args: args,
        });

        // Get nonce for the relayer account
        const nonce = await publicClient.getTransactionCount({
            address: account.address,
        });

        // Get gas price
        const gasPrice = await publicClient.getGasPrice();

        // Prepare transaction
        const transactionRequest: {
            to: `0x${string}`;
            data: `0x${string}`;
            nonce: bigint;
            gasPrice: bigint;
            gas?: bigint;
        } = {
            to: address as `0x${string}`,
            data: data,
            nonce: BigInt(nonce),
            gasPrice: gasPrice,
        };

        // Estimate gas
        try {
            const gasEstimate = await publicClient.estimateGas({
                account: account.address,
                to: address as `0x${string}`,
                data: data,
            });
            transactionRequest.gas = gasEstimate;
        } catch (error) {
            console.warn('Gas estimation failed, using default:', error);
            // Use a default gas limit if estimation fails
            transactionRequest.gas = BigInt(500000);
        }

        // Sign and send transaction
        const hash = await walletClient.sendTransaction(transactionRequest);

        return NextResponse.json({
            success: true,
            hash: hash,
            relayerAddress: account.address,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Relayer error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            },
            { status: 500 }
        );
    }
}

