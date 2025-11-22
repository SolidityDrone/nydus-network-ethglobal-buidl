/**
 * Nydus Protocol Utilities
 * Handles initialization and deposit operations
 * 
 * Uses dynamic imports for ESM-only packages
 */

import { config } from '../config';
import { logger } from '../utils/logger';

// Define NYDUS_MESSAGE (same as in frontend)
export const NYDUS_MESSAGE = "Welcome to the Nydus! \n\nThis signature on this message will be used to access the Nydus network. This signature is your access key to the network and needed for clientside proving. \nMake sure you don't pass this signature to someone else! \n\nCaution: Please make sure that the domain you are connected to is correct.";

/**
 * Compute private key (user_key) from Ethereum signature
 * Same logic as computeZkAddress but returns the private key
 */
export async function computePrivateKeyFromSignature(signature: string): Promise<bigint> {
  try {
    // Dynamic import for ESM-only package
    const aztecCrypto = await eval(`import('@aztec/foundation/crypto')`);
    const { poseidon2Hash } = aztecCrypto;

    // Convert signature hex string to Buffer (remove 0x prefix if present)
    const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
    const sigBuffer = Buffer.from(sigHex, 'hex');

    // Verify signature is 65 bytes
    if (sigBuffer.length !== 65) {
      throw new Error(`Signature must be 65 bytes, got ${sigBuffer.length}`);
    }

    // Split signature into 31, 31, 3 bytes
    const chunk1 = sigBuffer.subarray(0, 31);  // First 31 bytes
    const chunk2 = sigBuffer.subarray(31, 62); // Next 31 bytes
    const chunk3 = sigBuffer.subarray(62, 65); // Last 3 bytes

    // Convert each chunk to bigint (big-endian)
    const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
    const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
    const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));

    // Compute poseidon hash of the three chunks - this is the private key
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

    logger.debug('Private key computed from signature', {
      privateKeyHex: '0x' + privateKey.toString(16).slice(0, 16) + '...'
    });

    return privateKey;
  } catch (error) {
    logger.error('Error computing private key from signature', { error });
    throw error;
  }
}

/**
 * Generate public key from private key using Baby Jubjub curve
 */
export async function generatePublicKey(privateKey: bigint): Promise<{ x: bigint; y: bigint }> {
  try {
    // Dynamic import for ESM-only package
    const curves = await eval(`import('@noble/curves/misc.js')`);
    const { babyjubjub } = curves;

    // BASE8 coordinates (standard base point for Baby Jubjub)
    const BASE8_X = BigInt('5299619240641551281634865583518297030282874472190772894086521144482721001553');
    const BASE8_Y = BigInt('16950150798460657717958625567821834550301663161624707787222815936182638968203');

    const BASE8 = babyjubjub.Point.fromAffine({ x: BASE8_X, y: BASE8_Y });
    const publicKeyPoint = BASE8.multiply(privateKey);

    return { x: publicKeyPoint.x, y: publicKeyPoint.y };
  } catch (error) {
    logger.error('Error generating public key', { error });
    throw error;
  }
}

/**
 * Sign message with private key using ECDSA (for Nydus protocol)
 */
export async function signMessage(privateKey: string, message: string): Promise<string> {
  try {
    // Use dynamic import for viem (ESM module)
    const viemAccounts = await import('viem/accounts');
    const { privateKeyToAccount } = viemAccounts;

    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(formattedKey as `0x${string}`);

    const signature = await account.signMessage({ message });

    logger.debug('Message signed', {
      address: account.address,
      signaturePreview: signature.slice(0, 20) + '...'
    });

    return signature;
  } catch (error) {
    logger.error('Error signing message', { error });
    throw error;
  }
}

/**
 * Check if Nydus position is initialized for an address
 */
