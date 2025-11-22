'use client';

import { loadAccountData } from './indexeddb';
import { BalanceEntry, PersonalCommitmentState } from '@/hooks/useNonceDiscovery';

/**
 * Loads all saved account data from IndexedDB and updates the account state
 * This should be called after signing and computing zkAddress
 * 
 * Note: Personal commitment states are NOT reconstructed here.
 * They should be reconstructed when needed (e.g., when AccountModal opens or when generating proofs),
 * using balanceEntries from useNonceDiscovery (blockchain data), not cached data.
 */
export async function loadAccountDataOnSign(
  zkAddress: string,
  setters: {
    setCurrentNonce: (nonce: bigint | null) => void;
    setBalanceEntries: (entries: BalanceEntry[]) => void;
    setUserKey: (key: bigint | null) => void;
    setPersonalCommitmentState?: (nonce: bigint, tokenAddress: bigint, state: PersonalCommitmentState) => void;
    getPersonalCommitmentState?: (nonce: bigint, tokenAddress: bigint) => PersonalCommitmentState | null;
  },
  accountSignature?: string
): Promise<void> {
  try {
    console.log(`🔍 Loading saved account data for zkAddress: ${zkAddress}`);
    const savedData = await loadAccountData(zkAddress);
    
    if (savedData) {
      console.log('✅ Found saved account data:', {
        zkAddress: savedData.zkAddress,
        currentNonce: savedData.currentNonce?.toString() || 'null',
        balanceEntriesCount: savedData.balanceEntries?.length || 0,
        hasUserKey: savedData.userKey !== null,
        lastUpdated: savedData.lastUpdated ? new Date(savedData.lastUpdated).toISOString() : 'unknown',
      });

      // Update all state from saved data
      if (savedData.currentNonce !== null) {
        setters.setCurrentNonce(savedData.currentNonce);
        console.log(`  ✓ Loaded currentNonce: ${savedData.currentNonce.toString()}`);
      }

      if (savedData.balanceEntries && savedData.balanceEntries.length > 0) {
        setters.setBalanceEntries(savedData.balanceEntries);
        console.log(`  ✓ Loaded ${savedData.balanceEntries.length} balance entries`);
      }

      // Get or compute userKey
      let userKeyToUse = savedData.userKey;
      if (!userKeyToUse && accountSignature) {
        console.log('  Computing userKey from signature...');
        try {
          const { ensureBufferPolyfill } = await import('@/lib/zk-address');
          await ensureBufferPolyfill();

          const sigHex = accountSignature.startsWith('0x') ? accountSignature.slice(2) : accountSignature;
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
        } catch (error) {
          console.error('  ❌ Error computing userKey from signature:', error);
        }
      }

      if (userKeyToUse) {
        setters.setUserKey(userKeyToUse);
        console.log(`  ✓ Loaded/computed userKey: ${userKeyToUse.toString(16).slice(0, 16)}...`);
      }

      // Note: We do NOT reconstruct personal commitment states here.
      // States should be reconstructed when needed, using the same logic as AccountModal:
      // - When AccountModal opens, it reconstructs states for balanceEntries from useNonceDiscovery
      // - When transaction pages need states, they reconstruct only for new entries
      // This ensures we use the correct balanceEntries (from blockchain) not cached ones
    } else {
      console.log('⚠️ No saved account data found in IndexedDB');
    }
  } catch (error) {
    console.error('❌ Error loading saved account data:', error);
    // Don't throw - allow the app to continue even if loading fails
  }
}

