import { keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config';
import { logger } from './logger';

/**
 * Derive an Ethereum private key from a parameter using the master private key
 * Returns the derived private key as a hex string
 */
export function derivePrivateKeyFromParameter(parameter: string): string {
  const privateKey = config.privateKey;
  
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }

  // Ensure private key has 0x prefix
  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  // Create a deterministic derived key by hashing the original key with the parameter
  const derivationData = encodePacked(
    ['bytes32', 'string'],
    [formattedPrivateKey as `0x${string}`, parameter]
  );

  const derivedKey = keccak256(derivationData);
  
  logger.debug(`Derived private key for parameter "${parameter}"`);
  
  return derivedKey;
}

/**
 * Derive an Ethereum address from a parameter using the master private key
 */
export function deriveKeyFromParameter(parameter: string): string {
  const derivedKey = derivePrivateKeyFromParameter(parameter);

  // Create account from derived key and return its address
  const account = privateKeyToAccount(derivedKey as `0x${string}`);
  
  logger.debug(`Derived address for parameter "${parameter}": ${account.address}`);
  
  return account.address;
}

