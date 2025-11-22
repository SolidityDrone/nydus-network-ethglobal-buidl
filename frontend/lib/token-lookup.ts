import { Address, PublicClient, parseAbi } from 'viem';

// ERC20 ABI for name() and symbol()
const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

export interface TokenInfo {
  name: string;
  symbol: string;
  address: string;
}

/**
 * Fetch token name and symbol for a single token address
 * Uses readContract which automatically decodes the response
 */
export async function fetchTokenInfo(
  publicClient: PublicClient,
  tokenAddress: string
): Promise<TokenInfo | null> {
  try {
    // Convert hex string to Address format
    const address = tokenAddress.startsWith('0x') ? tokenAddress as Address : `0x${tokenAddress}` as Address;
    
    // Use Promise.allSettled to fetch both in parallel, handle failures gracefully
    const [nameResult, symbolResult] = await Promise.allSettled([
      publicClient.readContract({
        address,
        abi: ERC20_ABI,
        functionName: 'name',
      }),
      publicClient.readContract({
        address,
        abi: ERC20_ABI,
        functionName: 'symbol',
      }),
    ]);

    let name = '$NoName';
    let symbol = '$NoName';

    // Extract name (already decoded by readContract)
    if (nameResult.status === 'fulfilled') {
      name = nameResult.value || '$NoName';
      if (!name || name.trim() === '') name = '$NoName';
    }

    // Extract symbol (already decoded by readContract)
    if (symbolResult.status === 'fulfilled') {
      symbol = symbolResult.value || '$NoName';
      if (!symbol || symbol.trim() === '') symbol = '$NoName';
    }

    return {
      name,
      symbol,
      address: tokenAddress,
    };
  } catch (error) {
    console.error(`Error fetching token info for ${tokenAddress}:`, error);
    return {
      name: '$NoName',
      symbol: '$NoName',
      address: tokenAddress,
    };
  }
}

/**
 * Batch fetch token info for multiple addresses using viem multicall
 * This is more efficient than individual calls
 */
export async function fetchTokenInfoBatch(
  publicClient: PublicClient,
  tokenAddresses: string[]
): Promise<Map<string, TokenInfo>> {
  const results = new Map<string, TokenInfo>();
  
  // Remove duplicates and normalize
  const uniqueAddresses = Array.from(new Set(
    tokenAddresses.map(addr => addr.startsWith('0x') ? addr.toLowerCase() : `0x${addr}`.toLowerCase())
  ));

  if (uniqueAddresses.length === 0) return results;

  try {
    // Prepare multicall contracts array
    const contracts = uniqueAddresses.flatMap(address => [
      {
        address: address as Address,
        abi: ERC20_ABI,
        functionName: 'name' as const,
      },
      {
        address: address as Address,
        abi: ERC20_ABI,
        functionName: 'symbol' as const,
      },
    ]);

    // Use multicall if available, otherwise fall back to parallel individual calls
    let multicallResults;
    try {
      multicallResults = await publicClient.multicall({
        contracts,
        allowFailure: true,
      });
    } catch (e) {
      // Fallback to individual calls if multicall fails
      console.warn('Multicall not available, using individual calls:', e);
      const promises = uniqueAddresses.map(async (address) => {
        const info = await fetchTokenInfo(publicClient, address);
        return { address, info };
      });
      const fetched = await Promise.all(promises);
      fetched.forEach(({ address, info }) => {
        if (info) {
          results.set(address.toLowerCase(), info);
        }
      });
      return results;
    }

    // Process multicall results (pairs of name, symbol for each token)
    for (let i = 0; i < uniqueAddresses.length; i++) {
      const address = uniqueAddresses[i];
      const nameIndex = i * 2;
      const symbolIndex = i * 2 + 1;

      let name = '$NoName';
      let symbol = '$NoName';

      if (nameIndex < multicallResults.length && multicallResults[nameIndex].status === 'success') {
        try {
          // Result is already decoded by viem multicall
          name = (multicallResults[nameIndex].result as string) || '$NoName';
          if (!name || name.trim() === '') name = '$NoName';
        } catch (e) {
          console.warn(`Failed to get name for ${address}:`, e);
        }
      }

      if (symbolIndex < multicallResults.length && multicallResults[symbolIndex].status === 'success') {
        try {
          // Result is already decoded by viem multicall
          symbol = (multicallResults[symbolIndex].result as string) || '$NoName';
          if (!symbol || symbol.trim() === '') symbol = '$NoName';
        } catch (e) {
          console.warn(`Failed to get symbol for ${address}:`, e);
        }
      }

      results.set(address.toLowerCase(), {
        name: name || '$NoName',
        symbol: symbol || '$NoName',
        address,
      });
    }
  } catch (error) {
    console.error('Error in batch token info fetch:', error);
    // Fallback to individual calls
    const promises = uniqueAddresses.map(async (address) => {
      const info = await fetchTokenInfo(publicClient, address);
      return { address, info };
    });
    const fetched = await Promise.all(promises);
    fetched.forEach(({ address, info }) => {
      if (info) {
        results.set(address.toLowerCase(), info);
      }
    });
  }

  return results;
}

