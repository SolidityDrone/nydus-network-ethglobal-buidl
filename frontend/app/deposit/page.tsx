'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAccount as useAccountContext, useZkAddress } from '@/context/AccountProvider';
import { useAccountState } from '@/context/AccountStateProvider';
import { useAccount as useWagmiAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useCeloPublicClient } from '@/hooks/useCeloPublicClient';
import { useSignMessage } from 'wagmi';
import { createPublicClient, http } from 'viem';
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
import { Noir } from '@noir-lang/noir_js';
import { CachedUltraHonkBackend } from '@/lib/cached-ultra-honk-backend';
import circuit from '@/lib/circuits/nydus_deposit.json';
import { computeZkAddress, NYDUS_MESSAGE } from '@/lib/zk-address';
import { NydusAddress, NydusAbi } from '@/lib/abi/NydusConst';
import { pedersenCommitmentPositive } from '@/lib/pedersen-commitments';
import { loadAccountDataOnSign } from '@/lib/loadAccountDataOnSign';
import { useNonceDiscovery } from '@/hooks/useNonceDiscovery';
import { saveAccountData, loadAccountData } from '@/lib/indexeddb';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TransactionModal from '@/components/TransactionModal';
import SyncingModal from '@/components/SyncingModal';
import { useToast } from '@/components/Toast';
import TokenSelector from '@/components/TokenSelector';
import { generateProofRemote } from '@/lib/proof-server';

