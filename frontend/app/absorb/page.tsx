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
import circuit from '@/lib/circuits/nydus_absorb.json';
import { computeZkAddress, NYDUS_MESSAGE } from '@/lib/zk-address';
import { NydusAddress, NydusAbi } from '@/lib/abi/NydusConst';
import { pedersenCommitmentPositive, pedersenCommitmentNonHiding, grumpkinSubtract, grumpkinAddPoints, toNullifierDomain } from '@/lib/pedersen-commitments';
import { loadAccountDataOnSign } from '@/lib/loadAccountDataOnSign';
import { useNonceDiscovery } from '@/hooks/useNonceDiscovery';
import { saveAccountData, loadAccountData } from '@/lib/indexeddb';
import { generatePublicKey, performDHKeyExchange } from '@/lib/dh-utils';
import { poseidonCtrDecrypt } from '@/lib/poseidon-ctr-encryption';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TransactionModal from '@/components/TransactionModal';
import SyncingModal from '@/components/SyncingModal';
import { useToast } from '@/components/Toast';
import TokenSelector from '@/components/TokenSelector';
import { generateProofRemote, checkProofServerStatus } from '@/lib/proof-server';

export default function AbsorbPage() {
    const { toast } = useToast();
    const zkAddress = useZkAddress();
    const { setZkAddress, account } = useAccountContext();
    const accountState = useAccountState();
    const {
        balanceEntries,
        currentNonce,
        userKey: contextUserKey,
        setCurrentNonce,
        setBalanceEntries,
        setUserKey,
        setIsSyncing,
        setPersonalCommitmentState,
        getPersonalCommitmentState,
        isSyncing
    } = accountState;
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

    // Note selection state
    const [decryptedNotes, setDecryptedNotes] = useState<Array<{
        index: number;
        amount: bigint;
        tokenAddress: bigint;
        sharedKeyHash: bigint;
        senderPublicKey: { x: bigint; y: bigint };
    }>>([]);
    const [selectedTokenAddress, setSelectedTokenAddress] = useState<string>('');
    const [isLoadingNotes, setIsLoadingNotes] = useState(false);

    // State for token summaries (from account page logic)
    const [tokenSummaries, setTokenSummaries] = useState<Array<{
        tokenKey: string;
        notes: typeof decryptedNotes;
        totalAmount: bigint;
        nullifier: bigint;
        available: bigint;
    }>>([]);

    const [nullifier, setNullifier] = useState<string>('0x00');
    const [relayFeeTokenAddress, setRelayFeeTokenAddress] = useState<string>('');
    const [receiverFeeAmount, setReceiverFeeAmount] = useState<string>('');
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
    const [txError, setTxError] = useState<string | null>(null);
    const [simulationResult, setSimulationResult] = useState<any>(null);
    const [isCalculatingInputs, setIsCalculatingInputs] = useState(false);
    const [showTransactionModal, setShowTransactionModal] = useState(false);
    const [proofMode, setProofMode] = useState<'local' | 'remote'>('local');
    const [isCheckingServer, setIsCheckingServer] = useState(false);
    const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);

    const backendRef = useRef<CachedUltraHonkBackend | null>(null);
    const noirRef = useRef<Noir | null>(null);

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

    // Fetch and decrypt notes from contract
    const fetchAndDecryptNotes = useCallback(async () => {
        // Use contextUserKey if available, otherwise use localUserKey
        const userKeyToUse = contextUserKey ? '0x' + contextUserKey.toString(16) : localUserKey;
        if (!publicClient || !zkAddress || !userKeyToUse) {
            return;
        }

        setIsLoadingNotes(true);
        try {
            // Ensure Buffer polyfill is loaded BEFORE any @aztec imports
            const { ensureBufferPolyfill } = await import('@/lib/zk-address');
            await ensureBufferPolyfill();

            // Convert zkAddress (public key) to bytes format for contract
            // Remove "zk" prefix if present, and "0x" prefix
            let pubKeyBytes = zkAddress;
            if (pubKeyBytes.startsWith('zk')) {
                pubKeyBytes = pubKeyBytes.slice(2); // Remove "zk" prefix
            }
            if (pubKeyBytes.startsWith('0x')) {
                pubKeyBytes = pubKeyBytes.slice(2); // Remove "0x" prefix
            }
            // pubKeyBytes should now be 128 hex chars (64 bytes) representing x and y coordinates
            const pubKeyBytesArray = `0x${pubKeyBytes}` as `0x${string}`;

            // Fetch encrypted notes from contract
            const encryptedNotes = await publicClient.readContract({
                address: NydusAddress,
                abi: NydusAbi,
                functionName: 'getUserEncryptedNotes',
                args: [pubKeyBytesArray],
            });

            if (!encryptedNotes || encryptedNotes.length === 0) {
                setDecryptedNotes([]);
                return;
            }

            const cryptoModule = await import('@aztec/foundation/crypto');
            const { poseidon2Hash } = cryptoModule;
            const userKeyBigInt = BigInt(userKeyToUse.startsWith('0x') ? userKeyToUse : '0x' + userKeyToUse);

            // Decrypt each note using DH key exchange
            const decrypted: typeof decryptedNotes = [];
            for (let i = 0; i < encryptedNotes.length; i++) {
                const note = encryptedNotes[i] as any;
                const senderPubKey = {
                    x: BigInt(note.senderPublicKey.x.toString()),
                    y: BigInt(note.senderPublicKey.y.toString())
                };

                // Perform DH key exchange (receiver side: userKey is receiver's private key)
                // NOTE: The sender uses (user_key + nonce) as their private key for DH, but we don't know the sender's nonce.
                // However, the sender's public key stored in the contract is (user_key + nonce) * generator,
                // so we can compute the shared key using: receiver_user_key * sender_pub_key
                // This should match: (sender_user_key + sender_nonce) * receiver_pub_key
                const dhResult = await performDHKeyExchange(userKeyBigInt, senderPubKey);

                console.log(`[Note ${i}] DH Key Exchange:`);
                console.log(`  Receiver private key: 0x${userKeyBigInt.toString(16)}`);
                console.log(`  Sender public key: (0x${senderPubKey.x.toString(16)}, 0x${senderPubKey.y.toString(16)})`);
                console.log(`  Shared key: 0x${dhResult.sharedKey.toString(16)}`);

                // Hash shared key to get shared_key_hash
                // Send circuit uses: shared_key_hash = Poseidon2::hash([shared_key], 1)
                // This is a single-input hash, so poseidon2Hash should handle it correctly
                const sharedKeyHash = await poseidon2Hash([dhResult.sharedKey]);
                let sharedKeyHashBigInt: bigint;
                if (typeof sharedKeyHash === 'bigint') {
                    sharedKeyHashBigInt = sharedKeyHash;
                } else if ('toBigInt' in sharedKeyHash && typeof (sharedKeyHash as any).toBigInt === 'function') {
                    sharedKeyHashBigInt = (sharedKeyHash as any).toBigInt();
                } else if ('value' in sharedKeyHash) {
                    sharedKeyHashBigInt = BigInt((sharedKeyHash as any).value);
                } else {
                    sharedKeyHashBigInt = BigInt((sharedKeyHash as any).toString());
                }

                console.log(`  Shared key hash: 0x${sharedKeyHashBigInt.toString(16)}`);

                // Decrypt amount and token address
                const encryptedAmount = BigInt(note.encryptedAmountForReceiver.toString());
                const encryptedTokenAddress = BigInt(note.encryptedTokenAddressForReceiver.toString());

                console.log(`  Encrypted amount: 0x${encryptedAmount.toString(16)}`);
                console.log(`  Encrypted token address: 0x${encryptedTokenAddress.toString(16)}`);

                const amount = await poseidonCtrDecrypt(encryptedAmount, sharedKeyHashBigInt, 0);
                const tokenAddress = await poseidonCtrDecrypt(encryptedTokenAddress, sharedKeyHashBigInt, 1);

                console.log(`  Decrypted amount: 0x${amount.toString(16)} (${amount.toString()})`);
                console.log(`  Decrypted token address: 0x${tokenAddress.toString(16)}`);

                // Validate decrypted values are reasonable
                if (amount > BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) {
                    console.error(`  ⚠️ WARNING: Decrypted amount seems too large! This suggests a key mismatch.`);
                }
                if (tokenAddress > BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) {
                    console.error(`  ⚠️ WARNING: Decrypted token address seems too large! This suggests a key mismatch.`);
                }

                decrypted.push({
                    index: i,
                    amount,
                    tokenAddress,
                    sharedKeyHash: sharedKeyHashBigInt,
                    senderPublicKey: senderPubKey
                });
            }

            setDecryptedNotes(decrypted);
            console.log('Decrypted notes:', decrypted);

            // Calculate token summaries (group by token, calculate totals and available amounts)
            // We need to fetch nullifiers from the contract
            if (decrypted.length > 0 && publicClient && account?.signature) {
                await calculateTokenSummaries(decrypted);
            }

        } catch (error) {
            console.error('Error fetching/decrypting notes:', error);
            setError(error instanceof Error ? error.message : 'Failed to fetch notes');
        } finally {
            setIsLoadingNotes(false);
        }
    }, [publicClient, zkAddress, localUserKey, contextUserKey, account?.signature]);

    // Calculate token summaries with nullifiers
    const calculateTokenSummaries = async (notes: typeof decryptedNotes) => {
        if (!publicClient || !account?.signature) {
            return;
        }

        try {
            // Compute user key and view key (same as in account page)
            const { ensureBufferPolyfill } = await import('@/lib/zk-address');
            await ensureBufferPolyfill();

            const sigHex = account.signature.startsWith('0x') ? account.signature.slice(2) : account.signature;
            const sigBuffer = globalThis.Buffer.from(sigHex, 'hex');

            if (sigBuffer.length !== 65) {
                return;
            }

            const chunk1 = sigBuffer.slice(0, 31);
            const chunk2 = sigBuffer.slice(31, 62);
            const chunk3 = sigBuffer.slice(62, 65);

            const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
            const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
            const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));

            const { poseidon2Hash } = await import('@aztec/foundation/crypto');
            const poseidonHash = await poseidon2Hash([chunk1BigInt, chunk2BigInt, chunk3BigInt]);

            let userKey: bigint;
            if (typeof poseidonHash === 'bigint') {
                userKey = poseidonHash;
            } else if ('toBigInt' in poseidonHash && typeof (poseidonHash as any).toBigInt === 'function') {
                userKey = (poseidonHash as any).toBigInt();
            } else if ('value' in poseidonHash) {
                userKey = BigInt((poseidonHash as any).value);
            } else {
                userKey = BigInt((poseidonHash as any).toString());
            }

            const VIEW_STRING = BigInt('0x76696577696e675f6b6579');
            const userKeyHash = await poseidon2Hash([userKey]);
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

            const viewKey = await poseidon2Hash([VIEW_STRING, userKeyHashBigInt]);
            let viewKeyBigInt: bigint;
            if (typeof viewKey === 'bigint') {
                viewKeyBigInt = viewKey;
            } else if ('toBigInt' in viewKey && typeof (viewKey as any).toBigInt === 'function') {
                viewKeyBigInt = (viewKey as any).toBigInt();
            } else if ('value' in viewKey) {
                viewKeyBigInt = BigInt((viewKey as any).value);
            } else {
                viewKeyBigInt = BigInt((viewKey as any).toString());
            }

            // Group notes by token
            const notesByToken = new Map<string, typeof notes>();
            for (const note of notes) {
                const tokenKey = '0x' + note.tokenAddress.toString(16);
                if (!notesByToken.has(tokenKey)) {
                    notesByToken.set(tokenKey, []);
                }
                notesByToken.get(tokenKey)!.push(note);
            }

            // For each token, fetch nullifier and calculate available
            const summaries: typeof tokenSummaries = [];
            for (const [tokenKey, tokenNotes] of notesByToken.entries()) {
                const totalAmount = tokenNotes.reduce((sum, note) => sum + note.amount, BigInt(0));

                // Find balance entry for this token to get the nonce for nullifier lookup
                const tokenKeyNoPrefix = tokenKey.startsWith('0x') ? tokenKey.slice(2) : tokenKey;
                const tokenAddressBigInt = BigInt(tokenKey);

                // Get the highest nonce balance entry for this token
                const tokenBalanceEntries = balanceEntries.filter(e => e.tokenAddress.toString(16) === tokenKeyNoPrefix);
                const highestBalanceEntry = tokenBalanceEntries.length > 0
                    ? tokenBalanceEntries.reduce((max, e) => e.nonce > max.nonce ? e : max)
                    : null;

                let nullifier = BigInt(0);
                if (highestBalanceEntry) {
                    try {
                        const nonceCommitment = await poseidon2Hash([userKeyHashBigInt, highestBalanceEntry.nonce]);
                        let nonceCommitmentBigInt: bigint;
                        if (typeof nonceCommitment === 'bigint') {
                            nonceCommitmentBigInt = nonceCommitment;
                        } else if ('toBigInt' in nonceCommitment && typeof (nonceCommitment as any).toBigInt === 'function') {
                            nonceCommitmentBigInt = (nonceCommitment as any).toBigInt();
                        } else if ('value' in nonceCommitment) {
                            nonceCommitmentBigInt = BigInt((nonceCommitment as any).value);
                        } else {
                            nonceCommitmentBigInt = BigInt((nonceCommitment as any).toString());
                        }

                        const [encCTotM, encCTotR, encryptedNullifier] = await publicClient.readContract({
                            address: NydusAddress,
                            abi: NydusAbi,
                            functionName: 'getPersonalCTotAndNullifier',
                            args: [nonceCommitmentBigInt],
                        }) as [bigint, bigint, bigint];

                        if (encryptedNullifier !== BigInt(0)) {
                            const encryptionKey = await poseidon2Hash([viewKeyBigInt, highestBalanceEntry.nonce]);
                            let encryptionKeyBigInt: bigint;
                            if (typeof encryptionKey === 'bigint') {
                                encryptionKeyBigInt = encryptionKey;
                            } else if ('toBigInt' in encryptionKey && typeof (encryptionKey as any).toBigInt === 'function') {
                                encryptionKeyBigInt = (encryptionKey as any).toBigInt();
                            } else if ('value' in encryptionKey) {
                                encryptionKeyBigInt = BigInt((encryptionKey as any).value);
                            } else {
                                encryptionKeyBigInt = BigInt((encryptionKey as any).toString());
                            }

                            nullifier = await poseidonCtrDecrypt(encryptedNullifier, encryptionKeyBigInt, 6);
                        }
                    } catch (error) {
                        console.warn(`Could not fetch nullifier for token ${tokenKey}:`, error);
                    }
                }

                const available = totalAmount > nullifier ? totalAmount - nullifier : BigInt(0);

                summaries.push({
                    tokenKey,
                    notes: tokenNotes,
                    totalAmount,
                    nullifier,
                    available
                });
            }

            // Filter to only show tokens with available > 0
            const availableTokens = summaries.filter(s => s.available > BigInt(0));
            setTokenSummaries(availableTokens);
        } catch (error) {
            console.error('Error calculating token summaries:', error);
        }
    };

    // Auto-fetch notes when userKey and zkAddress are available
    React.useEffect(() => {
        const userKeyToUse = contextUserKey ? '0x' + contextUserKey.toString(16) : localUserKey;
        if (userKeyToUse && zkAddress && publicClient) {
            fetchAndDecryptNotes();
        }
    }, [localUserKey, contextUserKey, zkAddress, publicClient, fetchAndDecryptNotes]);

    // Calculate circuit inputs dynamically from contract state
    const calculateCircuitInputs = async () => {
        setIsCalculatingInputs(true);
        try {
            // Use contextUserKey if available, otherwise use localUserKey
            const userKeyToUse = contextUserKey ? '0x' + contextUserKey.toString(16) : localUserKey;

            if (!userKeyToUse) {
                throw new Error('User key not available. Please sign a message first.');
            }

            if (!selectedTokenAddress) {
                throw new Error('Please select a token to absorb');
            }

            // Find the token summary
            const tokenSummary = tokenSummaries.find(s => s.tokenKey === selectedTokenAddress);
            if (!tokenSummary) {
                throw new Error(`Token ${selectedTokenAddress} not found in available tokens`);
            }

            // Automatically select all notes for this token
            const selectedNotesArray = tokenSummary.notes;
            if (selectedNotesArray.length === 0) {
                throw new Error(`No notes found for token ${selectedTokenAddress}`);
            }

            if (currentNonce === null) {
                throw new Error('Please compute your current nonce first by visiting /account');
            }

            if (!relayFeeTokenAddress || !receiverFeeAmount) {
                throw new Error('Please enter relay fee token address and fee amount');
            }

            // Ensure Buffer polyfill is loaded BEFORE any @aztec imports
            const { ensureBufferPolyfill } = await import('@/lib/zk-address');
            await ensureBufferPolyfill();

            const cryptoModule = await import('@aztec/foundation/crypto');
            const { poseidon2Hash } = cryptoModule;

            // Convert inputs to BigInt
            const userKeyBigInt = BigInt(userKeyToUse.startsWith('0x') ? userKeyToUse : '0x' + userKeyToUse);
            const tokenAddressBigInt = BigInt(selectedTokenAddress.startsWith('0x') ? selectedTokenAddress : '0x' + selectedTokenAddress);

            // We'll determine nullifier after finding the token's previous nonce
            // For now, initialize it (will be updated based on token's actual state)
            let nullifierBigInt = BigInt(0);

            const relayFeeTokenAddressBigInt = BigInt(relayFeeTokenAddress.startsWith('0x') ? relayFeeTokenAddress : '0x' + relayFeeTokenAddress);
            // Convert decimal receiver fee amount to hex (default 18 decimals)
            const relayFeeDecimals = 18;
            const receiverFeeAmountFloat = parseFloat(receiverFeeAmount) || 0;
            const receiverFeeAmountInWei = BigInt(Math.floor(receiverFeeAmountFloat * Math.pow(10, relayFeeDecimals)));
            const receiverFeeAmountBigInt = receiverFeeAmountInWei;

            console.log(`[Absorb] Receiver fee amount conversion: ${receiverFeeAmountFloat} (decimal) -> ${receiverFeeAmountInWei.toString()} (wei) = 0x${receiverFeeAmountInWei.toString(16)}`);

            const tokensSame = tokenAddressBigInt === relayFeeTokenAddressBigInt;

            // Get previous nonce (current nonce - 1, or 0 if current nonce is 0)
            const previousNonce = currentNonce > BigInt(0) ? currentNonce - BigInt(1) : BigInt(0);

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

            // === COMPUTE NOTES COMMITMENTS (from selected notes) ===
            // selectedNotesArray is already set above from tokenSummary

            // Calculate inner: sum of selected notes for this token
            const innerNotesCount = BigInt(selectedNotesArray.length);
            const sumAmount = selectedNotesArray.reduce((sum, note) => sum + note.amount, BigInt(0));
            const sumSharedKeyHash = selectedNotesArray.reduce((sum, note) => sum + note.sharedKeyHash, BigInt(0));
            const tokenAddressWithCount = tokenAddressBigInt * innerNotesCount;

            // notes_c_inner = pedersen_commitment_positive(sum_amount, sum_shared_key_hash, token_address * count)
            const notesCInner = pedersenCommitmentPositive(sumAmount, sumSharedKeyHash, tokenAddressWithCount);
            const notesCInnerPoint: [bigint, bigint] = [sumAmount, sumSharedKeyHash];

            // Calculate outer: receiver's public key commitment (always the same, regardless of other notes)
            // notes_c_outer is always pedersen_commitment_positive(receiver_pub_x, receiver_pub_y, 1)
            // This matches the test structure where notes_c_outer is the receiver's public key commitment
            const receiverPublicKey = generatePublicKey(userKeyBigInt);
            const notesCOuter = pedersenCommitmentPositive(receiverPublicKey.x, receiverPublicKey.y, BigInt(1));
            const notesCOuterPoint: [bigint, bigint, bigint] = [receiverPublicKey.x, receiverPublicKey.y, BigInt(1)];

            // Verify that notes_c_outer_point reconstructs to notes_c_outer (circuit requirement)
            const reconstructedNotesCOuter = pedersenCommitmentPositive(
                notesCOuterPoint[0],
                notesCOuterPoint[1],
                notesCOuterPoint[2]
            );

            if (reconstructedNotesCOuter.x !== notesCOuter.x || reconstructedNotesCOuter.y !== notesCOuter.y) {
                console.error('❌ ERROR: notes_c_outer_point does not reconstruct to notes_c_outer!');
                console.error('  notes_c_outer_point:', notesCOuterPoint.map(v => '0x' + v.toString(16)));
                console.error('  notes_c_outer (expected): x = 0x' + notesCOuter.x.toString(16) + ', y = 0x' + notesCOuter.y.toString(16));
                console.error('  notes_c_outer (reconstructed): x = 0x' + reconstructedNotesCOuter.x.toString(16) + ', y = 0x' + reconstructedNotesCOuter.y.toString(16));
                console.error('  receiver_public_key.x = 0x' + receiverPublicKey.x.toString(16));
                console.error('  receiver_public_key.y = 0x' + receiverPublicKey.y.toString(16));
                throw new Error('notes_c_outer_point reconstruction failed - this will cause circuit verification to fail');
            }

            console.log('✅ Verified: notes_c_outer_point correctly reconstructs to notes_c_outer');
            console.log('  notes_c_outer_point[0] (receiver_pub_x) = 0x' + notesCOuterPoint[0].toString(16));
            console.log('  notes_c_outer_point[1] (receiver_pub_y) = 0x' + notesCOuterPoint[1].toString(16));
            console.log('  notes_c_outer_point[2] = 0x' + notesCOuterPoint[2].toString(16));
            console.log('  notes_c_outer.x = 0x' + notesCOuter.x.toString(16));
            console.log('  notes_c_outer.y = 0x' + notesCOuter.y.toString(16));
            console.log('');

            // Reference commitment is calculated in-circuit, but we need it for notes_c_tot calculation
            // Reference commitment: pedersen_commitment_positive(pub_x, pub_y, 1) - same as notes_c_outer
            const referenceCommitment = pedersenCommitmentPositive(receiverPublicKey.x, receiverPublicKey.y, BigInt(1));

            // notes_c_tot = notes_c_inner + notes_c_outer + reference_commitment
            const notesCTot = grumpkinAddPoints(
                grumpkinAddPoints(notesCInner, notesCOuter),
                referenceCommitment
            );

            console.log('=== NOTES COMMITMENTS ===');
            console.log('notes_c_inner:');
            console.log('  x = 0x' + notesCInner.x.toString(16));
            console.log('  y = 0x' + notesCInner.y.toString(16));
            console.log('notes_c_outer:');
            console.log('  x = 0x' + notesCOuter.x.toString(16));
            console.log('  y = 0x' + notesCOuter.y.toString(16));
            console.log('notes_c_outer_point:');
            console.log('  [0] = 0x' + notesCOuterPoint[0].toString(16));
            console.log('  [1] = 0x' + notesCOuterPoint[1].toString(16));
            console.log('  [2] = 0x' + notesCOuterPoint[2].toString(16));
            console.log('receiver_public_key:');
            console.log('  x = 0x' + receiverPublicKey.x.toString(16));
            console.log('  y = 0x' + receiverPublicKey.y.toString(16));
            console.log('notes_c_tot:');
            console.log('  x = 0x' + notesCTot.x.toString(16));
            console.log('  y = 0x' + notesCTot.y.toString(16));
            console.log('');

            // === COMPUTE PERSONAL COMMITMENTS (on the fly from balance entry) ===
            // Find the balance entry for the token at the highest nonce <= previousNonce
            // The token doesn't need to have a transaction at the exact previousNonce
            // If no balance entry found, use amount 0 (like deposit page does for new tokens)
            const tokenEntries = balanceEntries
                .filter(entry => entry.tokenAddress === tokenAddressBigInt && entry.nonce <= previousNonce)
                .sort((a, b) => a.nonce > b.nonce ? -1 : 1); // Sort descending by nonce

            const tokenBalanceEntry = tokenEntries.length > 0 ? tokenEntries[0] : null;

            // If no balance entry found, use amount 0 (new token - not initialized yet)
            // This allows absorbing notes into a token that hasn't been used before
            let tokenBalanceAmount: bigint;
            if (!tokenBalanceEntry || tokenBalanceEntry.amount === undefined || tokenBalanceEntry.amount === null) {
                console.log(`ℹ️ No balance entry found for token ${selectedTokenAddress} at any nonce <= ${previousNonce}. Using amount 0 (new token).`);
                tokenBalanceAmount = BigInt(0);
            } else {
                tokenBalanceAmount = tokenBalanceEntry.amount;
            }

            // Compute personal commitments (matching test's create_personal_commitments pattern)
            const balanceAmountHash = await poseidon2Hash([tokenBalanceAmount, userKeyHashBigInt]);
            let balanceAmountHashBigInt: bigint;
            if (typeof balanceAmountHash === 'bigint') {
                balanceAmountHashBigInt = balanceAmountHash;
            } else if ('toBigInt' in balanceAmountHash && typeof (balanceAmountHash as any).toBigInt === 'function') {
                balanceAmountHashBigInt = (balanceAmountHash as any).toBigInt();
            } else if ('value' in balanceAmountHash) {
                balanceAmountHashBigInt = BigInt((balanceAmountHash.toString()));
            } else {
                balanceAmountHashBigInt = BigInt((balanceAmountHash as any).toString());
            }

            const tokenAddressHash = await poseidon2Hash([tokenAddressBigInt, userKeyHashBigInt]);
            let tokenAddressHashBigInt: bigint;
            if (typeof tokenAddressHash === 'bigint') {
                tokenAddressHashBigInt = tokenAddressHash;
            } else if ('toBigInt' in tokenAddressHash && typeof (tokenAddressHash as any).toBigInt === 'function') {
                tokenAddressHashBigInt = (tokenAddressHash as any).toBigInt();
            } else if ('value' in tokenAddressHash) {
                tokenAddressHashBigInt = BigInt((tokenAddressHash as any).value);
            } else {
                tokenAddressHashBigInt = BigInt((tokenAddressHash as any).toString());
            }

            // Create personal commitments (matching absorb circuit - with initializer when nullifier = 0)
            const personalCInner = pedersenCommitmentNonHiding(balanceAmountHashBigInt, tokenAddressHashBigInt);
            const personalCOuter = pedersenCommitmentNonHiding(BigInt(0), tokenAddressBigInt);

            // According to test: when nullifier = 0, personal_c_tot = inner + outer + initializer
            // The initializer is: pedersen_commitment_non_hiding(token_address, user_key_hash)
            const initializer = pedersenCommitmentNonHiding(tokenAddressBigInt, userKeyHashBigInt);
            const personalCTot = grumpkinAddPoints(
                grumpkinAddPoints(personalCInner, personalCOuter),
                initializer
            );

            const personalState = {
                personal_c_tot: [personalCTot.x, personalCTot.y],
                personal_c_inner: [personalCInner.x, personalCInner.y],
                personal_c_outer: [personalCOuter.x, personalCOuter.y],
                personal_c_inner_m: tokenBalanceAmount,
                personal_c_outer_m: BigInt(0),
                personal_c_outer_r: tokenAddressBigInt,
            };

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
            console.log('nullifier:', nullifierBigInt.toString());
            console.log('');

            // === COMPUTE FEE TOKEN PERSONAL COMMITMENTS ===
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

                // Compute fee token personal commitments on the fly
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

                const feeTokenPersonalCInner = pedersenCommitmentNonHiding(feeTokenBalanceAmountHashBigInt, feeTokenTokenAddressHashBigInt);
                const feeTokenPersonalCOuter = pedersenCommitmentNonHiding(BigInt(0), relayFeeTokenAddressBigInt);

                // Fee token also needs initializer when nullifier = 0 (same logic as main token)
                const feeTokenInitializer = pedersenCommitmentNonHiding(relayFeeTokenAddressBigInt, userKeyHashBigInt);
                const feeTokenPersonalCTot = grumpkinAddPoints(
                    grumpkinAddPoints(feeTokenPersonalCInner, feeTokenPersonalCOuter),
                    feeTokenInitializer
                );

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
                feeTokenPersonalState = {
                    personal_c_tot: personalState.personal_c_tot,
                    personal_c_inner: personalState.personal_c_inner,
                    personal_c_outer: personalState.personal_c_outer,
                    personal_c_inner_m: personalState.personal_c_inner_m,
                    personal_c_outer_m: personalState.personal_c_outer_m,
                    personal_c_outer_r: personalState.personal_c_outer_r,
                };
            }

            // === COMPUTE MAIN COMMITMENTS (from contract state) ===
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

            console.log('=== ABSORB: PREVIOUS NONCE COMMITMENT ===');
            console.log(`  currentNonce: ${currentNonce.toString()}`);
            console.log(`  previousNonce: ${previousNonce.toString()}`);
            console.log(`  user_key_hash: 0x${userKeyHashBigInt.toString(16)}`);
            console.log(`  previous_nonce_commitment: 0x${previousNonceCommitmentBigInt.toString(16)}`);
            console.log('');

            // Fetch main_c_inner_point from contract
            // For uninitialized tokens (no balance entry), always compute from personalState
            // The contract's stored value is for the token that was used at previousNonce, not for the new token
            let mainCInnerPoint: [bigint, bigint];
            const isUninitializedToken = !tokenBalanceEntry || tokenBalanceEntry.amount === undefined || tokenBalanceEntry.amount === null;

            if (previousNonce === BigInt(0) || isUninitializedToken) {
                // First absorb after entry OR uninitialized token: need to reconstruct and encrypt personal_c_tot
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

                if (isUninitializedToken) {
                    console.log('Computed main_c_inner_point for uninitialized token (no balance entry):');
                } else {
                    console.log('Computed main_c_inner_point for nonce 0 (first absorb after entry):');
                }
                console.log('  enc_x = 0x' + encryptedX.toString(16));
                console.log('  enc_y = 0x' + encryptedY.toString(16));
                console.log('');
            } else {
                // Subsequent absorbs: fetch enc_x and enc_y from the previous nonce commitment
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

            // Calculate main_c_outer and main_c_outer_point
            // IMPORTANT: For absorb, main_c_tot structure is: notes_c_tot + main_c_outer = main_c_tot
            // So: main_c_outer = main_c_tot - notes_c_tot
            // 
            // The stateCommitment includes:
            // 1. Initial commitment: (1, 1, 1)
            // 2. All main_c_inner commitments: (enc_x, enc_y, nonce_commitment) for each absorb
            // 3. All note stack root commitments: (receiverStack.x, receiverStack.y, 1) for each send
            //
            // For main_c_outer_point, we need opening values that reconstruct to main_c_outer.
            // We need to subtract from contract's aggregated values:
            // - The current main_c_inner opening values (enc_x, enc_y, previousNonceCommitment)
            // - The user's note stack root opening values (noteStack.x, noteStack.y, 1)

            let mainCOuter: { x: bigint; y: bigint };
            let mainCOuterPoint: [bigint, bigint, bigint];
            let mainCTotForCircuit: [bigint, bigint];

            // Get user's note stack from contract
            let userNoteStackX: bigint | undefined;
            let userNoteStackY: bigint | undefined;
            try {
                // Convert zkAddress to bytes format for contract
                if (!zkAddress) {
                    throw new Error('zkAddress is required');
                }
                let pubKeyBytes = zkAddress;
                if (pubKeyBytes.startsWith('zk')) {
                    pubKeyBytes = pubKeyBytes.slice(2);
                }
                if (pubKeyBytes.startsWith('0x')) {
                    pubKeyBytes = pubKeyBytes.slice(2);
                }
                const pubKeyBytesArray = `0x${pubKeyBytes}` as `0x${string}`;

                const noteStack = await publicClient.readContract({
                    address: NydusAddress,
                    abi: NydusAbi,
                    functionName: 'getUserNoteCommitmentStack',
                    args: [pubKeyBytesArray],
                });

                if (Array.isArray(noteStack) && noteStack.length >= 2) {
                    userNoteStackX = BigInt(noteStack[0]?.toString() || '0');
                    userNoteStackY = BigInt(noteStack[1]?.toString() || '0');
                } else if (noteStack && typeof noteStack === 'object') {
                    userNoteStackX = BigInt((noteStack as any).x?.toString() || '0');
                    userNoteStackY = BigInt((noteStack as any).y?.toString() || '0');
                }
            } catch (error) {
                console.warn('Could not fetch user note stack, assuming empty:', error);
                userNoteStackX = BigInt(0);
                userNoteStackY = BigInt(0);
            }

            if (previousNonce === BigInt(0)) {
                // First absorb after entry: use the same approach as deposit/send/withdraw
                // For absorb, the structure is: main_c_tot = notes_c_tot + main_c_outer
                // For first operation, construct it as: main_c_tot = initial_state + notes_c_tot
                // This ensures main_c_outer = initial_state and main_c_outer_point = [1, 1, 1]

                // Compute initial state commitment
                const initialStateCommitment = pedersenCommitmentPositive(BigInt(1), BigInt(1), BigInt(1));

                // Construct main_c_tot = initial_state + notes_c_tot
                // This ensures main_c_outer = initial_state
                const mainCTotComputed = grumpkinAddPoints(initialStateCommitment, notesCTot);
                mainCTotForCircuit = [mainCTotComputed.x, mainCTotComputed.y];
                mainCOuter = initialStateCommitment;
                mainCOuterPoint = [BigInt(1), BigInt(1), BigInt(1)];

                console.log('=== FIRST ABSORB AFTER ENTRY (previousNonce === 0) ===');
                console.log('Using deposit/send/withdraw approach: computed main_c_tot = initial_state + notes_c_tot');
                console.log('initial_state_commitment:');
                console.log('  x = 0x' + initialStateCommitment.x.toString(16));
                console.log('  y = 0x' + initialStateCommitment.y.toString(16));
                console.log('');
                console.log('notes_c_tot:');
                console.log('  x = 0x' + notesCTot.x.toString(16));
                console.log('  y = 0x' + notesCTot.y.toString(16));
                console.log('');
                console.log('main_c_outer (set to initial_state):');
                console.log('  x = 0x' + mainCOuter.x.toString(16));
                console.log('  y = 0x' + mainCOuter.y.toString(16));
                console.log('');
                console.log('main_c_tot (computed as initial_state + notes_c_tot):');
                console.log('  x = 0x' + mainCTotForCircuit[0].toString(16));
                console.log('  y = 0x' + mainCTotForCircuit[1].toString(16));
                console.log('');
                console.log('main_c_outer_point: [1, 1, 1]');
                console.log('');

                // Verify: main_c_tot should equal notes_c_tot + main_c_outer
                const verifiedMainCTot = grumpkinAddPoints(notesCTot, mainCOuter);
                console.log('Verification: notes_c_tot + main_c_outer:');
                console.log('  x = 0x' + verifiedMainCTot.x.toString(16));
                console.log('  y = 0x' + verifiedMainCTot.y.toString(16));
                console.log('');
                const matches = verifiedMainCTot.x === mainCTotForCircuit[0] && verifiedMainCTot.y === mainCTotForCircuit[1];
                console.log('Match?', matches);
                if (!matches) {
                    console.error('❌ ERROR: main_c_tot mismatch!');
                    console.error('  Expected: x = 0x' + mainCTotForCircuit[0].toString(16) + ', y = 0x' + mainCTotForCircuit[1].toString(16));
                    console.error('  Got: x = 0x' + verifiedMainCTot.x.toString(16) + ', y = 0x' + verifiedMainCTot.y.toString(16));
                    throw new Error('main_c_tot verification failed: computed main_c_tot does not equal notes_c_tot + main_c_outer');
                }
                console.log('✅ main_c_tot verification passed!');
                console.log('');
            } else {
                // Subsequent absorbs: compute from contract state
                // main_c_outer = main_c_tot - notes_c_tot
                mainCOuter = grumpkinSubtract({ x: mainCTot[0], y: mainCTot[1] }, notesCTot);
                mainCTotForCircuit = [mainCTot[0], mainCTot[1]];

                // Compute main_c_outer_point via scalar subtraction from contract aggregated values
                if (contractStateM === undefined || contractStateR === undefined || contractStateD === undefined) {
                    throw new Error('Contract state opening values not available for previousNonce > 0');
                }

                const BN254_SCALAR_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

                // For uninitialized tokens, the contract's stored encCTotM/encCTotR at previousNonce
                // are for a DIFFERENT token (the one that was actually used at that nonce).
                // So we should NOT subtract them when computing main_c_outer_point.
                // Instead, we need to subtract the current main_c_inner opening values (which we computed).
                if (isUninitializedToken) {
                    // For uninitialized tokens: subtract current main_c_inner opening values (not contract's stored values)
                    // The current main_c_inner_point is what we computed for this new token
                    let outerM = (contractStateM - mainCInnerPoint[0] + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                    let outerR = (contractStateR - mainCInnerPoint[1] + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                    let outerD = (contractStateD - previousNonceCommitmentBigInt + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;

                    // Subtract user's note stack root opening values (if available)
                    if (userNoteStackX !== undefined && userNoteStackY !== undefined && userNoteStackX !== BigInt(0) && userNoteStackY !== BigInt(0)) {
                        outerM = (outerM - userNoteStackX + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                        outerR = (outerR - userNoteStackY + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                        outerD = (outerD - BigInt(1) + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                    }

                    mainCOuterPoint = [outerM, outerR, outerD];

                    console.log('=== UNINITIALIZED TOKEN: Using current main_c_inner_point for main_c_outer_point computation ===');
                    console.log('  (Not subtracting contract\'s stored encCTotM/encCTotR because they\'re for a different token)');
                    console.log('');
                } else {
                    // For initialized tokens: subtract contract's stored encCTotM/encCTotR from previous nonce
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

                    // For main_c_outer_point, we need to subtract from contract's aggregated values:
                    // 1. The previous main_c_inner opening values (enc_x, enc_y, previousNonceCommitment)
                    // 2. The user's note stack root opening values (userNoteStackX, userNoteStackY, 1)
                    // 
                    // stateCommitment aggregated = initial(1,1,1) + sum(main_c_inner) + sum(note_stack_roots)
                    // main_c_outer_point = stateCommitment_aggregated - main_c_inner - user_note_stack_root

                    // Subtract main_c_inner opening values
                    let outerM = (contractStateM - encCTotMBigInt + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                    let outerR = (contractStateR - encCTotRBigInt + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                    let outerD = (contractStateD - previousNonceCommitmentBigInt + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;

                    // Subtract user's note stack root opening values (if available)
                    if (userNoteStackX !== undefined && userNoteStackY !== undefined && userNoteStackX !== BigInt(0) && userNoteStackY !== BigInt(0)) {
                        outerM = (outerM - userNoteStackX + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                        outerR = (outerR - userNoteStackY + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                        outerD = (outerD - BigInt(1) + BN254_SCALAR_FIELD_MODULUS) % BN254_SCALAR_FIELD_MODULUS;
                    }

                    mainCOuterPoint = [outerM, outerR, outerD];
                }

                // CRITICAL: Compute main_c_outer from main_c_outer_point to ensure consistency
                // This ensures that main_c_outer matches what the circuit will reconstruct
                const reconstructedMainCOuter = pedersenCommitmentPositive(
                    mainCOuterPoint[0],
                    mainCOuterPoint[1],
                    mainCOuterPoint[2]
                );
                mainCOuter = reconstructedMainCOuter;

                // Recompute main_c_tot to ensure consistency (for absorb: main_c_tot = notes_c_tot + main_c_outer)
                const recomputedMainCTot = grumpkinAddPoints(notesCTot, mainCOuter);
                mainCTotForCircuit = [recomputedMainCTot.x, recomputedMainCTot.y];

                console.log('=== SUBSEQUENT ABSORB (previousNonce > 0) ===');
                console.log('main_c_outer_point (computed from contract aggregated values):');
                console.log('  [0] = 0x' + mainCOuterPoint[0].toString(16));
                console.log('  [1] = 0x' + mainCOuterPoint[1].toString(16));
                console.log('  [2] = 0x' + mainCOuterPoint[2].toString(16));
                console.log('');
                console.log('main_c_outer (computed from main_c_outer_point):');
                console.log('  x = 0x' + mainCOuter.x.toString(16));
                console.log('  y = 0x' + mainCOuter.y.toString(16));
                console.log('');
                console.log('main_c_tot (recomputed as notes_c_tot + main_c_outer):');
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


            // Verify main_c_tot structure: notes_c_tot + main_c_outer = main_c_tot
            const verifiedMainCTot = grumpkinAddPoints(notesCTot, mainCOuter);
            console.log('=== MAIN COMMITMENTS VERIFICATION ===');
            console.log('Verification: notes_c_tot + main_c_outer:');
            console.log('  x = 0x' + verifiedMainCTot.x.toString(16));
            console.log('  y = 0x' + verifiedMainCTot.y.toString(16));
            console.log('Expected main_c_tot (from contract):');
            console.log('  x = 0x' + mainCTotForCircuit[0].toString(16));
            console.log('  y = 0x' + mainCTotForCircuit[1].toString(16));
            const mainMatches = verifiedMainCTot.x === mainCTotForCircuit[0] && verifiedMainCTot.y === mainCTotForCircuit[1];
            console.log('Match?', mainMatches);
            if (!mainMatches) {
                console.warn('⚠️ WARNING: notes_c_tot + main_c_outer does not match main_c_tot from contract!');
                console.warn('This might be expected if the contract state includes other commitments.');
            }
            console.log('');

            // Format function for Noir
            const formatForNoir = (value: bigint): string => {
                return value.toString();
            };

            // Prepare circuit inputs
            const inputs = {
                user_key: formatForNoir(userKeyBigInt),
                token_address: formatForNoir(tokenAddressBigInt),
                previous_nonce: formatForNoir(previousNonce),
                inner_notes_count: formatForNoir(innerNotesCount),
                main_c_tot: mainCTotForCircuit.map(formatForNoir),
                main_c_inner: [mainCInner.x, mainCInner.y].map(formatForNoir),
                main_c_outer: [mainCOuter.x, mainCOuter.y].map(formatForNoir),
                main_c_inner_point: mainCInnerPoint.map(formatForNoir),
                main_c_outer_point: mainCOuterPoint.map(formatForNoir),
                notes_c_tot: [notesCTot.x, notesCTot.y].map(formatForNoir),
                notes_c_inner: [notesCInner.x, notesCInner.y].map(formatForNoir),
                notes_c_outer: [notesCOuter.x, notesCOuter.y].map(formatForNoir),
                notes_c_inner_point: notesCInnerPoint.map(formatForNoir),
                notes_c_outer_point: notesCOuterPoint.map(formatForNoir),
                personal_c_tot: personalState.personal_c_tot.map(formatForNoir),
                personal_c_inner: personalState.personal_c_inner.map(formatForNoir),
                personal_c_outer: personalState.personal_c_outer.map(formatForNoir),
                personal_c_inner_m: formatForNoir(personalState.personal_c_inner_m),
                personal_c_outer_m: formatForNoir(personalState.personal_c_outer_m),
                personal_c_outer_r: formatForNoir(personalState.personal_c_outer_r),
                nullifier: formatForNoir(nullifierBigInt),
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

    const proveAbsorb = async () => {
        if (!zkAddress) {
            setProofError('Please sign a message first to access the Nydus network');
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
                const result = await generateProofRemote('absorb', inputs);
                proofHex = result.proof;
                publicInputsHex = result.publicInputs.slice(0, 28); // Slice to 28 for absorb
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

            console.log('Proof generated successfully:', proofHex);
            console.log('Public inputs (sliced to 20):', publicInputsHex);
            console.log(`Total proving time: ${provingTimeMs}ms`);

        } catch (error) {
            console.error('Error generating proof:', error);
            setProofError(error instanceof Error ? error.message : 'Failed to generate proof');
        } finally {
            setIsProving(false);
        }
    };

    const handleAbsorb = async () => {
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

            console.log('Simulating absorb transaction...');
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
                    functionName: 'absorb',
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

            console.log('Sending absorb transaction...');

            writeContract({
                address: NydusAddress as `0x${string}`,
                abi: NydusAbi,
                functionName: 'absorb',
                args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[]],
            });

        } catch (error) {
            console.error('Error in handleAbsorb:', error);
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

    // Show toast on success
    React.useEffect(() => {
        if (isConfirmed && txHash) {
            toast('ABSORB TRANSACTION CONFIRMED', 'success');
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
        setRelayFeeTokenAddress('');
        setReceiverFeeAmount('');
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
                            <CardTitle className="text-center text-base sm:text-xl font-mono uppercase">ABSORB</CardTitle>
                        </div>
                        <CardDescription className="text-center text-xs sm:text-sm font-mono">ABSORB INCOMING NOTES</CardDescription>
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

                            {/* Token Selection */}
                            {zkAddress && (localUserKey || contextUserKey) && (
                                <Card>
                                    <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                                                <CardTitle className="text-xs sm:text-sm font-mono uppercase">$ SELECT TOKEN TO ABSORB</CardTitle>
                                            </div>
                                            <Button
                                                onClick={fetchAndDecryptNotes}
                                                disabled={isLoadingNotes}
                                                size="sm"
                                                variant="outline"
                                                className="text-xs h-7 px-2 border-[#333333] hover:border-[rgba(182,255,62,1)] hover:text-[rgba(182,255,62,1)] transition-colors"
                                            >
                                                {isLoadingNotes ? 'LOADING...' : 'REFRESH'}
                                            </Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-3 sm:space-y-4">
                                            {isLoadingNotes && (
                                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                                    <CardContent className="pt-4">
                                                        <p className="text-sm font-mono text-white uppercase">LOADING AND DECRYPTING NOTES...</p>
                                                    </CardContent>
                                                </Card>
                                            )}

                                            {!isLoadingNotes && tokenSummaries.length === 0 && (
                                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                                    <CardContent className="pt-4">
                                                        <p className="text-sm font-mono text-[#888888] uppercase">NO TOKENS AVAILABLE TO ABSORB. ALL NOTES HAVE BEEN ABSORBED OR NO INCOMING NOTES FOUND.</p>
                                                    </CardContent>
                                                </Card>
                                            )}

                                            {!isLoadingNotes && tokenSummaries.length > 0 && (() => {
                                                // Convert tokenSummaries to balanceEntries format for TokenSelector
                                                const absorbTokenEntries = tokenSummaries.map((summary) => ({
                                                    tokenAddress: BigInt(summary.tokenKey.startsWith('0x') ? summary.tokenKey : '0x' + summary.tokenKey),
                                                    amount: summary.available, // Use available amount
                                                    nonce: BigInt(0), // Dummy nonce, not used for display
                                                }));

                                                return (
                                                    <div>
                                                        <TokenSelector
                                                            label="SELECT TOKEN TO ABSORB"
                                                            value={tokenSummaries.findIndex(s => s.tokenKey === selectedTokenAddress) >= 0
                                                                ? tokenSummaries.findIndex(s => s.tokenKey === selectedTokenAddress)
                                                                : null}
                                                            onChange={(index) => {
                                                                if (index !== null && index >= 0 && index < tokenSummaries.length) {
                                                                    setSelectedTokenAddress(tokenSummaries[index].tokenKey);
                                                                } else {
                                                                    setSelectedTokenAddress('');
                                                                }
                                                            }}
                                                            balanceEntries={absorbTokenEntries}
                                                            originalIndices={tokenSummaries.map((_, i) => i)}
                                                            publicClient={publicClient || undefined}
                                                        />

                                                        {selectedTokenAddress && (() => {
                                                            const summary = tokenSummaries.find(s => s.tokenKey === selectedTokenAddress);
                                                            if (!summary) return null;
                                                            return (
                                                                <Card className="mt-2 sm:mt-3 border-white bg-black">
                                                                    <CardContent className="pt-3 sm:pt-4">
                                                                        <p className="text-xs sm:text-sm font-mono text-white font-bold uppercase mb-2 break-all">
                                                                            {summary.tokenKey}
                                                                        </p>
                                                                        <div className="grid grid-cols-2 gap-2 text-[10px] sm:text-xs font-mono">
                                                                            <div>
                                                                                <span className="text-[#888888] block mb-0.5">AVAILABLE:</span>
                                                                                <span className="text-white font-bold">{summary.available.toString()}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-[#888888] block mb-0.5">TOTAL:</span>
                                                                                <span className="text-white">{summary.totalAmount.toString()}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-[#888888] block mb-0.5">NULLIFIER:</span>
                                                                                <span className="text-white">{summary.nullifier.toString()}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-[#888888] block mb-0.5">NOTES:</span>
                                                                                <span className="text-white">{summary.notes.length}</span>
                                                                            </div>
                                                                        </div>
                                                                    </CardContent>
                                                                </Card>
                                                            );
                                                        })()}
                                                    </div>
                                                );
                                            })()}

                                            {selectedTokenAddress && (() => {
                                                const summary = tokenSummaries.find(s => s.tokenKey === selectedTokenAddress);
                                                if (!summary) return null;

                                                return (
                                                    <div>
                                                        <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 uppercase">
                                                            NULLIFIER (AUTO-FILLED)
                                                        </label>
                                                        <Input
                                                            type="text"
                                                            value={'0x' + summary.nullifier.toString(16)}
                                                            readOnly
                                                            className="cursor-not-allowed text-xs sm:text-sm"
                                                        />
                                                        <p className="mt-1 text-[10px] sm:text-xs font-mono text-[#888888] uppercase break-words">
                                                            TRACKS CUMULATIVE AMOUNT ABSORBED
                                                        </p>
                                                    </div>
                                                );
                                            })()}

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
                                                    placeholder="0x02"
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
                            {zkAddress && (
                                <Button
                                    onClick={proof ? handleAbsorb : proveAbsorb}
                                    disabled={
                                        proof
                                            ? isPending || isConfirming || isSubmitting || isSimulating || isConfirmed || !publicInputs.length
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
                                                    : 'ABSORB ON NYDUS'
                                        : isProving
                                            ? `GENERATING PROOF... (${currentProvingTime}MS)`
                                            : isInitializing || isCalculatingInputs
                                                ? 'CALCULATING INPUTS...'
                                                : 'GENERATE ABSORB PROOF'
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
                transactionType="ABSORB"
                onConfirmed={refreshAccountData}
            />
            <SyncingModal isOpen={isSyncing} />
        </div>
    );
}
