import { PublicClient, Address, decodeEventLog } from 'viem';
import { NydusAddress, NydusAbi } from '@/lib/abi/NydusConst';
import { poseidonCtrDecrypt } from '@/lib/poseidon-ctr-encryption';

// VIEW_STRING constant from circuits: 0x76696577696e675f6b6579 ("viewing_key" in hex)
const VIEW_STRING = BigInt('0x76696577696e675f6b6579');

export interface TransactionHistoryEntry {
  type: 'initialize' | 'deposit' | 'send' | 'withdraw' | 'absorb';
  nonce: bigint;
  nonceCommitment: bigint;
  tokenAddress: bigint;
  amount: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  transactionHash: string;
  // Additional fields based on transaction type
  receiverPublicKey?: { x: bigint; y: bigint };
  absorbedAmount?: bigint;
  nullifier?: bigint;
  // Decrypted personal_c_tot values
  personalCTotM?: bigint;
  personalCTotR?: bigint;
}

/**
 * Derive viewkey from user_key
 * view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2)
 */
export async function deriveViewKey(userKey: bigint): Promise<bigint> {
  const { poseidon2Hash } = await import('@aztec/foundation/crypto');
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
  if (typeof viewKey === 'bigint') {
    return viewKey;
  } else if ('toBigInt' in viewKey && typeof (viewKey as any).toBigInt === 'function') {
    return (viewKey as any).toBigInt();
  } else if ('value' in viewKey) {
    return BigInt((viewKey as any).value);
  } else {
    return BigInt((viewKey as any).toString());
  }
}

/**
 * Derive encryption key for a specific nonce
 * encryption_key = Poseidon2::hash([view_key, nonce], 2)
 */
export async function deriveEncryptionKey(viewKey: bigint, nonce: bigint): Promise<bigint> {
  const { poseidon2Hash } = await import('@aztec/foundation/crypto');
  const encryptionKey = await poseidon2Hash([viewKey, nonce]);
  if (typeof encryptionKey === 'bigint') {
    return encryptionKey;
  } else if ('toBigInt' in encryptionKey && typeof (encryptionKey as any).toBigInt === 'function') {
    return (encryptionKey as any).toBigInt();
  } else if ('value' in encryptionKey) {
    return BigInt((encryptionKey as any).value);
  } else {
    return BigInt((encryptionKey as any).toString());
  }
}

/**
 * Decrypt balance and token address for a given nonce
 */
export async function decryptBalanceEntry(
  viewKey: bigint,
  nonce: bigint,
  encryptedBalance: bigint,
  encryptedTokenAddress: bigint
): Promise<{ amount: bigint; tokenAddress: bigint }> {
  const encryptionKey = await deriveEncryptionKey(viewKey, nonce);
  
  const amount = await poseidonCtrDecrypt(encryptedBalance, encryptionKey, 0);
  const tokenAddress = await poseidonCtrDecrypt(encryptedTokenAddress, encryptionKey, 1);
  
  return { amount, tokenAddress };
}

/**
 * Decrypt personal_c_tot values for a given nonce
 */
export async function decryptPersonalCTot(
  viewKey: bigint,
  nonce: bigint,
  encryptedM: bigint,
  encryptedR: bigint
): Promise<{ m: bigint; r: bigint }> {
  const encryptionKey = await deriveEncryptionKey(viewKey, nonce);
  
  const m = await poseidonCtrDecrypt(encryptedM, encryptionKey, 3);
  const r = await poseidonCtrDecrypt(encryptedR, encryptionKey, 4);
  
  return { m, r };
}

/**
 * Decrypt nullifier for absorb operations
 */
export async function decryptNullifier(
  viewKey: bigint,
  nonce: bigint,
  encryptedNullifier: bigint
): Promise<bigint> {
  const encryptionKey = await deriveEncryptionKey(viewKey, nonce);
  return await poseidonCtrDecrypt(encryptedNullifier, encryptionKey, 6);
}

/**
 * Compute nonce commitment for a given nonce
 * nonceCommitment = Poseidon2::hash([user_key_hash, nonce], 2)
 */
export async function computeNonceCommitment(userKey: bigint, nonce: bigint): Promise<bigint> {
  const { poseidon2Hash } = await import('@aztec/foundation/crypto');
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

  const nonceCommitment = await poseidon2Hash([userKeyHashBigInt, nonce]);
  if (typeof nonceCommitment === 'bigint') {
    return nonceCommitment;
  } else if ('toBigInt' in nonceCommitment && typeof (nonceCommitment as any).toBigInt === 'function') {
    return (nonceCommitment as any).toBigInt();
  } else if ('value' in nonceCommitment) {
    return BigInt((nonceCommitment as any).value);
  } else {
    return BigInt((nonceCommitment as any).toString());
  }
}

