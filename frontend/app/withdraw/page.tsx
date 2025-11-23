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
import circuit from '@/lib/circuits/nydus_withdraw.json';
import { computeZkAddress, NYDUS_MESSAGE } from '@/lib/zk-address';
import { NydusAddress, NydusAbi } from '@/lib/abi/NydusConst';
import { pedersenCommitmentPositive, pedersenCommitmentNonHiding, grumpkinSubtract, grumpkinAddPoints } from '@/lib/pedersen-commitments';
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
import { generateProofRemote, checkProofServerStatus } from '@/lib/proof-server';
import { relayTransaction } from '@/lib/relayer';

export default function WithdrawPage() {
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
    const { computeCurrentNonce, reconstructPersonalCommitmentState } = useNonceDiscovery();
    
    // Redirect to initialize if nonce is 0 or null
    React.useEffect(() => {
        if (currentNonce === null || currentNonce === BigInt(0)) {
            window.location.href = '/initialize';
        }
    }, [currentNonce]);

    const { signMessageAsync, isPending: isSigning } = useSignMessage();
    const { address } = useWagmiAccount();
    const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });
    const publicClient = useCeloPublicClient();

    const [tokenAddress, setTokenAddress] = useState<string>('');
    const [amount, setAmount] = useState<string>('');
    const [receiverAddress, setReceiverAddress] = useState<string>('');
    const [relayFeeTokenAddress, setRelayFeeTokenAddress] = useState<string>('');
    const [receiverFeeAmount, setReceiverFeeAmount] = useState<string>('');
    const [arbitraryCalldataHash, setArbitraryCalldataHash] = useState<string>('0x1234567890abcdef');
    const [selectedBalanceEntry, setSelectedBalanceEntry] = useState<number | null>(null);
    const [selectedRelayFeeBalanceEntry, setSelectedRelayFeeBalanceEntry] = useState<number | null>(null);
    const [localUserKey, setLocalUserKey] = useState<string>('');
    const [publicInputs, setPublicInputs] = useState<string[]>([]);
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
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSimulating, setIsSimulating] = useState(false);
    const [txHash, setTxHash] = useState<string | null>(null);
    const [hasTransactionBeenSent, setHasTransactionBeenSent] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);
    const [simulationResult, setSimulationResult] = useState<any>(null);
    const [showTransactionModal, setShowTransactionModal] = useState(false);
    const [isCalculatingInputs, setIsCalculatingInputs] = useState(false);
    const [proofMode, setProofMode] = useState<'local' | 'remote'>('local');
    const [isRelaying, setIsRelaying] = useState(false);
    const [isCheckingServer, setIsCheckingServer] = useState(false);
    const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);

    // Check proof server status when switching to remote mode
    React.useEffect(() => {
        if (proofMode === 'remote') {
            setIsCheckingServer(true);
            checkProofServerStatus()
                .then((available) => {
                    setServerAvailable(available);
                    setIsCheckingServer(false);
                    if (!available) {
                        toast('Proof server unavailable. Switching to local mode.', 'error');
                        setProofMode('local');
                    }
                })
                .catch((error) => {
                    console.error('Error checking proof server status:', error);
                    setServerAvailable(false);
                    setIsCheckingServer(false);
                    toast('Proof server unavailable. Switching to local mode.', 'error');
                    setProofMode('local');
                });
        }
    }, [proofMode, toast]);

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
        const cryptoModule = await import('@aztec/foundation/crypto');
        const { poseidon2Hash } = cryptoModule;

        if (!globalThis.Buffer) {
            const { Buffer } = await import('buffer');
            globalThis.Buffer = Buffer;
        }

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

        const poseidonHash = await poseidon2Hash([chunk1BigInt, chunk2BigInt, chunk3BigInt]);

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

        return '0x' + privateKey.toString(16);
    };

    const handleSign = async () => {
        try {
            setIsLoading(true);
            setError(null);

            const signatureValue = await signMessageAsync({ message: NYDUS_MESSAGE });
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
                setLocalUserKey(userKeyHex);
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

    // Auto-fill relay fee token address when balance entry is selected
    useEffect(() => {
        if (selectedRelayFeeBalanceEntry !== null && balanceEntries[selectedRelayFeeBalanceEntry]) {
            const entry = balanceEntries[selectedRelayFeeBalanceEntry];
            setRelayFeeTokenAddress('0x' + entry.tokenAddress.toString(16));
        }
    }, [selectedRelayFeeBalanceEntry, balanceEntries]);

    // Initialize user_key from existing signature if zkAddress exists
    React.useEffect(() => {
        const initializeFromExisting = async () => {
            if (contextUserKey) {
                setLocalUserKey('0x' + contextUserKey.toString(16));
            } else if (zkAddress && account?.signature && !localUserKey) {
                try {
                    const userKeyHex = await computePrivateKeyFromSignature(account.signature);
                    setLocalUserKey(userKeyHex);
                    console.log('User key initialized from existing signature:', userKeyHex);
                } catch (error) {
                    console.error('Error computing user_key from existing signature:', error);
                }
            }
        };
        initializeFromExisting();
    }, [zkAddress, account?.signature, localUserKey, contextUserKey]);

    // Calculate circuit inputs dynamically from contract state
    const calculateCircuitInputs = async () => {
        setIsCalculatingInputs(true);
        try {
            // Use contextUserKey if available, otherwise use localUserKey
            const userKeyToUse = contextUserKey ? '0x' + contextUserKey.toString(16) : localUserKey;
            
            if (!userKeyToUse) {
                throw new Error('User key not available. Please sign a message first.');
            }

            if (!tokenAddress || !amount) {
                throw new Error('Please enter token address and amount');
            }

            if (currentNonce === null) {
                throw new Error('Please compute your current nonce first by visiting /account');
            }

            if (!receiverAddress) {
                throw new Error('Please enter receiver address');
            }

            if (!relayFeeTokenAddress || !receiverFeeAmount) {
                throw new Error('Please enter relay fee token address and fee amount');
            }

            const cryptoModule = await import('@aztec/foundation/crypto');
            const { poseidon2Hash } = cryptoModule;

            // Convert inputs to BigInt
            const userKeyBigInt = BigInt(userKeyToUse.startsWith('0x') ? userKeyToUse : '0x' + userKeyToUse);
            const tokenAddressBigInt = BigInt(tokenAddress.startsWith('0x') ? tokenAddress : '0x' + tokenAddress);
            
            // Calculate user_key_hash early (needed for fee token commitments)
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
            
            // Convert decimal amount to hex (default 18 decimals)
            const decimals = 18;
            const amountFloat = parseFloat(amount) || 0;
            const amountInWei = BigInt(Math.floor(amountFloat * Math.pow(10, decimals)));
            const amountBigInt = amountInWei;
            
            const receiverAddressBigInt = BigInt(receiverAddress.startsWith('0x') ? receiverAddress : '0x' + receiverAddress);
            const relayFeeTokenAddressBigInt = BigInt(relayFeeTokenAddress.startsWith('0x') ? relayFeeTokenAddress : '0x' + relayFeeTokenAddress);
            
            // Convert decimal receiver fee amount to hex (default 18 decimals)
            const relayFeeDecimals = 18;
            const receiverFeeAmountFloat = parseFloat(receiverFeeAmount) || 0;
            const receiverFeeAmountInWei = BigInt(Math.floor(receiverFeeAmountFloat * Math.pow(10, relayFeeDecimals)));
            const receiverFeeAmountBigInt = receiverFeeAmountInWei;
            
            console.log(`[Withdraw] Amount conversion: ${amountFloat} (decimal) -> ${amountInWei.toString()} (wei) = 0x${amountInWei.toString(16)}`);
            console.log(`[Withdraw] Receiver fee amount conversion: ${receiverFeeAmountFloat} (decimal) -> ${receiverFeeAmountInWei.toString()} (wei) = 0x${receiverFeeAmountInWei.toString(16)}`);
            
            // Use 0 for arbitrary calldata hash to skip verification in contract (for testing)
            // The contract will skip the hash check if arbitraryCalldataHash is 0
            const arbitraryCalldataHashBigInt = BigInt(0);

            console.log('=== ARBITRARY CALLDATA HASH ===');
            console.log('Using 0 to skip contract verification (for testing)');
            console.log('  0x' + arbitraryCalldataHashBigInt.toString(16));
            console.log('');
            
            // Update state to match the circuit input (0)
            setArbitraryCalldataHash('0x0');

            const tokensSame = tokenAddressBigInt === relayFeeTokenAddressBigInt;

            // Get previous nonce (current nonce - 1, or 0 if current nonce is 0)
            const previousNonce = currentNonce > BigInt(0) ? currentNonce - BigInt(1) : BigInt(0);

            // Find the balance entry for the withdrawal token at the highest nonce <= previousNonce
            // The token doesn't need to have a transaction at the exact previousNonce
            const tokenEntries = balanceEntries
                .filter(entry => entry.tokenAddress === tokenAddressBigInt && entry.nonce <= previousNonce)
                .sort((a, b) => a.nonce > b.nonce ? -1 : 1); // Sort descending by nonce
            
            const tokenBalanceEntry = tokenEntries.length > 0 ? tokenEntries[0] : null;
            const tokenPreviousNonce = tokenBalanceEntry ? tokenBalanceEntry.nonce : BigInt(0);

            if (!tokenBalanceEntry || tokenBalanceEntry.amount === undefined || tokenBalanceEntry.amount === null) {
                throw new Error(`Balance not found for token ${tokenAddress} at any nonce <= ${previousNonce}. Please visit /account first to compute your balances.`);
            }

            // Get personal commitment state for the withdrawal token
            // Use the token's previous nonce for state lookup (not the global previousNonce)
            let personalState = getPersonalCommitmentState(tokenPreviousNonce, tokenAddressBigInt);
            
            // If state doesn't exist, reconstruct it on-demand (lazy loading)
            if (!personalState) {
                console.log(`  🔄 Personal commitment state not found for token ${tokenAddress} at nonce ${tokenPreviousNonce}, reconstructing on-demand...`);
                
                if (!account?.signature || !contextUserKey) {
                    throw new Error(`Personal commitment state not found and cannot reconstruct: missing signature or userKey. Please visit /account first.`);
                }
                
                // Reconstruct the state using the token's balance entry
                personalState = await reconstructPersonalCommitmentState(
                    tokenBalanceEntry.amount,
                    tokenBalanceEntry.tokenAddress,
                    contextUserKey
                );
                
                // Store it in context for future use (using token's previous nonce)
                setPersonalCommitmentState(tokenPreviousNonce, tokenAddressBigInt, personalState);
                console.log(`  ✅ Reconstructed and stored personal commitment state for token ${tokenAddress} at nonce ${tokenPreviousNonce}`);
            }

            // For fee token personal commitments, compute them on the fly from balance entry
            // (matching the test's create_fee_token_personal_commitments function)
            let feeTokenPersonalState = null;
            if (!tokensSame) {
                // Find the balance entry for the fee token at the highest nonce <= previousNonce
                // The fee token doesn't need to have a transaction at the exact previousNonce
                const feeTokenEntries = balanceEntries
                    .filter(entry => entry.tokenAddress === relayFeeTokenAddressBigInt && entry.nonce <= previousNonce)
                    .sort((a, b) => a.nonce > b.nonce ? -1 : 1); // Sort descending by nonce
                
                const feeTokenBalanceEntry = feeTokenEntries.length > 0 ? feeTokenEntries[0] : null;

                if (!feeTokenBalanceEntry || feeTokenBalanceEntry.amount === undefined || feeTokenBalanceEntry.amount === null) {
                    throw new Error(`Fee token balance not found for token ${relayFeeTokenAddress} at any nonce <= ${previousNonce}. Please visit /account first to compute your balances.`);
                }

                // amount is always bigint in BalanceEntry
                const feeTokenBalanceAmount = feeTokenBalanceEntry.amount;

                // Compute fee token personal commitments on the fly (matching test's create_fee_token_personal_commitments)
                const feeTokenBalanceAmountHash = await poseidon2Hash([feeTokenBalanceAmount, userKeyHashBigInt]);
                let feeTokenBalanceAmountHashBigInt: bigint;
                if (typeof feeTokenBalanceAmountHash === 'bigint') {
                    feeTokenBalanceAmountHashBigInt = feeTokenBalanceAmountHash;
                } else if ('toBigInt' in feeTokenBalanceAmountHash && typeof (feeTokenBalanceAmountHash as any).toBigInt === 'function') {
                    feeTokenBalanceAmountHashBigInt = (feeTokenBalanceAmountHash as any).toBigInt();
                } else if ('value' in feeTokenBalanceAmountHash) {
                    feeTokenBalanceAmountHashBigInt = BigInt((feeTokenBalanceAmountHash as any).value);
                } else {
                    feeTokenBalanceAmountHashBigInt = BigInt((feeTokenBalanceAmountHash as any).toString());
                }

                const feeTokenTokenAddressHash = await poseidon2Hash([relayFeeTokenAddressBigInt, userKeyHashBigInt]);
                let feeTokenTokenAddressHashBigInt: bigint;
                if (typeof feeTokenTokenAddressHash === 'bigint') {
                    feeTokenTokenAddressHashBigInt = feeTokenTokenAddressHash;
                } else if ('toBigInt' in feeTokenTokenAddressHash && typeof (feeTokenTokenAddressHash as any).toBigInt === 'function') {
                    feeTokenTokenAddressHashBigInt = (feeTokenTokenAddressHash as any).toBigInt();
                } else if ('value' in feeTokenTokenAddressHash) {
                    feeTokenTokenAddressHashBigInt = BigInt((feeTokenTokenAddressHash as any).value);
                } else {
                    feeTokenTokenAddressHashBigInt = BigInt((feeTokenTokenAddressHash as any).toString());
                }

                // Create fee token personal commitments (matching test's create_fee_token_personal_commitments)
                const feeTokenPersonalCInner = pedersenCommitmentNonHiding(feeTokenBalanceAmountHashBigInt, feeTokenTokenAddressHashBigInt);
                const feeTokenPersonalCOuter = pedersenCommitmentNonHiding(BigInt(0), relayFeeTokenAddressBigInt);
                const feeTokenPersonalCTot = grumpkinAddPoints(feeTokenPersonalCInner, feeTokenPersonalCOuter);

                feeTokenPersonalState = {
                    personal_c_tot: [feeTokenPersonalCTot.x, feeTokenPersonalCTot.y],
                    personal_c_inner: [feeTokenPersonalCInner.x, feeTokenPersonalCInner.y],
                    personal_c_outer: [feeTokenPersonalCOuter.x, feeTokenPersonalCOuter.y],
                    personal_c_inner_m: feeTokenBalanceAmount,
                    personal_c_outer_m: BigInt(0),
                    personal_c_outer_r: relayFeeTokenAddressBigInt,
                };
            }

            // Get main_c_tot from contract
            if (!publicClient) {
                throw new Error('Public client not available');
            }

            const stateCommitment = await publicClient.readContract({
                address: NydusAddress,
                abi: NydusAbi,
                functionName: 'getStateCommitment',
            });

            let x: bigint, y: bigint;
            if (Array.isArray(stateCommitment)) {
                [x, y] = stateCommitment;
            } else if (stateCommitment && typeof stateCommitment === 'object') {
                x = (stateCommitment as any).x;
                y = (stateCommitment as any).y;
            } else {
                throw new Error('Invalid state commitment format from contract');
            }

            if (x === undefined || x === null || y === undefined || y === null) {
                throw new Error('State commitment values are undefined');
            }

            const mainCTot = [
                typeof x === 'bigint' ? x : BigInt(x),
                typeof y === 'bigint' ? y : BigInt(y)
            ];

            // Fetch opening values from contract
            let contractStateM: bigint | undefined;
            let contractStateR: bigint | undefined;
            let contractStateD: bigint | undefined;
            try {
                const result = await publicClient.readContract({
                    address: NydusAddress,
                    abi: NydusAbi,
                    functionName: 'getStateCommitmentOpeningValues',
                });

                let stateM: any, stateR: any, stateD: any;
                if (Array.isArray(result)) {
                    [stateM, stateR, stateD] = result;
                } else if (result && typeof result === 'object') {
                    stateM = (result as any).m ?? (result as any).stateM ?? (result as any)[0];
                    stateR = (result as any).r ?? (result as any).stateR ?? (result as any)[1];
                    stateD = (result as any).d ?? (result as any).stateD ?? (result as any)[2];
                } else {
                    throw new Error('Unexpected return format from getStateCommitmentOpeningValues');
                }

                if (stateM === undefined || stateR === undefined || stateD === undefined) {
                    throw new Error(`One or more opening values are undefined: m=${stateM}, r=${stateR}, d=${stateD}`);
                }

                contractStateM = BigInt(stateM.toString());
                contractStateR = BigInt(stateR.toString());
                contractStateD = BigInt(stateD.toString());
            } catch (error) {
                console.error('Error fetching contract state opening values:', error);
                if (currentNonce > BigInt(0)) {
                    throw new Error(`Could not fetch contract state opening values: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // userKeyHashBigInt already calculated above
            
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

            // Calculate previous_nonce_commitment (always use user_key_hash)
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

            console.log('=== WITHDRAW: PREVIOUS NONCE COMMITMENT ===');
            console.log(`  currentNonce: ${currentNonce.toString()}`);
            console.log(`  previousNonce: ${previousNonce.toString()}`);
            console.log(`  user_key_hash: 0x${userKeyHashBigInt.toString(16)}`);
            console.log(`  previous_nonce_commitment: 0x${previousNonceCommitmentBigInt.toString(16)}`);
            console.log('');

            // Fetch main_c_inner_point from contract
            // For previousNonce === 0, we need to handle it specially (similar to deposit)
            // For previousNonce > 0, we fetch from contract, with fallback if not found
            let mainCInnerPoint: [bigint, bigint];

            if (previousNonce === BigInt(0)) {
                // First withdraw after entry: need to reconstruct and encrypt personal_c_tot
                // Similar to deposit, but for withdraw we use the personal_c_tot from personalState
                const { poseidonCtrEncrypt } = await import('@/lib/poseidon-ctr-encryption');

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

                // Encrypt personal_c_tot from personalState (this is what was used in the entry transaction)
                const encryptedX = await poseidonCtrEncrypt(personalState.personal_c_tot[0], previousEncryptionKeyBigInt, 3);
                const encryptedY = await poseidonCtrEncrypt(personalState.personal_c_tot[1], previousEncryptionKeyBigInt, 4);

                mainCInnerPoint = [encryptedX, encryptedY];

                console.log('Computed main_c_inner_point for nonce 0 (first withdraw after entry):');
                console.log('  enc_x = 0x' + encryptedX.toString(16));
                console.log('  enc_y = 0x' + encryptedY.toString(16));
                console.log('');
            } else {
                // Subsequent withdraws: fetch enc_x and enc_y from the previous nonce commitment
                console.log('=== ATTEMPTING TO FETCH FROM CONTRACT ===');
                console.log(`  previousNonce: ${previousNonce.toString()}`);
                console.log(`  previousNonceCommitment: 0x${previousNonceCommitmentBigInt.toString(16)}`);
                console.log('  Calling getPersonalCTotReference...');
                console.log('');

                try {
                    const previousPersonalCTot = await publicClient.readContract({
                        address: NydusAddress,
                        abi: NydusAbi,
                        functionName: 'getPersonalCTotReference',
                        args: [previousNonceCommitmentBigInt],
                    });

                    console.log('Fetched previous nonce personal_c_tot values:');
                    console.log('  Previous nonce commitment:', '0x' + previousNonceCommitmentBigInt.toString(16));
                    console.log('  Raw result:', previousPersonalCTot);

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

                    if (previousEncX === BigInt(0) && previousEncY === BigInt(0)) {
                        // Fallback: compute encrypted values from personalState
                        // This happens when the previous transaction didn't store values (e.g., entry for nonce 0)
                        // or when the contract wasn't updated to store values yet
                        console.warn('⚠️ Previous nonce personal_c_tot values not found in contract (returned zeros).');
                        console.warn(`  Previous nonce: ${previousNonce.toString()}`);
                        console.warn(`  Previous nonce commitment: 0x${previousNonceCommitmentBigInt.toString(16)}`);
                        console.warn('  This is expected if the previous transaction was an entry (initCommit)');
                        console.warn('  or if the contract was deployed before storing these values.');
                        console.warn('  Falling back to computing encrypted values from personal_c_tot...');
                        console.warn('');

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

                        console.log('✅ Fallback computation successful:');
                        console.log('  enc_x = 0x' + mainCInnerPoint[0].toString(16));
                        console.log('  enc_y = 0x' + mainCInnerPoint[1].toString(16));
                        console.log('');
                    } else {
                        // Use the stored enc_x and enc_y from the previous transaction
                        mainCInnerPoint = [previousEncX, previousEncY];

                        console.log('✅ Using stored enc_x and enc_y from previous transaction:');
                        console.log('  enc_x = 0x' + previousEncX.toString(16));
                        console.log('  enc_y = 0x' + previousEncY.toString(16));
                        console.log('');

                        // CRITICAL: Verify that main_c_inner_point decrypts to personal_c_tot
                        // The circuit will verify this, so we should check it here too
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
                } catch (error) {
                    console.error('Error fetching previous nonce personal_c_tot:', error);
                    // Fallback: try to compute from personalState
                    console.warn('⚠️ Could not fetch from contract, attempting fallback computation...');

                    try {
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

                        console.log('✅ Fallback computation successful:');
                        console.log('  enc_x = 0x' + mainCInnerPoint[0].toString(16));
                        console.log('  enc_y = 0x' + mainCInnerPoint[1].toString(16));
                        console.log('');
                    } catch (fallbackError) {
                        console.error('❌ Fallback computation also failed:', fallbackError);
                        console.error('  This suggests personalState might be invalid or missing.');
                        console.error('  personalState:', personalState);
                        throw new Error(`Could not fetch previous nonce personal_c_tot values: ${error instanceof Error ? error.message : 'Unknown error'}. Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}. Please ensure you have visited /account to compute your balances first.`);
                    }
                }
            }

            // Calculate main_c_inner
            const mainCInner = pedersenCommitmentPositive(
                mainCInnerPoint[0],
                mainCInnerPoint[1],
                previousNonceCommitmentBigInt
            );

            // Compute initial state commitment
            const initialStateCommitment = pedersenCommitmentPositive(BigInt(1), BigInt(1), BigInt(1));

            // Calculate main_c_outer and main_c_outer_point
            // For previousNonce === 0, match deposit's approach: use computed main_c_tot and set main_c_outer = initial_state
            let mainCOuter: { x: bigint; y: bigint };
            let mainCOuterPoint: [bigint, bigint, bigint];
            let mainCTotForCircuit: [bigint, bigint];

            if (previousNonce === BigInt(0)) {
                // First withdraw after entry: construct main_c_tot as deposit does
                // main_c_tot = initial_state + main_c_inner (where main_c_inner uses withdraw circuit's personal_c_tot)
                // This ensures main_c_outer = initial_state
                const mainCTotComputed = grumpkinAddPoints(initialStateCommitment, mainCInner);
                mainCTotForCircuit = [mainCTotComputed.x, mainCTotComputed.y];
                mainCOuter = initialStateCommitment;
                mainCOuterPoint = [BigInt(1), BigInt(1), BigInt(1)];

                console.log('=== FIRST WITHDRAW AFTER ENTRY (previousNonce === 0) ===');
                console.log('Using deposit\'s approach: computed main_c_tot = initial_state + main_c_inner');
                console.log('initial_state_commitment:');
                console.log('  x = 0x' + initialStateCommitment.x.toString(16));
                console.log('  y = 0x' + initialStateCommitment.y.toString(16));
                console.log('');
                console.log('main_c_outer (set to initial_state):');
                console.log('  x = 0x' + mainCOuter.x.toString(16));
                console.log('  y = 0x' + mainCOuter.y.toString(16));
                console.log('');
                console.log('main_c_tot (computed as initial_state + main_c_inner):');
                console.log('  x = 0x' + mainCTotForCircuit[0].toString(16));
                console.log('  y = 0x' + mainCTotForCircuit[1].toString(16));
                console.log('');
                console.log('main_c_outer_point: [1, 1, 1]');
                console.log('');

                // Verify: main_c_tot should equal main_c_inner + main_c_outer
                const verifiedMainCTot = grumpkinAddPoints(mainCInner, mainCOuter);
                console.log('Verification: main_c_inner + main_c_outer:');
                console.log('  x = 0x' + verifiedMainCTot.x.toString(16));
                console.log('  y = 0x' + verifiedMainCTot.y.toString(16));
                console.log('');
                console.log('Match?', verifiedMainCTot.x === mainCTotForCircuit[0] && verifiedMainCTot.y === mainCTotForCircuit[1]);
                console.log('');
            } else {
                // Subsequent withdraws: use contract's main_c_tot and compute main_c_outer
                mainCOuter = grumpkinSubtract(
                    { x: mainCTot[0], y: mainCTot[1] },
                    mainCInner
                );
                mainCTotForCircuit = [mainCTot[0], mainCTot[1]];

                // Calculate main_c_outer_point from contract's aggregated values
                if (contractStateM === undefined || contractStateR === undefined || contractStateD === undefined) {
                    throw new Error('Could not fetch contract state opening values. Please try again.');
                }

                const BN254_SCALAR_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
                const mainCOuterM = (contractStateM - mainCInnerPoint[0] + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                const mainCOuterR = (contractStateR - mainCInnerPoint[1] + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                const mainCOuterD = (contractStateD - previousNonceCommitmentBigInt + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                mainCOuterPoint = [mainCOuterM, mainCOuterR, mainCOuterD];

                // CRITICAL: Compute main_c_outer from main_c_outer_point to ensure consistency
                // This ensures that main_c_outer matches what the circuit will reconstruct
                const reconstructedMainCOuter = pedersenCommitmentPositive(
                    mainCOuterPoint[0],
                    mainCOuterPoint[1],
                    mainCOuterPoint[2]
                );
                mainCOuter = reconstructedMainCOuter;

                // Recompute main_c_tot to ensure consistency
                const recomputedMainCTot = grumpkinAddPoints(mainCInner, mainCOuter);
                mainCTotForCircuit = [recomputedMainCTot.x, recomputedMainCTot.y];

                console.log('=== SUBSEQUENT WITHDRAW (previousNonce > 0) ===');
                console.log('main_c_outer_point (computed from contract aggregated values):');
                console.log('  [0] = 0x' + mainCOuterPoint[0].toString(16));
                console.log('  [1] = 0x' + mainCOuterPoint[1].toString(16));
                console.log('  [2] = 0x' + mainCOuterPoint[2].toString(16));
                console.log('');
                console.log('main_c_outer (computed from main_c_outer_point):');
                console.log('  x = 0x' + mainCOuter.x.toString(16));
                console.log('  y = 0x' + mainCOuter.y.toString(16));
                console.log('');
                console.log('main_c_tot (recomputed as main_c_inner + main_c_outer):');
                console.log('  x = 0x' + mainCTotForCircuit[0].toString(16));
                console.log('  y = 0x' + mainCTotForCircuit[1].toString(16));
                console.log('');
                console.log('✅ Using main_c_outer computed from main_c_outer_point to ensure circuit consistency');
                console.log('');
            }

            // Verify that main_c_outer_point correctly reconstructs to main_c_outer
            // Since we computed main_c_outer from main_c_outer_point, this should always match
            if (previousNonce > BigInt(0)) {
                const reconstructedMainCOuterFinal = pedersenCommitmentPositive(
                    mainCOuterPoint[0],
                    mainCOuterPoint[1],
                    mainCOuterPoint[2]
                );

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

            // Format for Noir circuit inputs
            const formatForNoir = (value: bigint | string): string => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                const hexValue = value.startsWith('0x') ? value : '0x' + value;
                return BigInt(hexValue).toString();
            };

            // Build circuit inputs
            const inputs: any = {
                user_key: formatForNoir(userKeyToUse),
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
                arbitrary_calldata_hash: '0', // Always use 0 to skip contract verification
                receiver_address: formatForNoir(receiverAddress),
                relay_fee_token_address: formatForNoir(relayFeeTokenAddress),
                receiver_fee_amount: formatForNoir(receiverFeeAmountBigInt),
            };

            // Add fee token commitments if tokens are different
            if (!tokensSame && feeTokenPersonalState) {
                inputs.fee_token_personal_c_inner = [feeTokenPersonalState.personal_c_inner[0].toString(), feeTokenPersonalState.personal_c_inner[1].toString()];
                inputs.fee_token_personal_c_outer = [feeTokenPersonalState.personal_c_outer[0].toString(), feeTokenPersonalState.personal_c_outer[1].toString()];
                inputs.fee_token_personal_c_inner_m = feeTokenPersonalState.personal_c_inner_m.toString();
                inputs.fee_token_personal_c_outer_m = feeTokenPersonalState.personal_c_outer_m.toString();
                inputs.fee_token_personal_c_outer_r = feeTokenPersonalState.personal_c_outer_r.toString();
            } else {
                // If tokens are same, use same values for fee token
                inputs.fee_token_personal_c_inner = [personalState.personal_c_inner[0].toString(), personalState.personal_c_inner[1].toString()];
                inputs.fee_token_personal_c_outer = [personalState.personal_c_outer[0].toString(), personalState.personal_c_outer[1].toString()];
                inputs.fee_token_personal_c_inner_m = personalState.personal_c_inner_m.toString();
                inputs.fee_token_personal_c_outer_m = personalState.personal_c_outer_m.toString();
                inputs.fee_token_personal_c_outer_r = personalState.personal_c_outer_r.toString();
            }

            return inputs;
        } finally {
            setIsCalculatingInputs(false);
        }
    };

    const proveWithdraw = async () => {
        if (!zkAddress) {
            setProofError('Please sign a message first to access the Nydus network');
            return;
        }

        if (!tokenAddress || !amount || !receiverAddress || !relayFeeTokenAddress || !receiverFeeAmount) {
            setProofError('Please fill in all required fields');
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
                const result = await generateProofRemote('withdraw', inputs);
                proofHex = result.proof;
                publicInputsHex = result.publicInputs.slice(0, 28); // Slice to 28 for withdraw
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

                // Extract public inputs from proof result and slice to 28 elements
                const publicInputsArray = (proofResult.publicInputs || []).slice(0, 28);
                publicInputsHex = publicInputsArray.map((input: any) => {
                if (typeof input === 'string' && input.startsWith('0x')) {
                    return input;
                }
                if (typeof input === 'bigint') {
                    return `0x${input.toString(16).padStart(64, '0')}`;
                }
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

    const handleWithdraw = async () => {
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

            const proofBytes = `0x${proof}`;
            const slicedInputs = publicInputs.slice(0, 20);
            const publicInputsBytes32 = slicedInputs.map((input: string) => {
                const hex = input.startsWith('0x') ? input.slice(2) : input;
                return `0x${hex.padStart(64, '0')}` as `0x${string}`;
            });

            // Use truly empty bytes (not '0x00') - contract skips hash check for empty calldata
            // '0x' encodes as empty bytes (length 0), while '0x00' would encode as one byte of zeros
            const arbitraryCalldata = '0x' as `0x${string}`;

            console.log('Simulating withdraw transaction...');
            console.log('Proof length:', proofBytes.length);
            console.log('Public inputs (sliced to 20):', publicInputsBytes32);

            const client = publicClient || createPublicClient({
                chain: celoSepolia,
                transport: http(process.env.NEXT_PUBLIC_CONTRACT_HOST_RPC || 'https://forno.celo-sepolia.celo-testnet.org')
            });

            setIsSimulating(true);
            try {
                const simResult = await client.simulateContract({
                    account: address as `0x${string}`,
                    address: NydusAddress as `0x${string}`,
                    abi: NydusAbi,
                    functionName: 'withdraw',
                    args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[], arbitraryCalldata],
                });

                console.log('✅ Simulation successful:', simResult);
                setSimulationResult(simResult);

            } catch (simulationError: any) {
                let errorMessage = 'Transaction simulation failed';
                if (simulationError?.shortMessage) {
                    errorMessage = simulationError.shortMessage;
                } else if (simulationError?.message) {
                    errorMessage = simulationError.message;
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

            console.log('Sending withdraw transaction...');
            writeContract({
                address: NydusAddress as `0x${string}`,
                abi: NydusAbi,
                functionName: 'withdraw',
                args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[], arbitraryCalldata],
            });
            setHasTransactionBeenSent(true);

        } catch (error) {
            console.error('Error in handleWithdraw:', error);
            setTxError(error instanceof Error ? error.message : 'Failed to process transaction');
            setIsSubmitting(false);
        }
    };

    const handleRelayWithdraw = async () => {
        if (!proof || !publicInputs || publicInputs.length === 0) {
            setTxError('Proof and public inputs are required');
            return;
        }

        try {
            setIsRelaying(true);
            setTxError(null);
            setTxHash(null);
            setShowTransactionModal(true);

            const proofBytes = `0x${proof}`;

            // Verifier expects exactly 28 public inputs
            if (publicInputs.length < 28) {
                throw new Error(`Expected 28 public inputs, but got ${publicInputs.length}. Please regenerate the proof.`);
            }

            const slicedInputs = publicInputs.slice(0, 28);
            const publicInputsBytes32 = slicedInputs.map((input: string) => {
                const hex = input.startsWith('0x') ? input.slice(2) : input;
                return `0x${hex.padStart(64, '0')}` as `0x${string}`;
            });

            const arbitraryCalldata = arbitraryCalldataHash as `0x${string}`;

            console.log('Relaying withdraw transaction...');

            const result = await relayTransaction({
                address: NydusAddress,
                abi: NydusAbi as unknown as any[],
                functionName: 'withdraw',
                args: [proofBytes, publicInputsBytes32, arbitraryCalldata],
            });

            setTxHash(result.hash);
            setHasTransactionBeenSent(true);
            toast('Transaction relayed successfully', 'success');
        } catch (error) {
            console.error('Error in handleRelayWithdraw:', error);
            setTxError(error instanceof Error ? error.message : 'Failed to relay transaction');
        } finally {
            setIsRelaying(false);
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
            toast('WITHDRAW TRANSACTION CONFIRMED', 'success');
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
        if (!isPending && !hash && isSubmitting) {
            // Transaction was likely rejected - reset after a short delay
            const timer = setTimeout(() => {
                setIsSubmitting(false);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [isPending, hash, isSubmitting]);

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
        setReceiverAddress('');
        setRelayFeeTokenAddress('');
        setReceiverFeeAmount('');
        setArbitraryCalldataHash('0x1234567890abcdef');
        setSelectedBalanceEntry(null);
        setSelectedRelayFeeBalanceEntry(null);
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
                            <CardTitle className="text-center text-base sm:text-xl font-mono uppercase">WITHDRAW</CardTitle>
                        </div>
                        <CardDescription className="text-center text-xs sm:text-sm font-mono">WITHDRAW TO PUBLIC ADDRESS</CardDescription>
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
                            {!zkAddress && (
                                <Button
                                    onClick={handleSign}
                                    disabled={isLoading || isSigning}
                                    className="w-full bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading || isSigning ? 'SIGNING...' : 'SIGN MESSAGE FOR NYDUS NETWORK ACCESS'}
                                </Button>
                            )}

                            {error && (
                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                    <CardContent className="pt-6">
                                        <p className="text-sm font-mono text-white uppercase">{error}</p>
                                    </CardContent>
                                </Card>
                            )}

                            {zkAddress && (
                                <Card>
                                    <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                                            <CardTitle className="text-xs sm:text-sm font-mono uppercase">WITHDRAW DETAILS</CardTitle>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-3 sm:space-y-4">
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

                                            <div>
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    TOKEN ADDRESS (HEX)
                                                </label>
                                                <Input
                                                    type="text"
                                                    value={tokenAddress}
                                                    onChange={(e) => setTokenAddress(e.target.value)}
                                                    placeholder="0x02"
                                                    className="text-xs sm:text-sm"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    WITHDRAW AMOUNT
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

                                            <div>
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    RECEIVER ADDRESS (HEX)
                                                </label>
                                                <Input
                                                    type="text"
                                                    value={receiverAddress}
                                                    onChange={(e) => setReceiverAddress(e.target.value)}
                                                    placeholder="0x..."
                                                    className="text-xs sm:text-sm"
                                                />
                                            </div>

                                            {/* Relay Fee Token Balance Entry Selector */}
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
                                                        label="SELECT RELAY FEE TOKEN (OPTIONAL)"
                                                        value={selectedRelayFeeBalanceEntry}
                                                        onChange={setSelectedRelayFeeBalanceEntry}
                                                        balanceEntries={balanceEntriesForSelector}
                                                        originalIndices={originalIndices}
                                                        publicClient={publicClient || undefined}
                                                    />
                                                );
                                            })()}

                                            <div>
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    RELAY FEE TOKEN ADDRESS (HEX)
                                                </label>
                                                <Input
                                                    type="text"
                                                    value={relayFeeTokenAddress}
                                                    onChange={(e) => setRelayFeeTokenAddress(e.target.value)}
                                                    placeholder="0x03"
                                                    className="text-xs sm:text-sm"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                                                    RECEIVER FEE AMOUNT
                                                </label>
                                                <Input
                                                    type="text"
                                                    value={receiverFeeAmount}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        // Allow only numbers and decimal point
                                                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                                            setReceiverFeeAmount(value);
                                                        }
                                                    }}
                                                    placeholder="0.00001"
                                                    className="text-xs sm:text-sm"
                                                />
                                            </div>

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
                                                                    className={`text-xs h-7 px-3 font-mono ${
                                                                        proofMode === 'local'
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
                                                                    className={`text-xs h-7 px-3 font-mono ${
                                                                        proofMode === 'remote'
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
                                            <div className="flex flex-col gap-2">
                                                <Button
                                                    onClick={proof ? handleWithdraw : proveWithdraw}
                                                    disabled={
                                                        proof
                                                            ? isPending || isConfirming || isSubmitting || isSimulating || isConfirmed || !publicInputs.length || isRelaying
                                                            : isProving || isInitializing || isCalculatingInputs
                                                    }
                                                    className="w-full bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {proof
                                                        ? isSimulating
                                                            ? 'SIMULATING...'
                                                            : isPending || isSubmitting
                                                                ? 'PREPARING...'
                                                                : isConfirming
                                                                    ? 'CONFIRMING...'
                                                                    : 'WITHDRAW ON NYDUS'
                                                        : isCalculatingInputs
                                                            ? 'CALCULATING INPUTS...'
                                                            : isProving
                                                                ? `GENERATING PROOF... (${currentProvingTime}MS)`
                                                                : isInitializing
                                                                    ? 'INITIALIZING BACKEND...'
                                                                    : 'GENERATE WITHDRAW PROOF'
                                                    }
                                                </Button>
                                                {proof && publicInputs.length > 0 && !hasTransactionBeenSent && (
                                                    <Button
                                                        onClick={handleRelayWithdraw}
                                                        disabled={isRelaying || isPending || isConfirming || isSubmitting || isSimulating}
                                                        className="w-full bg-[rgba(100,100,255,1)] hover:bg-[rgba(100,100,255,0.8)] text-white font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {isRelaying ? 'RELAYING...' : 'RELAY TRANSACTION'}
                                                    </Button>
                                                )}
                                            </div>
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
                isRelaying={isRelaying}
                txHash={txHash}
                error={txError || writeError?.message || proofError || null}
                transactionType="WITHDRAW"
                onConfirmed={refreshAccountData}
            />
            <SyncingModal isOpen={isSyncing} />
        </div>
    );
}