export async function isNydusInitialized(publicKeyX: bigint, publicKeyY: bigint): Promise<boolean> {
  try {
    const viem = await import('viem');
    const { createPublicClient, http } = viem;

    const client = createPublicClient({
      transport: http(config.rpcUrl),
    });

    // Read from Nydus contract (assume it has a method to check if initialized)
    // This would need the actual ABI from the contract
    logger.info('Checking Nydus initialization status', {
      contractAddress: config.nydusContractAddress,
      publicKeyX: '0x' + publicKeyX.toString(16).slice(0, 16) + '...',
      publicKeyY: '0x' + publicKeyY.toString(16).slice(0, 16) + '...',
    });

    // TODO: Implement actual contract call when ABI is available
    // For now, return false to trigger initialization
    return false;
  } catch (error) {
    logger.error('Error checking Nydus initialization', { error });
    return false;
  }
}

/**
 * Initialize Nydus position
 * This generates a proof using nydus_entry circuit and submits to contract
 */
export async function initializeNydusPosition(
  privateKey: bigint,
  publicKey: { x: bigint; y: bigint }
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    logger.info('🔄 Initializing Nydus position...');

    // Step 1: Load circuit
    const pathModule = await import('path');
    const fsModule = await import('fs');
    const circuitPath = pathModule.join(__dirname, '../../circuits/nydus_entry.json');

    if (!fsModule.existsSync(circuitPath)) {
      throw new Error(`Circuit file not found: ${circuitPath}`);
    }

    const circuit = JSON.parse(fsModule.readFileSync(circuitPath, 'utf-8'));

    // Step 2: Initialize backend
    const { UltraHonkBackend } = await import('@aztec/bb.js');
    const { Noir } = await import('@noir-lang/noir_js');

    const backend = new UltraHonkBackend(circuit.bytecode);
    const noir = new Noir(circuit);

    // Step 3: Prepare circuit inputs
    const WETH_BASE_SEPOLIA = '0x4200000000000000000000000000000000000006';

    // Double hash the private key to get a different user_key (for testing)
    const aztecCrypto = await eval(`import('@aztec/foundation/crypto')`);
    const { poseidon2Hash } = aztecCrypto;
    const doubleHashedKey = await poseidon2Hash([privateKey]);

    // Convert to bigint
    let finalUserKey: bigint;
    if (typeof doubleHashedKey === 'bigint') {
      finalUserKey = doubleHashedKey;
    } else if ('toBigInt' in doubleHashedKey && typeof (doubleHashedKey as any).toBigInt === 'function') {
      finalUserKey = (doubleHashedKey as any).toBigInt();
    } else if ('value' in doubleHashedKey) {
      finalUserKey = BigInt((doubleHashedKey as any).value);
    } else {
      finalUserKey = BigInt((doubleHashedKey as any).toString());
    }

    const inputs = {
      user_key: '0x' + finalUserKey.toString(16),
      token_address: WETH_BASE_SEPOLIA,
      amount: '0x1', // 1 wei for initialization
    };

    // @ts-ignore - Use { keccak: true } like in frontend
    const { witness } = await noir.execute(inputs, { keccak: true });

    // Step 4: Generate proof
    const proofStartTime = Date.now();
    // @ts-ignore - Use { keccak: true } for proof generation like in frontend
    const proofResult = await backend.generateProof(witness, { keccak: true });
    const proofTime = Date.now() - proofStartTime;
    logger.info(`✅ Proof generated in ${proofTime}ms`);

    // Convert proof to hex (like frontend does)
    const proofHex = Buffer.from(proofResult.proof).toString('hex');

    // Step 5: Extract public inputs from proof result (slice to 9 like frontend)
    const publicInputsArray = (proofResult.publicInputs || []).slice(0, 9);

    // Step 6: Submit to Nydus contract
    const viem = await import('viem');
    const { createWalletClient, createPublicClient, http } = viem;
    const { privateKeyToAccount } = await import('viem/accounts');
    const { baseSepolia } = await import('viem/chains');

    const masterPrivateKey = config.privateKey.startsWith('0x') ? config.privateKey : `0x${config.privateKey}`;
    const account = privateKeyToAccount(masterPrivateKey as `0x${string}`);

    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(config.rpcUrl),
    });

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(config.rpcUrl),
    });

    // Convert proof hex to bytes (like frontend: `0x${proof}`)
    const proofBytes = `0x${proofHex}`;

    // Convert public inputs to hex strings (bytes32 format) - like frontend
    const publicInputsHex = publicInputsArray.map((input: any) => {
      // Handle different input types (same as frontend)
      if (typeof input === 'string' && input.startsWith('0x')) {
        return input;
      }
      if (typeof input === 'bigint') {
        return `0x${input.toString(16).padStart(64, '0')}`;
      }
      // Convert to hex string
      const hex = BigInt(input).toString(16);
      return `0x${hex.padStart(64, '0')}`;
    });

    // Validate contract address
    if (!config.nydusContractAddress || config.nydusContractAddress === '') {
      throw new Error('NYDUS_CONTRACT_ADDRESS is not set! Please add it to your .env file. It should be: 0xC25bf07DD0f9ebBB8A6B622b379C4b5081c26B0A');
    }

    logger.info(`🔄 Submitting to Nydus at ${config.nydusContractAddress}`);
    logger.info(`   Proof size: ${proofBytes.length} chars (${(proofBytes.length / 2 / 1024).toFixed(2)} KB)`);
    logger.info(`   Public inputs count: ${publicInputsHex.length}`);

    // Load Nydus ABI
    const abiPath = pathModule.join(__dirname, '../lib/Nydus.abi.json');
    const nydusAbi = JSON.parse(fsModule.readFileSync(abiPath, 'utf-8'));

    // Convert public inputs to bytes32 array (like frontend)
    const publicInputsBytes32 = publicInputsHex.map((input: string) => {
      // Ensure it's a valid bytes32 (64 hex chars + 0x = 66 chars)
      const hex = input.startsWith('0x') ? input.slice(2) : input;
      return `0x${hex.padStart(64, '0')}` as `0x${string}`;
    });

    // Submit transaction to Nydus contract
    try {
      const txHash = await walletClient.writeContract({
        address: config.nydusContractAddress as `0x${string}`,
        abi: nydusAbi,
        functionName: 'initCommit',
        args: [proofBytes as `0x${string}`, publicInputsBytes32 as readonly `0x${string}`[]],
        gas: 5_000_000n, // Explicit gas limit: 5M gas
      });

      logger.info(`✅ Tx submitted: ${txHash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'success') {
        logger.info(`✅ Nydus initialized! Block: ${receipt.blockNumber}`);
      } else {
        throw new Error('Transaction reverted');
      }

      return {
        success: true,
        txHash,
      };
    } catch (txError: any) {
      // Log detailed error with all available info
      logger.error('❌ Transaction failed:', {
        message: txError.message,
        shortMessage: txError.shortMessage,
        cause: txError.cause?.message || txError.cause,
        details: txError.details,
        metaMessages: txError.metaMessages,
        data: txError.cause?.data,
        reason: txError.cause?.reason,
      });

      // Try to get revert reason from receipt if hash exists
      if (txError.transactionHash) {
        try {
          const receipt = await publicClient.getTransactionReceipt({
            hash: txError.transactionHash
          });
          logger.error('Transaction receipt:', {
            status: receipt.status,
            gasUsed: receipt.gasUsed?.toString(),
            logs: receipt.logs?.length || 0,
          });
        } catch (receiptError) {
          logger.error('Could not fetch receipt:', receiptError);
        }
      }

      throw txError;
    }

  } catch (error) {
    logger.error('❌ Error initializing Nydus position', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create deposit proof and submit to Nydus
 * This is called when an ERC20 transfer is detected
 */
export async function depositToNydus(
  privateKey: bigint,
  tokenAddress: string,
  amount: bigint,
  fromAddress: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    logger.info('Creating Nydus deposit...', {
      tokenAddress,
      amount: amount.toString(),
      fromAddress,
    });

    // TODO: Implement proof generation using nydus_deposit circuit
    // This requires:
    // 1. Load nydus_deposit.json circuit
    // 2. Prepare inputs (user_key, token_address, amount, etc.)
    // 3. Generate proof with Noir + UltraHonkBackend
    // 4. Submit to Nydus contract

    logger.warn('Nydus deposit not yet fully implemented - skipping for now');

    return {
      success: true,
      txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
  } catch (error) {
    logger.error('Error creating Nydus deposit', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

