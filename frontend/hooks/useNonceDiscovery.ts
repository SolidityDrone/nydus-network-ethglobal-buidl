'use client';

import { useState, useCallback } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { NydusAddress, NydusAbi } from '@/lib/abi/NydusConst';
import { pedersenCommitmentNonHiding, grumpkinPointEqual, grumpkinSubtract, grumpkinAddPoints, aggregateOpeningValue, GrumpkinPoint } from '@/lib/pedersen-commitments';
import { useZkAddress, useAccount as useAccountContext } from '@/context/AccountProvider';
import { poseidonCtrDecrypt } from '@/lib/poseidon-ctr-encryption';

export interface BalanceEntry {
  tokenAddress: bigint;
  amount: bigint;
  nonce: bigint;
}

export interface PersonalCommitmentState {
  personal_c_tot: [bigint, bigint];
  personal_c_inner: [bigint, bigint];
  personal_c_outer: [bigint, bigint];
  personal_c_inner_m: bigint;
  personal_c_outer_m: bigint;
  personal_c_outer_r: bigint;
}

/**
 * Hook to compute current nonce from nonce discovery point
 * 
 * Algorithm:
 * 1. Read nonceDiscoveryPoint (C_tot) and aggregated m, r from contract
 * 2. For each potential nonce (starting from 0):
 *    - Compute user_key_hash = Poseidon2([user_key], 1)
 *    - Compute nonceCommitment = Poseidon2([user_key_hash, nonce], 2)
 *      NOTE: All circuits (entry, deposit, absorb, send, withdraw) use user_key_hash consistently
 *    - Compute inner = pedersen_commitment_non_hiding(1, nonceCommitment)
 *    - Compute remaining = C_tot - inner
 *    - Compute expected_remaining_m = aggregate(tot_m - 1)
 *    - Compute expected_remaining_r = aggregate(tot_r - nonceCommitment)
 *    - Check if remaining can be opened with (expected_remaining_m, expected_remaining_r)
 * 3. The first nonce that doesn't match is the current nonce
 */
