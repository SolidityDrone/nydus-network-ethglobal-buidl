'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAccount as useAccountContext, useZkAddress } from '@/context/AccountProvider';
import { useAccountState } from '@/context/AccountStateProvider';
import { useAccount as useWagmiAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { useSignMessage } from 'wagmi';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { Noir } from '@noir-lang/noir_js';
import { CachedUltraHonkBackend } from '@/lib/cached-ultra-honk-backend';
import circuit from '@/lib/circuits/nydus_send.json';
import { computeZkAddress, NYDUS_MESSAGE, parseZkAddress, constructZkAddress } from '@/lib/zk-address';
import QRScanner from '@/components/QRScanner';
import { QrCode } from 'lucide-react';
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

export default function SendPage() {
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
    const { signMessageAsync, isPending: isSigning } = useSignMessage();
    const { address } = useWagmiAccount();
    const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });
    const publicClient = usePublicClient();

    const [tokenAddress, setTokenAddress] = useState<string>('');
    const [amount, setAmount] = useState<string>('');
    const [receiverZkAddress, setReceiverZkAddress] = useState<string>('');
    const [receiverPublicKeyX, setReceiverPublicKeyX] = useState<string>('');
    const [receiverPublicKeyY, setReceiverPublicKeyY] = useState<string>('');
    const [relayFeeTokenAddress, setRelayFeeTokenAddress] = useState<string>('');
    const [receiverFeeAmount, setReceiverFeeAmount] = useState<string>('');
    const [selectedBalanceEntry, setSelectedBalanceEntry] = useState<number | null>(null);
    const [selectedRelayFeeBalanceEntry, setSelectedRelayFeeBalanceEntry] = useState<number | null>(null);
    const [qrScannerOpen, setQrScannerOpen] = useState(false);

    // Handle QR code scan
    const handleQRScan = useCallback((data: { x: string; y: string }) => {
        try {
            // Construct zkAddress from scanned x and y coordinates
            const zkAddr = constructZkAddress(data.x, data.y);
            setReceiverZkAddress(zkAddr);
            console.log('✅ QR code scanned and zkAddress set:', zkAddr);
        } catch (error) {
            console.error('Error constructing zkAddress from QR scan:', error);
        }
    }, []);

    // Parse zkAddress when it changes
    React.useEffect(() => {
        if (receiverZkAddress && receiverZkAddress.trim()) {
            try {
                const { x, y } = parseZkAddress(receiverZkAddress.trim());
                setReceiverPublicKeyX('0x' + x.toString(16));
                setReceiverPublicKeyY('0x' + y.toString(16));
            } catch (error) {
                // If parsing fails, clear the fields (user might be typing)
                // Only clear if it's clearly not a valid format
                if (receiverZkAddress.length > 10) {
                    console.warn('Failed to parse zkAddress:', error);
                }
            }
        }
    }, [receiverZkAddress]);
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
    const [showTransactionModal, setShowTransactionModal] = useState(false);
    const [simulationResult, setSimulationResult] = useState<any>(null);
    const [isCalculatingInputs, setIsCalculatingInputs] = useState(false);

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

            if (!relayFeeTokenAddress || !receiverFeeAmount) {
                throw new Error('Please enter relay fee token address and fee amount');
            }

            const cryptoModule = await import('@aztec/foundation/crypto');
            const { poseidon2Hash } = cryptoModule;

            // Convert inputs to BigInt
            const userKeyBigInt = BigInt(userKeyToUse.startsWith('0x') ? userKeyToUse : '0x' + userKeyToUse);
            const tokenAddressBigInt = BigInt(tokenAddress.startsWith('0x') ? tokenAddress : '0x' + tokenAddress);
            
            // Convert decimal amount to hex (default 18 decimals)
            const decimals = 18;
            const amountFloat = parseFloat(amount) || 0;
            const amountInWei = BigInt(Math.floor(amountFloat * Math.pow(10, decimals)));
            const amountBigInt = amountInWei;
            
            console.log(`[Send] Amount conversion: ${amountFloat} (decimal) -> ${amountInWei.toString()} (wei) = 0x${amountInWei.toString(16)}`);
            
            const relayFeeTokenAddressBigInt = BigInt(relayFeeTokenAddress.startsWith('0x') ? relayFeeTokenAddress : '0x' + relayFeeTokenAddress);
            
            // Convert decimal receiver fee amount to hex (default 18 decimals)
            const relayFeeDecimals = 18;
            const receiverFeeAmountFloat = parseFloat(receiverFeeAmount) || 0;
            const receiverFeeAmountInWei = BigInt(Math.floor(receiverFeeAmountFloat * Math.pow(10, relayFeeDecimals)));
            const receiverFeeAmountBigInt = receiverFeeAmountInWei;
            
            console.log(`[Send] Receiver fee amount conversion: ${receiverFeeAmountFloat} (decimal) -> ${receiverFeeAmountInWei.toString()} (wei) = 0x${receiverFeeAmountInWei.toString(16)}`);

            // Validate receiver zkAddress
            if (!receiverZkAddress || !receiverZkAddress.trim()) {
                throw new Error('Please enter receiver zkAddress');
            }

            // Parse zkAddress to get x and y coordinates
            let receiverPublicKeyXBigInt: bigint;
            let receiverPublicKeyYBigInt: bigint;

            try {
                const parsed = parseZkAddress(receiverZkAddress.trim());
                receiverPublicKeyXBigInt = parsed.x;
                receiverPublicKeyYBigInt = parsed.y;
            } catch (error) {
                throw new Error(`Invalid zkAddress format: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            const tokensSame = tokenAddressBigInt === relayFeeTokenAddressBigInt;

            // Calculate user_key_hash and view_key first (needed for fee token commitments)
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

            // Get previous nonce (current nonce - 1, or 0 if current nonce is 0)
            const previousNonce = currentNonce > BigInt(0) ? currentNonce - BigInt(1) : BigInt(0);

            // Find the balance entry for the send token at the highest nonce <= previousNonce
            // The token doesn't need to have a transaction at the exact previousNonce
            const sendTokenEntries = balanceEntries
                .filter(entry => entry.tokenAddress === tokenAddressBigInt && entry.nonce <= previousNonce)
                .sort((a, b) => a.nonce > b.nonce ? -1 : 1); // Sort descending by nonce
            
            const sendTokenBalanceEntry = sendTokenEntries.length > 0 ? sendTokenEntries[0] : null;

            if (!sendTokenBalanceEntry || sendTokenBalanceEntry.amount === undefined || sendTokenBalanceEntry.amount === null) {
                throw new Error(`Balance not found for token ${tokenAddress} at any nonce <= ${previousNonce}. Please visit /account first to compute your balances.`);
            }

            // amount is always bigint in BalanceEntry
            const sendTokenBalanceAmount = sendTokenBalanceEntry.amount;

            // Compute personal commitments on the fly (matching test's create_personal_commitments function)
            // This ensures personal_c_tot = personal_c_inner + personal_c_outer
            const sendTokenBalanceAmountHash = await poseidon2Hash([sendTokenBalanceAmount, userKeyHashBigInt]);
            let sendTokenBalanceAmountHashBigInt: bigint;
            if (typeof sendTokenBalanceAmountHash === 'bigint') {
                sendTokenBalanceAmountHashBigInt = sendTokenBalanceAmountHash;
            } else if ('toBigInt' in sendTokenBalanceAmountHash && typeof (sendTokenBalanceAmountHash as any).toBigInt === 'function') {
                sendTokenBalanceAmountHashBigInt = (sendTokenBalanceAmountHash as any).toBigInt();
            } else if ('value' in sendTokenBalanceAmountHash) {
                sendTokenBalanceAmountHashBigInt = BigInt((sendTokenBalanceAmountHash as any).value);
            } else {
                sendTokenBalanceAmountHashBigInt = BigInt((sendTokenBalanceAmountHash as any).toString());
            }

            const sendTokenTokenAddressHash = await poseidon2Hash([tokenAddressBigInt, userKeyHashBigInt]);
            let sendTokenTokenAddressHashBigInt: bigint;
            if (typeof sendTokenTokenAddressHash === 'bigint') {
                sendTokenTokenAddressHashBigInt = sendTokenTokenAddressHash;
            } else if ('toBigInt' in sendTokenTokenAddressHash && typeof (sendTokenTokenAddressHash as any).toBigInt === 'function') {
                sendTokenTokenAddressHashBigInt = (sendTokenTokenAddressHash as any).toBigInt();
            } else if ('value' in sendTokenTokenAddressHash) {
                sendTokenTokenAddressHashBigInt = BigInt((sendTokenTokenAddressHash as any).value);
            } else {
                sendTokenTokenAddressHashBigInt = BigInt((sendTokenTokenAddressHash as any).toString());
            }

            // Create personal commitments (matching test's create_personal_commitments)
            const personalCInner = pedersenCommitmentNonHiding(sendTokenBalanceAmountHashBigInt, sendTokenTokenAddressHashBigInt);
            const personalCOuter = pedersenCommitmentNonHiding(BigInt(0), tokenAddressBigInt);
            const personalCTot = grumpkinAddPoints(personalCInner, personalCOuter);

            const personalState = {
                personal_c_tot: [personalCTot.x, personalCTot.y],
                personal_c_inner: [personalCInner.x, personalCInner.y],
                personal_c_outer: [personalCOuter.x, personalCOuter.y],
                personal_c_inner_m: sendTokenBalanceAmount,
                personal_c_outer_m: BigInt(0),
                personal_c_outer_r: tokenAddressBigInt,
            };

            // For fee token personal commitments, handle based on whether tokens are the same
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
            } else {
                // Tokens are the same: fee token personal commitments = send token personal commitments
                // (matching same_token_test.nr lines 113-117)
                feeTokenPersonalState = {
                    personal_c_tot: personalState.personal_c_tot,
                    personal_c_inner: personalState.personal_c_inner,
                    personal_c_outer: personalState.personal_c_outer,
                    personal_c_inner_m: personalState.personal_c_inner_m,
                    personal_c_outer_m: personalState.personal_c_outer_m,
                    personal_c_outer_r: personalState.personal_c_outer_r,
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
                if (previousNonce > BigInt(0)) {
                    throw new Error(`Could not fetch contract state opening values: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
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

            console.log('=== SEND: PREVIOUS NONCE COMMITMENT ===');
            console.log(`  currentNonce: ${currentNonce.toString()}`);
            console.log(`  previousNonce: ${previousNonce.toString()}`);
            console.log(`  user_key_hash: 0x${userKeyHashBigInt.toString(16)}`);
            console.log(`  previous_nonce_commitment: 0x${previousNonceCommitmentBigInt.toString(16)}`);
            console.log('');

            // Fetch main_c_inner_point from contract (similar to withdraw)
            let mainCInnerPoint: [bigint, bigint];

            if (previousNonce === BigInt(0)) {
                // First send after entry: need to reconstruct and encrypt personal_c_tot
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

                // Encrypt personal_c_tot from personalState
                const encryptedX = await poseidonCtrEncrypt(personalState.personal_c_tot[0], previousEncryptionKeyBigInt, 3);
                const encryptedY = await poseidonCtrEncrypt(personalState.personal_c_tot[1], previousEncryptionKeyBigInt, 4);

                mainCInnerPoint = [encryptedX, encryptedY];

                console.log('Computed main_c_inner_point for nonce 0 (first send after entry):');
                console.log('  enc_x = 0x' + encryptedX.toString(16));
                console.log('  enc_y = 0x' + encryptedY.toString(16));
                console.log('');
            } else {
                // Subsequent sends: fetch enc_x and enc_y from the previous nonce commitment
                try {
                    const previousPersonalCTot = await publicClient.readContract({
                        address: NydusAddress,
                        abi: NydusAbi,
                        functionName: 'getPersonalCTotReference',
                        args: [previousNonceCommitmentBigInt],
                    });

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
                        throw new Error('Previous nonce personal_c_tot values are undefined');
                    }

                    const previousEncX = BigInt(encCTotM.toString());
                    const previousEncY = BigInt(encCTotR.toString());

                    if (previousEncX === BigInt(0) && previousEncY === BigInt(0)) {
                        // Fallback: compute encrypted values from personalState
                        const { poseidonCtrEncrypt } = await import('@/lib/poseidon-ctr-encryption');
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

                        mainCInnerPoint = [
                            await poseidonCtrEncrypt(personalState.personal_c_tot[0], previousEncryptionKeyBigInt, 3),
                            await poseidonCtrEncrypt(personalState.personal_c_tot[1], previousEncryptionKeyBigInt, 4),
                        ];
                    } else {
                        mainCInnerPoint = [previousEncX, previousEncY];

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
                    // Fallback: compute from personalState
                    const { poseidonCtrEncrypt } = await import('@/lib/poseidon-ctr-encryption');
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

                    mainCInnerPoint = [
                        await poseidonCtrEncrypt(personalState.personal_c_tot[0], previousEncryptionKeyBigInt, 3),
                        await poseidonCtrEncrypt(personalState.personal_c_tot[1], previousEncryptionKeyBigInt, 4),
                    ];
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

            // Calculate main_c_outer and main_c_outer_point (similar to withdraw)
            let mainCOuter: { x: bigint; y: bigint };
            let mainCOuterPoint: [bigint, bigint, bigint];
            let mainCTotForCircuit: [bigint, bigint];

            if (previousNonce === BigInt(0)) {
                // First send after entry: construct main_c_tot as deposit/withdraw does
                // main_c_tot = initial_state + main_c_inner (where main_c_inner uses send circuit's personal_c_tot)
                // This ensures main_c_outer = initial_state
                const mainCTotComputed = grumpkinAddPoints(initialStateCommitment, mainCInner);
                mainCTotForCircuit = [mainCTotComputed.x, mainCTotComputed.y];
                mainCOuter = initialStateCommitment;
                mainCOuterPoint = [BigInt(1), BigInt(1), BigInt(1)];

                console.log('=== FIRST SEND AFTER ENTRY (previousNonce === 0) ===');
                console.log('Using deposit/withdraw approach: computed main_c_tot = initial_state + main_c_inner');
                console.log('initial_state_commitment:');
                console.log('  x = 0x' + initialStateCommitment.x.toString(16));
                console.log('  y = 0x' + initialStateCommitment.y.toString(16));
                console.log('');
                console.log('main_c_inner:');
                console.log('  x = 0x' + mainCInner.x.toString(16));
                console.log('  y = 0x' + mainCInner.y.toString(16));
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
                const matches = verifiedMainCTot.x === mainCTotForCircuit[0] && verifiedMainCTot.y === mainCTotForCircuit[1];
                console.log('Match?', matches);
                if (!matches) {
                    console.error('❌ ERROR: main_c_tot mismatch!');
                    console.error('  Expected: x = 0x' + mainCTotForCircuit[0].toString(16) + ', y = 0x' + mainCTotForCircuit[1].toString(16));
                    console.error('  Got: x = 0x' + verifiedMainCTot.x.toString(16) + ', y = 0x' + verifiedMainCTot.y.toString(16));
                    throw new Error('main_c_tot verification failed: computed main_c_tot does not equal main_c_inner + main_c_outer');
                }
                console.log('✅ main_c_tot verification passed!');
                console.log('');
            } else {
                // Subsequent sends: compute from contract state
                mainCOuter = grumpkinSubtract({ x: mainCTot[0], y: mainCTot[1] }, mainCInner);

                // Compute main_c_outer_point via scalar subtraction from contract aggregated values
                if (contractStateM === undefined || contractStateR === undefined || contractStateD === undefined) {
                    throw new Error('Contract state opening values not available for previousNonce > 0');
                }

                // Fetch encCTotM and encCTotR from contract for previous nonce
                const previousPersonalCTot = await publicClient.readContract({
                    address: NydusAddress,
                    abi: NydusAbi,
                    functionName: 'getPersonalCTotReference',
                    args: [previousNonceCommitmentBigInt],
                });

                let encCTotM: any, encCTotR: any;
                if (Array.isArray(previousPersonalCTot)) {
                    [encCTotM, encCTotR] = previousPersonalCTot;
                } else if (previousPersonalCTot && typeof previousPersonalCTot === 'object') {
                    encCTotM = (previousPersonalCTot as any).encCTotM ?? (previousPersonalCTot as any)[0];
                    encCTotR = (previousPersonalCTot as any).encCTotR ?? (previousPersonalCTot as any)[1];
                } else {
                    throw new Error('Unexpected return format from getPersonalCTotReference');
                }

                const encCTotMBigInt = BigInt(encCTotM?.toString() || '0');
                const encCTotRBigInt = BigInt(encCTotR?.toString() || '0');

                // Compute main_c_outer_point via scalar subtraction from contract aggregated values
                // The key insight: main_c_outer includes ALL previous operations (initial + entry + all operations before previousNonce)
                // We subtract the previous operation's opening values from the contract's aggregated values
                const BN254_SCALAR_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
                
                const mainCOuterM = (contractStateM - encCTotMBigInt + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                const mainCOuterR = (contractStateR - encCTotRBigInt + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
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

                console.log('=== SUBSEQUENT SEND (previousNonce > 0) ===');
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

                // Verify that main_c_outer_point correctly reconstructs to main_c_outer
                // Since we computed main_c_outer from main_c_outer_point, this should always match
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

            // Log personal commitments for debugging
            console.log('=== PERSONAL COMMITMENTS ===');
            console.log('personal_c_tot:');
            console.log('  x = 0x' + personalState.personal_c_tot[0].toString(16));
            console.log('  y = 0x' + personalState.personal_c_tot[1].toString(16));
            console.log('personal_c_inner:');
            console.log('  x = 0x' + personalState.personal_c_inner[0].toString(16));
            console.log('  y = 0x' + personalState.personal_c_inner[1].toString(16));
            console.log('personal_c_outer:');
            console.log('  x = 0x' + personalState.personal_c_outer[0].toString(16));
            console.log('  y = 0x' + personalState.personal_c_outer[1].toString(16));
            console.log('personal_c_inner_m:', personalState.personal_c_inner_m.toString());
            console.log('personal_c_outer_m:', personalState.personal_c_outer_m.toString());
            console.log('personal_c_outer_r:', personalState.personal_c_outer_r.toString());
            console.log('');

            // Verify personal_c_tot = personal_c_inner + personal_c_outer
            const verifiedPersonalCTot = grumpkinAddPoints(
                { x: personalState.personal_c_inner[0], y: personalState.personal_c_inner[1] },
                { x: personalState.personal_c_outer[0], y: personalState.personal_c_outer[1] }
            );
            console.log('Verification: personal_c_inner + personal_c_outer:');
            console.log('  x = 0x' + verifiedPersonalCTot.x.toString(16));
            console.log('  y = 0x' + verifiedPersonalCTot.y.toString(16));
            const personalMatches = verifiedPersonalCTot.x === personalState.personal_c_tot[0] && verifiedPersonalCTot.y === personalState.personal_c_tot[1];
            console.log('Match?', personalMatches);
            if (!personalMatches) {
                console.error('❌ ERROR: personal_c_tot mismatch!');
                console.error('  Expected: x = 0x' + personalState.personal_c_tot[0].toString(16) + ', y = 0x' + personalState.personal_c_tot[1].toString(16));
                console.error('  Got: x = 0x' + verifiedPersonalCTot.x.toString(16) + ', y = 0x' + verifiedPersonalCTot.y.toString(16));
                throw new Error('personal_c_tot verification failed: personal_c_tot does not equal personal_c_inner + personal_c_outer');
            }
            console.log('✅ personal_c_tot verification passed!');
            console.log('');

            // Format function for Noir
            const formatForNoir = (value: bigint): string => {
                return value.toString();
            };

            // Prepare circuit inputs
            const inputs = {
                user_key: formatForNoir(userKeyBigInt),
                token_address: formatForNoir(tokenAddressBigInt),
                amount: formatForNoir(amountBigInt),
                previous_nonce: formatForNoir(previousNonce),
                main_c_tot: mainCTotForCircuit.map(formatForNoir),
                main_c_inner: [mainCInner.x, mainCInner.y].map(formatForNoir),
                main_c_outer: [mainCOuter.x, mainCOuter.y].map(formatForNoir),
                main_c_inner_point: mainCInnerPoint.map(formatForNoir),
                main_c_outer_point: mainCOuterPoint.map(formatForNoir),
                personal_c_tot: personalState.personal_c_tot.map(formatForNoir),
                personal_c_inner: personalState.personal_c_inner.map(formatForNoir),
                personal_c_outer: personalState.personal_c_outer.map(formatForNoir),
                personal_c_inner_m: formatForNoir(personalState.personal_c_inner_m),
                personal_c_outer_m: formatForNoir(personalState.personal_c_outer_m),
                personal_c_outer_r: formatForNoir(personalState.personal_c_outer_r),
                receiver_public_key: [formatForNoir(receiverPublicKeyXBigInt), formatForNoir(receiverPublicKeyYBigInt)],
                relay_fee_token_address: formatForNoir(relayFeeTokenAddressBigInt),
                receiver_fee_amount: formatForNoir(receiverFeeAmountBigInt),
                fee_token_personal_c_inner: feeTokenPersonalState.personal_c_inner.map(formatForNoir),
                fee_token_personal_c_outer: feeTokenPersonalState.personal_c_outer.map(formatForNoir),
                fee_token_personal_c_inner_m: formatForNoir(feeTokenPersonalState.personal_c_inner_m),
                fee_token_personal_c_outer_m: formatForNoir(feeTokenPersonalState.personal_c_outer_m),
                fee_token_personal_c_outer_r: formatForNoir(feeTokenPersonalState.personal_c_outer_r),
            };

            return inputs;
        } catch (error) {
            console.error('Error calculating circuit inputs:', error);
            throw error;
        } finally {
            setIsCalculatingInputs(false);
        }
    };

    const proveSend = async () => {
        if (!zkAddress) {
            setProofError('Please sign a message first to access the Nydus network');
            return;
        }
        try {
            setIsProving(true);
            setProofError(null);
            setProvingTime(null);

            const startTime = performance.now();
            await initializeBackend();

            if (!backendRef.current || !noirRef.current) {
                throw new Error('Failed to initialize backend');
            }

            // Calculate circuit inputs dynamically
            const inputs = await calculateCircuitInputs();

            //@ts-ignore
            const { witness } = await noirRef.current!.execute(inputs, { keccak: true });
            console.log('Circuit execution result:', witness);

            //@ts-ignore
            const proofResult = await backendRef.current!.generateProof(witness, { keccak: true });
            console.log('Generated proof:', proofResult);
            const proofHex = Buffer.from(proofResult.proof).toString('hex');

            // Extract public inputs from proof result and slice to 30 elements
            const publicInputsArray = (proofResult.publicInputs || []).slice(0, 28);
            const publicInputsHex = publicInputsArray.map((input: any) => {
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
            setProof(proofHex);
            setPublicInputs(publicInputsHex);

            console.log('Proof generated successfully:', proofHex);
            console.log('Public inputs (sliced to 30):', publicInputsHex);
            console.log(`Total proving time: ${provingTimeMs}ms`);

        } catch (error) {
            console.error('Error generating proof:', error);
            setProofError(error instanceof Error ? error.message : 'Failed to generate proof');
        } finally {
            setIsProving(false);
        }
    };

    const handleSend = async () => {
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

            // Verifier expects exactly 28 public inputs (8 inputs + 20 outputs)
            if (publicInputs.length < 28) {
                throw new Error(`Expected 28 public inputs, but got ${publicInputs.length}. Please regenerate the proof.`);
            }

            const slicedInputs = publicInputs.slice(0, 28);
            const publicInputsBytes32 = slicedInputs.map((input: string) => {
                const hex = input.startsWith('0x') ? input.slice(2) : input;
                return `0x${hex.padStart(64, '0')}` as `0x${string}`;
            });

            console.log('Simulating send transaction...');
            console.log('Proof length:', proofBytes.length);
            console.log(`Public inputs (sliced to 28):`, publicInputsBytes32);
            console.log(`Total public inputs: ${publicInputsBytes32.length} (expected: 28)`);

            const client = publicClient || createPublicClient({
                chain: baseSepolia,
                transport: http()
            });

            setIsSimulating(true);
            try {
                const simResult = await client.simulateContract({
                    account: address as `0x${string}`,
                    address: NydusAddress as `0x${string}`,
                    abi: NydusAbi,
                    functionName: 'send',
                    args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[]],
                });

                console.log('✅ Simulation successful:', simResult);
                console.log('Gas estimate:', simResult.request?.gas?.toString());
                setSimulationResult(simResult);

            } catch (simulationError: any) {
                let errorMessage = 'Transaction simulation failed';

                if (simulationError?.shortMessage) {
                    errorMessage = simulationError.shortMessage;
                } else if (simulationError?.message) {
                    errorMessage = simulationError.message;
                } else if (typeof simulationError === 'string') {
                    errorMessage = simulationError;
                }

                if (simulationError?.cause) {
                    const cause = simulationError.cause;
                    if (cause?.data) {
                        errorMessage += `\nRevert data: ${cause.data}`;
                    }
                    if (cause?.reason) {
                        errorMessage += `\nReason: ${cause.reason}`;
                    }
                }

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

            console.log('Sending send transaction...');

            writeContract({
                address: NydusAddress as `0x${string}`,
                abi: NydusAbi,
                functionName: 'send',
                args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[]],
            });
            setHasTransactionBeenSent(true);

        } catch (error) {
            console.error('Error in handleSend:', error);
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
            toast('SEND TRANSACTION CONFIRMED', 'success');
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
        setReceiverZkAddress('');
        setReceiverPublicKeyX('');
        setReceiverPublicKeyY('');
        setRelayFeeTokenAddress('');
        setReceiverFeeAmount('');
        setSelectedBalanceEntry(null);
        setSelectedRelayFeeBalanceEntry(null);
        setQrScannerOpen(false);
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
                            <CardTitle className="text-center text-base sm:text-xl font-mono uppercase">SEND</CardTitle>
                        </div>
                        <CardDescription className="text-center text-xs sm:text-sm font-mono">SEND PRIVATE PAYMENTS</CardDescription>
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
                            {/* Sign Message Button */}
                            {!zkAddress && (
                                <Button
                                    onClick={handleSign}
                                    disabled={isLoading || isSigning}
                                    className="w-full bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading || isSigning ? 'SIGNING...' : 'SIGN MESSAGE FOR NYDUS NETWORK ACCESS'}
                                </Button>
                            )}

                            {zkAddress && !localUserKey && !contextUserKey && (
                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                    <CardContent className="pt-6">
                                        <p className="text-sm font-mono text-[#888888] uppercase">
                                            COMPUTING USER KEY FROM EXISTING SIGNATURE...
                                        </p>
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

                            {/* Input Fields */}
                            {zkAddress && (
                                <Card>
                                    <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                                            <CardTitle className="text-xs sm:text-sm font-mono uppercase">SEND DETAILS</CardTitle>
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
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 uppercase">
                                                    TOKEN ADDRESS
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
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 uppercase">
                                                    SEND AMOUNT
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
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 uppercase">
                                                    RECEIVER ZK ADDRESS
                                                </label>
                                                <div className="flex items-center space-x-2">
                                                    <Input
                                                        type="text"
                                                        value={receiverZkAddress}
                                                        onChange={(e) => setReceiverZkAddress(e.target.value)}
                                                        placeholder="zk..."
                                                        className="text-xs sm:text-sm flex-1"
                                                    />
                                                    <Button
                                                        type="button"
                                                        onClick={() => setQrScannerOpen(true)}
                                                        variant="outline"
                                                        size="sm"
                                                        className="p-2"
                                                        title="Scan QR code"
                                                    >
                                                        <QrCode className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                                <p className="mt-1 text-[10px] sm:text-xs font-mono text-[#888888] uppercase break-words">
                                                    X AND Y COORDINATES WILL BE EXTRACTED AUTOMATICALLY
                                                </p>
                                            </div>

                                            {/* Display extracted coordinates (read-only) */}
                                            {receiverZkAddress && receiverPublicKeyX && receiverPublicKeyY && (
                                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                                    <CardContent className="pt-3 sm:pt-4">
                                                        <p className="text-[10px] sm:text-xs font-mono text-[#888888] mb-2 uppercase">EXTRACTED COORDINATES:</p>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            <div>
                                                                <span className="text-[9px] sm:text-[10px] font-mono text-[#888888] block mb-0.5">X:</span>
                                                                <span className="text-[10px] sm:text-xs text-white font-mono break-all">
                                                                    {receiverPublicKeyX.length > 20 ? receiverPublicKeyX.slice(0, 20) + '...' : receiverPublicKeyX}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-[9px] sm:text-[10px] font-mono text-[#888888] block mb-0.5">Y:</span>
                                                                <span className="text-[10px] sm:text-xs text-white font-mono break-all">
                                                                    {receiverPublicKeyY.length > 20 ? receiverPublicKeyY.slice(0, 20) + '...' : receiverPublicKeyY}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )}

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
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 uppercase">
                                                    RELAY FEE TOKEN ADDRESS
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
                                                <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 uppercase">
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
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Generate Proof / Send Transaction Button */}
                            {zkAddress && (
                                <Button
                                    onClick={proof ? handleSend : proveSend}
                                    disabled={
                                        proof
                                            ? isPending || isConfirming || isSubmitting || isSimulating || !publicInputs.length || hasTransactionBeenSent
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
                                                    : 'SEND ON NYDUS'
                                        : isProving
                                            ? `GENERATING PROOF... (${currentProvingTime}MS)`
                                            : isInitializing || isCalculatingInputs
                                                ? 'CALCULATING INPUTS...'
                                                : 'GENERATE SEND PROOF'
                                    }
                                </Button>
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
                transactionType="SEND"
                onConfirmed={refreshAccountData}
            />
            <SyncingModal isOpen={isSyncing} />
            <QRScanner
                isOpen={qrScannerOpen}
                onClose={() => setQrScannerOpen(false)}
                onScan={handleQRScan}
            />
        </div>
    );
}
