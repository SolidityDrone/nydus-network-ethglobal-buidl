/**
 * JustaName SIWE (Sign-In with Ethereum) Client
 * Handles getting challenges and user signatures for ENS operations
 */

const JUSTANAME_API_BASE = 'https://api.justaname.id';
const ENS_DOMAIN = process.env.NEXT_PUBLIC_ENS_DOMAIN || 'nydusns.eth';
const CHAIN_ID = 11155111; // Sepolia
const PROVIDER_URL = process.env.NEXT_PUBLIC_PROVIDER_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

/**
 * Request a SIWE challenge from JustaName for a specific address
 */
export async function requestSIWEChallenge(address: string): Promise<string> {
  try {
    const response = await fetch(`${JUSTANAME_API_BASE}/ens/v1/siwe/request-challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address,
        chainId: CHAIN_ID,
        origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
        domain: ENS_DOMAIN,
        ens: ENS_DOMAIN,
        providerUrl: PROVIDER_URL,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get challenge: ${error}`);
    }

    const data = await response.json();
    
    // JustaName returns the challenge in result.data or result
    const challenge = data?.result?.data?.challenge || data?.result?.challenge || data?.challenge;
    
    if (!challenge) {
      console.error('Challenge response:', data);
      throw new Error('No challenge in response');
    }

    return challenge;
  } catch (error) {
    console.error('Error requesting SIWE challenge:', error);
    throw error;
  }
}