export default function DepositPage() {
    const { toast } = useToast();
    const zkAddress = useZkAddress();
    const { setZkAddress, account } = useAccountContext();
    const accountState = useAccountState();
    const {
        balanceEntries,
        getPersonalCommitmentState,
        currentNonce,
        userKey: contextUserKey,
        setCurrentNonce,
        setBalanceEntries,
        setUserKey,
        setIsSyncing,
        setPersonalCommitmentState,
        isSyncing
    } = accountState;

    // Redirect to initialize if nonce is 0 or null
    React.useEffect(() => {
        if (currentNonce === null || currentNonce === BigInt(0)) {
            window.location.href = '/initialize';
        }
    }, [currentNonce]);

    // Fallback if setIsSyncing is not available (for debugging)
    if (!setIsSyncing || typeof setIsSyncing !== 'function') {
        console.warn('⚠️ setIsSyncing not available in accountState:', accountState);
    }
    const { computeCurrentNonce, reconstructPersonalCommitmentState } = useNonceDiscovery();
    const { signMessageAsync, isPending: isSigning } = useSignMessage();
    const { address } = useWagmiAccount();

    // Redirect to initialize if nonce is 0 or null
    React.useEffect(() => {
        if (currentNonce === null || currentNonce === BigInt(0)) {
            window.location.href = '/initialize';
        }
    }, [currentNonce]);
    const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });
    const publicClient = useCeloPublicClient();

    const [tokenAddress, setTokenAddress] = useState<string>('');
    const [amount, setAmount] = useState<string>('');
    const [selectedBalanceEntry, setSelectedBalanceEntry] = useState<number | null>(null);
    const [localUserKey, setLocalUserKey] = useState<string>('');
    const [publicInputs, setPublicInputs] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isProving, setIsProving] = useState(false);
    const [proof, setProof] = useState<string>('');
    const [proofMode, setProofMode] = useState<'local' | 'remote'>('local');
    const [isCheckingServer, setIsCheckingServer] = useState(false);
    const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
    const [proofError, setProofError] = useState<string | null>(null);
    const [, setProvingTime] = useState<number | null>(null);
    const [currentProvingTime, setCurrentProvingTime] = useState<number>(0);
    const [isInitializing, setIsInitializing] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [_initializationTime, setInitializationTime] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSimulating, setIsSimulating] = useState(false);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [hasTransactionBeenSent, setHasTransactionBeenSent] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);
    const [, setSimulationResult] = useState<any>(null);
    const [isCalculatingInputs, setIsCalculatingInputs] = useState(false);
    const [showTransactionModal, setShowTransactionModal] = useState(false);

    const backendRef = useRef<CachedUltraHonkBackend | null>(null);
    const noirRef = useRef<Noir | null>(null);

    React.useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isProving) {
            const startTime = performance.now();
            interval = setInterval(() => {
                const elapsed = Math.round(performance.now() - startTime);
                setCurrentProvingTime(elapsed);
            }, 100);
        } else {
            setCurrentProvingTime(0);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isProving]);

    const initializeBackend = useCallback(async () => {
        if (isInitialized && backendRef.current && noirRef.current) {
            return;
        }

        const startTime = performance.now();
        setIsInitializing(true);

        try {
            const backendOptions = {
                threads: 1,
            };

            const backend = new CachedUltraHonkBackend(circuit.bytecode, backendOptions);
            const noir = new Noir(circuit);

            backendRef.current = backend;
            noirRef.current = noir;

            const endTime = performance.now();
            const initTime = Math.round(endTime - startTime);
            setInitializationTime(initTime);
            setIsInitialized(true);

        } catch (error) {
            console.error('Failed to initialize backend:', error);
            throw error;
        } finally {
            setIsInitializing(false);
        }
    }, [isInitialized]);

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
                setUserKey,
            }, account?.signature);

            // Compute private key (user_key) from signature (only if not loaded from IndexedDB)
            if (!contextUserKey) {
                const userKeyHex = await computePrivateKeyFromSignature(signatureValue);
                // Ensure userKey always has 0x prefix
                setLocalUserKey(userKeyHex.startsWith('0x') ? userKeyHex : '0x' + userKeyHex);
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

    // Load saved account data when zkAddress is available (e.g., on page refresh)
    React.useEffect(() => {
        const loadSavedData = async () => {
            if (zkAddress && currentNonce === null) {
                // Only load if we don't already have a nonce (to avoid overwriting fresh data)
                console.log('🔄 zkAddress available but no currentNonce - loading from IndexedDB...');
                await loadAccountDataOnSign(zkAddress, {
                    setCurrentNonce,
                    setBalanceEntries,
                    setUserKey,
                }, account?.signature);
            }
        };
        loadSavedData();
    }, [zkAddress, currentNonce, setCurrentNonce, setBalanceEntries, setUserKey]);

    // Track if auto-sync has been performed to avoid multiple calls
    const hasAutoSyncedRef = React.useRef(false);

    // Auto-sync account data when page loads if states are missing
    React.useEffect(() => {
        // Skip if we've already auto-synced
        if (hasAutoSyncedRef.current) {
            return;
        }

        const autoSync = async () => {
            // Only sync if we have zkAddress and currentNonce, but might be missing states
            if (!zkAddress || currentNonce === null || balanceEntries.length === 0) {
                return;
            }

            // Check if we're missing any personal commitment states
            const missingStates = balanceEntries.filter(entry => {
                const state = getPersonalCommitmentState(entry.nonce, entry.tokenAddress);
                return !state;
            });

            // If we have missing states, trigger a refresh to reconstruct them
            if (missingStates.length > 0) {
                console.log(`🔄 Auto-syncing: ${missingStates.length} missing personal commitment states detected`);
                hasAutoSyncedRef.current = true; // Mark as synced
                // Small delay to ensure other effects have completed
                setTimeout(() => {
                    refreshAccountData();
                }, 500);
            } else {
                // No missing states, mark as synced anyway
                hasAutoSyncedRef.current = true;
            }
        };

        // Only run once when component mounts and data is available
        const timer = setTimeout(() => {
            autoSync();
        }, 1000);

        return () => clearTimeout(timer);
    }, [zkAddress, currentNonce, balanceEntries.length, getPersonalCommitmentState]);

    // Initialize user_key from context or existing signature
    React.useEffect(() => {
        const initializeFromExisting = async () => {
            if (contextUserKey) {
                setLocalUserKey('0x' + contextUserKey.toString(16));
            } else if (zkAddress && account?.signature && !localUserKey) {
                try {
                    const userKeyHex = await computePrivateKeyFromSignature(account.signature);
                    // Ensure userKey always has 0x prefix
                    setLocalUserKey(userKeyHex.startsWith('0x') ? userKeyHex : '0x' + userKeyHex);
                    console.log('User key initialized from existing signature:', userKeyHex);
                } catch (error) {
                    console.error('Error computing user_key from existing signature:', error);
                }
            }
        };
        initializeFromExisting();
    }, [zkAddress, account?.signature, localUserKey, contextUserKey]);

    // Note: Personal commitment states are NOT automatically reconstructed here.
    // They will be reconstructed on-demand when needed (e.g., when generating a proof),
    // or when the user opens AccountModal (which reconstructs all states).
    // This matches AccountModal behavior - states are only reconstructed when the modal is opened.

    // Auto-fill form when balance entry is selected
    useEffect(() => {
        if (selectedBalanceEntry !== null && balanceEntries[selectedBalanceEntry]) {
            const entry = balanceEntries[selectedBalanceEntry];
            setTokenAddress('0x' + entry.tokenAddress.toString(16));
        }
    }, [selectedBalanceEntry, balanceEntries]);

    // Calculate circuit inputs dynamically
    const calculateCircuitInputs = async () => {
        // Use contextUserKey if available, otherwise use localUserKey
        const userKeyToUse = contextUserKey ? '0x' + contextUserKey.toString(16) : localUserKey;

        if (!userKeyToUse || !tokenAddress || !amount || currentNonce === null) {
            throw new Error('Missing required inputs: userKey, tokenAddress, amount, or currentNonce');
        }

        setIsCalculatingInputs(true);
        try {
            // Ensure Buffer polyfill
            const { ensureBufferPolyfill } = await import('@/lib/zk-address');
            await ensureBufferPolyfill();

            const { poseidon2Hash } = await import('@aztec/foundation/crypto');
            const { poseidonCtrEncrypt } = await import('@/lib/poseidon-ctr-encryption');

            // Convert inputs to bigint
            const tokenAddressBigInt = BigInt(tokenAddress.startsWith('0x') ? tokenAddress : '0x' + tokenAddress);

            // Convert decimal amount to hex (default 18 decimals)
            const decimals = 18;
            const amountFloat = parseFloat(amount) || 0;
            const amountInWei = BigInt(Math.floor(amountFloat * Math.pow(10, decimals)));
            const amountBigInt = amountInWei;

            console.log(`[Deposit] Amount conversion: ${amountFloat} (decimal) -> ${amountInWei.toString()} (wei) = 0x${amountInWei.toString(16)}`);
            // Ensure userKey has 0x prefix before converting to BigInt
            // userKey might be a hex string without prefix (e.g., from context)
            const userKeyNormalized = userKeyToUse.startsWith('0x') ? userKeyToUse : '0x' + userKeyToUse;
            const userKeyBigInt = BigInt(userKeyNormalized);

            // For deposit, we need to find the previous balance entry for THIS token
            // The previous nonce for the circuit is still currentNonce - 1 (global last used nonce)
            // But we need to find the balance entry for this token at the highest nonce <= previousNonce
            const previousNonce = currentNonce > BigInt(0) ? currentNonce - BigInt(1) : BigInt(0);

            // Find the balance entry for this token at the highest nonce <= previousNonce
            // This handles tokens that may not have transactions at every nonce
            const tokenEntries = balanceEntries
                .filter(entry => entry.tokenAddress === tokenAddressBigInt && entry.nonce <= previousNonce)
                .sort((a, b) => a.nonce > b.nonce ? -1 : 1); // Sort descending by nonce

            const balanceEntry = tokenEntries.length > 0 ? tokenEntries[0] : null;
            const tokenPreviousNonce = balanceEntry ? balanceEntry.nonce : BigInt(0);

            // For new token deposits, we need to ensure account is initialized (has nonce 0 entry)
            if (!balanceEntry) {
                // Check if account is initialized
                const entryBalanceEntry = balanceEntries.find(entry => entry.nonce === BigInt(0));
                if (!entryBalanceEntry) {
                    throw new Error(`No balance entry found for token ${tokenAddress} at any nonce <= ${previousNonce}, and account is not initialized. Please initialize your account first (nonce 0).`);
                }
                console.log(`ℹ️ New token deposit: No balance entry found for token ${tokenAddress} at any nonce <= ${previousNonce}. Using amount 0 as previous balance.`);
            } else {
                console.log(`ℹ️ Found balance entry for token ${tokenAddress} at nonce ${tokenPreviousNonce} (global previous nonce: ${previousNonce})`);
            }

            // Get personal commitment state from context
            // Use the token's previous nonce (not the global previous nonce) for state lookup
            let personalState = getPersonalCommitmentState(tokenPreviousNonce, tokenAddressBigInt);

            // If state doesn't exist, reconstruct it on-demand (lazy loading)
            if (!personalState) {
                console.log(`  🔄 Personal commitment state not found for token ${tokenAddress} at nonce ${tokenPreviousNonce}, reconstructing on-demand...`);

                if (!account?.signature || !contextUserKey) {
                    throw new Error(`Personal commitment state not found and cannot reconstruct: missing signature or userKey. Please visit /account first.`);
                }

                // Use the balance entry we found (or amount 0 for new tokens)
                const previousAmount = balanceEntry ? balanceEntry.amount : BigInt(0);
                if (!balanceEntry) {
                    console.log(`  ℹ️ New token: Using amount 0 for previous balance`);
                }

                // Reconstruct the state (with amount 0 for new tokens)
                personalState = await reconstructPersonalCommitmentState(
                    previousAmount,
                    tokenAddressBigInt,
                    contextUserKey
                );

                // Store it in context for future use (using token's previous nonce)
                setPersonalCommitmentState(tokenPreviousNonce, tokenAddressBigInt, personalState);
                console.log(`  ✅ Reconstructed and stored personal commitment state for token ${tokenAddress} at nonce ${tokenPreviousNonce}`);
            }

            // Get main_c_tot from contract (stateCommitmentPoint)
            if (!publicClient) {
                throw new Error('Public client not available');
            }

            const stateCommitment = await publicClient.readContract({
                address: NydusAddress,
                abi: NydusAbi,
                functionName: 'getStateCommitment',
            });

            // Handle different return formats (tuple or object)
            let x: bigint;
            let y: bigint;

            if (Array.isArray(stateCommitment)) {
                // Tuple format: [x, y]
                x = stateCommitment[0];
                y = stateCommitment[1];
            } else if (stateCommitment && typeof stateCommitment === 'object') {
                // Object format: { x, y }
                x = (stateCommitment as any).x;
                y = (stateCommitment as any).y;
            } else {
                throw new Error('Invalid state commitment format from contract');
            }

            // Ensure both values are BigInt and not undefined
            if (x === undefined || x === null) {
                throw new Error('State commitment x is undefined');
            }
            if (y === undefined || y === null) {
                throw new Error('State commitment y is undefined');
            }

            const mainCTot = [
                typeof x === 'bigint' ? x : BigInt(x),
                typeof y === 'bigint' ? y : BigInt(y)
            ];

            // Fetch opening values from contract (required for subsequent deposits)
            let contractStateM: bigint | undefined;
            let contractStateR: bigint | undefined;
            let contractStateD: bigint | undefined;
            try {
                const result = await publicClient.readContract({
                    address: NydusAddress,
                    abi: NydusAbi,
                    functionName: 'getStateCommitmentOpeningValues',
                });

                console.log('Raw result from getStateCommitmentOpeningValues:', result);
                console.log('Result type:', typeof result);
                console.log('Is array?', Array.isArray(result));
                if (result && typeof result === 'object') {
                    console.log('Result keys:', Object.keys(result));
                }

                // Handle different return formats
                let stateM: any, stateR: any, stateD: any;
                if (Array.isArray(result)) {
                    [stateM, stateR, stateD] = result;
                } else if (result && typeof result === 'object') {
                    // Try different property names
                    stateM = (result as any).m ?? (result as any).stateM ?? (result as any)[0];
                    stateR = (result as any).r ?? (result as any).stateR ?? (result as any)[1];
                    stateD = (result as any).d ?? (result as any).stateD ?? (result as any)[2];
                } else {
                    throw new Error('Unexpected return format from getStateCommitmentOpeningValues');
                }

                console.log('Extracted values:');
                console.log('  stateM:', stateM, 'type:', typeof stateM);
                console.log('  stateR:', stateR, 'type:', typeof stateR);
                console.log('  stateD:', stateD, 'type:', typeof stateD);

                if (stateM === undefined || stateR === undefined || stateD === undefined) {
                    throw new Error(`One or more opening values are undefined: m=${stateM}, r=${stateR}, d=${stateD}`);
                }

                contractStateM = BigInt(stateM.toString());
                contractStateR = BigInt(stateR.toString());
                contractStateD = BigInt(stateD.toString());
                console.log('Fetched contract state opening values:');
                console.log('  M = 0x' + contractStateM.toString(16));
                console.log('  R = 0x' + contractStateR.toString(16));
                console.log('  D = 0x' + contractStateD.toString(16));
            } catch (error) {
                console.error('Error fetching contract state opening values:', error);
                console.error('Error details:', JSON.stringify(error, null, 2));
                // For subsequent deposits, we need these values
                if (currentNonce > BigInt(0)) {
                    throw new Error(`Could not fetch contract state opening values: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Calculate user_key_hash and view_key
            const userKeyHash = await poseidon2Hash([userKeyBigInt]);
            let userKeyHashBigInt: bigint;
            if (typeof userKeyHash === 'bigint') {
                userKeyHashBigInt = userKeyHash;
            } else if ('toBigInt' in userKeyHash && typeof (userKeyHash as any).toBigInt === 'function') {
                userKeyHashBigInt = (userKeyHash as any).toBigInt();
            } else if ('value' in userKeyHash) {
                userKeyHashBigInt = BigInt((userKeyHash as any).value);
            } else {
                userKeyHashBigInt = BigInt((userKeyHash as any).toString());
            }

            const VIEW_STRING = BigInt('0x76696577696e675f6b6579');
            const viewKeyHash = await poseidon2Hash([VIEW_STRING, userKeyHashBigInt]);
            let viewKeyBigInt: bigint;
            if (typeof viewKeyHash === 'bigint') {
                viewKeyBigInt = viewKeyHash;
            } else if ('toBigInt' in viewKeyHash && typeof (viewKeyHash as any).toBigInt === 'function') {
                viewKeyBigInt = (viewKeyHash as any).toBigInt();
            } else if ('value' in viewKeyHash) {
                viewKeyBigInt = BigInt((viewKeyHash as any).value);
            } else {
                viewKeyBigInt = BigInt((viewKeyHash as any).toString());
            }

            // Calculate previous_nonce_commitment
            // ALL circuits (entry, deposit, absorb, send, withdraw) use: Poseidon2::hash([user_key_hash, nonce], 2)
            // This is consistent across all circuits - entry circuit also uses user_key_hash for nonce 0
            const previousNonceCommitmentHash = await poseidon2Hash([userKeyHashBigInt, previousNonce]);
            let previousNonceCommitmentBigInt: bigint;
            if (typeof previousNonceCommitmentHash === 'bigint') {
                previousNonceCommitmentBigInt = previousNonceCommitmentHash;
            } else if ('toBigInt' in previousNonceCommitmentHash && typeof (previousNonceCommitmentHash as any).toBigInt === 'function') {
                previousNonceCommitmentBigInt = (previousNonceCommitmentHash as any).toBigInt();
            } else if ('value' in previousNonceCommitmentHash) {
                previousNonceCommitmentBigInt = BigInt((previousNonceCommitmentHash as any).value);
            } else {
                previousNonceCommitmentBigInt = BigInt((previousNonceCommitmentHash as any).toString());
            }

            console.log('Computed previous_nonce_commitment:');
            console.log(`  Previous nonce: ${previousNonce.toString()}`);
            console.log(`  Using user_key_hash (consistent across all circuits, including entry for nonce 0)`);
            console.log(`  user_key_hash: 0x${userKeyHashBigInt.toString(16)}`);
            console.log(`  Nonce commitment: 0x${previousNonceCommitmentBigInt.toString(16)}`);
            console.log('');

            // For main_c_inner_point, we need the opening values that were used in the previous transaction
            // For entry transaction (nonce 0), the entry circuit uses PLAINTEXT c_tot.x, c_tot.y (not encrypted)
            // Entry creates: pedersen_commitment_positive(c_tot.x, c_tot.y, nonce_commitment)
            // So main_c_inner_point should be [c_tot.x, c_tot.y] from entry (plaintext personal_c_tot)
            // For subsequent transactions (nonce > 0), we use encrypted coordinates

            let mainCInnerPoint: [bigint, bigint];

            // Declare variables for entry circuit reconstruction (for comparison)
            let entryCTot: { x: bigint; y: bigint } | undefined;
            let _entryMainCommitment: { x: bigint; y: bigint } | undefined;

            if (previousNonce === BigInt(0)) {
                // First deposit after entry: need to reconstruct entry circuit's c_tot
                // Entry circuit creates:
                //   c_balance_commitment = pedersen_commitment_non_hiding(amount_hashed, token_address_hashed)
                //   c_token_initializer = pedersen_commitment_non_hiding(token_address_hashed, user_key_hash)
                //   c_inbound_nullifier = pedersen_commitment_non_hiding(nullifier_hashed, nullifier_domain)
                //   c_tot = c_balance_commitment + c_token_initializer + c_inbound_nullifier
                //   main_stack_commitment = pedersen_commitment_positive(c_tot.x, c_tot.y, nonce_commitment)
                //
                // However, deposit circuit expects main_c_inner_point to decrypt to personal_c_tot (without nullifier)
                // This is a mismatch that needs to be resolved at the circuit level
                // For now, we'll use the deposit circuit's personal_c_tot as the test does

                const { pedersenCommitmentNonHiding, grumpkinAddPoints, toNullifierDomain } = await import('@/lib/pedersen-commitments');
                const { poseidonCtrEncrypt } = await import('@/lib/poseidon-ctr-encryption');

                // Get the previous balance (from balance entry)
                // For new tokens, use amount 0; for existing tokens, use the actual balance
                const entryBalanceEntry = balanceEntries.find(entry => entry.nonce === BigInt(0));
                if (!entryBalanceEntry) {
                    throw new Error('Entry balance entry not found. Make sure you have initialized your account (nonce 0).');
                }

                // Find balance entry for this specific token at nonce 0
                const tokenBalanceEntry = balanceEntries.find(
                    entry => entry.nonce === BigInt(0) && entry.tokenAddress === tokenAddressBigInt
                );

                // Use the token's balance if found, otherwise 0 for new tokens
                const prevBalanceAmount = tokenBalanceEntry
                    ? (tokenBalanceEntry.amount ?? BigInt(0))
                    : BigInt(0);

                if (tokenBalanceEntry) {
                    console.log(`  Using existing token balance: ${prevBalanceAmount.toString()}`);
                } else {
                    console.log(`  New token deposit: Using amount 0 as previous balance`);
                }

                // Create personal_c_tot as the deposit circuit expects it
                // prev_balance_amount_hash = Poseidon2::hash([prev_balance_amount, user_key_hash], 2)
                const prevBalanceAmountHash = await poseidon2Hash([prevBalanceAmount, userKeyHashBigInt]);
                if (prevBalanceAmountHash === undefined || prevBalanceAmountHash === null) {
                    throw new Error('prevBalanceAmountHash is undefined');
                }
                let prevBalanceAmountHashBigInt: bigint;
                if (typeof prevBalanceAmountHash === 'bigint') {
                    prevBalanceAmountHashBigInt = prevBalanceAmountHash;
                } else if ('toBigInt' in prevBalanceAmountHash && typeof (prevBalanceAmountHash as any).toBigInt === 'function') {
                    prevBalanceAmountHashBigInt = (prevBalanceAmountHash as any).toBigInt();
                } else if ('value' in prevBalanceAmountHash) {
                    prevBalanceAmountHashBigInt = BigInt((prevBalanceAmountHash as any).value);
                } else {
                    prevBalanceAmountHashBigInt = BigInt((prevBalanceAmountHash as any).toString());
                }
                // Compute token_address_hash (same as used elsewhere in the function)
                const tokenAddressHash = await poseidon2Hash([tokenAddressBigInt, userKeyHashBigInt]);
                if (tokenAddressHash === undefined || tokenAddressHash === null) {
                    throw new Error('tokenAddressHash is undefined');
                }
                let tokenAddressHashedBigInt: bigint;
                if (typeof tokenAddressHash === 'bigint') {
                    tokenAddressHashedBigInt = tokenAddressHash;
                } else if ('toBigInt' in tokenAddressHash && typeof (tokenAddressHash as any).toBigInt === 'function') {
                    tokenAddressHashedBigInt = (tokenAddressHash as any).toBigInt();
                } else if ('value' in tokenAddressHash) {
                    tokenAddressHashedBigInt = BigInt((tokenAddressHash as any).value);
                } else {
                    tokenAddressHashedBigInt = BigInt((tokenAddressHash as any).toString());
                }

                // Reconstruct entry circuit's c_tot (with nullifier) for verification
                const nullifier = BigInt(0);
                const nullifierHash = await poseidon2Hash([nullifier, userKeyHashBigInt]);
                if (nullifierHash === undefined || nullifierHash === null) {
                    throw new Error('nullifierHash is undefined');
                }
                let nullifierHashBigInt: bigint;
                if (typeof nullifierHash === 'bigint') {
                    nullifierHashBigInt = nullifierHash;
                } else if ('toBigInt' in nullifierHash && typeof (nullifierHash as any).toBigInt === 'function') {
                    nullifierHashBigInt = (nullifierHash as any).toBigInt();
                } else if ('value' in nullifierHash) {
                    nullifierHashBigInt = BigInt((nullifierHash as any).value);
                } else {
                    nullifierHashBigInt = BigInt((nullifierHash as any).toString());
                }
                const nullifierDomain = toNullifierDomain(tokenAddressBigInt);

                // Entry circuit's c_tot components
                const cBalanceCommitment = pedersenCommitmentNonHiding(prevBalanceAmountHashBigInt, tokenAddressHashedBigInt);
                const cTokenInitializer = pedersenCommitmentNonHiding(tokenAddressHashedBigInt, userKeyHashBigInt);
                const cInboundNullifier = pedersenCommitmentNonHiding(nullifierHashBigInt, nullifierDomain);
                entryCTot = grumpkinAddPoints(
                    grumpkinAddPoints(cBalanceCommitment, cTokenInitializer),
                    cInboundNullifier
                );
                // Log only the entry circuit's c_tot reconstruction (what we're verifying)
                console.log('=== ENTRY CIRCUIT C_TOT RECONSTRUCTION ===');
                console.log('personal_c_tot.x = 0x' + entryCTot.x.toString(16));
                console.log('personal_c_tot.y = 0x' + entryCTot.y.toString(16));
                console.log('');

                // Construct deposit circuit's personal_c_tot (without nullifier) - matching test approach
                const personalCInnerCommitment = pedersenCommitmentNonHiding(prevBalanceAmountHashBigInt, tokenAddressHashedBigInt);
                const personalCOuterCommitment = pedersenCommitmentNonHiding(BigInt(0), tokenAddressBigInt);
                const initializer = pedersenCommitmentNonHiding(tokenAddressBigInt, userKeyHashBigInt);
                const personalCTotCommitment = grumpkinAddPoints(
                    grumpkinAddPoints(personalCInnerCommitment, personalCOuterCommitment),
                    initializer
                );

                // Encrypt deposit circuit's personal_c_tot (as test does in tests.nr lines 98-101)
                const previousEncryptionKey = await poseidon2Hash([viewKeyBigInt, previousNonce]);
                if (previousEncryptionKey === undefined || previousEncryptionKey === null) {
                    throw new Error('previousEncryptionKey is undefined');
                }
                let previousEncryptionKeyBigInt: bigint;
                if (typeof previousEncryptionKey === 'bigint') {
                    previousEncryptionKeyBigInt = previousEncryptionKey;
                } else if ('toBigInt' in previousEncryptionKey && typeof (previousEncryptionKey as any).toBigInt === 'function') {
                    previousEncryptionKeyBigInt = (previousEncryptionKey as any).toBigInt();
                } else if ('value' in previousEncryptionKey) {
                    previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).value);
                } else {
                    previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).toString());
                }

                const encryptedX = await poseidonCtrEncrypt(personalCTotCommitment.x, previousEncryptionKeyBigInt, 3);
                const encryptedY = await poseidonCtrEncrypt(personalCTotCommitment.y, previousEncryptionKeyBigInt, 4);

                // Use encrypted deposit circuit's personal_c_tot (matching test approach)
                mainCInnerPoint = [encryptedX, encryptedY];
            } else {
                // Subsequent deposits: fetch enc_x and enc_y from the previous nonce commitment
                // These are stored in the contract as encCTotM and encCTotR
                // Note: The circuit uses the global previousNonce, but if the token doesn't have a transaction
                // at that nonce, we need to compute mainCInnerPoint from the reconstructed personal state
                try {
                    // Check if the token has a transaction at the global previousNonce
                    const tokenHasTransactionAtPreviousNonce = tokenPreviousNonce === previousNonce;

                    if (!tokenHasTransactionAtPreviousNonce) {
                        // Token doesn't have a transaction at the global previousNonce
                        // Compute mainCInnerPoint from the reconstructed personal state
                        // CRITICAL: Always use global previousNonce for encryption (circuit requirement)
                        // The personal state is correctly reconstructed from token's previous nonce,
                        // but the encryption key must use global previousNonce
                        console.log(`  Token's previous nonce (${tokenPreviousNonce.toString()}) differs from global previous nonce (${previousNonce.toString()})`);
                        console.log(`  Computing main_c_inner_point from reconstructed personal_c_tot...`);
                        console.log(`  Using global previous nonce (${previousNonce.toString()}) for encryption key (circuit requirement)`);

                        const previousEncryptionKey = await poseidon2Hash([viewKeyBigInt, previousNonce]);
                        let previousEncryptionKeyBigInt: bigint;
                        if (typeof previousEncryptionKey === 'bigint') {
                            previousEncryptionKeyBigInt = previousEncryptionKey;
                        } else if ('toBigInt' in previousEncryptionKey && typeof (previousEncryptionKey as any).toBigInt === 'function') {
                            previousEncryptionKeyBigInt = (previousEncryptionKey as any).toBigInt();
                        } else if ('value' in previousEncryptionKey) {
                            previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).value);
                        } else {
                            previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).toString());
                        }

                        const { poseidonCtrEncrypt } = await import('@/lib/poseidon-ctr-encryption');
                        mainCInnerPoint = [
                            await poseidonCtrEncrypt(personalState.personal_c_tot[0], previousEncryptionKeyBigInt, 3),
                            await poseidonCtrEncrypt(personalState.personal_c_tot[1], previousEncryptionKeyBigInt, 4),
                        ];

                        console.log('Computed main_c_inner_point from personal_c_tot:');
                        console.log(`  Personal state reconstructed from token's previous nonce: ${tokenPreviousNonce.toString()}`);
                        console.log(`  Encryption key uses global previous nonce: ${previousNonce.toString()}`);
                        console.log('  enc_x = 0x' + mainCInnerPoint[0].toString(16));
                        console.log('  enc_y = 0x' + mainCInnerPoint[1].toString(16));
                        console.log('');
                    } else {
                        // Token has a transaction at the global previousNonce, fetch from contract
                        const previousPersonalCTot = await publicClient.readContract({
                            address: NydusAddress,
                            abi: NydusAbi,
                            functionName: 'getPersonalCTotReference',
                            args: [previousNonceCommitmentBigInt],
                        });

                        console.log('Fetched previous nonce personal_c_tot values from contract:');
                        console.log('  Previous nonce commitment:', '0x' + previousNonceCommitmentBigInt.toString(16));
                        console.log('  Raw result:', previousPersonalCTot);

                        // Handle different return formats (array vs object)
                        let encCTotM: any, encCTotR: any;
                        if (Array.isArray(previousPersonalCTot)) {
                            [encCTotM, encCTotR] = previousPersonalCTot;
                        } else if (previousPersonalCTot && typeof previousPersonalCTot === 'object') {
                            encCTotM = (previousPersonalCTot as any).encCTotM ?? (previousPersonalCTot as any)[0];
                            encCTotR = (previousPersonalCTot as any).encCTotR ?? (previousPersonalCTot as any)[1];
                        } else {
                            throw new Error('Unexpected return format from getPersonalCTotReference');
                        }

                        if (encCTotM === undefined || encCTotM === null || encCTotR === undefined || encCTotR === null) {
                            throw new Error('Previous nonce personal_c_tot values are undefined. Make sure the previous transaction was completed.');
                        }

                        const previousEncX = BigInt(encCTotM.toString());
                        const previousEncY = BigInt(encCTotR.toString());

                        // Check if both values are zero (which means the entry doesn't exist in the mapping)
                        if (previousEncX === BigInt(0) && previousEncY === BigInt(0)) {
                            // Fallback: compute encrypted values from personal_c_tot
                            console.warn('⚠️ Previous nonce personal_c_tot values not found in contract (both are zero).');
                            console.warn('Falling back to computing encrypted values from personal_c_tot...');

                            // Compute encrypted values using the global previousNonce (circuit requirement)
                            const previousEncryptionKey = await poseidon2Hash([viewKeyBigInt, previousNonce]);
                            let previousEncryptionKeyBigInt: bigint;
                            if (typeof previousEncryptionKey === 'bigint') {
                                previousEncryptionKeyBigInt = previousEncryptionKey;
                            } else if ('toBigInt' in previousEncryptionKey && typeof (previousEncryptionKey as any).toBigInt === 'function') {
                                previousEncryptionKeyBigInt = (previousEncryptionKey as any).toBigInt();
                            } else if ('value' in previousEncryptionKey) {
                                previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).value);
                            } else {
                                previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).toString());
                            }

                            const { poseidonCtrEncrypt } = await import('@/lib/poseidon-ctr-encryption');
                            mainCInnerPoint = [
                                await poseidonCtrEncrypt(personalState.personal_c_tot[0], previousEncryptionKeyBigInt, 3),
                                await poseidonCtrEncrypt(personalState.personal_c_tot[1], previousEncryptionKeyBigInt, 4),
                            ];

                            console.log('Computed fallback enc_x and enc_y from personal_c_tot:');
                            console.log(`  Using global previous nonce: ${previousNonce.toString()}`);
                            console.log('  enc_x = 0x' + mainCInnerPoint[0].toString(16));
                            console.log('  enc_y = 0x' + mainCInnerPoint[1].toString(16));
                            console.log('');
                        } else {
                            // Use the stored enc_x and enc_y from the previous transaction
                            mainCInnerPoint = [previousEncX, previousEncY];

                            console.log('Using stored enc_x and enc_y from previous transaction:');
                            console.log('  enc_x = 0x' + previousEncX.toString(16));
                            console.log('  enc_y = 0x' + previousEncY.toString(16));
                            console.log('');

                            // CRITICAL: Verify that main_c_inner_point decrypts to personal_c_tot
                            // The circuit will verify this, so we should check it here too
                            // Always use global previousNonce for decryption (circuit requirement)
                            const { poseidonCtrDecrypt } = await import('@/lib/poseidon-ctr-encryption');
                            const previousEncryptionKey = await poseidon2Hash([viewKeyBigInt, previousNonce]);
                            let previousEncryptionKeyBigInt: bigint;
                            if (typeof previousEncryptionKey === 'bigint') {
                                previousEncryptionKeyBigInt = previousEncryptionKey;
                            } else if ('toBigInt' in previousEncryptionKey && typeof (previousEncryptionKey as any).toBigInt === 'function') {
                                previousEncryptionKeyBigInt = (previousEncryptionKey as any).toBigInt();
                            } else if ('value' in previousEncryptionKey) {
                                previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).value);
                            } else {
                                previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).toString());
                            }

                            const decryptedX = await poseidonCtrDecrypt(mainCInnerPoint[0], previousEncryptionKeyBigInt, 3);
                            const decryptedY = await poseidonCtrDecrypt(mainCInnerPoint[1], previousEncryptionKeyBigInt, 4);

                            console.log('Verifying main_c_inner_point decryption:');
                            console.log(`  Decrypted x = 0x${decryptedX.toString(16)}`);
                            console.log(`  personal_c_tot[0] = 0x${personalState.personal_c_tot[0].toString(16)}`);
                            console.log(`  Match? ${decryptedX === personalState.personal_c_tot[0]}`);
                            console.log(`  Decrypted y = 0x${decryptedY.toString(16)}`);
                            console.log(`  personal_c_tot[1] = 0x${personalState.personal_c_tot[1].toString(16)}`);
                            console.log(`  Match? ${decryptedY === personalState.personal_c_tot[1]}`);
                            console.log('');

                            if (decryptedX !== personalState.personal_c_tot[0] || decryptedY !== personalState.personal_c_tot[1]) {
                                console.warn('⚠️ WARNING: main_c_inner_point does not decrypt to personal_c_tot!');
                                console.warn('  Stored values from contract may be incorrect or from a different computation.');
                                console.warn('  This will cause the circuit to fail with "Decrypted x coordinate doesn\'t match personal_c_tot"');
                                console.warn('');
                                console.warn('  Decrypted x = 0x' + decryptedX.toString(16));
                                console.warn('  Expected x  = 0x' + personalState.personal_c_tot[0].toString(16));
                                console.warn('  Decrypted y = 0x' + decryptedY.toString(16));
                                console.warn('  Expected y  = 0x' + personalState.personal_c_tot[1].toString(16));
                                console.warn('');
                                console.warn('  Recomputing main_c_inner_point from current personal_c_tot to ensure consistency...');

                                // Recompute from current personal_c_tot to ensure they match
                                const { poseidonCtrEncrypt } = await import('@/lib/poseidon-ctr-encryption');
                                const recomputedEncX = await poseidonCtrEncrypt(personalState.personal_c_tot[0], previousEncryptionKeyBigInt, 3);
                                const recomputedEncY = await poseidonCtrEncrypt(personalState.personal_c_tot[1], previousEncryptionKeyBigInt, 4);

                                console.log('✅ Recomputed main_c_inner_point:');
                                console.log(`    enc_x = 0x${recomputedEncX.toString(16)}`);
                                console.log(`    enc_y = 0x${recomputedEncY.toString(16)}`);
                                console.log(`  (was: enc_x = 0x${previousEncX.toString(16)}, enc_y = 0x${previousEncY.toString(16)})`);
                                console.log('');

                                // Verify the recomputed values decrypt correctly
                                const verifyDecryptedX = await poseidonCtrDecrypt(recomputedEncX, previousEncryptionKeyBigInt, 3);
                                const verifyDecryptedY = await poseidonCtrDecrypt(recomputedEncY, previousEncryptionKeyBigInt, 4);
                                if (verifyDecryptedX === personalState.personal_c_tot[0] && verifyDecryptedY === personalState.personal_c_tot[1]) {
                                    console.log('✅ Verified: Recomputed main_c_inner_point correctly decrypts to personal_c_tot');
                                    console.log('');
                                } else {
                                    throw new Error('Recomputed main_c_inner_point still does not decrypt correctly - this is a bug');
                                }

                                // Use the recomputed values
                                mainCInnerPoint = [recomputedEncX, recomputedEncY];
                            } else {
                                console.log('✅ Verified: main_c_inner_point correctly decrypts to personal_c_tot');
                                console.log('');
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error fetching previous nonce personal_c_tot:', error);
                    throw new Error(`Could not fetch previous nonce personal_c_tot values: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Compute initial state commitment
            const initialStateCommitment = pedersenCommitmentPositive(BigInt(1), BigInt(1), BigInt(1));

            // Calculate main_c_inner = pedersen_commitment_positive(main_c_inner_point[0], main_c_inner_point[1], previous_nonce_commitment)
            console.log('=== COMPUTING MAIN_C_INNER ===');
            console.log('Using values:');
            console.log(`  main_c_inner_point[0] (enc_x) = 0x${mainCInnerPoint[0].toString(16)}`);
            console.log(`  main_c_inner_point[1] (enc_y) = 0x${mainCInnerPoint[1].toString(16)}`);
            console.log(`  previous_nonce_commitment = 0x${previousNonceCommitmentBigInt.toString(16)}`);
            console.log('');
            console.log('Computing: pedersen_commitment_positive(enc_x, enc_y, previous_nonce_commitment)');

            const mainCInner = pedersenCommitmentPositive(
                mainCInnerPoint[0],
                mainCInnerPoint[1],
                previousNonceCommitmentBigInt
            );

            console.log('Result main_c_inner:');
            console.log('  x = 0x' + mainCInner.x.toString(16));
            console.log('  y = 0x' + mainCInner.y.toString(16));
            console.log('');
            console.log('=== MAIN COMMITMENTS (HEX) ===');
            console.log('main_c_inner:');
            console.log('  x = 0x' + mainCInner.x.toString(16));
            console.log('  y = 0x' + mainCInner.y.toString(16));
            console.log('');

            // For main_c_outer_point, we need opening values that reconstruct to the computed main_c_outer
            let mainCOuterPoint: [bigint, bigint, bigint];
            let mainCOuter: { x: bigint; y: bigint };
            let mainCTotForCircuit: [bigint, bigint];

            if (previousNonce === BigInt(0)) {
                // First deposit after entry: construct main_c_tot as test does
                // main_c_tot = initial_state + main_c_inner (where main_c_inner uses deposit circuit's personal_c_tot)
                // This ensures main_c_outer = initial_state
                const { grumpkinAddPoints } = await import('@/lib/pedersen-commitments');
                const mainCTotComputed = grumpkinAddPoints(initialStateCommitment, mainCInner);
                mainCTotForCircuit = [mainCTotComputed.x, mainCTotComputed.y];
                mainCOuter = initialStateCommitment;
                mainCOuterPoint = [BigInt(1), BigInt(1), BigInt(1)];

                console.log('initial_state_commitment:');
                console.log('  x = 0x' + initialStateCommitment.x.toString(16));
                console.log('  y = 0x' + initialStateCommitment.y.toString(16));
                console.log('');
                console.log('main_c_outer (should equal initial_state):');
                console.log('  x = 0x' + mainCOuter.x.toString(16));
                console.log('  y = 0x' + mainCOuter.y.toString(16));
                console.log('');
                console.log('main_c_tot (computed as initial_state + main_c_inner):');
                console.log('  x = 0x' + mainCTotForCircuit[0].toString(16));
                console.log('  y = 0x' + mainCTotForCircuit[1].toString(16));
                console.log('');

                // Verify: main_c_tot should equal main_c_inner + main_c_outer
                const { grumpkinAddPoints: verifyAdd } = await import('@/lib/pedersen-commitments');
                const verifiedMainCTot = verifyAdd(mainCInner, mainCOuter);
                console.log('Verification: main_c_inner + main_c_outer:');
                console.log('  x = 0x' + verifiedMainCTot.x.toString(16));
                console.log('  y = 0x' + verifiedMainCTot.y.toString(16));
                console.log('');
                console.log('Match?', verifiedMainCTot.x === mainCTotForCircuit[0] && verifiedMainCTot.y === mainCTotForCircuit[1]);
                console.log('');
            } else {
                // Subsequent deposits: use contract's main_c_tot and compute main_c_outer
                const { grumpkinSubtract } = await import('@/lib/pedersen-commitments');
                mainCOuter = grumpkinSubtract(
                    { x: mainCTot[0], y: mainCTot[1] },
                    mainCInner
                );
                mainCTotForCircuit = [mainCTot[0], mainCTot[1]];

                console.log('main_c_outer (computed as main_c_tot - main_c_inner):');
                console.log('  x = 0x' + mainCOuter.x.toString(16));
                console.log('  y = 0x' + mainCOuter.y.toString(16));
                console.log('');
                console.log('main_c_tot (from contract):');
                console.log('  x = 0x' + mainCTotForCircuit[0].toString(16));
                console.log('  y = 0x' + mainCTotForCircuit[1].toString(16));
                console.log('');
                console.log('main_c_inner (previous deposit commitment):');
                console.log('  x = 0x' + mainCInner.x.toString(16));
                console.log('  y = 0x' + mainCInner.y.toString(16));
                console.log('');

                // Verify: main_c_outer should be initial + entry (everything before the previous deposit)
                // For deposit 2: main_c_outer = initial + entry
                // For deposit 3: main_c_outer = initial + entry + deposit_1
                // etc.
                console.log('Expected main_c_outer composition:');
                console.log(`  For deposit at nonce ${currentNonce}, main_c_outer should be:`);
                console.log(`    initial_state + entry + all deposits before nonce ${previousNonce}`);
                console.log(`  Which equals: main_c_tot (before current) - main_c_inner (previous deposit)`);
                console.log(`  This should match the computed main_c_outer above.`);
                console.log('');

                // Verify: main_c_tot should equal main_c_inner + main_c_outer
                const { grumpkinAddPoints: verifyAdd } = await import('@/lib/pedersen-commitments');
                const verifiedMainCTot = verifyAdd(mainCInner, mainCOuter);
                console.log('Verification: main_c_inner + main_c_outer:');
                console.log('  x = 0x' + verifiedMainCTot.x.toString(16));
                console.log('  y = 0x' + verifiedMainCTot.y.toString(16));
                console.log('');
                console.log('Match?', verifiedMainCTot.x === mainCTotForCircuit[0] && verifiedMainCTot.y === mainCTotForCircuit[1]);
                console.log('');

                // For subsequent deposits, we need to compute main_c_outer_point correctly
                // The key insight: main_c_outer = initial + entry + all operations before previousNonce
                // 
                // CRITICAL: Scalar subtraction of opening values does NOT give us the correct
                // opening values for point subtraction. We need to reconstruct main_c_outer_point
                // by fetching the opening values for each operation in main_c_outer and summing them.
                //
                // For deposit 2 (nonce 2, previousNonce = 1):
                // - main_c_outer = initial + entry (nonce 0)
                // - We need to fetch entry's opening values and add them to initial (1, 1, 1)

                if (contractStateM === undefined || contractStateR === undefined || contractStateD === undefined) {
                    throw new Error('Could not fetch contract state opening values. Please try again.');
                }

                const BN254_SCALAR_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

                console.log('=== COMPUTING MAIN_C_OUTER_POINT ===');
                console.log('For subsequent deposit: main_c_outer includes ALL previous operations');
                console.log(`  Current nonce: ${currentNonce.toString()}`);
                console.log(`  Previous nonce: ${previousNonce.toString()}`);
                console.log('');
                console.log('Strategy: Compute main_c_outer_point by subtracting previous operation\'s opening values');
                console.log('  from contract\'s aggregated opening values');
                console.log('  main_c_outer = initial + entry + all operations before previousNonce');
                console.log('');

                // Compute main_c_outer_point
                // For subsequent deposits (previousNonce > 0), we compute by subtracting the previous operation's
                // opening values from the contract's aggregated opening values.
                // 
                // The contract's aggregated opening values = initial(1,1,1) + entry + all deposits up to current state
                // For main_c_outer, we need: initial + entry + all deposits before previousNonce
                // So: main_c_outer_point = contract_aggregated - previous_deposit_opening_values
                //
                // Note: mainCInnerPoint[0] and mainCInnerPoint[1] are the encrypted point coordinates from the
                // previous deposit, which are used as opening values (m, r) in the contract's addStateCommitment.
                // previousNonceCommitmentBigInt is the d opening value for the previous deposit.
                const mainCOuterM = (contractStateM - mainCInnerPoint[0] + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                const mainCOuterR = (contractStateR - mainCInnerPoint[1] + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                const mainCOuterD = (contractStateD - previousNonceCommitmentBigInt + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                mainCOuterPoint = [mainCOuterM, mainCOuterR, mainCOuterD];

                // CRITICAL FIX: Compute main_c_outer from main_c_outer_point instead of point subtraction
                // This ensures consistency with what the circuit will verify
                const { pedersenCommitmentPositive } = await import('@/lib/pedersen-commitments');
                const mainCOuterFromPoint = pedersenCommitmentPositive(mainCOuterPoint[0], mainCOuterPoint[1], mainCOuterPoint[2]);
                mainCOuter = mainCOuterFromPoint;

                // Recompute main_c_tot from main_c_inner + main_c_outer (using the recomputed main_c_outer)
                const { grumpkinAddPoints } = await import('@/lib/pedersen-commitments');
                const mainCTotRecomputed = grumpkinAddPoints(mainCInner, mainCOuter);
                mainCTotForCircuit = [mainCTotRecomputed.x, mainCTotRecomputed.y];

                console.log('Computed main_c_outer_point via scalar subtraction:');
                console.log(`  Contract aggregated M = 0x${contractStateM.toString(16)}`);
                console.log(`  Previous deposit enc_x (m) = 0x${mainCInnerPoint[0].toString(16)}`);
                console.log(`  Result M = 0x${mainCOuterM.toString(16)}`);
                console.log(`  Contract aggregated R = 0x${contractStateR.toString(16)}`);
                console.log(`  Previous deposit enc_y (r) = 0x${mainCInnerPoint[1].toString(16)}`);
                console.log(`  Result R = 0x${mainCOuterR.toString(16)}`);
                console.log(`  Contract aggregated D = 0x${contractStateD.toString(16)}`);
                console.log(`  Previous deposit nonce (d) = 0x${previousNonceCommitmentBigInt.toString(16)}`);
                console.log(`  Result D = 0x${mainCOuterD.toString(16)}`);
                console.log('');

                console.log('=== MAIN_C_OUTER_POINT COMPUTATION (subsequent deposit) ===');
                console.log('Contract state opening values:');
                console.log('  M = 0x' + contractStateM.toString(16));
                console.log('  R = 0x' + contractStateR.toString(16));
                console.log('  D = 0x' + contractStateD.toString(16));
                console.log('');
                console.log('Current main_c_inner_point:');
                console.log('  [0] = 0x' + mainCInnerPoint[0].toString(16));
                console.log('  [1] = 0x' + mainCInnerPoint[1].toString(16));
                console.log('  previous_nonce_commitment = 0x' + previousNonceCommitmentBigInt.toString(16));
                console.log('');
                console.log('Computed main_c_outer_point:');
                console.log('  [0] = 0x' + mainCOuterPoint[0].toString(16));
                console.log('  [1] = 0x' + mainCOuterPoint[1].toString(16));
                console.log('  [2] = 0x' + mainCOuterPoint[2].toString(16));
                console.log('');

                // Verify that the opening values reconstruct to main_c_outer
                const reconstructedMainCOuterFinal = pedersenCommitmentPositive(
                    mainCOuterPoint[0],
                    mainCOuterPoint[1],
                    mainCOuterPoint[2]
                );

                console.log('=== MAIN_C_OUTER_POINT VERIFICATION ===');
                console.log('main_c_outer (computed from main_c_outer_point):');
                console.log('    x = 0x' + mainCOuter.x.toString(16));
                console.log('    y = 0x' + mainCOuter.y.toString(16));
                console.log('main_c_tot (computed from main_c_inner + main_c_outer):');
                console.log('    x = 0x' + mainCTotForCircuit[0].toString(16));
                console.log('    y = 0x' + mainCTotForCircuit[1].toString(16));
                console.log('✅ Using main_c_outer computed from main_c_outer_point to ensure circuit consistency');
                console.log('');

                // Verify that main_c_outer_point correctly reconstructs to main_c_outer
                // Since we computed main_c_outer from main_c_outer_point, this should always match
                if (reconstructedMainCOuterFinal.x !== mainCOuter.x || reconstructedMainCOuterFinal.y !== mainCOuter.y) {
                    console.error('❌ ERROR: main_c_outer_point opening values do not reconstruct to main_c_outer point!');
                    console.error('This indicates a bug in the computation. main_c_outer was computed from main_c_outer_point,');
                    console.error('so they should match. This should never happen.');
                    throw new Error('main_c_outer_point reconstruction failed - this is a bug');
                } else {
                    console.log('✅ Verified: main_c_outer_point correctly reconstructs to main_c_outer');
                    console.log('');
                }
            }

            console.log('=== OPENING VALUES (HEX) ===');
            console.log('main_c_inner_point:');
            console.log('  [0] = 0x' + mainCInnerPoint[0].toString(16));
            console.log('  [1] = 0x' + mainCInnerPoint[1].toString(16));
            console.log('');
            console.log('main_c_outer_point:');
            console.log('  [0] = 0x' + mainCOuterPoint[0].toString(16));
            console.log('  [1] = 0x' + mainCOuterPoint[1].toString(16));
            console.log('  [2] = 0x' + mainCOuterPoint[2].toString(16));
            console.log('');
            console.log('previous_nonce_commitment:');
            console.log('  = 0x' + previousNonceCommitmentBigInt.toString(16));
            console.log('');

            // Convert hex strings to decimal strings for Noir circuit inputs
            // Noir expects decimal integer strings, not hex strings
            const formatForNoir = (value: bigint | string): string => {
                if (typeof value === 'bigint') {
                    return value.toString(); // Decimal string
                }
                // If it's a hex string, convert to bigint then to decimal
                const hexValue = value.startsWith('0x') ? value : '0x' + value;
                return BigInt(hexValue).toString(); // Decimal string
            };

            console.log('=== CIRCUIT INPUTS SUMMARY ===');
            console.log(`previous_nonce: ${previousNonce.toString()}`);
            console.log(`previous_nonce_commitment (computed in frontend): 0x${previousNonceCommitmentBigInt.toString(16)}`);
            console.log(`main_c_inner_point[0] (enc_x): 0x${mainCInnerPoint[0].toString(16)}`);
            console.log(`main_c_inner_point[1] (enc_y): 0x${mainCInnerPoint[1].toString(16)}`);
            console.log(`main_c_inner (computed): (0x${mainCInner.x.toString(16)}, 0x${mainCInner.y.toString(16)})`);
            console.log('');
            console.log('Note: The circuit will compute previous_nonce_commitment internally.');
            console.log(`For previous_nonce = ${previousNonce.toString()}, it should use ${previousNonce === BigInt(0) ? 'user_key' : 'user_key_hash'}.`);
            console.log('If the circuit fails, make sure the circuit JSON was rebuilt with the updated code.');
            console.log('');

            // Use contextUserKey if available, otherwise use localUserKey
            const userKeyForCircuit = contextUserKey ? '0x' + contextUserKey.toString(16) : localUserKey;

            return {
                user_key: formatForNoir(userKeyForCircuit),
                token_address: formatForNoir(tokenAddress),
                amount: formatForNoir(amountBigInt),
                previous_nonce: previousNonce.toString(),
                main_c_tot: [mainCTotForCircuit[0].toString(), mainCTotForCircuit[1].toString()],
                main_c_inner: [mainCInner.x.toString(), mainCInner.y.toString()],
                main_c_outer: [mainCOuter.x.toString(), mainCOuter.y.toString()],
                main_c_inner_point: [mainCInnerPoint[0].toString(), mainCInnerPoint[1].toString()],
                main_c_outer_point: [mainCOuterPoint[0].toString(), mainCOuterPoint[1].toString(), mainCOuterPoint[2].toString()],
                personal_c_tot: [personalState.personal_c_tot[0].toString(), personalState.personal_c_tot[1].toString()],
                personal_c_inner: [personalState.personal_c_inner[0].toString(), personalState.personal_c_inner[1].toString()],
                personal_c_outer: [personalState.personal_c_outer[0].toString(), personalState.personal_c_outer[1].toString()],
                personal_c_inner_m: personalState.personal_c_inner_m.toString(),
                personal_c_outer_m: personalState.personal_c_outer_m.toString(),
                personal_c_outer_r: personalState.personal_c_outer_r.toString(),
            };
        } finally {
            setIsCalculatingInputs(false);
        }
    };

    const proveDeposit = async () => {
        if (!zkAddress) {
            setProofError('Please sign a message first to access the Nydus network');
            return;
        }

        if (!tokenAddress || !amount) {
            setProofError('Please enter token address and amount');
            return;
        }

        if (currentNonce === null) {
            setProofError('Please compute your current nonce first by visiting /account');
            return;
        }

        try {
            setIsProving(true);
            setProofError(null);
            setProvingTime(null);

            const startTime = performance.now();

            // Calculate circuit inputs dynamically
            const inputs = await calculateCircuitInputs();

            let proofHex: string;
            let publicInputsHex: string[];

            if (proofMode === 'remote') {
                // Remote proof generation
                console.log('🌐 Generating proof remotely...');
                const result = await generateProofRemote('deposit', inputs);
                proofHex = result.proof;
                publicInputsHex = result.publicInputs.slice(0, 16); // Slice to 16 for deposit
                const provingTimeMs = result.timing.total;
                setProvingTime(provingTimeMs);
                console.log('✅ Remote proof generated successfully');
                console.log(`Total proving time: ${provingTimeMs}ms (execution: ${result.timing.execution}ms, proving: ${result.timing.proving}ms)`);
            } else {
                // Local proof generation
                console.log('💻 Generating proof locally...');
                await initializeBackend();

                if (!backendRef.current || !noirRef.current) {
                    throw new Error('Failed to initialize backend');
                }

                //@ts-ignore
                const { witness } = await noirRef.current!.execute(inputs, { keccak: true });
                console.log('Circuit execution result:', witness);

                //@ts-ignore
                const proofResult = await backendRef.current!.generateProof(witness, { keccak: true });
                console.log('Generated proof:', proofResult);
                proofHex = Buffer.from(proofResult.proof).toString('hex');

                // Extract public inputs from proof result and slice to 16 elements (circuit has 16 public inputs)
                // Public inputs: token_address(1) + amount(1) + mainCommitmentReference(2) + newNonceCommitment(1) 
                //                + newMainCommitment(2) + encrypted_note(5) + nonceDiscoveryEntry(2) + enc_x(1) + enc_y(1) = 16 total
                const publicInputsArray = (proofResult.publicInputs || []).slice(0, 16);
                // Convert public inputs to hex strings (bytes32 format)
                publicInputsHex = publicInputsArray.map((input: any) => {
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

                const endTime = performance.now();
                const provingTimeMs = Math.round(endTime - startTime);
                setProvingTime(provingTimeMs);
                console.log('✅ Local proof generated successfully');
                console.log(`Total proving time: ${provingTimeMs}ms`);
            }

            setProof(proofHex);
            setPublicInputs(publicInputsHex);
            console.log('Proof:', proofHex);
            console.log('Public inputs:', publicInputsHex);

        } catch (error) {
            console.error('Error generating proof:', error);
            setProofError(error instanceof Error ? error.message : 'Failed to generate proof');
        } finally {
            setIsProving(false);
        }
    };

    const handleDeposit = async () => {
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

            // Slice public inputs to 16 elements (circuit has 16 public inputs)
            const slicedInputs = publicInputs.slice(0, 16);

            // Convert public inputs to bytes32 array
            const publicInputsBytes32 = slicedInputs.map((input: string) => {
                // Ensure it's a valid bytes32 (64 hex chars + 0x = 66 chars)
                const hex = input.startsWith('0x') ? input.slice(2) : input;
                return `0x${hex.padStart(64, '0')}` as `0x${string}`;
            });

            console.log('Simulating deposit transaction...');
            console.log('Proof length:', proofBytes.length);
            console.log('Public inputs (sliced to 16):', publicInputsBytes32);

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
                    functionName: 'deposit',
                    args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[]],
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
            console.log('Sending deposit transaction...');

            // Send transaction using wagmi
            writeContract({
                address: NydusAddress as `0x${string}`,
                abi: NydusAbi,
                functionName: 'deposit',
                args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[]],
            });
            // Mark that transaction has been sent
            setHasTransactionBeenSent(true);

        } catch (error) {
            console.error('Error in handleDeposit:', error);
            setTxError(error instanceof Error ? error.message : 'Failed to process transaction');
            setIsSubmitting(false);
        }
    };

    // Update txHash when hash changes and mark transaction as sent
    React.useEffect(() => {
        if (hash) {
            setHasTransactionBeenSent(true);
            setTxHash(hash);
        }
    }, [hash]);

    // Show modal when proof is generating, transaction is pending, confirming, or confirmed
    React.useEffect(() => {
        if (isProving || isPending || isConfirming || isConfirmed) {
            setShowTransactionModal(true);
        }
    }, [isProving, isPending, isConfirming, isConfirmed]);

    // Show toast on success
    React.useEffect(() => {
        if (isConfirmed && txHash) {
            toast('DEPOSIT TRANSACTION CONFIRMED', 'success');
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
            setIsSubmitting(false);
            setHasTransactionBeenSent(false); // Allow retry after error
        }
    }, [writeError]);

    // Reset submitting state when transaction completes or is rejected
    React.useEffect(() => {
        if (isConfirmed) {
            setIsSubmitting(false);
        }
    }, [isConfirmed]);

    // Reset submitting state when transaction is rejected (isPending becomes false without hash)
    React.useEffect(() => {
        if (!isPending && !hash && isSubmitting && hasTransactionBeenSent) {
            // Transaction was likely rejected - reset after a short delay
            const timer = setTimeout(() => {
                setIsSubmitting(false);
                setHasTransactionBeenSent(false); // Allow retry after rejection
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [isPending, hash, isSubmitting, hasTransactionBeenSent]);

    // Refresh account data when transaction is confirmed
    const refreshAccountData = useCallback(async () => {
        console.log('🔄 refreshAccountData called!');
        console.log('  zkAddress:', zkAddress);
        console.log('  setIsSyncing type:', typeof setIsSyncing);

        if (!zkAddress) {
            console.warn('⚠️ No zkAddress, skipping refresh');
            return;
        }

        if (typeof setIsSyncing !== 'function') {
            console.error('❌ setIsSyncing is not a function!', setIsSyncing);
            console.error('  Full accountState:', accountState);
            // Continue without syncing indicator if setIsSyncing is not available
        } else {
            setIsSyncing(true);
        }
        try {
            console.log('🔄 Refreshing account data after transaction confirmation...');
            // Load cached data first
            const savedData = await loadAccountData(zkAddress);
            console.log('📦 Loaded cached data:', savedData ? {
                currentNonce: savedData.currentNonce?.toString() || 'null',
                balanceEntriesCount: savedData.balanceEntries?.length || 0,
                hasUserKey: savedData.userKey !== null
            } : 'null');

            const cachedNonce = savedData?.currentNonce || null;
            const cachedBalanceEntries = savedData?.balanceEntries || [];

            // After a transaction, the nonce should have incremented
            // Start checking from the cached nonce (which should now be the previous nonce)
            // Or start from 0 if no cached nonce
            console.log(`📊 Starting nonce computation from cached nonce: ${cachedNonce?.toString() || 'null'}`);

            // Call computeCurrentNonce once - no retry needed for simple refresh
            // (Retry logic is only needed when we expect the nonce to have changed after a transaction)
            console.log('  Calling computeCurrentNonce...');
            const result = await computeCurrentNonce(cachedNonce, cachedBalanceEntries);
            console.log('  computeCurrentNonce returned:', result ? {
                currentNonce: result.currentNonce?.toString() || 'null',
                balanceEntriesCount: result.balanceEntries?.length || 0,
                hasUserKey: result.userKey !== null
            } : 'null');

            if (result) {
                console.log(`✅ Successfully computed nonce: ${result.currentNonce.toString()}`);

                console.log('  Updating state...');
                setCurrentNonce(result.currentNonce);
                setBalanceEntries(result.balanceEntries);

                // Get or compute userKey
                let userKeyToUse = result.userKey;
                if (!userKeyToUse && account?.signature) {
                    console.log('  Computing userKey from signature...');
                    // Compute userKey from signature if not available
                    const { ensureBufferPolyfill } = await import('@/lib/zk-address');
                    await ensureBufferPolyfill();

                    const sigHex = account.signature.startsWith('0x') ? account.signature.slice(2) : account.signature;
                    const sigBuffer = globalThis.Buffer.from(sigHex, 'hex');

                    if (sigBuffer.length === 65) {
                        const chunk1 = sigBuffer.slice(0, 31);
                        const chunk2 = sigBuffer.slice(31, 62);
                        const chunk3 = sigBuffer.slice(62, 65);

                        const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
                        const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
                        const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));

                        const { poseidon2Hash } = await import('@aztec/foundation/crypto');
                        const poseidonHash = await poseidon2Hash([chunk1BigInt, chunk2BigInt, chunk3BigInt]);

                        if (typeof poseidonHash === 'bigint') {
                            userKeyToUse = poseidonHash;
                        } else if ('toBigInt' in poseidonHash && typeof (poseidonHash as any).toBigInt === 'function') {
                            userKeyToUse = (poseidonHash as any).toBigInt();
                        } else if ('value' in poseidonHash) {
                            userKeyToUse = BigInt((poseidonHash as any).value);
                        } else {
                            userKeyToUse = BigInt((poseidonHash as any).toString());
                        }
                    }
                }

                if (userKeyToUse) {
                    setUserKey(userKeyToUse);
                    console.log('  UserKey set:', userKeyToUse.toString(16).slice(0, 16) + '...');
                }

                // Reconstruct personal commitment states only for NEW entries (not in cached data)
                // This avoids reconstructing all states on every refresh
                if (result.balanceEntries.length > 0 && userKeyToUse && reconstructPersonalCommitmentState) {
                    // Find new entries (those not in cachedBalanceEntries)
                    const cachedNonceSet = new Set(cachedBalanceEntries.map(e => `${e.nonce.toString()}-${e.tokenAddress.toString()}`));
                    const newEntries = result.balanceEntries.filter(entry => {
                        const key = `${entry.nonce.toString()}-${entry.tokenAddress.toString()}`;
                        return !cachedNonceSet.has(key);
                    });

                    if (newEntries.length > 0) {
                        console.log(`  Reconstructing personal commitment states for ${newEntries.length} NEW entries (out of ${result.balanceEntries.length} total)...`);
                        try {
                            for (const entry of newEntries) {
                                // Check if state already exists before reconstructing
                                const existingState = getPersonalCommitmentState(entry.nonce, entry.tokenAddress);
                                if (!existingState) {
                                    const state = await reconstructPersonalCommitmentState(
                                        entry.amount,
                                        entry.tokenAddress,
                                        userKeyToUse
                                    );
                                    setPersonalCommitmentState(entry.nonce, entry.tokenAddress, state);
                                    console.log(`    ✓ Reconstructed state for token ${entry.tokenAddress.toString(16).slice(0, 10)}... at nonce ${entry.nonce.toString()}`);
                                } else {
                                    console.log(`    ⊙ State already exists for token ${entry.tokenAddress.toString(16).slice(0, 10)}... at nonce ${entry.nonce.toString()}`);
                                }
                            }
                            console.log('  ✅ New personal commitment states reconstructed');
                        } catch (error) {
                            console.error('  ❌ Error reconstructing personal commitment states:', error);
                        }
                    } else {
                        console.log('  ⊙ No new entries to reconstruct states for');
                    }
                }

                // Save to IndexedDB
                const now = Date.now();
                const dataToSave = {
                    zkAddress,
                    currentNonce: result.currentNonce,
                    balanceEntries: result.balanceEntries,
                    userKey: userKeyToUse || null,
                    lastUpdated: now,
                };
                console.log('💾 Saving to IndexedDB:', {
                    zkAddress: dataToSave.zkAddress,
                    currentNonce: dataToSave.currentNonce.toString(),
                    balanceEntriesCount: dataToSave.balanceEntries.length,
                    hasUserKey: dataToSave.userKey !== null,
                    lastUpdated: new Date(now).toISOString()
                });

                await saveAccountData(dataToSave);
                console.log('✅ Account data refreshed and saved to IndexedDB');
            } else {
                console.error('❌ computeCurrentNonce returned null');
            }
        } catch (error) {
            console.error('❌ Error refreshing account data:', error);
            if (error instanceof Error) {
                console.error('  Error message:', error.message);
                console.error('  Error stack:', error.stack);
            }
        } finally {
            if (typeof setIsSyncing === 'function') {
                setIsSyncing(false);
            }
            console.log('🔄 refreshAccountData completed');
        }
    }, [zkAddress, computeCurrentNonce, setCurrentNonce, setBalanceEntries, setUserKey, setIsSyncing, accountState, account?.signature, reconstructPersonalCommitmentState, setPersonalCommitmentState, getPersonalCommitmentState]);

    // Clear form data and states, and reload account data
    const handleClear = useCallback(async () => {
        // Clear form data
        setTokenAddress('');
        setAmount('');
        setSelectedBalanceEntry(null);
        setLocalUserKey('');
        setPublicInputs([]);
        setError(null);
        setIsProving(false);
        setProof('');
        setProofError(null);
        setProvingTime(null);
        setCurrentProvingTime(0);
        setTxHash(null);
        setTxError(null);
        setSimulationResult(null);
        setIsSubmitting(false);
        setIsSimulating(false);
        setShowTransactionModal(false);
        setHasTransactionBeenSent(false);
        // Note: hash from useWriteContract will be reset when a new transaction starts

        // Reload account data from blockchain and save to IndexedDB
        if (zkAddress) {
            console.log('🔄 Clearing form and reloading account data...');
            await refreshAccountData();
        }
    }, [zkAddress, refreshAccountData]);

    return (
        <div className="min-h-screen pt-20 sm:pt-24 pb-8 sm:pb-12 px-3 sm:px-4 lg:px-6">
            <div className="max-w-2xl mx-auto">
                <Card>
                    <CardHeader className="relative border-b border-[#333333] bg-black/50 py-3 px-3 sm:px-4 mb-4">
                        <div className="flex items-center gap-2 justify-center mb-1">
                            <div className="w-1 h-4 bg-[rgba(182,255,62,1)]"></div>
                            <CardTitle className="text-center text-base sm:text-xl font-mono uppercase">DEPOSIT</CardTitle>
                        </div>
                        <CardDescription className="text-center text-xs sm:text-sm font-mono">ADD FUNDS TO YOUR PRIVATE ACCOUNT</CardDescription>
                        <Button
                            onClick={handleClear}
                            variant="outline"
                            size="sm"
                            className="absolute top-2 right-2 font-mono text-xs"
                        >
                            CLEAR
                        </Button>
                    </CardHeader>
                    <CardContent className="p-3 sm:p-6">
                        <div className="space-y-3 sm:space-y-4">
                            {/* Sign Message Button - Show if no zkAddress */}
                            {!zkAddress && (
                                <Button
                                    onClick={handleSign}
                                    disabled={isLoading || isSigning}
                                    className="w-full"
                                >
                                    {isLoading || isSigning ? 'SIGNING...' : 'SIGN MESSAGE FOR NYDUS NETWORK ACCESS'}
                                </Button>
                            )}

                            {/* Error message */}
                            {error && (
                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                    <CardContent className="pt-6">
                                        <p className="text-sm font-mono text-white uppercase">{error}</p>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Form for token address and amount - Show if zkAddress exists */}
                            {zkAddress && (
                                <Card>
                                    <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                                            <CardTitle className="text-xs sm:text-sm font-mono uppercase">DEPOSIT DETAILS</CardTitle>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">

                                            {/* Balance Entry Selector */}
                                            {balanceEntries.length > 0 && (() => {
                                                // Group entries by token address and keep only the highest nonce for each token
                                                const tokenMap = new Map<string, { entry: typeof balanceEntries[0], originalIndex: number }>();
                                                balanceEntries.forEach((entry, index) => {
                                                    const tokenKey = entry.tokenAddress.toString(16);
                                                    const existing = tokenMap.get(tokenKey);
                                                    if (!existing || entry.nonce > existing.entry.nonce) {
                                                        tokenMap.set(tokenKey, { entry, originalIndex: index });
                                                    }
                                                });
                                                const currentBalances = Array.from(tokenMap.values());
                                                const balanceEntriesForSelector = currentBalances.map(({ entry }) => entry);
                                                const originalIndices = currentBalances.map(({ originalIndex }) => originalIndex);

                                                return (
                                                    <TokenSelector
                                                        label="SELECT BALANCE ENTRY (OPTIONAL)"
                                                        value={selectedBalanceEntry}
                                                        onChange={setSelectedBalanceEntry}
                                                        balanceEntries={balanceEntriesForSelector}
                                                        originalIndices={originalIndices}
                                                        publicClient={publicClient || undefined}
                                                    />
                                                );
                                            })()}

                                            {/* Token Address Input */}
                                            <div>
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    TOKEN ADDRESS
                                                </label>
                                                <Input
                                                    type="text"
                                                    value={tokenAddress}
                                                    onChange={(e) => setTokenAddress(e.target.value)}
                                                    placeholder="0x..."
                                                    className="text-xs sm:text-sm"
                                                />
                                            </div>

                                            {/* Amount Input */}
                                            <div>
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    DEPOSIT AMOUNT
                                                </label>
                                                <Input
                                                    type="text"
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

                                            {/* Current Nonce Display */}
                                            {currentNonce !== null && (
                                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                                    <CardContent className="pt-3 sm:pt-4">
                                                        <div className="space-y-1">
                                                            <p className="text-xs sm:text-sm font-mono text-white">
                                                                CURRENT NONCE: <span className="font-bold break-all">{currentNonce.toString()}</span>
                                                            </p>
                                                            <p className="text-[10px] sm:text-xs font-mono text-[#888888] uppercase break-words">
                                                                USING PREV NONCE {(currentNonce > BigInt(0) ? currentNonce - BigInt(1) : BigInt(0)).toString()} → CREATE {currentNonce.toString()}
                                                            </p>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )}

                                            {currentNonce === null && (
                                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                                    <CardContent className="pt-3 sm:pt-4">
                                                        <p className="text-xs sm:text-sm font-mono text-[#888888] uppercase break-words">
                                                            PLEASE VISIT ACCOUNT FIRST TO COMPUTE YOUR CURRENT NONCE
                                                        </p>
                                                    </CardContent>
                                                </Card>
                                            )}

                                            {/* Proof Mode Toggle */}
                                            {zkAddress && !proof && (
                                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                                    <CardContent className="pt-4">
                                                        <div className="flex items-center justify-between">
                                                            <label className="text-xs sm:text-sm font-mono font-bold text-white uppercase">
                                                                PROOF GENERATION MODE
                                                            </label>
                                                            <div className="flex items-center gap-2">
                                                                <Button
                                                                    type="button"
                                                                    onClick={() => setProofMode('local')}
                                                                    variant={proofMode === 'local' ? 'default' : 'outline'}
                                                                    size="sm"
                                                                    className={`text-xs h-7 px-3 font-mono ${proofMode === 'local'
                                                                        ? 'bg-[rgba(182,255,62,1)] text-black hover:bg-[rgba(182,255,62,0.8)]'
                                                                        : 'border-[#333333] hover:border-[rgba(182,255,62,1)]'
                                                                        }`}
                                                                >
                                                                    LOCAL
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    onClick={() => setProofMode('remote')}
                                                                    variant={proofMode === 'remote' ? 'default' : 'outline'}
                                                                    size="sm"
                                                                    disabled={isCheckingServer || serverAvailable === false}
                                                                    className={`text-xs h-7 px-3 font-mono ${proofMode === 'remote'
                                                                        ? 'bg-[rgba(182,255,62,1)] text-black hover:bg-[rgba(182,255,62,0.8)]'
                                                                        : 'border-[#333333] hover:border-[rgba(182,255,62,1)]'
                                                                        }`}
                                                                >
                                                                    {isCheckingServer ? 'CHECKING...' : 'REMOTE'}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        {proofMode === 'remote' && serverAvailable === false && (
                                                            <p className="mt-2 text-[10px] sm:text-xs font-mono text-red-500 uppercase">
                                                                PROOF SERVER UNAVAILABLE
                                                            </p>
                                                        )}
                                                        {proofMode === 'remote' && serverAvailable === true && (
                                                            <p className="mt-2 text-[10px] sm:text-xs font-mono text-[rgba(182,255,62,1)] uppercase">
                                                                ✓ PROOF SERVER CONNECTED
                                                            </p>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            )}

                                            {/* Generate Proof / Send Transaction Button */}
                                            <Button
                                                onClick={proof ? handleDeposit : proveDeposit}
                                                disabled={
                                                    proof
                                                        ? isPending || isConfirming || isSubmitting || isSimulating || !publicInputs.length || hasTransactionBeenSent
                                                        : isProving || isInitializing || isCalculatingInputs || !tokenAddress || !amount || currentNonce === null
                                                }
                                                className="w-full bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {proof
                                                    ? isSimulating
                                                        ? 'SIMULATING TRANSACTION...'
                                                        : isPending || isSubmitting
                                                            ? 'PREPARING TRANSACTION...'
                                                            : isConfirming
                                                                ? 'CONFIRMING TRANSACTION...'
                                                                : 'DEPOSIT ON NYDUS CONTRACT'
                                                    : isCalculatingInputs
                                                        ? 'CALCULATING INPUTS...'
                                                        : isProving
                                                            ? `GENERATING PROOF... (${currentProvingTime}MS)`
                                                            : isInitializing
                                                                ? 'INITIALIZING BACKEND...'
                                                                : 'GENERATE DEPOSIT PROOF'
                                                }
                                            </Button>
                                        </div>
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
                transactionType="DEPOSIT"
                onConfirmed={refreshAccountData}
            />
            <SyncingModal isOpen={isSyncing} />
        </div>
    );
}