/**
 * Reconstruct transaction history using viewkey
 * 
 * This function:
 * 1. Uses nonce discovery to find all nonces up to current nonce
 * 2. For each nonce, computes nonceCommitment and queries contract
 * 3. Decrypts the encrypted data using the viewkey
 * 4. Queries events to get transaction metadata (type, block number, etc.)
 * 5. Returns a chronological history of all transactions
 * 
 * @param onEntryFound Optional callback that gets called for each entry as it's found (for progressive loading)
 */
export async function reconstructTransactionHistory(
  publicClient: PublicClient,
  userKey: bigint,
  currentNonce: bigint,
  fromBlock?: bigint,
  toBlock?: bigint,
  onEntryFound?: (entry: TransactionHistoryEntry) => void
): Promise<TransactionHistoryEntry[]> {
  const viewKey = await deriveViewKey(userKey);
  const history: TransactionHistoryEntry[] = [];

  try {
    // We don't query logs anymore - we get all data from contract state
    // This avoids RPC limits and is more efficient
    console.log(`[History] Reconstructing history from contract state (no log queries)`);

    // Iterate through all nonces from currentNonce - 1 down to 0
    // currentNonce is the NEXT available nonce, so we check from currentNonce - 1 down to 0
    // This way, most recent transactions appear first (progressive loading)
    const lastUsedNonce = currentNonce > BigInt(0) ? currentNonce - BigInt(1) : BigInt(0);
    console.log(`[History] Checking nonces from ${lastUsedNonce.toString()} down to 0 (currentNonce = ${currentNonce.toString()})`);
    for (let nonce = lastUsedNonce; nonce >= BigInt(0); nonce--) {
      try {
        console.log(`[History] Processing nonce ${nonce.toString()}...`);
        const nonceCommitment = await computeNonceCommitment(userKey, nonce);
        const nonceCommitmentStr = nonceCommitment.toString();
        console.log(`[History] Nonce ${nonce.toString()}: nonceCommitment = ${nonceCommitmentStr}`);
        
        // Check if this nonceCommitment exists in the contract
        const known = await publicClient.readContract({
          address: NydusAddress,
          abi: NydusAbi,
          functionName: 'knownNonceCommitments',
          args: [nonceCommitment],
        });

        console.log(`[History] Nonce ${nonce.toString()}: known in contract = ${known}`);

        if (!known) {
          console.log(`[History] Nonce ${nonce.toString()}: not known in contract, skipping`);
          continue; // This nonce doesn't exist yet
        }

        console.log(`[History] Nonce ${nonce.toString()}: found in contract, decrypting...`);

        // Get encrypted data from contract using the correct view functions
        const [encryptedBalance, encryptedTokenAddress] = await publicClient.readContract({
          address: NydusAddress,
          abi: NydusAbi,
          functionName: 'getBalanceReference',
          args: [nonceCommitment],
        }) as [bigint, bigint];

        const [encCTotM, encCTotR] = await publicClient.readContract({
          address: NydusAddress,
          abi: NydusAbi,
          functionName: 'getPersonalCTotReference',
          args: [nonceCommitment],
        }) as [bigint, bigint];

        // Decrypt the data
        let amount: bigint;
        let tokenAddress: bigint;
        
        if (nonce === BigInt(0)) {
          // For nonce 0, values are plaintext (from initCommit)
          amount = encryptedBalance;
          tokenAddress = encryptedTokenAddress;
        } else {
          // For other nonces, decrypt using viewkey
          const result = await decryptBalanceEntry(
            viewKey,
            nonce,
            encryptedBalance,
            encryptedTokenAddress
          );
          amount = result.amount;
          tokenAddress = result.tokenAddress;
        }

        const { m, r } = await decryptPersonalCTot(
          viewKey,
          nonce,
          encCTotM,
          encCTotR
        );

        // Query events to determine transaction type and get metadata
        let transactionType: 'initialize' | 'deposit' | 'send' | 'withdraw' | 'absorb' = 'deposit';
        let blockNumber = BigInt(0);
        let transactionHash = '';
        let timestamp = BigInt(0);
        let receiverPublicKey: { x: bigint; y: bigint } | undefined;
        let absorbedAmount: bigint | undefined;
        let nullifier: bigint | undefined;

        try {
          // Query logs for each event type separately using event filters
          // nonceCommitment is the first indexed parameter (topics[1])
          const nonceCommitmentTopic = `0x${nonceCommitment.toString(16).padStart(64, '0')}` as `0x${string}`;
          
          // Query each event type separately
          const eventNames = ['Initialized', 'Deposited', 'Sent', 'Withdrawn', 'Absorbed'] as const;
          const allLogs: any[] = [];
          
          for (const eventName of eventNames) {
            try {
              const eventAbi = NydusAbi.find((item: any) => 
                item.type === 'event' && item.name === eventName
              );
              
              if (!eventAbi) continue;
              
              // Use event filter with args filter for nonceCommitment
              const logs = await publicClient.getLogs({
                address: NydusAddress,
                event: eventAbi as any,
                args: {
                  nonceCommitment: nonceCommitment,
                } as any,
                fromBlock: fromBlock || BigInt(0),
                toBlock: toBlock || 'latest',
              }).catch(() => []);
              
              allLogs.push(...logs);
            } catch {
              // If event filter fails, skip this event type
              continue;
            }
          }

          // Now decode each log to determine which event type it is
          let initializedLog: any = null;
          let depositedLog: any = null;
          let sentLog: any = null;
          let withdrawnLog: any = null;
          let absorbedLog: any = null;

          for (const log of allLogs) {
            try {
              // Try to decode with each event type
              // We check the event signature hash (topics[0]) to identify the event
              const eventAbi = NydusAbi.find((item: any) => 
                item.type === 'event' && 
                (item.name === 'Initialized' || item.name === 'Deposited' || item.name === 'Sent' || 
                 item.name === 'Withdrawn' || item.name === 'Absorbed')
              );
              
              if (!eventAbi) continue;

              // Try to decode the log
              const decoded = decodeEventLog({
                abi: [eventAbi],
                data: log.data,
                topics: log.topics,
              } as any);

              // Match by event name
              if (decoded.eventName === 'Initialized' && !initializedLog) {
                initializedLog = { ...log, parsed: decoded };
              } else if (decoded.eventName === 'Deposited' && !depositedLog) {
                depositedLog = { ...log, parsed: decoded };
              } else if (decoded.eventName === 'Sent' && !sentLog) {
                sentLog = { ...log, parsed: decoded };
              } else if (decoded.eventName === 'Withdrawn' && !withdrawnLog) {
                withdrawnLog = { ...log, parsed: decoded };
              } else if (decoded.eventName === 'Absorbed' && !absorbedLog) {
                absorbedLog = { ...log, parsed: decoded };
              }
            } catch (error) {
              // If decoding fails, try the next event type
              // We need to try each event type separately
              for (const eventName of ['Initialized', 'Deposited', 'Sent', 'Withdrawn', 'Absorbed']) {
                try {
                  const eventAbi = NydusAbi.find((item: any) => 
                    item.type === 'event' && item.name === eventName
                  );
                  if (!eventAbi) continue;

                  const decoded = decodeEventLog({
                    abi: [eventAbi],
                    data: log.data,
                    topics: log.topics,
                  } as any);

                  if (decoded.eventName === 'Initialized' && !initializedLog) {
                    initializedLog = { ...log, parsed: decoded };
                    break;
                  } else if (decoded.eventName === 'Deposited' && !depositedLog) {
                    depositedLog = { ...log, parsed: decoded };
                    break;
                  } else if (decoded.eventName === 'Sent' && !sentLog) {
                    sentLog = { ...log, parsed: decoded };
                    break;
                  } else if (decoded.eventName === 'Withdrawn' && !withdrawnLog) {
                    withdrawnLog = { ...log, parsed: decoded };
                    break;
                  } else if (decoded.eventName === 'Absorbed' && !absorbedLog) {
                    absorbedLog = { ...log, parsed: decoded };
                    break;
                  }
                } catch {
                  continue;
                }
              }
            }
          }

          // Determine transaction type based on which event was found
          // Priority: Initialized > Absorbed > Sent > Withdrawn > Deposited
          // (This order ensures we catch the correct type even if multiple events exist)
          if (initializedLog) {
            const log = initializedLog;
            transactionType = 'initialize';
            blockNumber = BigInt(log.blockNumber);
            transactionHash = log.transactionHash;
            const block = await publicClient.getBlock({ blockNumber: log.blockNumber }).catch(() => null);
            if (block) {
              timestamp = BigInt(block.timestamp);
            }
            console.log(`[History] Nonce ${nonce.toString()}: found Initialized event`);
          } else if (absorbedLog) {
            const log = absorbedLog;
            transactionType = 'absorb';
            blockNumber = BigInt(log.blockNumber);
            transactionHash = log.transactionHash;
            const block = await publicClient.getBlock({ blockNumber: log.blockNumber }).catch(() => null);
            if (block) {
              timestamp = BigInt(block.timestamp);
            }
            // Decrypt absorbed amount and nullifier
            if (log.parsed && 'encryptedAbsorbedAmount' in log.parsed && log.parsed.encryptedAbsorbedAmount) {
              const encryptedAbsorbedAmount = BigInt(log.parsed.encryptedAbsorbedAmount.toString());
              absorbedAmount = await poseidonCtrDecrypt(encryptedAbsorbedAmount, await deriveEncryptionKey(viewKey, nonce), 5);
            }
            if (log.parsed && 'encryptedNewNullifier' in log.parsed && log.parsed.encryptedNewNullifier) {
              const encryptedNullifier = BigInt(log.parsed.encryptedNewNullifier.toString());
              nullifier = await decryptNullifier(viewKey, nonce, encryptedNullifier);
            }
            console.log(`[History] Nonce ${nonce.toString()}: found Absorbed event`);
          } else if (sentLog) {
            const log = sentLog;
            transactionType = 'send';
            blockNumber = BigInt(log.blockNumber);
            transactionHash = log.transactionHash;
            const block = await publicClient.getBlock({ blockNumber: log.blockNumber }).catch(() => null);
            if (block) {
              timestamp = BigInt(block.timestamp);
            }
            // Extract receiver public key from event args
            if (log.parsed && 'receiptNoteX' in log.parsed && 'receiptNoteY' in log.parsed) {
              receiverPublicKey = {
                x: BigInt(log.parsed.receiptNoteX?.toString() || '0'),
                y: BigInt(log.parsed.receiptNoteY?.toString() || '0'),
              };
            }
            console.log(`[History] Nonce ${nonce.toString()}: found Sent event`);
          } else if (withdrawnLog) {
            const log = withdrawnLog;
            transactionType = 'withdraw';
            blockNumber = BigInt(log.blockNumber);
            transactionHash = log.transactionHash;
            const block = await publicClient.getBlock({ blockNumber: log.blockNumber }).catch(() => null);
            if (block) {
              timestamp = BigInt(block.timestamp);
            }
            console.log(`[History] Nonce ${nonce.toString()}: found Withdrawn event`);
          } else if (depositedLog) {
            const log = depositedLog;
            transactionType = 'deposit';
            blockNumber = BigInt(log.blockNumber);
            transactionHash = log.transactionHash;
            const block = await publicClient.getBlock({ blockNumber: log.blockNumber }).catch(() => null);
            if (block) {
              timestamp = BigInt(block.timestamp);
            }
            console.log(`[History] Nonce ${nonce.toString()}: found Deposited event`);
          } else {
            // Fallback: if no event found, default based on nonce
            if (nonce === BigInt(0)) {
              transactionType = 'initialize';
            } else {
              transactionType = 'deposit'; // Default fallback
            }
            console.warn(`[History] No event found for nonce ${nonce.toString()}, using default type: ${transactionType}`);
          }
        } catch (error) {
          console.error(`[History] Error querying events for nonce ${nonce.toString()}:`, error);
          // Fallback to default type
        if (nonce === BigInt(0)) {
          transactionType = 'initialize';
        } else {
          transactionType = 'deposit';
          }
        }

        // Create entry with available data
        const entry: TransactionHistoryEntry = {
          type: transactionType,
          nonce,
          nonceCommitment,
          tokenAddress,
          amount,
          timestamp,
          blockNumber,
          transactionHash,
          receiverPublicKey,
          absorbedAmount,
          nullifier,
          personalCTotM: m,
          personalCTotR: r,
        };

        if (entry) {
          console.log(`[History] Nonce ${nonce.toString()}: created entry of type ${entry.type}`);
          history.push(entry);
          // Call the callback if provided (for progressive loading)
          if (onEntryFound) {
            onEntryFound(entry);
          }
        } else {
          console.warn(`[History] Nonce ${nonce.toString()}: failed to create entry`);
        }
      } catch (error) {
        // If decryption fails, skip this nonce
        console.error(`[History] Nonce ${nonce.toString()}: decryption/processing failed:`, error);
      }
    }

    console.log(`[History] Reconstructed ${history.length} transactions`);

    // Sort by nonce in descending order (most recent first)
    // Since we processed from high to low, entries are already mostly in reverse order
    // But we sort to ensure consistency
    history.sort((a, b) => {
      return a.nonce > b.nonce ? -1 : 1; // Descending order (most recent first)
    });

    return history;
  } catch (error) {
    console.error('Error reconstructing transaction history:', error);
    throw error;
  }
}

