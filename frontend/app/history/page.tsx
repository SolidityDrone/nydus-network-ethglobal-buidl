'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCeloPublicClient } from '@/hooks/useCeloPublicClient';
import { useZkAddress, useAccount as useAccountContext } from '@/context/AccountProvider';
import { useAccountState } from '@/context/AccountStateProvider';
import { useNonceDiscovery } from '@/hooks/useNonceDiscovery';
import { reconstructTransactionHistory, TransactionHistoryEntry } from '@/lib/transaction-history';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fetchTokenInfoBatch } from '@/lib/token-lookup';
import { saveTransactionHistory, loadTransactionHistory } from '@/lib/indexeddb';

export default function HistoryPage() {
  const publicClient = useCeloPublicClient();
  const { account } = useAccountContext();
  const zkAddress = useZkAddress();
  const { currentNonce } = useAccountState();
  const { computeCurrentNonce } = useNonceDiscovery();

  const [history, setHistory] = useState<TransactionHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenInfoMap, setTokenInfoMap] = useState<Map<string, { name: string; symbol: string }>>(new Map());

  // Get user key from account signature
  const getUserKey = useCallback(async (): Promise<bigint> => {
    if (!account?.signature) {
      throw new Error('Account signature not available');
    }

    const { ensureBufferPolyfill } = await import('@/lib/zk-address');
    await ensureBufferPolyfill();

    const sigHex = account.signature.startsWith('0x') ? account.signature.slice(2) : account.signature;
    const sigBuffer = globalThis.Buffer.from(sigHex, 'hex');

    if (sigBuffer.length !== 65) {
      throw new Error('Invalid signature length');
    }

    const chunk1 = sigBuffer.slice(0, 31);
    const chunk2 = sigBuffer.slice(31, 62);
    const chunk3 = sigBuffer.slice(62, 65);

    const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
    const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
    const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));

    const { poseidon2Hash } = await import('@aztec/foundation/crypto');
    const poseidonHash = await poseidon2Hash([chunk1BigInt, chunk2BigInt, chunk3BigInt]);

    if (typeof poseidonHash === 'bigint') {
      return poseidonHash;
    } else if ('toBigInt' in poseidonHash && typeof (poseidonHash as any).toBigInt === 'function') {
      return (poseidonHash as any).toBigInt();
    } else if ('value' in poseidonHash) {
      return BigInt((poseidonHash as any).value);
    } else {
      return BigInt((poseidonHash as any).toString());
    }
  }, [account?.signature]);

  const loadHistory = useCallback(async (forceRefresh: boolean = false) => {
    console.log('[History] loadHistory called:', {
      forceRefresh,
      hasPublicClient: !!publicClient,
      hasSignature: !!account?.signature,
      currentNonce: currentNonce?.toString(),
      zkAddress: zkAddress?.slice(0, 20) + '...',
    });
    
    if (!publicClient || !account?.signature || currentNonce === null || !zkAddress) {
      console.log('[History] Missing required data, cannot load history');
      if (!account?.signature) {
        setError('Please sign in to view transaction history');
      } else if (currentNonce === null) {
        setError('Please initialize your account first');
      } else if (!zkAddress) {
        setError('ZK address not available');
      } else if (!publicClient) {
        setError('Public client not available');
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Load from cache first (unless forcing refresh)
      let cachedHistory: TransactionHistoryEntry[] | null = null;
      if (!forceRefresh) {
        cachedHistory = await loadTransactionHistory(zkAddress);
        if (cachedHistory && cachedHistory.length > 0) {
          console.log(`[History] Loaded ${cachedHistory.length} entries from cache`);
          setHistory(cachedHistory);
          
          // Fetch token info for cached entries
          if (cachedHistory.length > 0 && publicClient) {
            const tokenAddresses = Array.from(new Set(
              cachedHistory.map(entry => '0x' + entry.tokenAddress.toString(16).toLowerCase())
            ));
            const infoMap = await fetchTokenInfoBatch(publicClient, tokenAddresses);
            setTokenInfoMap(new Map(
              Array.from(infoMap.entries()).map(([addr, info]) => [addr, { name: info.name, symbol: info.symbol }])
            ));
          }
        }
      }

      // Ensure Buffer polyfill is initialized before any @aztec imports
      const { ensureBufferPolyfill } = await import('@/lib/zk-address');
      await ensureBufferPolyfill();

      // Ensure nonce is up to date
      if (currentNonce === BigInt(0)) {
        await computeCurrentNonce();
      }

      const userKey = await getUserKey();
      
      // Progressive loading: start from cached history if available, otherwise empty
      const newHistory: TransactionHistoryEntry[] = cachedHistory ? [...cachedHistory] : [];
      const seenNonces = new Set<string>(newHistory.map(e => e.nonce.toString()));
      
      const onEntryFound = (entry: TransactionHistoryEntry) => {
        // Only add if we haven't seen this nonce before (avoid duplicates)
        const nonceKey = entry.nonce.toString();
        if (!seenNonces.has(nonceKey)) {
          newHistory.push(entry);
          seenNonces.add(nonceKey);
          // Sort by nonce in descending order (most recent first) and update state progressively
          const sorted = [...newHistory].sort((a, b) => {
            return a.nonce > b.nonce ? -1 : 1; // Descending order (most recent first)
          });
          setHistory(sorted);
          console.log(`[History] Progressively added entry: nonce ${entry.nonce.toString()}, total: ${sorted.length}`);
        }
      };

      console.log(`[History] Starting to fetch transaction history from chain...`);
      const historyData = await reconstructTransactionHistory(
        publicClient,
        userKey,
        currentNonce,
        undefined,
        undefined,
        onEntryFound
      );

      console.log(`[History] Fetch complete, found ${historyData.length} total entries`);
      
      // Final update with all entries (sorted by nonce)
      // Merge with cached history to ensure we have everything
      const allEntries = new Map<string, TransactionHistoryEntry>();
      
      // Add cached entries first
      if (cachedHistory) {
        for (const entry of cachedHistory) {
          allEntries.set(entry.nonce.toString(), entry);
        }
      }
      
      // Add/update with fetched entries
      for (const entry of historyData) {
        allEntries.set(entry.nonce.toString(), entry);
      }
      
      const sortedHistory = Array.from(allEntries.values()).sort((a, b) => {
        return a.nonce > b.nonce ? -1 : 1; // Descending order (most recent first)
      });
      
      setHistory(sortedHistory);
      console.log(`[History] Final history: ${sortedHistory.length} entries`);

      // Save to cache
      await saveTransactionHistory(zkAddress, sortedHistory, currentNonce);
      console.log(`[History] Saved ${sortedHistory.length} entries to cache`);

      // Fetch token info for all unique tokens
      if (sortedHistory.length > 0 && publicClient) {
        const tokenAddresses = Array.from(new Set(
          sortedHistory.map(entry => '0x' + entry.tokenAddress.toString(16).toLowerCase())
        ));
        const infoMap = await fetchTokenInfoBatch(publicClient, tokenAddresses);
        setTokenInfoMap(new Map(
          Array.from(infoMap.entries()).map(([addr, info]) => [addr, { name: info.name, symbol: info.symbol }])
        ));
      }
    } catch (err: any) {
      console.error('Error loading history:', err);
      setError(err.message || 'Failed to load transaction history');
    } finally {
      setIsLoading(false);
    }
  }, [publicClient, account?.signature, currentNonce, getUserKey, computeCurrentNonce, zkAddress]);

  useEffect(() => {
    console.log('[History] useEffect triggered:', {
      currentNonce: currentNonce?.toString(),
      hasSignature: !!account?.signature,
      zkAddress: zkAddress?.slice(0, 20) + '...',
    });
    
    if (currentNonce !== null && currentNonce >= BigInt(0) && account?.signature && zkAddress) {
      console.log('[History] Conditions met, calling loadHistory...');
      loadHistory();
    } else {
      console.log('[History] Conditions not met, skipping loadHistory');
    }
  }, [currentNonce, account?.signature, loadHistory, zkAddress]);

  const getTransactionTypeLabel = (type: string) => {
    switch (type) {
      case 'initialize': return 'INITIALIZE';
      case 'deposit': return 'DEPOSIT';
      case 'send': return 'SEND';
      case 'withdraw': return 'WITHDRAW';
      case 'absorb': return 'ABSORB';
      default: return type.toUpperCase();
    }
  };

  const formatTokenAddress = (tokenAddress: bigint) => {
    const hex = tokenAddress.toString(16);
    const address = hex.length % 2 === 0 ? `0x${hex}` : `0x0${hex}`;
    return address.length > 20 ? `${address.slice(0, 10)}...${address.slice(-8)}` : address;
  };

  if (!account?.signature) {
    return (
      <div className="min-h-screen bg-black text-white pt-20 sm:pt-24 pb-8 sm:pb-12 px-3 sm:px-4 lg:px-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                <CardTitle className="text-xs sm:text-sm font-mono uppercase">$ TRANSACTION HISTORY</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs sm:text-sm font-mono text-[#888888] uppercase">
                PLEASE SIGN IN TO VIEW TRANSACTION HISTORY.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (currentNonce === null) {
    return (
      <div className="min-h-screen bg-black text-white pt-20 sm:pt-24 pb-8 sm:pb-12 px-3 sm:px-4 lg:px-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                <CardTitle className="text-xs sm:text-sm font-mono uppercase">$ TRANSACTION HISTORY</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs sm:text-sm font-mono text-[#888888] uppercase">
                LOADING ACCOUNT STATE...
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (currentNonce === BigInt(0)) {
    return (
      <div className="min-h-screen bg-black text-white pt-20 sm:pt-24 pb-8 sm:pb-12 px-3 sm:px-4 lg:px-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                <CardTitle className="text-xs sm:text-sm font-mono uppercase">$ TRANSACTION HISTORY</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs sm:text-sm font-mono text-[#888888] uppercase">
                NO HISTORY AVAILABLE. PLEASE INITIALIZE YOUR ACCOUNT FIRST.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pt-20 sm:pt-24 pb-8 sm:pb-12 px-3 sm:px-4 lg:px-6">
      <div className="max-w-4xl mx-auto space-y-3 sm:space-y-4">
        <Card>
          <CardHeader className="border-b border-[#333333] bg-black/50 py-2 px-3 sm:px-4 mb-3">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 bg-[rgba(182,255,62,1)]"></div>
                <CardTitle className="text-xs sm:text-sm font-mono uppercase">$ TRANSACTION HISTORY</CardTitle>
              </div>
              <Button
                onClick={() => loadHistory(true)}
                disabled={isLoading}
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2 border-[#333333] hover:border-[rgba(182,255,62,1)] hover:text-[rgba(182,255,62,1)] transition-colors"
              >
                {isLoading ? 'LOADING...' : 'REFRESH'}
              </Button>
            </div>
            {isLoading && (
              <CardDescription className="text-[10px] sm:text-xs font-mono uppercase">
                LOADING HISTORY...
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-3 sm:mb-4 p-2 sm:p-3 border border-[#333333] bg-[#0a0a0a]">
                <p className="text-xs sm:text-sm font-mono text-white uppercase break-words">{error}</p>
              </div>
            )}

            {!isLoading && history.length === 0 && !error && (
              <div className="text-xs sm:text-sm font-mono text-[#888888] uppercase">
                NO TRANSACTIONS FOUND.
              </div>
            )}

            {(isLoading || history.length > 0) && (
              <div className="space-y-2 sm:space-y-3">
                {history.length === 0 && isLoading && (
                  <div className="text-xs sm:text-sm font-mono text-[#888888] uppercase">
                    FETCHING HISTORY...
                  </div>
                )}
                {history.map((entry, index) => {
                  const tokenAddress = '0x' + entry.tokenAddress.toString(16).toLowerCase();
                  const tokenInfo = tokenInfoMap.get(tokenAddress);
                  const displayName = tokenInfo?.name || '$NoName';
                  const displaySymbol = tokenInfo?.symbol || '$NoName';

                  return (
                    <Card key={index} className="border-[#333333]">
                      <CardContent className="pt-3 sm:pt-4">
                        <div className="text-[10px] sm:text-xs font-mono">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2 sm:mb-3 gap-1 sm:gap-0">
                            <div>
                              <p className="font-bold text-white uppercase">
                                #{entry.nonce.toString()} - {getTransactionTypeLabel(entry.type)}
                              </p>
                              <p className="text-[8px] sm:text-[9px] text-[#888888] mt-0.5 break-all">
                                {entry.transactionHash || 'N/A'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[8px] sm:text-[9px] text-[#888888]">
                                BLOCK: {entry.blockNumber.toString()}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-2 sm:mb-3">
                            <div>
                              <span className="text-[#888888] block mb-0.5 text-[9px] sm:text-[10px]">TOKEN:</span>
                              <p className="text-white font-semibold">
                                {displayName} ({displaySymbol})
                              </p>
                              <p className="text-[8px] sm:text-[9px] text-[#888888] mt-0.5 break-all">
                                {formatTokenAddress(entry.tokenAddress)}
                              </p>
                            </div>
                            <div>
                              <span className="text-[#888888] block mb-0.5 text-[9px] sm:text-[10px]">AMOUNT:</span>
                              <p className="text-white font-semibold break-all">{entry.amount.toString()}</p>
                            </div>
                          </div>

                          {entry.type === 'send' && entry.receiverPublicKey && (
                            <div className="mb-2 sm:mb-3 p-2 border border-[#333333] bg-[#0a0a0a]">
                              <span className="text-[#888888] block mb-1 text-[9px] sm:text-[10px]">RECEIVER:</span>
                              <p className="text-white text-[9px] sm:text-[10px] break-all">
                                X: {entry.receiverPublicKey.x.toString()}
                              </p>
                              <p className="text-white text-[9px] sm:text-[10px] break-all">
                                Y: {entry.receiverPublicKey.y.toString()}
                              </p>
                            </div>
                          )}

                          {entry.type === 'absorb' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-2 sm:mb-3">
                              {entry.absorbedAmount !== undefined && (
                                <div>
                                  <span className="text-[#888888] block mb-0.5 text-[9px] sm:text-[10px]">ABSORBED:</span>
                                  <p className="text-white break-all">{entry.absorbedAmount.toString()}</p>
                                </div>
                              )}
                              {entry.nullifier !== undefined && (
                                <div>
                                  <span className="text-[#888888] block mb-0.5 text-[9px] sm:text-[10px]">NULLIFIER:</span>
                                  <p className="text-white break-all">{entry.nullifier.toString()}</p>
                                </div>
                              )}
                            </div>
                          )}

                          <details className="mt-2">
                            <summary className="text-[9px] sm:text-[10px] text-[#888888] cursor-pointer uppercase hover:text-white">
                              SHOW DETAILS
                            </summary>
                            <div className="mt-1 space-y-0.5 pl-2 text-[9px] sm:text-[10px] text-[#888888]">
                              <p>NONCE COMMITMENT: {entry.nonceCommitment.toString()}</p>
                              {entry.personalCTotM !== undefined && (
                                <p>PERSONAL_C_TOT_M: {entry.personalCTotM.toString()}</p>
                              )}
                              {entry.personalCTotR !== undefined && (
                                <p>PERSONAL_C_TOT_R: {entry.personalCTotR.toString()}</p>
                              )}
                            </div>
                          </details>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

