'use client';

import React, { useState, useRef, useCallback } from 'react';
import { createWalletClient, custom, recoverMessageAddress, keccak256, stringToHex, recoverPublicKey, createPublicClient, http } from 'viem';
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
import { useAccount as useWagmiAccount, useWriteContract, useWaitForTransactionReceipt, useSignMessage } from 'wagmi';
import { useCeloPublicClient } from '@/hooks/useCeloPublicClient';
import { useAccount as useAccountContext, useZkAddress } from '@/context/AccountProvider';
import { Noir } from '@noir-lang/noir_js';
import { CachedUltraHonkBackend } from '@/lib/cached-ultra-honk-backend';
import circuit from '@/lib/circuits/nydus_entry.json';
import { NydusAddress, NydusAbi } from '@/lib/abi/NydusConst';
import { computeZkAddress, NYDUS_MESSAGE } from '@/lib/zk-address';
import { loadAccountDataOnSign } from '@/lib/loadAccountDataOnSign';
import { useAccountState } from '@/context/AccountStateProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TransactionModal from '@/components/TransactionModal';
import { useToast } from '@/components/Toast';
import { getUniversalLink } from "@selfxyz/core";
import { SelfQRcodeWrapper, SelfAppBuilder, countries, type SelfApp } from "@selfxyz/qrcode";
import { ethers } from "ethers";

type Step = 1 | 2 | 3;

