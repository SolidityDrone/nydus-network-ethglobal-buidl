/**
 * JustaName SDK Client-Side Service
 * Handles ENS subdomain operations directly in the frontend
 */

import { JustaName } from '@justaname.id/sdk';
import type { ChainId } from '@justaname.id/sdk';
import { privateKeyToAccount } from 'viem/accounts';

const ENS_DOMAIN = process.env.NEXT_PUBLIC_ENS_DOMAIN || 'nydusns.eth';
const CHAIN_ID = 11155111; // Sepolia
const PROVIDER_URL = process.env.NEXT_PUBLIC_PROVIDER_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const JUSTANAME_API_KEY = process.env.NEXT_PUBLIC_JUSTANAME_API_KEY || '';
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

// IMPORTANT: This private key must be the owner of the ENS domain
// In production, this should NEVER be exposed in the frontend
// This is only for demo/testing purposes
const DOMAIN_OWNER_PRIVATE_KEY = process.env.NEXT_PUBLIC_DOMAIN_OWNER_PRIVATE_KEY || '';

let justanameInstance: JustaName | null = null;

/**
 * Initialize JustaName SDK
 */
async function getJustaNameInstance(): Promise<JustaName> {
  if (justanameInstance) {
    return justanameInstance;
  }

  const chainId = CHAIN_ID as ChainId;

  justanameInstance = JustaName.init({
    networks: [
      {
        chainId: chainId,
        providerUrl: PROVIDER_URL,
      },
    ],
    ensDomains: [
      {
        chainId: chainId,
        domain: ENS_DOMAIN,
      },
    ] as any,
    config: {
      apiKey: JUSTANAME_API_KEY,
    } as any,
  });

  return justanameInstance;
}

/**
 * Derive Ethereum address from a parameter (for deterministic key generation)
 */
function deriveKeyFromParameter(parameter: string): string {
  // Simple derivation - in production you'd want a more secure method
  // This matches the backend's deriveKeyFromParameter function
  const hash = Array.from(parameter)
    .reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
  
  // Create a deterministic private key from the hash
  const privateKey = '0x' + hash.toString(16).padStart(64, '0').slice(0, 64);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return account.address;
}

/**
 * Register a new subname
 */
export async function registerSubnameWithSDK(
  subname: string,
  description?: string,
  privateKey?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    if (!JUSTANAME_API_KEY) {
      throw new Error('JustaName API key not configured. Please set NEXT_PUBLIC_JUSTANAME_API_KEY');
    }

    const justaname = await getJustaNameInstance();
    const chainId = CHAIN_ID as ChainId;

    // Derive address from subname for deterministic ownership
    const derivedAddress = deriveKeyFromParameter(subname);

    // If a private key is provided, use it; otherwise use a derived one
    const accountPrivateKey = privateKey || ('0x' + subname.padStart(64, '0').slice(0, 64));
    const account = privateKeyToAccount(accountPrivateKey as `0x${string}`);

    // Request SIWE challenge
    const challengeResponse = await justaname.siwe.requestChallenge({
      address: account.address,
      chainId: chainId,
      origin: ORIGIN,
      domain: ENS_DOMAIN,
    });

    if (!challengeResponse.challenge) {
      throw new Error('Failed to get SIWE challenge');
    }

    // Sign the challenge
    const signature = await account.signMessage({
      message: challengeResponse.challenge,
    });

    // Register the subname
    const ETH_COIN_TYPE = 60;
    const result = await justaname.subnames.addSubname(
      {
        username: subname,
        ensDomain: ENS_DOMAIN,
        chainId: chainId,
        apiKey: JUSTANAME_API_KEY,
        addresses: {
          [ETH_COIN_TYPE]: derivedAddress,
        },
        text: {
          description: description || '',
          'com.twitter': 'nydus',
          'com.github': 'nydus',
          url: 'https://nydus.app',
        },
      },
      {
        xMessage: challengeResponse.challenge,
        xAddress: account.address,
        xSignature: signature,
      }
    );

    return {
      success: true,
      data: {
        message: 'Registration completed successfully!',
        result,
        subname: `${subname}.${ENS_DOMAIN}`,
        address: derivedAddress,
      },
    };
  } catch (error) {
    console.error('Error registering subname:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Update an existing subname
 */
export async function updateSubnameWithSDK(
  subname: string,
  description?: string,
  privateKey?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    if (!JUSTANAME_API_KEY) {
      throw new Error('JustaName API key not configured. Please set NEXT_PUBLIC_JUSTANAME_API_KEY');
    }

    const justaname = await getJustaNameInstance();
    const chainId = CHAIN_ID as ChainId;

    // Use provided private key or derive one
    const accountPrivateKey = privateKey || ('0x' + subname.padStart(64, '0').slice(0, 64));
    const account = privateKeyToAccount(accountPrivateKey as `0x${string}`);

    // Request SIWE challenge
    const challengeResponse = await justaname.siwe.requestChallenge({
      address: account.address,
      chainId: chainId,
      origin: ORIGIN,
      domain: ENS_DOMAIN,
    });

    if (!challengeResponse.challenge) {
      throw new Error('Failed to get SIWE challenge');
    }

    // Sign the challenge
    const signature = await account.signMessage({
      message: challengeResponse.challenge,
    });

    // Update the subname
    const result = await justaname.subnames.updateSubname(
      {
        username: subname,
        ensDomain: ENS_DOMAIN,
        chainId: chainId,
        text: {
          description: description || '',
          'com.twitter': 'nydus',
          'com.github': 'nydus',
          url: 'https://nydus.app',
        },
      },
      {
        xMessage: challengeResponse.challenge,
        xAddress: account.address,
        xSignature: signature,
      }
    );

    return {
      success: true,
      data: {
        message: 'Update completed successfully!',
        result,
        subname: `${subname}.${ENS_DOMAIN}`,
      },
    };
  } catch (error) {
    console.error('Error updating subname:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Check if a subname exists
 */
export async function checkSubnameExists(subname: string): Promise<boolean> {
  try {
    const justaname = await getJustaNameInstance();
    const chainId = CHAIN_ID as ChainId;

    const result = await justaname.subnames.getSubname({
      subname: subname,
      chainId: chainId,
    });

    return !!result;
  } catch (error: any) {
    if (error.message && error.message.includes('not found')) {
      return false;
    }
    console.error('Error checking subname existence:', error);
    return false;
  }
}

/**
 * Get subname details
 */
export async function getSubnameDetails(subname: string): Promise<any> {
  try {
    const justaname = await getJustaNameInstance();
    const chainId = CHAIN_ID as ChainId;

    const result = await justaname.subnames.getSubname({
      subname: subname,
      chainId: chainId,
    });

    return result;
  } catch (error) {
    console.error('Error getting subname details:', error);
    return null;
  }
}

