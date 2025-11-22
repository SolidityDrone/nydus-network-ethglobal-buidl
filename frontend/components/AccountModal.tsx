'use client';

import { useNonceDiscovery, BalanceEntry } from '@/hooks/useNonceDiscovery';
import { useZkAddress, useAccount } from '@/context/AccountProvider';
import { useAccountState } from '@/context/AccountStateProvider';
import { useEffect, useState, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { usePublicClient } from 'wagmi';
import { NydusAddress, NydusAbi } from '@/lib/abi/NydusConst';
import { poseidonCtrDecrypt } from '@/lib/poseidon-ctr-encryption';
import { performDHKeyExchange } from '@/lib/dh-utils';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { saveAccountData, loadAccountData } from '@/lib/indexeddb';
import { fetchTokenInfoBatch, TokenInfo } from '@/lib/token-lookup';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AccountModal({ isOpen, onClose }: AccountModalProps) {
  const {
    computeCurrentNonce,
    isComputing,
    currentNonce,
    error,
    nonceDiscoveryPoint,
    aggregatedM,
    aggregatedR,
    balanceEntries,
    isDecrypting,
    reconstructPersonalCommitmentState,
  } = useNonceDiscovery();

  const {
    setBalanceEntries,
    setCurrentNonce,
    setPersonalCommitmentState,
    setUserKey,
    userKey: contextUserKey,
  } = useAccountState();

  const zkAddress = useZkAddress();
  const { account } = useAccount();
  const publicClient = usePublicClient();
  const router = useRouter();

  // State for nullifiers per token
  const [tokenNullifiers, setTokenNullifiers] = useState<Map<string, bigint>>(new Map());
  const [isLoadingNullifiers, setIsLoadingNullifiers] = useState(false);

  // State for notes
  const [decryptedNotes, setDecryptedNotes] = useState<Array<{
    index: number;
    amount: bigint;
    tokenAddress: bigint;
    sharedKeyHash: bigint;
    senderPublicKey: { x: bigint; y: bigint };
  }>>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [selectedTokenForAbsorb, setSelectedTokenForAbsorb] = useState<string>('');
  const [dataLastSaved, setDataLastSaved] = useState<number | null>(null);
  const [isLoadingSavedData, setIsLoadingSavedData] = useState(false);
  const [tokenInfoMap, setTokenInfoMap] = useState<Map<string, TokenInfo>>(new Map());
  const [isLoadingTokenInfo, setIsLoadingTokenInfo] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  // Track if modal is closed to cancel ongoing operations
  const isModalClosedRef = useRef(false);

  // Reset the ref when modal opens
  useEffect(() => {
    if (isOpen) {
      isModalClosedRef.current = false;
    }
  }, [isOpen]);

  // Handle close - should work immediately even during computations
  const handleClose = useCallback(() => {
    // Set the ref first to stop all ongoing operations
    isModalClosedRef.current = true;
    // Use setTimeout to allow browser to update DOM even during heavy computations
    // This gives the browser a chance to render the close before continuing
    setTimeout(() => {
      flushSync(() => {
        onClose();
      });
    }, 0);
  }, [onClose]);

  // Fetch nullifiers for each token
  const fetchNullifiers = useCallback(async () => {
    if (!publicClient || !account?.signature || balanceEntries.length === 0 || isModalClosedRef.current) {
      return;
    }

    setIsLoadingNullifiers(true);
    try {
      // Check if modal was closed before starting
      if (isModalClosedRef.current) {
        setIsLoadingNullifiers(false);
        return;
      }
      // Compute user key from signature
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

      // Compute view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2)
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

      // Group entries by token and sort by nonce (highest first)
      const tokenMap = new Map<string, typeof balanceEntries[0]>();
      for (const entry of balanceEntries) {
        const tokenKey = entry.tokenAddress.toString(16);
        const existing = tokenMap.get(tokenKey);
        if (!existing || entry.nonce > existing.nonce) {
          tokenMap.set(tokenKey, entry);
        }
      }

      const nullifierMap = new Map<string, bigint>();

      // For each token, check the nullifier for the current balance entry's nonce
      let tokenIndex = 0;
      const tokenEntries = Array.from(tokenMap.entries());
      for (const [tokenKey, currentEntry] of tokenEntries) {
        // Check if modal was closed during iteration
        if (isModalClosedRef.current) {
          setIsLoadingNullifiers(false);
          return;
        }

        const nonceCommitment = await poseidon2Hash([userKeyHashBigInt, currentEntry.nonce]);
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

        // Check if modal was closed after contract call
        if (isModalClosedRef.current) {
          setIsLoadingNullifiers(false);
          return;
        }

        if (encryptedNullifier !== BigInt(0)) {
          const encryptionKey = await poseidon2Hash([viewKeyBigInt, currentEntry.nonce]);
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

          const nullifier = await poseidonCtrDecrypt(encryptedNullifier, encryptionKeyBigInt, 6);
          nullifierMap.set(tokenKey, nullifier);
        } else {
          nullifierMap.set(tokenKey, BigInt(0));
        }

        // Yield to browser every 3 entries to allow DOM updates
        tokenIndex++;
        if (tokenIndex % 3 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Final check before setting state
      if (isModalClosedRef.current) {
        setIsLoadingNullifiers(false);
        return;
      }

      setTokenNullifiers(nullifierMap);
    } catch (error) {
      console.error('Error fetching nullifiers:', error);
    } finally {
      setIsLoadingNullifiers(false);
    }
  }, [publicClient, account?.signature, balanceEntries]);

  // Check if modal was closed during async operations
  const checkIfClosed = useCallback(() => {
    return isModalClosedRef.current;
  }, []);

  // Fetch and decrypt notes from contract
  const fetchAndDecryptNotes = useCallback(async () => {
    if (!publicClient || !zkAddress || !account?.signature || isModalClosedRef.current) {
      return;
    }

    setIsLoadingNotes(true);

    // Check if modal was closed before starting
    if (isModalClosedRef.current) {
      setIsLoadingNotes(false);
      return;
    }
    try {
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

      let pubKeyBytes = zkAddress;
      if (pubKeyBytes.startsWith('zk')) {
        pubKeyBytes = pubKeyBytes.slice(2);
      }
      if (pubKeyBytes.startsWith('0x')) {
        pubKeyBytes = pubKeyBytes.slice(2);
      }
      const pubKeyBytesArray = `0x${pubKeyBytes}` as `0x${string}`;

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

      const userKeyBigInt = userKey;
      const decrypted: typeof decryptedNotes = [];
      for (let i = 0; i < encryptedNotes.length; i++) {
        // Check if modal was closed during iteration
        if (isModalClosedRef.current) {
          setIsLoadingNotes(false);
          return;
        }

        const note = encryptedNotes[i] as any;
        const senderPubKey = {
          x: BigInt(note.senderPublicKey.x.toString()),
          y: BigInt(note.senderPublicKey.y.toString())
        };

        const dhResult = await performDHKeyExchange(userKeyBigInt, senderPubKey);
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

        const encryptedAmount = BigInt(note.encryptedAmountForReceiver.toString());
        const encryptedTokenAddress = BigInt(note.encryptedTokenAddressForReceiver.toString());

        const amount = await poseidonCtrDecrypt(encryptedAmount, sharedKeyHashBigInt, 0);
        const tokenAddress = await poseidonCtrDecrypt(encryptedTokenAddress, sharedKeyHashBigInt, 1);

        // Check again before adding to array
        if (isModalClosedRef.current) {
          setIsLoadingNotes(false);
          return;
        }

        decrypted.push({
          index: i,
          amount,
          tokenAddress,
          sharedKeyHash: sharedKeyHashBigInt,
          senderPublicKey: senderPubKey
        });

        // Yield to browser every 5 notes to allow DOM updates
        if (i % 5 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Final check before setting state
      if (isModalClosedRef.current) {
        setIsLoadingNotes(false);
        return;
      }

      setDecryptedNotes(decrypted);
    } catch (error) {
      console.error('Error fetching/decrypting notes:', error);
    } finally {
      setIsLoadingNotes(false);
    }
  }, [publicClient, zkAddress, account?.signature]);

  // Fetch token info for all displayed tokens
  const fetchTokenInfoForDisplay = useCallback(async () => {
    if (!publicClient || isModalClosedRef.current) return;

    // Collect all unique token addresses from both notes and balances
    const tokenAddresses = new Set<string>();

    // Add tokens from decrypted notes
    decryptedNotes.forEach(note => {
      const tokenKey = '0x' + note.tokenAddress.toString(16);
      tokenAddresses.add(tokenKey.toLowerCase());
    });

    // Add tokens from balance entries
    balanceEntries.forEach(entry => {
      const tokenKey = '0x' + entry.tokenAddress.toString(16);
      tokenAddresses.add(tokenKey.toLowerCase());
    });

    if (tokenAddresses.size === 0) return;

    setIsLoadingTokenInfo(true);
    try {
      // Check if modal was closed before fetching
      if (isModalClosedRef.current) {
        setIsLoadingTokenInfo(false);
        return;
      }

      const infoMap = await fetchTokenInfoBatch(publicClient, Array.from(tokenAddresses));

      // Check if modal was closed after fetching
      if (isModalClosedRef.current) {
        setIsLoadingTokenInfo(false);
        return;
      }

      setTokenInfoMap(infoMap);
    } catch (error) {
      console.error('Error fetching token info:', error);
    } finally {
      setIsLoadingTokenInfo(false);
    }
  }, [publicClient, decryptedNotes, balanceEntries]);

  // Fetch token info when notes or balances change
  useEffect(() => {
    if (decryptedNotes.length > 0 || balanceEntries.length > 0) {
      fetchTokenInfoForDisplay();
    }
  }, [decryptedNotes, balanceEntries, fetchTokenInfoForDisplay]);

  // Auto-fetch notes when modal opens and data is available
  useEffect(() => {
    if (isOpen && zkAddress && account?.signature && publicClient) {
      fetchAndDecryptNotes();
    }
  }, [isOpen, zkAddress, account?.signature, publicClient, fetchAndDecryptNotes]);

  // Fetch nullifiers when balance entries change
  useEffect(() => {
    if (isOpen && balanceEntries.length > 0 && publicClient && account?.signature) {
      fetchNullifiers();
    }
  }, [isOpen, balanceEntries, publicClient, account?.signature, fetchNullifiers]);

  // Update context when balance entries change
  useEffect(() => {
    if (balanceEntries.length > 0) {
      setBalanceEntries(balanceEntries);
    }
  }, [balanceEntries, setBalanceEntries]);

  // Update context when current nonce changes
  useEffect(() => {
    if (currentNonce !== null) {
      setCurrentNonce(currentNonce);
    }
  }, [currentNonce, setCurrentNonce]);

  // Save to IndexedDB whenever balance entries or nonce changes (after initial load)
  useEffect(() => {
    const saveData = async () => {
      if (!zkAddress || !isOpen) return;

      // Only save if we have meaningful data (not just initial empty state)
      if (currentNonce !== null || balanceEntries.length > 0) {
        const now = Date.now();
        await saveAccountData({
          zkAddress,
          currentNonce,
          balanceEntries,
          userKey: contextUserKey,
          lastUpdated: now,
        });
        setDataLastSaved(now);
      }
    };

    // Debounce saves to avoid too frequent writes
    const timeoutId = setTimeout(saveData, 1000);
    return () => clearTimeout(timeoutId);
  }, [zkAddress, currentNonce, balanceEntries, isOpen, contextUserKey]);

  // Reconstruct and store personal commitment states - don't block rendering
  useEffect(() => {
    if (!isOpen) return; // Don't run if modal is closed

    // Use setTimeout to ensure modal renders first
    const timeoutId = setTimeout(() => {
      const reconstructStates = async () => {
        if (balanceEntries.length === 0 || !account?.signature || isModalClosedRef.current) {
          return;
        }

        try {
          // Check if modal was closed before starting
          if (isModalClosedRef.current) {
            return;
          }
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

          setUserKey(userKey);

          // Process entries with yield points to allow DOM updates
          for (let i = 0; i < balanceEntries.length; i++) {
            // Check if modal was closed
            if (isModalClosedRef.current) {
              return;
            }

            const entry = balanceEntries[i];
            const state = await reconstructPersonalCommitmentState(
              entry.amount,
              entry.tokenAddress,
              userKey
            );

            // Check again before setting state
            if (isModalClosedRef.current) {
              return;
            }

            setPersonalCommitmentState(entry.nonce, entry.tokenAddress, state);

            // Yield to browser every 5 entries to allow DOM updates
            if (i % 5 === 0 && i > 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
        } catch (error) {
          console.error('Error reconstructing personal commitment states:', error);
        }
      };

      if (isOpen) {
        reconstructStates();
      }
    }, 0); // Start after render completes

    return () => clearTimeout(timeoutId);
  }, [isOpen, balanceEntries, account?.signature, reconstructPersonalCommitmentState, setPersonalCommitmentState, setUserKey]);

  // Auto-compute when modal opens - but don't block rendering
  useEffect(() => {
    // Use setTimeout to ensure modal renders first, then start computation
    const timeoutId = setTimeout(() => {
      const autoCompute = async () => {
        if (!isOpen || !zkAddress || !account?.signature || isModalClosedRef.current) return;

        setIsLoadingSavedData(true);

        // Check if modal was closed before starting
        if (isModalClosedRef.current) {
          setIsLoadingSavedData(false);
          return;
        }
        try {
          // First, try to load saved data
          console.log(`🔍 Attempting to load cached data for zkAddress: ${zkAddress}`);
          const savedData = await loadAccountData(zkAddress);
          let cachedNonce: bigint | null = null;
          let cachedBalanceEntries: BalanceEntry[] = [];

          if (savedData) {
            console.log('✅ Loading saved account data from IndexedDB:', savedData);
            console.log(`  Saved zkAddress: ${savedData.zkAddress}`);
            console.log(`  Current zkAddress: ${zkAddress}`);
            console.log(`  Match: ${savedData.zkAddress === zkAddress}`);
            console.log(`  Cached currentNonce: ${savedData.currentNonce?.toString() || 'null'} (type: ${typeof savedData.currentNonce})`);
            console.log(`  Cached balanceEntries: ${savedData.balanceEntries?.length || 0} entries`);
            console.log(`  Last updated: ${savedData.lastUpdated ? new Date(savedData.lastUpdated).toISOString() : 'unknown'}`);

            cachedNonce = savedData.currentNonce;
            cachedBalanceEntries = savedData.balanceEntries || [];

            if (cachedNonce === null) {
              console.warn('⚠️ WARNING: Cached currentNonce is null! This should not happen if data was saved correctly.');
            }

            setCurrentNonce(savedData.currentNonce);
            setBalanceEntries(savedData.balanceEntries);
            if (savedData.userKey) {
              setUserKey(savedData.userKey);
            }
            setDataLastSaved(savedData.lastUpdated);
          } else {
            console.log('⚠️ No saved account data found in IndexedDB');
            console.log(`   Searched for zkAddress: ${zkAddress}`);
            console.log(`   This might mean:`);
            console.log(`   1. First time opening account modal`);
            console.log(`   2. IndexedDB was cleared`);
            console.log(`   3. zkAddress format mismatch`);
          }

          // Compute to get fresh data, starting from cached nonce if available
          console.log('Auto-computing nonce on modal open...');
          console.log(`📊 BEFORE calling computeCurrentNonce:`);
          console.log(`   cachedNonce: ${cachedNonce?.toString() || 'null'} (type: ${typeof cachedNonce})`);
          console.log(`   cachedBalanceEntries: ${cachedBalanceEntries.length} entries`);
          console.log(`   cachedNonce === null: ${cachedNonce === null}`);
          console.log(`   cachedNonce !== null: ${cachedNonce !== null}`);

          // Check if modal was closed before computing
          if (isModalClosedRef.current) {
            setIsLoadingSavedData(false);
            return;
          }

          // Yield to browser before heavy computation to allow DOM updates
          await new Promise(resolve => setTimeout(resolve, 0));

          if (isModalClosedRef.current) {
            setIsLoadingSavedData(false);
            return;
          }

          const result = await computeCurrentNonce(cachedNonce, cachedBalanceEntries);

          // Check if modal was closed after computing
          if (isModalClosedRef.current) {
            setIsLoadingSavedData(false);
            return;
          }

          if (result) {
            setCurrentNonce(result.currentNonce);
            setBalanceEntries(result.balanceEntries);
            if (result.userKey) {
              setUserKey(result.userKey);
            }

            // Save to IndexedDB
            const now = Date.now();
            const dataToSave = {
              zkAddress,
              currentNonce: result.currentNonce,
              balanceEntries: result.balanceEntries,
              userKey: result.userKey || null,
              lastUpdated: now,
            };
            console.log(`💾 Saving account data to IndexedDB:`);
            console.log(`   zkAddress: ${dataToSave.zkAddress}`);
            console.log(`   currentNonce: ${dataToSave.currentNonce?.toString() || 'null'}`);
            console.log(`   balanceEntries: ${dataToSave.balanceEntries.length} entries`);
            await saveAccountData(dataToSave);
            setDataLastSaved(now);
            console.log('✅ Saved account data to IndexedDB');
          }
        } catch (error) {
          console.error('Error auto-computing nonce:', error);
        } finally {
          setIsLoadingSavedData(false);
        }
      };

      if (isOpen && zkAddress && account?.signature) {
        autoCompute();
      }
    }, 0); // Start after render completes

    return () => clearTimeout(timeoutId);
  }, [isOpen, zkAddress, account?.signature, computeCurrentNonce, setCurrentNonce, setBalanceEntries, setUserKey]);


  // Use portal to render outside navbar
  // Render immediately when open - no delay
  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          isModalClosedRef.current = true;
          // Use setTimeout to allow DOM update even during heavy computations
          setTimeout(() => {
            flushSync(() => {
              onClose();
            });
          }, 0);
        }}
        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-2 sm:p-4">
        <div className="relative bg-black border border-[#333333] max-w-5xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto terminal-border">
          {/* Header */}
          <div className="sticky top-0 bg-black border-b border-[#333333] px-4 sm:px-6 py-4 flex justify-between items-center z-10 backdrop-blur-sm bg-black/95">
            <div className="flex items-center gap-3">
              <div className="w-1 h-6 bg-[rgba(182,255,62,1)]"></div>
              <h2 className="text-base sm:text-xl font-mono font-bold text-white uppercase">ACCOUNT</h2>
            </div>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Close immediately - use setTimeout to allow DOM update even during heavy computations
                isModalClosedRef.current = true;
                // Give browser a chance to update DOM before continuing
                setTimeout(() => {
                  flushSync(() => {
                    onClose();
                  });
                }, 0);
              }}
              className="text-[#888888] hover:text-[rgba(182,255,62,1)] font-mono text-lg sm:text-xl cursor-pointer transition-colors"
              style={{ pointerEvents: 'auto' }}
              type="button"
            >
              [X]
            </button>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-6 space-y-4">
            {!zkAddress && (
              <div className="p-4 border border-[#333333] bg-[#0a0a0a]">
                <p className="text-xs font-mono text-[#888888] uppercase">
                  PLEASE SIGN A MESSAGE FIRST TO ACCESS YOUR ACCOUNT.
                </p>
              </div>
            )}

            {zkAddress && (
              <>
                {/* Account Summary - Compact Header */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="bg-[#0a0a0a] border border-[#333333] p-4">
                    <p className="text-[10px] text-[#888888] font-mono uppercase mb-2 tracking-wider">ZK ADDRESS</p>
                    <p className="text-xs font-mono text-white break-all leading-relaxed">{zkAddress}</p>
                  </div>
                  <div className="bg-[#0a0a0a] border border-[#333333] p-4">
                    <p className="text-[10px] text-[#888888] font-mono uppercase mb-2 tracking-wider">NONCE</p>
                    {currentNonce !== null ? (
                      <p className="text-lg font-mono text-[rgba(182,255,62,1)] font-bold">{currentNonce.toString()}</p>
                    ) : (
                      <p className="text-lg font-mono text-[#888888]">-</p>
                    )}
                  </div>
                  <div className="bg-[#0a0a0a] border border-[#333333] p-4">
                    <p className="text-[10px] text-[#888888] font-mono uppercase mb-2 tracking-wider">LAST UPDATED</p>
                    {dataLastSaved ? (
                      <p className="text-xs font-mono text-white">
                        {new Date(dataLastSaved).toLocaleTimeString()}
                      </p>
                    ) : (
                      <p className="text-xs font-mono text-[#888888]">-</p>
                    )}
                  </div>
                </div>



                {/* Token Balances Section - Now on Top */}
                {(() => {
                  // Format number with 18 decimals, showing up to 4 decimal places
                  const formatNumber = (num: bigint, decimals: number = 18): string => {
                    if (num === BigInt(0)) return '0';

                    const divisor = BigInt(10 ** decimals);
                    const wholePart = num / divisor;
                    const fractionalPart = num % divisor;

                    // Calculate the actual decimal value (0.0 to 0.9999...)
                    const decimalValue = Number(fractionalPart) / Number(divisor);

                    // If whole part is 0 and decimal value is less than 0.0001, show as >0.0000
                    if (wholePart === BigInt(0) && decimalValue < 0.0001) {
                      return '>0.0000';
                    }

                    // Format to 4 decimal places max
                    const totalValue = Number(wholePart) + decimalValue;
                    const formatted = totalValue.toLocaleString('en-US', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 4,
                    });

                    return formatted;
                  };

                  // Group notes by token
                  const notesByToken = new Map<string, typeof decryptedNotes>();
                  for (const note of decryptedNotes) {
                    const tokenKey = '0x' + note.tokenAddress.toString(16);
                    if (!notesByToken.has(tokenKey)) {
                      notesByToken.set(tokenKey, []);
                    }
                    notesByToken.get(tokenKey)!.push(note);
                  }

                  // Get balance map
                  const balanceTokenMap = new Map<string, typeof balanceEntries[0]>();
                  for (const entry of balanceEntries) {
                    const tokenKey = entry.tokenAddress.toString(16);
                    const existing = balanceTokenMap.get(tokenKey);
                    if (!existing || entry.nonce > existing.nonce) {
                      balanceTokenMap.set(tokenKey, entry);
                    }
                  }

                  // Combine all tokens (from balances and notes)
                  const allTokenKeys = new Set<string>();
                  balanceTokenMap.forEach((_, tokenKey) => allTokenKeys.add('0x' + tokenKey));
                  notesByToken.forEach((_, tokenKey) => allTokenKeys.add(tokenKey));

                  const allTokens = Array.from(allTokenKeys).map(tokenKey => {
                    const tokenKeyNoPrefix = tokenKey.startsWith('0x') ? tokenKey.slice(2) : tokenKey;
                    const balanceEntry = balanceTokenMap.get(tokenKeyNoPrefix);
                    const activeBalance = balanceEntry ? balanceEntry.amount : BigInt(0);
                    const notes = notesByToken.get(tokenKey) || [];
                    const incomingAmount = notes.reduce((sum, note) => sum + note.amount, BigInt(0));
                    const tokenKeyNoPrefixForNullifier = tokenKeyNoPrefix;
                    const nullifier = tokenNullifiers.get(tokenKeyNoPrefixForNullifier) || BigInt(0);
                    const available = incomingAmount > nullifier ? incomingAmount - nullifier : BigInt(0);
                    const totalBalance = activeBalance + available;

                    return {
                      tokenKey,
                      tokenKeyNoPrefix,
                      tokenAddress: balanceEntry ? balanceEntry.tokenAddress : BigInt('0x' + tokenKeyNoPrefix),
                      activeBalance,
                      incomingAmount,
                      available,
                      totalBalance,
                      notes,
                      hasNotes: notes.length > 0 && available > BigInt(0),
                    };
                  });

                  if (allTokens.length === 0) {
                    return null;
                  }

                  return (
                    <div className="border border-[#333333] bg-[#0a0a0a] mb-4">
                      <div className="px-4 py-3 border-b border-[#333333] bg-black/50">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-4 bg-[rgba(182,255,62,1)]"></div>
                          <p className="text-sm font-mono font-bold text-white uppercase tracking-wider">TOKEN BALANCES</p>
                        </div>
                        {(isLoadingNullifiers || isLoadingTokenInfo) && (
                          <p className="text-[10px] font-mono text-[#888888] uppercase mt-2 tracking-wider">
                            {isLoadingNullifiers ? 'LOADING...' : 'FETCHING...'}
                          </p>
                        )}
                      </div>
                      <div className="divide-y divide-[#333333]">
                        {allTokens.map((token, index) => {
                          const tokenAddress = token.tokenKey;
                          const tokenInfo = tokenInfoMap.get(tokenAddress.toLowerCase());
                          const displayName = tokenInfo?.name || '$NoName';
                          const displaySymbol = tokenInfo?.symbol || '$NoName';
                          const isExpanded = expandedNotes.has(token.tokenKey);

                          return (
                            <div key={index} className="px-4 py-4 hover:bg-[#111111] transition-colors border-l-2 border-transparent hover:border-[rgba(182,255,62,0.3)]">
                              <div className="flex items-center gap-4">
                                {/* Token Icon Placeholder */}
                                <div className="w-12 h-12 rounded-full bg-[#1a1a1a] border-2 border-[#333333] flex items-center justify-center flex-shrink-0 hover:border-[rgba(182,255,62,0.5)] transition-colors">
                                  <span className="text-sm font-mono text-[rgba(182,255,62,1)] font-bold">
                                    {displaySymbol.slice(0, 2).toUpperCase()}
                                  </span>
                                </div>

                                {/* Token Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <p className="text-sm font-mono font-semibold text-white">
                                      {displayName}
                                    </p>
                                    <p className="text-xs font-mono text-[#888888] px-2 py-0.5 bg-[#1a1a1a] rounded">
                                      {displaySymbol}
                                    </p>
                                  </div>
                                  <p className="text-[10px] font-mono text-[#666666] truncate mb-2">
                                    {tokenAddress.slice(0, 6)}...{tokenAddress.slice(-4)}
                                  </p>
                                  {/* Total Balance */}
                                  <div className="mb-1">
                                    <p className="text-lg font-mono font-bold text-[rgba(182,255,62,1)]">
                                      $ {formatNumber(token.totalBalance)}
                                    </p>
                                    <p className="text-[10px] font-mono text-[#888888] mt-0.5">
                                      (active balance $ {formatNumber(token.activeBalance)})
                                    </p>
                                  </div>
                                </div>

                                {/* Actions */}
                                <div className="text-right flex-shrink-0 flex flex-col gap-2">
                                  {token.hasNotes && (
                                    <Button
                                      onClick={() => {
                                        router.push(`/absorb?token=${token.tokenKey}`);
                                        onClose();
                                      }}
                                      className="text-[10px] h-7 px-3 bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors"
                                    >
                                      ABSORB
                                    </Button>
                                  )}
                                  {token.notes.length > 0 && (
                                    <button
                                      onClick={() => {
                                        const newExpanded = new Set(expandedNotes);
                                        if (isExpanded) {
                                          newExpanded.delete(token.tokenKey);
                                        } else {
                                          newExpanded.add(token.tokenKey);
                                        }
                                        setExpandedNotes(newExpanded);
                                      }}
                                      className="text-[10px] font-mono text-[#888888] hover:text-[rgba(182,255,62,1)] transition-colors uppercase tracking-wider"
                                    >
                                      {isExpanded ? 'HIDE' : 'SHOW'} NOTES ({token.notes.length})
                                    </button>
                                  )}
                                </div>
                              </div>
                              {/* Expandable Notes List */}
                              {isExpanded && token.notes.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-[#333333]">
                                  <div className="space-y-2">
                                    {token.notes.map((note, noteIndex) => (
                                      <div key={noteIndex} className="px-3 py-2 bg-[#1a1a1a] rounded border border-[#333333]">
                                        <div className="flex justify-between items-center">
                                          <div>
                                            <p className="text-xs font-mono text-white">
                                              Note #{note.index}
                                            </p>
                                            <p className="text-[10px] font-mono text-[#888888]">
                                              Amount: $ {formatNumber(note.amount)}
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Incoming Notes Section - Now on Bottom */}
                <div className="border border-[#333333] bg-[#0a0a0a]">
                  <div className="px-4 py-3 border-b border-[#333333] flex justify-between items-center bg-black/50">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-4 bg-[rgba(182,255,62,1)]"></div>
                      <p className="text-sm font-mono font-bold text-white uppercase tracking-wider">INCOMING NOTES</p>
                    </div>
                    <Button
                      onClick={fetchAndDecryptNotes}
                      disabled={isLoadingNotes || isLoadingTokenInfo}
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-7 px-3 border-[#333333] hover:border-[rgba(182,255,62,1)] hover:text-[rgba(182,255,62,1)] transition-colors"
                    >
                      {isLoadingNotes || isLoadingTokenInfo ? '[...]' : 'REFRESH'}
                    </Button>
                  </div>
                  <div className="p-4">
                    {isLoadingNotes && (
                      <div className="py-8 text-center">
                        <p className="text-xs font-mono text-[#888888] uppercase tracking-wider">LOADING...</p>
                      </div>
                    )}
                    {!isLoadingNotes && decryptedNotes.length === 0 && (
                      <div className="py-8 text-center">
                        <p className="text-xs font-mono text-[#888888] uppercase tracking-wider">NO NOTES FOUND</p>
                      </div>
                    )}
                    {!isLoadingNotes && decryptedNotes.length > 0 && (() => {
                      // Format number function
                      const formatNumber = (num: bigint, decimals: number = 18): string => {
                        if (num === BigInt(0)) return '0';

                        const divisor = BigInt(10 ** decimals);
                        const wholePart = num / divisor;
                        const fractionalPart = num % divisor;

                        const decimalValue = Number(fractionalPart) / Number(divisor);

                        if (wholePart === BigInt(0) && decimalValue < 0.0001) {
                          return '>0.0000';
                        }

                        const totalValue = Number(wholePart) + decimalValue;
                        const formatted = totalValue.toLocaleString('en-US', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 4,
                        });

                        return formatted;
                      };

                      const notesByToken = new Map<string, typeof decryptedNotes>();
                      for (const note of decryptedNotes) {
                        const tokenKey = '0x' + note.tokenAddress.toString(16);
                        if (!notesByToken.has(tokenKey)) {
                          notesByToken.set(tokenKey, []);
                        }
                        notesByToken.get(tokenKey)!.push(note);
                      }

                      return (
                        <div className="space-y-3">
                          {Array.from(notesByToken.entries()).map(([tokenKey, notes]) => {
                            const tokenInfo = tokenInfoMap.get(tokenKey.toLowerCase());
                            const displayName = tokenInfo?.name || '$NoName';
                            const displaySymbol = tokenInfo?.symbol || '$NoName';
                            const tokenKeyNoPrefix = tokenKey.startsWith('0x') ? tokenKey.slice(2) : tokenKey;
                            const nullifier = tokenNullifiers.get(tokenKeyNoPrefix) || BigInt(0);
                            const totalAmount = notes.reduce((sum, note) => sum + note.amount, BigInt(0));
                            const available = totalAmount > nullifier ? totalAmount - nullifier : BigInt(0);
                            const isExpanded = expandedNotes.has(tokenKey);

                            return (
                              <div key={tokenKey} className="border border-[#333333] bg-[#1a1a1a] rounded">
                                <div
                                  className="px-4 py-3 cursor-pointer hover:bg-[#222222] transition-colors"
                                  onClick={() => {
                                    const newExpanded = new Set(expandedNotes);
                                    if (isExpanded) {
                                      newExpanded.delete(tokenKey);
                                    } else {
                                      newExpanded.add(tokenKey);
                                    }
                                    setExpandedNotes(newExpanded);
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-full bg-[#0a0a0a] border border-[#333333] flex items-center justify-center">
                                        <span className="text-xs font-mono text-[rgba(182,255,62,1)] font-bold">
                                          {displaySymbol.slice(0, 2).toUpperCase()}
                                        </span>
                                      </div>
                                      <div>
                                        <p className="text-sm font-mono font-semibold text-white">
                                          {displayName} ({displaySymbol})
                                        </p>
                                        <p className="text-[10px] font-mono text-[#888888]">
                                          {notes.length} note{notes.length !== 1 ? 's' : ''} • Available: $ {formatNumber(available)}
                                        </p>
                                      </div>
                                    </div>
                                    <p className="text-xs font-mono text-[#888888]">
                                      {isExpanded ? '▼' : '▶'}
                                    </p>
                                  </div>
                                </div>
                                {isExpanded && (
                                  <div className="px-4 pb-3 space-y-2">
                                    {notes.map((note, noteIndex) => (
                                      <div key={noteIndex} className="px-3 py-2 bg-[#0a0a0a] rounded border border-[#333333]">
                                        <p className="text-xs font-mono text-white mb-1">
                                          Note #{note.index}
                                        </p>
                                        <p className="text-[10px] font-mono text-[#888888]">
                                          Amount: $ {formatNumber(note.amount)}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Render modal using portal to document body
  return createPortal(modalContent, document.body);
}