export default function InitializePage() {
    const { toast } = useToast();
    const zkAddress = useZkAddress();
    const { setZkAddress, account } = useAccountContext();
    const { address } = useWagmiAccount();
    const { signMessageAsync, isPending: isSigning } = useSignMessage();
    const { setCurrentNonce, setBalanceEntries, setUserKey: setContextUserKey, setPersonalCommitmentState, getPersonalCommitmentState } = useAccountState();
    
    // 3-step flow state
    const [currentStep, setCurrentStep] = useState<Step>(1);
    const [selfApp, setSelfApp] = useState<SelfApp | null>(null);
    const [universalLink, setUniversalLink] = useState<string>('');
    const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
    const [verificationResult, setVerificationResult] = useState<any>(null);
    const [verificationProof, setVerificationProof] = useState<string | null>(null);
    const [countdown, setCountdown] = useState<number>(5);

    const [tokenAddress, setTokenAddress] = useState('');
    const [amount, setAmount] = useState('');
    const [userKey, setUserKey] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isProving, setIsProving] = useState(false);
    const [proof, setProof] = useState<string>('');
    const [proofError, setProofError] = useState<string | null>(null);
    const [provingTime, setProvingTime] = useState<number | null>(null);
    const [currentProvingTime, setCurrentProvingTime] = useState<number>(0);
    const [isInitializing, setIsInitializing] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [initializationTime, setInitializationTime] = useState<number | null>(null);
    const [cacheInfo, setCacheInfo] = useState<{ size: number; entries?: string[] } | null>(null);
    const [publicInputs, setPublicInputs] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSimulating, setIsSimulating] = useState(false);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [txError, setTxError] = useState<string | null>(null);
    const [simulationResult, setSimulationResult] = useState<any>(null);
    const [showTransactionModal, setShowTransactionModal] = useState(false);

    const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });
    const publicClient = useCeloPublicClient();

    // Backend and Noir references
    const backendRef = useRef<CachedUltraHonkBackend | null>(null);
    const noirRef = useRef<Noir | null>(null);

    // Initialize Self Protocol App
    React.useEffect(() => {
        if (!address) return;

        const initializeSelfApp = async () => {
            try {
                const endpoint = process.env.NEXT_PUBLIC_SELF_ENDPOINT;
                const scope = process.env.NEXT_PUBLIC_SELF_SCOPE_SEED;
                const appName = process.env.NEXT_PUBLIC_SELF_APP_NAME;

                if (!endpoint || !scope) {
                    throw new Error('Self Protocol environment variables not configured');
                }

                const app = new SelfAppBuilder({
                    version: 2,
                    appName: appName || "Nydus",
                    scope: scope,
                    endpoint: endpoint.toLowerCase(),
                    logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
                    userId: address,
                    endpointType: "staging_celo",
                    userIdType: "hex",
                    userDefinedData: `Wallet: ${address}`,
                    deeplinkCallback: typeof window !== 'undefined' ? window.location.href : '',
                    disclosures: {
                        minimumAge: 18,
                        excludedCountries: [countries.UNITED_STATES],
                        ofac: true,
                    },
                }).build();

                setSelfApp(app);
                const deeplink = getUniversalLink(app);
                setUniversalLink(deeplink);
            } catch (error) {
                console.error("Failed to initialize Self app:", error);
                toast('Failed to initialize Self verification', 'error');
            }
        };

        initializeSelfApp();
    }, [address, toast]);

    // Countdown timer for step 2
    React.useEffect(() => {
        if (currentStep !== 2) {
            setCountdown(5);
            return;
        }

        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    setCurrentStep(3);
                    toast('Ready to initialize!', 'success');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [currentStep, toast]);

    // Real-time timer for proving
    React.useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isProving) {
            const startTime = performance.now();
            interval = setInterval(() => {
                const elapsed = Math.round(performance.now() - startTime);
                setCurrentProvingTime(elapsed);
            }, 100); // Update every 100ms
        } else {
            setCurrentProvingTime(0);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isProving]);



    // Initialize backend and Noir
    const initializeBackend = useCallback(async () => {
        if (isInitialized && backendRef.current && noirRef.current) {
            console.log('✅ Backend already initialized');
            return;
        }

        const startTime = performance.now();
        setIsInitializing(true);

        try {
            console.log('🔄 Initializing backend...');

            // Create backend with minimal settings
            const backendOptions = {
                threads: 1, // Single thread for faster initialization
            };

            const backend = new CachedUltraHonkBackend(circuit.bytecode, backendOptions);
            const noir = new Noir(circuit);

            // Store references
            backendRef.current = backend;
            noirRef.current = noir;

            const endTime = performance.now();
            const initTime = Math.round(endTime - startTime);
            setInitializationTime(initTime);
            setIsInitialized(true);

            console.log(`✅ Backend initialized in ${initTime}ms`);

        } catch (error) {
            console.error('❌ Failed to initialize backend:', error);
            throw error;
        } finally {
            setIsInitializing(false);
        }
    }, [isInitialized]);

    // Cache management functions
    const loadCacheInfo = useCallback(async () => {
        try {
            const info = await CachedUltraHonkBackend.getCacheInfo();
            setCacheInfo({
                size: info.size || 0,
                entries: info.keys || []
            });
        } catch (error) {
            console.error('Failed to load cache info:', error);
            setCacheInfo({ size: 0, entries: [] });
        }
    }, []);

    const handleClearCache = useCallback(async () => {
        try {
            await CachedUltraHonkBackend.clearCache();
            await loadCacheInfo();
            console.log('✅ Backend cache cleared');
        } catch (error) {
            console.error('Failed to clear cache:', error);
        }
    }, [loadCacheInfo]);

    // Load cache info on mount
    React.useEffect(() => {
        loadCacheInfo();
    }, [loadCacheInfo]);

    // No auto-initialization - only initialize when user wants to prove


    // Compute private key from signature
    const computePrivateKeyFromSignature = async (signatureValue: string): Promise<string> => {
        // Import poseidon2Hash to compute private key directly
        const cryptoModule = await import('@aztec/foundation/crypto');
        const { poseidon2Hash } = cryptoModule;

        // Ensure Buffer is available
        if (!globalThis.Buffer) {
            const { Buffer } = await import('buffer');
            globalThis.Buffer = Buffer;
        }

        // Split signature into 31, 31, 3 bytes (same as in zk-address.ts)
        const sigHex = signatureValue.startsWith('0x') ? signatureValue.slice(2) : signatureValue;
        const sigBuffer = globalThis.Buffer.from(sigHex, 'hex');

        if (sigBuffer.length !== 65) {
            throw new Error(`Signature must be 65 bytes, got ${sigBuffer.length}`);
        }

        const chunk1 = sigBuffer.slice(0, 31);
        const chunk2 = sigBuffer.slice(31, 62);
        const chunk3 = sigBuffer.slice(62, 65);

        const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
        const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
        const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));

        // Compute poseidon hash - this is the private key (user_key)
        const poseidonHash = await poseidon2Hash([chunk1BigInt, chunk2BigInt, chunk3BigInt]);

        // Convert to bigint
        let privateKey: bigint;
        if (typeof poseidonHash === 'bigint') {
            privateKey = poseidonHash;
        } else if ('toBigInt' in poseidonHash && typeof (poseidonHash as any).toBigInt === 'function') {
            privateKey = (poseidonHash as any).toBigInt();
        } else if ('value' in poseidonHash) {
            privateKey = BigInt((poseidonHash as any).value);
        } else {
            privateKey = BigInt((poseidonHash as any).toString());
        }

        // Convert to hex string for circuit input
        return '0x' + privateKey.toString(16);
    };

    const handleSign = async () => {
        try {
            setIsLoading(true);
            setError(null);

            // Sign the message using wagmi
            const signatureValue = await signMessageAsync({ message: NYDUS_MESSAGE });

            // Compute zkAddress (public key) and store in context with signature
            const zkAddr = await computeZkAddress(signatureValue);
            setZkAddress(zkAddr, signatureValue);

            // Load all saved account data from IndexedDB
            await loadAccountDataOnSign(zkAddr, {
                setCurrentNonce,
                setBalanceEntries,
                setUserKey: (key: bigint | null) => {
                    // Set context userKey
                    setContextUserKey(key);
                    // Also set local string userKey if needed
                    if (key !== null && !userKey) {
                        setUserKey('0x' + key.toString(16));
                    }
                },
            }, account?.signature);

            // Compute private key (user_key) from signature (only if not loaded from IndexedDB)
            if (!userKey) {
                const userKeyHex = await computePrivateKeyFromSignature(signatureValue);
                setUserKey(userKeyHex);
                console.log('User key (private key) computed:', userKeyHex);
            }

            console.log('Signature generated:', signatureValue);
            console.log('ZK Address (public key) computed:', zkAddr);

        } catch (error) {
            console.error('Error signing message:', error);
            setError(error instanceof Error ? error.message : 'Failed to sign message');
        } finally {
            setIsLoading(false);
        }
    };

    // Initialize user_key from existing signature if zkAddress exists
    React.useEffect(() => {
        const initializeFromExisting = async () => {
            if (zkAddress && account?.signature && !userKey) {
                try {
                    const userKeyHex = await computePrivateKeyFromSignature(account.signature);
                    setUserKey(userKeyHex);
                    console.log('User key initialized from existing signature:', userKeyHex);
                } catch (error) {
                    console.error('Error computing user_key from existing signature:', error);
                }
            }
        };
        initializeFromExisting();
    }, [zkAddress, account?.signature, userKey]);

    const proveNydusEntry = async () => {
        if (!userKey) {
            setProofError('Please sign a message first to generate user_key');
            return;
        }

        if (!tokenAddress || !amount) {
            setProofError('Please fill in token_address and amount');
            return;
        }

        try {
            setIsProving(true);
            setProofError(null);
            setProvingTime(null);

            // Start timing
            const startTime = performance.now();

            // Ensure backend is initialized
            console.log('🔄 Ensuring backend is initialized...');
            await initializeBackend();

            if (!backendRef.current || !noirRef.current) {
                throw new Error('Failed to initialize backend');
            }

            // Use form values
            console.log('Circuit inputs:');
            console.log('user_key:', userKey);
            console.log('token_address:', tokenAddress);
            console.log('amount:', amount);

            // Convert decimal amount to hex (default 18 decimals)
            const decimals = 18;
            const amountFloat = parseFloat(amount) || 0;
            const amountInWei = BigInt(Math.floor(amountFloat * Math.pow(10, decimals)));
            const amountHex = '0x' + amountInWei.toString(16);
            
            console.log(`[Initialize] Amount conversion: ${amountFloat} (decimal) -> ${amountInWei.toString()} (wei) = ${amountHex}`);
            
            // Prepare inputs for nydus_entry circuit
            const inputs = {
                user_key: userKey,
                token_address: tokenAddress,
                amount: amountHex
            };

            // Generate witness
            console.log('🔄 Generating witness...');
            const witnessStartTime = performance.now();
            //@ts-ignore
            const { witness } = await noirRef.current!.execute(inputs, { keccak: true });
            const witnessEndTime = performance.now();
            const witnessTime = Math.round(witnessEndTime - witnessStartTime);
            console.log(`✅ Witness generated in ${witnessTime}ms`);
            console.log('Circuit execution result:', witness);

            // Generate proof
            console.log('🔄 Generating proof...');
            const proofStartTime = performance.now();
            //@ts-ignore
            const proofResult = await backendRef.current!.generateProof(witness, { keccak: true });
            const proofEndTime = performance.now();
            const proofTime = Math.round(proofEndTime - proofStartTime);
            console.log(`✅ Proof generated in ${proofTime}ms`);
            console.log('Generated proof:', proofResult);

            const proofHex = Buffer.from(proofResult.proof).toString('hex');

            // Extract public inputs from proof result and slice to 9 elements (circuit has 9 inputs)
            const publicInputsArray = (proofResult.publicInputs || []).slice(0, 9);
            // Convert public inputs to hex strings (bytes32 format)
            const publicInputsHex = publicInputsArray.map((input: any) => {
                // Handle different input types
                if (typeof input === 'string' && input.startsWith('0x')) {
                    return input;
                }
                if (typeof input === 'bigint') {
                    return `0x${input.toString(16).padStart(64, '0')}`;
                }
                // Convert to hex string
                const hex = BigInt(input).toString(16);
                return `0x${hex.padStart(64, '0')}`;
            });

            // Calculate proving time
            const endTime = performance.now();
            const provingTimeMs = Math.round(endTime - startTime);
            setProvingTime(provingTimeMs);

            setProof(proofHex);
            setPublicInputs(publicInputsHex);
            console.log('Proof generated successfully:', proofHex);
            console.log('Public inputs (sliced to 9):', publicInputsHex);
            console.log(`Total proving time: ${provingTimeMs}ms`);
            console.log(`📊 Breakdown: Witness=${witnessTime}ms, Proof=${proofTime}ms`);

        } catch (error) {
            console.error('Error generating proof:', error);
            setProofError(error instanceof Error ? error.message : 'Failed to generate proof');
        } finally {
            setIsProving(false);
        }
    };

    const handleInitCommit = async () => {
        if (!proof || !publicInputs || publicInputs.length === 0) {
            setTxError('Proof and public inputs are required');
            return;
        }

        if (!address) {
            setTxError('Please connect your wallet first');
            return;
        }

        try {
            setIsSubmitting(true);
            setTxError(null);
            setTxHash(null);

            // Convert proof hex string to bytes
            const proofBytes = `0x${proof}`;

            // Slice public inputs to 9 elements (circuit has 9 inputs)
            const slicedInputs = publicInputs.slice(0, 9);

            // Convert public inputs to bytes32 array
            const publicInputsBytes32 = slicedInputs.map((input: string) => {
                // Ensure it's a valid bytes32 (64 hex chars + 0x = 66 chars)
                const hex = input.startsWith('0x') ? input.slice(2) : input;
                return `0x${hex.padStart(64, '0')}` as `0x${string}`;
            });

            console.log('Simulating initCommit transaction...');
            console.log('Proof length:', proofBytes.length);
            console.log('Public inputs (sliced to 9):', publicInputsBytes32);

            // Create public client if not available from wagmi
            const client = publicClient || createPublicClient({
                chain: celoSepolia,
                transport: http(process.env.NEXT_PUBLIC_CONTRACT_HOST_RPC || 'https://forno.celo-sepolia.celo-testnet.org')
            });

            // Simulate the transaction first to catch errors
            setIsSimulating(true);
            try {
                const simResult = await client.simulateContract({
                    account: address as `0x${string}`,
                    address: NydusAddress as `0x${string}`,
                    abi: NydusAbi,
                    functionName: 'initCommit',
                    args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[]],
                    // value is optional and defaults to 0 if not provided
                });

                console.log('✅ Simulation successful:', simResult);
                console.log('Gas estimate:', simResult.request?.gas?.toString());
                setSimulationResult(simResult);

            } catch (simulationError: any) {
                // Extract detailed error information
                let errorMessage = 'Transaction simulation failed';

                if (simulationError?.shortMessage) {
                    errorMessage = simulationError.shortMessage;
                } else if (simulationError?.message) {
                    errorMessage = simulationError.message;
                } else if (typeof simulationError === 'string') {
                    errorMessage = simulationError;
                }

                // Try to extract revert reason if available
                if (simulationError?.cause) {
                    const cause = simulationError.cause;
                    if (cause?.data) {
                        errorMessage += `\nRevert data: ${cause.data}`;
                    }
                    if (cause?.reason) {
                        errorMessage += `\nReason: ${cause.reason}`;
                    }
                }

                // Check for specific error types
                if (simulationError?.name === 'ContractFunctionExecutionError') {
                    errorMessage = `Contract execution error: ${errorMessage}`;
                } else if (simulationError?.name === 'ContractFunctionRevertedError') {
                    errorMessage = `Contract reverted: ${errorMessage}`;
                }

                console.error('❌ Simulation failed:', simulationError);
                console.error('Full error object:', JSON.stringify(simulationError, null, 2));
                console.error('Error message:', errorMessage);

                setTxError('Simulation errored');
                setIsSubmitting(false);
                setIsSimulating(false);
                setSimulationResult(null);
                return;
            } finally {
                setIsSimulating(false);
            }

            // If simulation succeeds, proceed with actual transaction
            console.log('Sending initCommit transaction...');

            // Send transaction using wagmi
            writeContract({
                address: NydusAddress as `0x${string}`,
                abi: NydusAbi,
                functionName: 'initCommit',
                args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[]],
                // value defaults to 0 if not provided
            });

        } catch (error) {
            console.error('Error in handleInitCommit:', error);
            setTxError(error instanceof Error ? error.message : 'Failed to process transaction');
            setIsSubmitting(false);
        }
    };

    // Update txHash when hash changes
    React.useEffect(() => {
        if (hash) {
            setTxHash(hash);
        }
    }, [hash]);

    // Show modal when proof is generating, transaction is pending, confirming, or confirmed
    React.useEffect(() => {
        if (isProving || isPending || isConfirming || isConfirmed) {
            setShowTransactionModal(true);
        }
    }, [isProving, isPending, isConfirming, isConfirmed]);

    // Reset isSubmitting when transaction is confirmed or fails
    React.useEffect(() => {
        if (isConfirmed) {
            setIsSubmitting(false);
        }
    }, [isConfirmed]);

    // Reset isSubmitting when transaction is rejected or errors
    React.useEffect(() => {
        if (writeError) {
            setIsSubmitting(false);
        }
    }, [writeError]);

    // Reset isSubmitting when isPending becomes false without a hash (rejected transaction)
    React.useEffect(() => {
        if (!isPending && !hash && isSubmitting) {
            setIsSubmitting(false);
        }
    }, [isPending, hash, isSubmitting]);

    // Show toast on success
    React.useEffect(() => {
        if (isConfirmed && txHash) {
            toast('INITIALIZE TRANSACTION CONFIRMED', 'success');
        }
    }, [isConfirmed, txHash, toast]);

    // Show modal on error
    React.useEffect(() => {
        if (writeError || txError) {
            setShowTransactionModal(true);
        }
    }, [writeError, txError]);

    // Update error when writeError changes
    React.useEffect(() => {
        if (writeError) {
            setTxError(writeError.message || 'Transaction failed');
        }
    }, [writeError]);

    // Self Protocol verification handlers
    const handleSuccessfulVerification = (result: any) => {
        console.log("Verification successful!", result);
        console.log("Full result object:", JSON.stringify(result, null, 2));
        console.log("Result keys:", Object.keys(result || {}));
        
        // Store the full result
        setVerificationResult(result);
        
        // Check for proof in various possible locations
        let foundProof = null;
        
        if (result?.proof) {
            console.log("✓ Proof found in result.proof:", result.proof);
            foundProof = result.proof;
        } else if (result?.data?.proof) {
            console.log("✓ Proof found in result.data.proof:", result.data.proof);
            foundProof = result.data.proof;
        } else if (result?.verificationProof) {
            console.log("✓ Proof found in result.verificationProof:", result.verificationProof);
            foundProof = result.verificationProof;
        } else if (result?.verification?.proof) {
            console.log("✓ Proof found in result.verification.proof:", result.verification.proof);
            foundProof = result.verification.proof;
        } else {
            console.log("⚠ No proof found in result object");
        }
        
        if (foundProof) {
            const proofStr = typeof foundProof === 'string' ? foundProof : JSON.stringify(foundProof);
            setVerificationProof(proofStr);
            // Store in localStorage for use in naming page
            if (typeof window !== 'undefined') {
                localStorage.setItem('selfVerificationProof', proofStr);
            }
            console.log("✓ Verification proof stored:", proofStr);
        }
        
        if (result?.discloseOutput) {
            console.log("Disclose output:", result.discloseOutput);
        }
        if (result?.userIdentifier) {
            console.log("User identifier:", result.userIdentifier);
        }
        
        setVerificationStatus('success');
        toast('Identity verification successful!', 'success');
        setCurrentStep(2);
    };

    const handleVerificationError = (error: any) => {
        console.error("Verification error:", error);
        setVerificationStatus('error');
        toast('Verification failed. Please try again.', 'error');
    };

    // Render step content
    const renderStepContent = () => {
        // Step 1: Self Protocol Verification
        if (currentStep === 1) {
            if (!address) {
                return (
                    <Card className="border-[#333333] bg-[#0a0a0a]">
                        <CardContent className="pt-6">
                            <p className="text-center text-[#888888] font-mono text-sm uppercase">
                                Please connect your wallet to start verification
                            </p>
                        </CardContent>
                    </Card>
                );
            }

            if (!selfApp) {
                return (
                    <Card className="border-[#333333] bg-[#0a0a0a]">
                        <CardContent className="pt-6">
                            <div className="flex flex-col items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[rgba(182,255,62,1)] mb-4"></div>
                                <p className="text-[#888888] font-mono text-sm uppercase">Initializing Verification...</p>
                            </div>
                        </CardContent>
                    </Card>
                );
            }

            const handleOpenSelf = () => {
                if (universalLink) {
                    window.open(universalLink, '_blank');
                }
            };

            return (
                <div className="space-y-6">
                    <Card className="border-[#333333] bg-[#0a0a0a]">
                        <CardHeader>
                            <CardTitle className="text-xl font-mono font-bold uppercase text-white">
                                Step 1: Identity Verification
                            </CardTitle>
                            <CardDescription className="text-[#888888] font-mono text-sm mt-2">
                                Verify your identity using Self Protocol. Use the button below (mobile) or scan the QR code (desktop) with the Self app.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-6">
                            {/* Mobile: Deep Link Button */}
                            <div className="md:hidden flex flex-col items-center space-y-4">
                                <Button
                                    onClick={handleOpenSelf}
                                    disabled={!universalLink}
                                    className="w-full bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Open Self App
                                </Button>
                                {universalLink && (
                                    <p className="text-center text-[#888888] font-mono text-xs uppercase">
                                        Tap to open Self app for verification
                                    </p>
                                )}
                            </div>

                            {/* Desktop: QR Code */}
                            <div className="hidden md:flex flex-col items-center">
                                <div className="p-4 border border-[#333333] bg-white rounded-lg">
                                    <SelfQRcodeWrapper
                                        selfApp={selfApp}
                                        onSuccess={handleSuccessfulVerification}
                                        onError={handleVerificationError}
                                    />
                                </div>
                                <p className="mt-4 text-center text-[#888888] font-mono text-xs sm:text-sm uppercase">
                                    Scan with Self App
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            );
        }

        // Step 2: Waiting 5 seconds before allowing initialization
        if (currentStep === 2) {
            return (
                <Card className="border-[#333333] bg-[#0a0a0a]">
                    <CardHeader>
                        <CardTitle className="text-xl font-mono font-bold uppercase text-white">
                            Step 2: Processing Verification
                        </CardTitle>
                        <CardDescription className="text-[#888888] font-mono text-sm mt-2">
                            Your verification is being processed. Please wait...
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="flex flex-col items-center justify-center py-12 space-y-4">
                            <div className="text-4xl font-mono font-bold text-[rgba(182,255,62,1)] mb-4">
                                {countdown}
                            </div>
                            <p className="text-[#888888] font-mono text-sm uppercase">
                                {countdown > 0 ? 'Preparing initialization...' : 'Ready to initialize!'}
                            </p>
                            
                            {/* Display verification proof if available */}
                            {verificationProof && (
                                <Card className="mt-4 border-[rgba(182,255,62,0.5)] bg-[#0a0a0a] w-full">
                                    <CardHeader>
                                        <CardTitle className="text-sm font-mono font-bold uppercase text-[rgba(182,255,62,1)]">
                                            ✓ Verification Proof Obtained
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="pt-4">
                                        <div className="space-y-2">
                                            <p className="text-xs font-mono text-[#888888] uppercase">Proof:</p>
                                            <p className="text-xs font-mono text-white break-all">
                                                {typeof verificationProof === 'string' 
                                                    ? verificationProof.slice(0, 100) + '...' 
                                                    : JSON.stringify(verificationProof).slice(0, 100) + '...'}
                                            </p>
                                            <Button
                                                onClick={() => {
                                                    const proofStr = typeof verificationProof === 'string' 
                                                        ? verificationProof 
                                                        : JSON.stringify(verificationProof);
                                                    navigator.clipboard.writeText(proofStr);
                                                    toast('Proof copied to clipboard!', 'success');
                                                }}
                                                size="sm"
                                                variant="outline"
                                                className="text-xs mt-2"
                                            >
                                                Copy Proof
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                            
                            {/* Display full result for debugging */}
                            {verificationResult && (
                                <Card className="mt-4 border-[#333333] bg-[#0a0a0a] w-full">
                                    <CardHeader>
                                        <CardTitle className="text-xs font-mono font-bold uppercase text-white">
                                            Debug: Full Result
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="pt-4">
                                        <pre className="text-[10px] font-mono text-[#888888] overflow-auto max-h-40">
                                            {JSON.stringify(verificationResult, null, 2)}
                                        </pre>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    </CardContent>
                </Card>
            );
        }

        // Step 3: Initialize (existing initialization flow)
        return (
            <div className="space-y-3 sm:space-y-4">
                {/* Sign Message Button - Show if no zkAddress */}
                {!zkAddress && (
                                <Button
                                    onClick={handleSign}
                                    disabled={isLoading || isSigning}
                                    className="w-full bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading || isSigning ? 'SIGNING...' : 'SIGN MESSAGE FOR NYDUS NETWORK ACCESS'}
                                </Button>
                            )}

                            {/* Show message if zkAddress exists */}
                            {zkAddress && !userKey && (
                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                    <CardContent className="pt-6">
                                        <p className="text-sm font-mono text-[#888888] uppercase">
                                            COMPUTING USER KEY FROM EXISTING SIGNATURE...
                                        </p>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Form for Circuit Inputs */}
                            {zkAddress && userKey && (
                                <Card>
                                    <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                                            <CardTitle className="text-xs sm:text-sm font-mono uppercase">$ CIRCUIT INPUTS</CardTitle>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-3 sm:space-y-4">
                                            <div>
                                                <label htmlFor="token_address" className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    TOKEN ADDRESS
                                                </label>
                                                <Input
                                                    type="text"
                                                    id="token_address"
                                                    value={tokenAddress}
                                                    onChange={(e) => setTokenAddress(e.target.value)}
                                                    placeholder="0x..."
                                                    className="text-xs sm:text-sm"
                                                />
                                            </div>

                                            <div>
                                                <label htmlFor="amount" className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    AMOUNT
                                                </label>
                                                <Input
                                                    type="text"
                                                    id="amount"
                                                    value={amount}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        // Allow only numbers and decimal point
                                                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                                            setAmount(value);
                                                        }
                                                    }}
                                                    placeholder="0.00001"
                                                    className="text-xs sm:text-sm"
                                                />
                                            </div>

                                            <Button
                                                onClick={proveNydusEntry}
                                                disabled={isProving || isInitializing || !tokenAddress || !amount}
                                                className="w-full bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isProving
                                                    ? `GENERATING PROOF... (${currentProvingTime}MS)`
                                                    : isInitializing
                                                        ? 'INITIALIZING BACKEND...'
                                                        : 'GENERATE NYDUS ENTRY PROOF'
                                                }
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {error && (
                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                    <CardContent className="pt-6">
                                        <p className="text-sm font-mono text-white uppercase">{error}</p>
                                    </CardContent>
                                </Card>
                            )}

                            {proofError && (
                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                    <CardContent className="pt-6">
                                        <p className="text-sm font-mono text-white uppercase">{proofError}</p>
                                    </CardContent>
                                </Card>
                            )}


                            {proof && (
                                <Card>
                                    <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                                            <CardTitle className="text-xs sm:text-sm font-mono uppercase">$ NYDUS ENTRY PROOF</CardTitle>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-3 sm:p-6">
                                        <div className="space-y-2 sm:space-y-3">
                                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0">
                                                <span className="text-xs sm:text-sm font-mono text-[#888888] uppercase">PROOF:</span>
                                                <div className="flex items-center space-x-2">
                                                    <span className="text-xs sm:text-sm text-white font-mono break-all">
                                                        {proof.slice(0, 12)}...{proof.slice(-6)}
                                                    </span>
                                                    <Button
                                                        onClick={() => navigator.clipboard.writeText(proof)}
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-xs"
                                                    >
                                                        COPY
                                                    </Button>
                                                </div>
                                            </div>
                                            {provingTime && (
                                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1 sm:gap-0">
                                                    <span className="text-xs sm:text-sm font-mono text-[#888888] uppercase">PROVING TIME:</span>
                                                    <span className="text-xs sm:text-sm text-white font-mono bg-[#0a0a0a] px-2 py-1 border border-[#333333]">
                                                        {provingTime}MS
                                                    </span>
                                                </div>
                                            )}
                                            {publicInputs.length > 0 && (
                                                <div className="mt-2 sm:mt-3">
                                                    <span className="text-xs sm:text-sm font-mono text-[#888888] uppercase">PUBLIC INPUTS:</span>
                                                    <div className="mt-1 text-[10px] sm:text-xs font-mono text-[#888888]">
                                                        {publicInputs.slice(0, 9).length} INPUTS READY
                                                    </div>
                                                </div>
                                            )}
                                            <p className="text-[10px] sm:text-xs font-mono text-white mt-2 uppercase break-words">
                                                [PROOF GENERATED] DEMONSTRATES YOUR ACCESS TO THE NYDUS NETWORK.
                                            </p>

                                            {/* Simulation Status */}
                                            {isSimulating && (
                                                <Card className="mt-2 sm:mt-3 border-[#333333] bg-[#0a0a0a]">
                                                    <CardContent className="pt-3 sm:pt-4">
                                                        <div className="flex items-center space-x-2">
                                                            <span className="text-white font-mono text-[10px] sm:text-xs">[...]</span>
                                                            <p className="text-xs sm:text-sm font-mono text-white uppercase">SIMULATING...</p>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )}

                                            {simulationResult && !isSimulating && (
                                                <Card className="mt-2 sm:mt-3 border-white bg-black">
                                                    <CardContent className="pt-3 sm:pt-4">
                                                        <p className="text-xs sm:text-sm font-mono text-white font-bold uppercase">[SIMULATION SUCCESSFUL]</p>
                                                        {simulationResult.request?.gas && (
                                                            <p className="text-[10px] sm:text-xs font-mono text-[#888888] mt-1 uppercase">
                                                                GAS: {simulationResult.request.gas.toString()}
                                                            </p>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            )}

                                            {/* Transaction Button */}
                                            <Button
                                                onClick={handleInitCommit}
                                                disabled={isPending || isConfirming || isSubmitting || isSimulating || !publicInputs.length}
                                                className="w-full mt-3 sm:mt-4 text-xs sm:text-sm bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isSimulating
                                                    ? 'SIMULATING...'
                                                    : isPending || isSubmitting
                                                        ? 'PREPARING...'
                                                        : isConfirming
                                                            ? 'CONFIRMING...'
                                                            : 'INITIALIZE ON NYDUS'
                                                }
                                            </Button>

                                            {/* Transaction Status */}
                                            {txHash && (
                                                <Card className="mt-2 sm:mt-3 border-white bg-black">
                                                    <CardContent className="pt-3 sm:pt-4">
                                                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-0">
                                                            <span className="text-xs sm:text-sm font-mono text-white uppercase">TX HASH:</span>
                                                            <a
                                                                href={`https://sepolia.basescan.org/tx/${txHash}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-xs sm:text-sm font-mono text-white hover:text-[#888888] underline break-all"
                                                            >
                                                                {txHash.slice(0, 12)}...{txHash.slice(-6)}
                                                            </a>
                                                        </div>
                                                        {isConfirming && (
                                                            <p className="text-[10px] sm:text-xs font-mono text-[#888888] mt-1 uppercase">
                                                                WAITING FOR CONFIRMATION...
                                                            </p>
                                                        )}
                                                        {isConfirmed && (
                                                            <p className="text-[10px] sm:text-xs font-mono text-white font-bold mt-1 uppercase">
                                                                [CONFIRMED]
                                                            </p>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            )}

                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
            );
    };

    return (
        <div className="min-h-screen pt-20 sm:pt-24 pb-8 sm:pb-12 px-3 sm:px-4 lg:px-6">
            <div className="max-w-2xl mx-auto">
                <Card>
                    <CardHeader className="border-b border-[#333333] bg-black/50 py-3 px-3 sm:px-4 mb-4">
                        <div className="flex items-center gap-2 justify-center mb-1">
                            <div className="w-1 h-4 bg-[rgba(182,255,62,1)]"></div>
                            <CardTitle className="text-center text-base sm:text-xl font-mono uppercase">INITIALIZE</CardTitle>
                        </div>
                        <CardDescription className="text-center text-xs sm:text-sm font-mono">
                            {currentStep === 1 && 'STEP 1: VERIFY YOUR IDENTITY'}
                            {currentStep === 2 && 'STEP 2: WAITING FOR ON-CHAIN CONFIRMATION'}
                            {currentStep === 3 && 'STEP 3: SET UP YOUR PRIVATE ACCOUNT'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-3 sm:p-6">
                        {renderStepContent()}
                    </CardContent>
                </Card>
            </div>

            <TransactionModal
                isOpen={showTransactionModal}
                onClose={() => setShowTransactionModal(false)}
                isProving={isProving}
                isPending={isPending || isSubmitting}
                isConfirming={isConfirming}
                isConfirmed={isConfirmed}
                txHash={txHash}
                error={txError || writeError?.message || proofError || null}
                transactionType="INITIALIZE"
            />
        </div>
    );
}