export function useNonceDiscovery() {
  const [isComputing, setIsComputing] = useState(false);
  const [currentNonce, setCurrentNonce] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonceDiscoveryPoint, setNonceDiscoveryPoint] = useState<GrumpkinPoint | null>(null);
  const [aggregatedM, setAggregatedM] = useState<bigint | null>(null);
  const [aggregatedR, setAggregatedR] = useState<bigint | null>(null);
  const [balanceEntries, setBalanceEntries] = useState<BalanceEntry[]>([]);
  const [isDecrypting, setIsDecrypting] = useState(false);
  
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const zkAddress = useZkAddress(); // Returns string | null, not an object
  const { account } = useAccountContext();
  
  /**
   * Compute private key (user_key) from signature
   */
  const computePrivateKeyFromSignature = useCallback(async (signature: string): Promise<bigint> => {
    // Import ensureBufferPolyfill from zk-address
    const { ensureBufferPolyfill } = await import('@/lib/zk-address');
    
    // Ensure Buffer is available with polyfill
    await ensureBufferPolyfill();
    
    if (typeof window === 'undefined' || !globalThis.Buffer) {
      throw new Error('Buffer is not available after polyfill');
    }
    
    // Double-check Buffer has the required method
    if (typeof globalThis.Buffer.prototype.writeBigUInt64BE !== 'function') {
      throw new Error('Buffer.writeBigUInt64BE is not available even after polyfill');
    }
    
    const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
    const sigBuffer = globalThis.Buffer.from(sigHex, 'hex');
    
    if (sigBuffer.length !== 65) {
      throw new Error(`Signature must be 65 bytes, got ${sigBuffer.length}`);
    }
    
    // Split signature into 31, 31, 3 bytes
    const chunk1 = sigBuffer.slice(0, 31);
    const chunk2 = sigBuffer.slice(31, 62);
    const chunk3 = sigBuffer.slice(62, 65);
    
    // Convert to bigint
    const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
    const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
    const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));
    
    // Dynamic import of poseidon2Hash after Buffer is ready
    const { poseidon2Hash } = await import('@aztec/foundation/crypto');
    
    // Compute Poseidon2 hash
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
    
    return privateKey;
  }, []);
  
  /**
   * Read nonce discovery point and aggregated m, r from contract
   */
  const readNonceDiscoveryFromContract = useCallback(async () => {
    if (!publicClient || !address) {
      throw new Error('Public client or address not available');
    }
    
    // Read all nonce discovery info in one call
    const [x, y, m, r] = await publicClient.readContract({
      address: NydusAddress,
      abi: NydusAbi,
      functionName: 'getNonceDiscoveryInfo',
    }) as [bigint, bigint, bigint, bigint];
    
    return {
      point: { x, y } as GrumpkinPoint,
      aggregatedM: m,
      aggregatedR: r,
    };
  }, [publicClient, address]);
  
  /**
   * Decrypt balances starting from highest nonce down to 0
   * For nonce 0, uses plaintext values from contract
   * For other nonces, decrypts using Poseidon CTR decryption
   */
  const decryptBalances = useCallback(async (highestNonce: bigint, userKey: bigint, lowestNonce: bigint = BigInt(0)) => {
    if (!publicClient || !account?.signature) {
      return;
    }
    
    setIsDecrypting(true);
    setError(null);
    
    try {
      // Ensure Buffer polyfill is available
      const { ensureBufferPolyfill } = await import('@/lib/zk-address');
      await ensureBufferPolyfill();
      
      // Dynamic import of poseidon2Hash
      const { poseidon2Hash } = await import('@aztec/foundation/crypto');
      
      // Constants from circuit
      const VIEW_STRING = BigInt('0x76696577696e675f6b6579');
      
      // Compute user_key_hash = Poseidon2::hash([user_key], 1)
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
      
      // Compute view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2)
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
      
      const entries: BalanceEntry[] = [];
      
      // Decrypt from highest nonce down to lowestNonce (only decrypt new nonces)
      for (let nonce = highestNonce; nonce >= lowestNonce; nonce--) {
        // Compute nonceCommitment:
        // All nonces (including nonce 0) use: Poseidon2::hash([user_key_hash, nonce], 2)
        // This matches the standardized behavior across all circuits (entry, deposit, absorb, send, withdraw)
        const nonceCommitment = await poseidon2Hash([userKeyHashBigInt, nonce]);
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
        
        // Get balance reference from contract
        const [encryptedBalance, encryptedTokenAddress] = await publicClient.readContract({
          address: NydusAddress,
          abi: NydusAbi,
          functionName: 'getBalanceReference',
          args: [nonceCommitmentBigInt],
        }) as [bigint, bigint];
        
        let amount: bigint;
        let tokenAddress: bigint;
        
        if (nonce === BigInt(0)) {
          // For nonce 0, values are plaintext (from initCommit)
          amount = encryptedBalance;
          tokenAddress = encryptedTokenAddress;
        } else {
          // For other nonces, decrypt using Poseidon CTR
          // encryption_key = Poseidon2::hash([view_key, nonce], 2)
          const encryptionKey = await poseidon2Hash([viewKeyBigInt, nonce]);
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
          
          // Decrypt: new_balance = poseidon_ctr_decrypt(encrypted_amount, encryption_key, 0)
          //          token_address = poseidon_ctr_decrypt(encrypted_token_address, encryption_key, 1)
          amount = await poseidonCtrDecrypt(encryptedBalance, encryptionKeyBigInt, 0);
          tokenAddress = await poseidonCtrDecrypt(encryptedTokenAddress, encryptionKeyBigInt, 1);
        }
        
        entries.push({ tokenAddress, amount, nonce });
      }
      
      setBalanceEntries(entries);
      return entries;
    } catch (error) {
      console.error('Error decrypting balances:', error);
      setError(error instanceof Error ? error.message : 'Failed to decrypt balances');
      return [];
    } finally {
      setIsDecrypting(false);
    }
  }, [publicClient, account?.signature]);
  
  /**
   * Compute current nonce
   * @param cachedNonce Optional cached nonce to start from (for incremental computation)
   * @param cachedBalanceEntries Optional cached balance entries to merge with new ones
   */
  const computeCurrentNonce = useCallback(async (cachedNonce: bigint | null = null, cachedBalanceEntries: BalanceEntry[] = []) => {
    // Log immediately to verify parameters are received
    console.log(`🔵 computeCurrentNonce called with: cachedNonce=${cachedNonce?.toString() || 'null'}, cachedEntries=${cachedBalanceEntries.length}`);
    
    setIsComputing(true);
    setError(null);
    
    try {
      // Ensure Buffer polyfill is loaded BEFORE any Aztec imports
      const { ensureBufferPolyfill } = await import('@/lib/zk-address');
      await ensureBufferPolyfill();
      
      // Check prerequisites
      if (!publicClient) {
        throw new Error('Public client not available.');
      }
      
      if (!account?.signature) {
        throw new Error('No signature available. Please sign the message first.');
      }
      
      if (!zkAddress) {
        throw new Error('zkAddress not available. Please sign the message first.');
      }
      
      // Read from contract
      const { point, aggregatedM: totM, aggregatedR: totR } = await readNonceDiscoveryFromContract();
      setNonceDiscoveryPoint(point);
      setAggregatedM(totM);
      setAggregatedR(totR);
      
      // Compute private key from signature
      const userKey = await computePrivateKeyFromSignature(account.signature);
      
      console.log('Computing current nonce...');
      console.log('Nonce discovery point (C_tot):', point);
      console.log('Aggregated M:', totM.toString());
      console.log('Aggregated R:', totR.toString());
      console.log('User key:', userKey.toString(16));
      console.log(`📦 Cache status: cachedNonce=${cachedNonce?.toString() || 'null'}, cachedEntries=${cachedBalanceEntries.length}`);
      
      // Get the initial nonce discovery point (from constructor)
      const initialNonceDiscoveryPoint: GrumpkinPoint = {
        x: BigInt('0x098b60b4fb636ed774329d8bb20eb1f9bd2f1b53445e991de219b50739e95c16'),
        y: BigInt('0x1b82bb29393d7897d102bc412ca1b3353e78ecc738baf483fed847ef9e212997')
      };
      
      // Import poseidon2Hash dynamically after Buffer polyfill is ensured
      const { poseidon2Hash } = await import('@aztec/foundation/crypto');
      
      // Compute user_key_hash (needed for nonce > 0)
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
      
      // If we have cached data, try to quickly verify if it's still valid
      // If cached nonce is still the current nonce, we can skip most of the computation
      let startNonce = BigInt(0);
      let ourLocalPoint: GrumpkinPoint;
      let ourLocalM: bigint;
      let ourLocalR: bigint;
      let skipToCachedNonce = false;
      
      if (cachedNonce !== null && cachedNonce !== undefined) {
        console.log(`📦 Found cached nonce: ${cachedNonce.toString()} (type: ${typeof cachedNonce})`);
        console.log(`   cachedNonce value: ${cachedNonce}`);
        console.log(`   cachedNonce > 0: ${cachedNonce > BigInt(0)}`);
        
        // Quick check: verify if cached nonce is still valid by checking if it's NOT in the contract
        // If it's not in the contract, it's still the current nonce - we can skip checking all previous nonces
        const cachedNonceCommitment = await poseidon2Hash([userKeyHashBigInt, cachedNonce]);
        let cachedNonceCommitmentBigInt: bigint;
        if (typeof cachedNonceCommitment === 'bigint') {
          cachedNonceCommitmentBigInt = cachedNonceCommitment;
        } else if ('toBigInt' in cachedNonceCommitment && typeof (cachedNonceCommitment as any).toBigInt === 'function') {
          cachedNonceCommitmentBigInt = (cachedNonceCommitment as any).toBigInt();
        } else if ('value' in cachedNonceCommitment) {
          cachedNonceCommitmentBigInt = BigInt((cachedNonceCommitment as any).value);
        } else {
          cachedNonceCommitmentBigInt = BigInt((cachedNonceCommitment as any).toString());
        }
        
        const isCachedNonceKnown = await publicClient.readContract({
          address: NydusAddress,
          abi: NydusAbi,
          functionName: 'knownNonceCommitments',
          args: [cachedNonceCommitmentBigInt],
        }) as boolean;
        
        if (!isCachedNonceKnown) {
          // Cached nonce is still the current nonce! No new transactions since last check
          console.log(`✅ Cached nonce ${cachedNonce.toString()} is still valid (not in contract) - skipping computation!`);
          setCurrentNonce(cachedNonce);
          setBalanceEntries(cachedBalanceEntries);
          return {
            currentNonce: cachedNonce,
            balanceEntries: cachedBalanceEntries,
            userKey: userKey,
          };
        } else {
          // Cached nonce has been used - there are new transactions
          console.log(`⚠️ Cached nonce ${cachedNonce.toString()} has been used - new transactions detected, computing from cache...`);
          startNonce = cachedNonce;
          skipToCachedNonce = true;
        }
      }
      
      // Rebuild local state if we're using cached data
      if (skipToCachedNonce && cachedNonce !== null) {
        console.log(`🔨 Rebuilding local state up to nonce ${(cachedNonce - BigInt(1)).toString()} (last used nonce)`);
        ourLocalPoint = initialNonceDiscoveryPoint;
        ourLocalM = BigInt(1);
        ourLocalR = BigInt(1);
        
        const lastUsedNonce = cachedNonce > BigInt(0) ? cachedNonce - BigInt(1) : BigInt(0);
        if (lastUsedNonce >= BigInt(0)) {
          for (let n = BigInt(0); n <= lastUsedNonce; n++) {
            const nonceCommitment = await poseidon2Hash([userKeyHashBigInt, n]);
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
            
            const inner = pedersenCommitmentNonHiding(BigInt(1), nonceCommitmentBigInt);
            ourLocalPoint = grumpkinAddPoints(ourLocalPoint, inner);
            ourLocalM = aggregateOpeningValue(ourLocalM, BigInt(1));
            ourLocalR = aggregateOpeningValue(ourLocalR, nonceCommitmentBigInt);
          }
          console.log(`✅ Rebuilt local state up to nonce ${lastUsedNonce.toString()}`);
        }
      } else {
        // Start from beginning
        ourLocalPoint = initialNonceDiscoveryPoint;
        ourLocalM = BigInt(1);
        ourLocalR = BigInt(1);
      }
      
      console.log('Starting nonce discovery computation (using nonce discovery point and aggregated M/R)...');
      console.log('Initial point:', initialNonceDiscoveryPoint);
      console.log('Contract point (global):', point);
      console.log('Contract M:', totM.toString());
      console.log('Contract R:', totR.toString(16));
      console.log(`🚀 Starting from nonce ${startNonce.toString()}${cachedNonce !== null ? ` (cached)` : ' (no cache)'}`);
      if (cachedNonce !== null) {
        console.log(`   Cached nonce: ${cachedNonce.toString()}, Cached entries: ${cachedBalanceEntries.length}`);
      }
      
        // Algorithm: Use nonce discovery point and aggregated M/R to verify nonces
        // For each nonce starting from cached nonce (or 0):
        //   1. Compute our nonceCommitment = Poseidon2(user_key_hash, nonce)
        //   2. Check if this nonce commitment is in the global commitment stack
        //   3. If not, this is the current nonce - STOP
        //   4. If yes, continue to next nonce
        
        let nonce = startNonce;
        const maxNonce = BigInt(100); // Safety limit
        
        while (nonce < maxNonce) {
          // Compute nonceCommitment:
          // All nonces (including nonce 0) use: Poseidon2::hash([user_key_hash, nonce], 2)
          // This matches the standardized behavior across all circuits (entry, deposit, absorb, send, withdraw)
          const nonceCommitment = await poseidon2Hash([userKeyHashBigInt, nonce]);
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
          
          console.log(`\nNonce ${nonce.toString()}:`);
          console.log(`  NonceCommitment: ${nonceCommitmentBigInt.toString(16)}`);
          
          // Check if this nonce commitment is in the global commitment stack
          // by reading from the knownNonceCommitments mapping
          const isKnown = await publicClient.readContract({
            address: NydusAddress,
            abi: NydusAbi,
            functionName: 'knownNonceCommitments',
            args: [nonceCommitmentBigInt],
          }) as boolean;
          
          console.log(`  Is known in contract: ${isKnown}`);
          
          if (!isKnown) {
            // This nonce commitment is NOT in the global commitment stack
            // This means this nonce has NOT been used - this is the current nonce!
            console.log(`  ❌ Nonce ${nonce.toString()} has NOT been used (not in global commitment stack)`);
            console.log(`  Current nonce is: ${nonce.toString()}`);
            setCurrentNonce(nonce);
            break;
          }
          
          // This nonce commitment IS in the global commitment stack
          // This means this nonce HAS been used - continue to next nonce
          console.log(`  ✅ Nonce ${nonce.toString()} HAS been used (in global commitment stack) - continuing...`);
          
          // Compute inner = pedersen_commitment_non_hiding(1, nonceCommitment)
          const inner = pedersenCommitmentNonHiding(BigInt(1), nonceCommitmentBigInt);
          
          // Add this nonce's contribution to our local point
          const newOurLocalPoint = grumpkinAddPoints(ourLocalPoint, inner);
          
          // Aggregate our local M and R (m=1, r=nonceCommitment for each nonce)
          // Using BN254 scalar field addition (not hash)
          const newOurLocalM = aggregateOpeningValue(ourLocalM, BigInt(1));
          const newOurLocalR = aggregateOpeningValue(ourLocalR, nonceCommitmentBigInt);
          
          // Update our local state for next iteration
          ourLocalPoint = newOurLocalPoint;
          ourLocalM = newOurLocalM;
          ourLocalR = newOurLocalR;
          nonce++;
        }
      
      if (nonce >= maxNonce) {
        throw new Error(`Could not find current nonce after checking ${maxNonce.toString()} nonces`);
      }
      
      setCurrentNonce(nonce);
      
      // Automatically decrypt balances after discovering current nonce
      // If currentNonce is 0, no nonces have been used, so skip decryption
      // Otherwise, decrypt from highest used nonce (currentNonce - 1) down to (startNonce - 1)
      // (only decrypt new nonces, not cached ones)
      // Note: startNonce is the cached current nonce (unused), so (startNonce - 1) is the last cached used nonce
      let finalBalanceEntries: BalanceEntry[] = cachedBalanceEntries;
      
      if (nonce > BigInt(0)) {
        const highestNonceToDecrypt = nonce - BigInt(1); // Last used nonce
        const lastCachedUsedNonce = startNonce > BigInt(0) ? startNonce - BigInt(1) : BigInt(-1); // Last nonce that was cached (or -1 if no cache)
        const lowestNonceToDecrypt = lastCachedUsedNonce + BigInt(1); // First new nonce to decrypt
        
        if (highestNonceToDecrypt >= lowestNonceToDecrypt && lowestNonceToDecrypt >= BigInt(0)) {
          console.log(`🔓 Decrypting NEW balances from nonce ${lowestNonceToDecrypt.toString()} to ${highestNonceToDecrypt.toString()}`);
          console.log(`   (Cached nonces 0-${lastCachedUsedNonce.toString()} will be reused)`);
          const newEntries = await decryptBalances(highestNonceToDecrypt, userKey, lowestNonceToDecrypt);
          
          // Merge cached entries with newly decrypted entries
          // Handle case where decryptBalances might return undefined
          const entriesToMerge = newEntries || [];
          finalBalanceEntries = [...cachedBalanceEntries.filter(e => e.nonce < lowestNonceToDecrypt), ...entriesToMerge];
          setBalanceEntries(finalBalanceEntries);
          console.log(`✅ Merged ${cachedBalanceEntries.filter(e => e.nonce < lowestNonceToDecrypt).length} cached entries with ${entriesToMerge.length} new entries`);
        } else {
          // No new nonces to decrypt, use cached entries
          console.log(`✅ No new nonces to decrypt (current: ${nonce.toString()}, cached: ${startNonce.toString()}), using cached entries`);
          setBalanceEntries(cachedBalanceEntries);
        }
      } else {
        // No nonces used, use cached entries if available
        setBalanceEntries(cachedBalanceEntries);
      }
      
      return {
        currentNonce: nonce,
        balanceEntries: finalBalanceEntries,
        userKey: userKey,
      };
      
    } catch (err) {
      console.error('Error computing current nonce:', err);
      setError(err instanceof Error ? err.message : 'Failed to compute current nonce');
    } finally {
      setIsComputing(false);
    }
  }, [account?.signature, zkAddress, readNonceDiscoveryFromContract, computePrivateKeyFromSignature, decryptBalances]);
  
  /**
   * Reconstruct personal commitment state from decrypted balance and token address
   * This is needed to prepare inputs for the deposit circuit
   * Matches the logic in circuits/main/nydus-deposit/src/test/tests.nr create_personal_commitments
   */
  const reconstructPersonalCommitmentState = useCallback(async (
    balance: bigint,
    tokenAddress: bigint,
    userKey: bigint
  ): Promise<PersonalCommitmentState> => {
    // Ensure Buffer polyfill is available
    const { ensureBufferPolyfill } = await import('@/lib/zk-address');
    await ensureBufferPolyfill();
    
    // Dynamic import of poseidon2Hash
    const { poseidon2Hash } = await import('@aztec/foundation/crypto');
    
    // Compute user_key_hash = Poseidon2::hash([user_key], 1)
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
    
    // Compute hashes for personal_c_inner
    // personal_c_inner_m_hash = Poseidon2::hash([balance, user_key_hash], 2)
    const personalCInnerMHash = await poseidon2Hash([balance, userKeyHashBigInt]);
    let personalCInnerMHashBigInt: bigint;
    if (typeof personalCInnerMHash === 'bigint') {
      personalCInnerMHashBigInt = personalCInnerMHash;
    } else if ('toBigInt' in personalCInnerMHash && typeof (personalCInnerMHash as any).toBigInt === 'function') {
      personalCInnerMHashBigInt = (personalCInnerMHash as any).toBigInt();
    } else if ('value' in personalCInnerMHash) {
      personalCInnerMHashBigInt = BigInt((personalCInnerMHash as any).value);
    } else {
      personalCInnerMHashBigInt = BigInt((personalCInnerMHash as any).toString());
    }
    
    // personal_c_inner_token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2)
    const personalCInnerTokenAddressHash = await poseidon2Hash([tokenAddress, userKeyHashBigInt]);
    let personalCInnerTokenAddressHashBigInt: bigint;
    if (typeof personalCInnerTokenAddressHash === 'bigint') {
      personalCInnerTokenAddressHashBigInt = personalCInnerTokenAddressHash;
    } else if ('toBigInt' in personalCInnerTokenAddressHash && typeof (personalCInnerTokenAddressHash as any).toBigInt === 'function') {
      personalCInnerTokenAddressHashBigInt = (personalCInnerTokenAddressHash as any).toBigInt();
    } else if ('value' in personalCInnerTokenAddressHash) {
      personalCInnerTokenAddressHashBigInt = BigInt((personalCInnerTokenAddressHash as any).value);
    } else {
      personalCInnerTokenAddressHashBigInt = BigInt((personalCInnerTokenAddressHash as any).toString());
    }
    
    // Construct personal_c_inner = pedersen_commitment_non_hiding(personal_c_inner_m_hash, personal_c_inner_token_address_hash)
    const personalCInner = pedersenCommitmentNonHiding(personalCInnerMHashBigInt, personalCInnerTokenAddressHashBigInt);
    
    // Construct personal_c_outer = pedersen_commitment_non_hiding(0, token_address)
    // For first deposit after entry, outer is usually (0, token_address)
    const personalCOuter = pedersenCommitmentNonHiding(BigInt(0), tokenAddress);
    
    // Construct initializer = pedersen_commitment_non_hiding(token_address, user_key_hash)
    const initializer = pedersenCommitmentNonHiding(tokenAddress, userKeyHashBigInt);
    
    // Construct personal_c_tot = inner + outer + initializer
    const personalCTot = grumpkinAddPoints(
      grumpkinAddPoints(personalCInner, personalCOuter),
      initializer
    );
    
    return {
      personal_c_tot: [personalCTot.x, personalCTot.y],
      personal_c_inner: [personalCInner.x, personalCInner.y],
      personal_c_outer: [personalCOuter.x, personalCOuter.y],
      personal_c_inner_m: balance,
      personal_c_outer_m: BigInt(0),
      personal_c_outer_r: tokenAddress,
    };
  }, []);
  
  return {
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
  };
}

