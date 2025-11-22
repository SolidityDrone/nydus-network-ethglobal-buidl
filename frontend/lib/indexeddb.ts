'use client';

import { BalanceEntry } from '@/hooks/useNonceDiscovery';
import { TransactionHistoryEntry } from '@/lib/transaction-history';

const DB_NAME = 'nydus_account_db';
const DB_VERSION = 2;
const STORE_NAME = 'account_data';
const HISTORY_STORE_NAME = 'transaction_history';

interface AccountData {
  zkAddress: string;
  currentNonce: bigint | null;
  balanceEntries: BalanceEntry[];
  userKey: bigint | null;
  lastUpdated: number;
}

let dbInstance: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'zkAddress' });
        objectStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        const historyStore = db.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'zkAddress' });
        historyStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
      }
    };
  });
}

export async function saveAccountData(data: AccountData): Promise<void> {
  try {
    const db = await getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Convert bigints to strings for storage
    const dataToStore = {
      ...data,
      currentNonce: data.currentNonce !== null ? data.currentNonce.toString() : null,
      balanceEntries: data.balanceEntries.map(entry => ({
        ...entry,
        tokenAddress: entry.tokenAddress.toString(),
        amount: entry.amount.toString(),
        nonce: entry.nonce.toString(),
      })),
      userKey: data.userKey !== null ? data.userKey.toString() : null,
      lastUpdated: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(dataToStore);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error saving account data to IndexedDB:', error);
  }
}

export async function loadAccountData(zkAddress: string): Promise<AccountData | null> {
  try {
    const db = await getDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise<AccountData | null>((resolve, reject) => {
      const request = store.get(zkAddress);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }

        // Convert strings back to bigints
        const data: AccountData = {
          zkAddress: result.zkAddress,
          currentNonce: result.currentNonce !== null ? BigInt(result.currentNonce) : null,
          balanceEntries: result.balanceEntries.map((entry: any) => ({
            tokenAddress: BigInt(entry.tokenAddress),
            amount: BigInt(entry.amount),
            nonce: BigInt(entry.nonce),
          })),
          userKey: result.userKey !== null ? BigInt(result.userKey) : null,
          lastUpdated: result.lastUpdated,
        };

        resolve(data);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error loading account data from IndexedDB:', error);
    return null;
  }
}

export async function clearAccountData(zkAddress: string): Promise<void> {
  try {
    const db = await getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(zkAddress);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error clearing account data from IndexedDB:', error);
  }
}

// Transaction History Storage
// Stored version with bigints converted to strings for IndexedDB
interface StoredTransactionHistoryEntry {
  type: 'initialize' | 'deposit' | 'send' | 'withdraw' | 'absorb';
  nonce: string;
  nonceCommitment: string;
  tokenAddress: string;
  amount: string;
  timestamp: string;
  blockNumber: string;
  transactionHash: string;
  receiverPublicKey?: { x: string; y: string };
  absorbedAmount?: string;
  nullifier?: string;
  personalCTotM?: string;
  personalCTotR?: string;
}

interface HistoryData {
  zkAddress: string;
  history: StoredTransactionHistoryEntry[];
  currentNonce: string; // Store as string to match the nonce used when history was fetched
  lastUpdated: number;
}

export async function saveTransactionHistory(
  zkAddress: string,
  history: TransactionHistoryEntry[],
  currentNonce: bigint
): Promise<void> {
  try {
    const db = await getDB();
    const transaction = db.transaction([HISTORY_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(HISTORY_STORE_NAME);

    // Convert bigints to strings for storage
    const historyToStore: HistoryData = {
      zkAddress,
      history: history.map(entry => {
        const storedEntry: StoredTransactionHistoryEntry = {
          type: entry.type,
          nonce: entry.nonce.toString(),
          nonceCommitment: entry.nonceCommitment.toString(),
          tokenAddress: entry.tokenAddress.toString(),
          amount: entry.amount.toString(),
          timestamp: entry.timestamp.toString(),
          blockNumber: entry.blockNumber.toString(),
          transactionHash: entry.transactionHash,
          receiverPublicKey: entry.receiverPublicKey ? {
            x: entry.receiverPublicKey.x.toString(),
            y: entry.receiverPublicKey.y.toString(),
          } : undefined,
          absorbedAmount: entry.absorbedAmount?.toString(),
          nullifier: entry.nullifier?.toString(),
          personalCTotM: entry.personalCTotM?.toString(),
          personalCTotR: entry.personalCTotR?.toString(),
        };
        return storedEntry;
      }),
      currentNonce: currentNonce.toString(),
      lastUpdated: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(historyToStore);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error saving transaction history to IndexedDB:', error);
  }
}

export async function loadTransactionHistory(zkAddress: string): Promise<TransactionHistoryEntry[] | null> {
  try {
    const db = await getDB();
    const transaction = db.transaction([HISTORY_STORE_NAME], 'readonly');
    const store = transaction.objectStore(HISTORY_STORE_NAME);

    return new Promise<TransactionHistoryEntry[] | null>((resolve, reject) => {
      const request = store.get(zkAddress);
      request.onsuccess = () => {
        const result = request.result as HistoryData | undefined;
        if (!result) {
          resolve(null);
          return;
        }

        // Convert strings back to bigints
        const history: TransactionHistoryEntry[] = result.history.map((entry: any) => ({
          ...entry,
          nonce: BigInt(entry.nonce),
          nonceCommitment: BigInt(entry.nonceCommitment),
          tokenAddress: BigInt(entry.tokenAddress),
          amount: BigInt(entry.amount),
          timestamp: BigInt(entry.timestamp),
          blockNumber: BigInt(entry.blockNumber),
          receiverPublicKey: entry.receiverPublicKey ? {
            x: BigInt(entry.receiverPublicKey.x),
            y: BigInt(entry.receiverPublicKey.y),
          } : undefined,
          absorbedAmount: entry.absorbedAmount ? BigInt(entry.absorbedAmount) : undefined,
          nullifier: entry.nullifier ? BigInt(entry.nullifier) : undefined,
          personalCTotM: entry.personalCTotM ? BigInt(entry.personalCTotM) : undefined,
          personalCTotR: entry.personalCTotR ? BigInt(entry.personalCTotR) : undefined,
        }));

        resolve(history);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error loading transaction history from IndexedDB:', error);
    return null;
  }
}

