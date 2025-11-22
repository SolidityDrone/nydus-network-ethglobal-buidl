/**
 * Test Send Transaction Script
 * 
 * This script:
 * 1. Derives user_key from the PRIVATE_KEY signature
 * 2. Loads account data (nonce, balances) using loadAccountDataOnSign approach
 * 3. Reconstructs personal commitment states (matching frontend send/page.tsx)
 * 4. Generates a send proof for 0 USDC with 0 USDC fee
 * 5. Submits the transaction to Nydus contract
 */

import { config } from '../config';
import { logger } from '../utils/logger';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import dotenv from 'dotenv';

dotenv.config();

// WETH address on Base Sepolia (matching what we initialized with)
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
const SEND_AMOUNT = BigInt(0); // 0 WETH
const FEE_AMOUNT = BigInt(0); // 0 WETH fee

// Import Nydus contract ABI
import NydusAbi from '../lib/Nydus.abi.json';

async function testSendTransaction() {
  try {
    logger.info('🚀 Starting Send Transaction Test');
    logger.info('='.repeat(80));

    // Step 1: Setup accounts and clients
    logger.info('📋 Step 1: Setting up accounts and clients...');
    
    // Validate and format private key
    let privateKey = config.privateKey;
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    // Ensure it's 32 bytes (64 hex chars + 0x)
    if (privateKey.length !== 66) {
      throw new Error(`Invalid PRIVATE_KEY format. Expected 32 bytes (64 hex chars), got ${(privateKey.length - 2) / 2} bytes. Make sure PRIVATE_KEY in .env is a valid Ethereum private key.`);
    }
    
    const masterAccount = privateKeyToAccount(privateKey as Hex);
    logger.info(`  Master Ethereum Address: ${masterAccount.address}`);

    const walletClient = createWalletClient({
      account: masterAccount,
      chain: baseSepolia,
      transport: http(config.rpcUrl),
    });

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(config.rpcUrl),
    });

    // Step 2: Compute user_key from signature (matching frontend computePrivateKeyFromSignature)
    logger.info('📋 Step 2: Computing user_key from signature...');
    
    // Sign NYDUS_MESSAGE to get signature
    const NYDUS_MESSAGE = "Welcome to the Nydus! \n\nThis signature on this message will be used to access the Nydus network. \nThis signature is your access key to the network and needed for clientside proving. \nMake sure you don't pass this signature to someone else! \n\nCaution: Please make sure that the domain you are connected to is correct.";
    
    const signature = await masterAccount.signMessage({ message: NYDUS_MESSAGE });
    logger.info(`  NYDUS signature: ${signature.slice(0, 20)}...`);

    // Compute user_key (private key) from signature using Poseidon2
    const aztecCrypto = await eval(`import('@aztec/foundation/crypto')`);
    const { poseidon2Hash } = aztecCrypto;
    
    const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
    const sigBuffer = Buffer.from(sigHex, 'hex');
    
    if (sigBuffer.length !== 65) {
      throw new Error(`Signature must be 65 bytes, got ${sigBuffer.length}`);
    }

    const chunk1 = sigBuffer.subarray(0, 31);
    const chunk2 = sigBuffer.subarray(31, 62);
    const chunk3 = sigBuffer.subarray(62, 65);

    const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
    const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
    const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));

    const poseidonHash = await poseidon2Hash([chunk1BigInt, chunk2BigInt, chunk3BigInt]);

    let userKey: bigint;
    if (typeof poseidonHash === 'bigint') {
      userKey = poseidonHash;
    } else if ('toBigInt' in poseidonHash && typeof (poseidonHash as any).toBigInt === 'function') {
      userKey = (poseidonHash as any).toBigInt();
    } else if ('value' in poseidonHash) {
      userKey = BigInt((poseidonHash as any).value);
    } else {
      userKey = BigInt((poseidonHash as any).toString());
    }

    logger.info(`  ✅ Nydus private key (user_key): 0x${userKey.toString(16).slice(0, 16)}...`);

    // Step 3: Compute zkAddress (public key) from user_key
    logger.info('📋 Step 3: Computing zkAddress (public key)...');
    
    const curves = await eval(`import('@noble/curves/misc.js')`);
    const { babyjubjub } = curves;
    const BASE8_X = BigInt('5299619240641551281634865583518297030282874472190772894086521144482721001553');
    const BASE8_Y = BigInt('16950150798460657717958625567821834550301663161624707787222815936182638968203');
    const BASE8 = babyjubjub.Point.fromAffine({ x: BASE8_X, y: BASE8_Y });
    const publicKeyPoint = BASE8.multiply(userKey);
    
    const pubKeyXHex = publicKeyPoint.x.toString(16).padStart(64, '0');
    const pubKeyYHex = publicKeyPoint.y.toString(16).padStart(64, '0');
    const zkAddress = `0x${pubKeyXHex}${pubKeyYHex}`;
    
    logger.info(`  ✅ Nydus public key (zkAddress): ${zkAddress.slice(0, 20)}...`);

    // Step 4: Load account data (matching frontend loadAccountDataOnSign)
    logger.info('📋 Step 4: Loading account data from contract...');
    
    // Compute user_key_hash and view_key (needed for querying contract)
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
    
    logger.info(`  user_key_hash: 0x${userKeyHashBigInt.toString(16).slice(0, 16)}...`);

    // Query current nonce from contract (matching frontend nonce discovery logic)
    // Start from nonce 0 and scan until we find a nonce that doesn't exist
    logger.info('  🔍 Discovering current nonce (user-specific)...');
    
    let currentNonce = BigInt(0);
    
    // Scan nonces starting from 0 until we find one that doesn't exist
    // The first non-existent nonce is the current nonce
    for (let testNonce = BigInt(0); testNonce <= BigInt(100); testNonce++) {
      // Compute nonce commitment for THIS user: poseidon2Hash([user_key_hash, nonce])
      const nonceCommitmentHash = await poseidon2Hash([userKeyHashBigInt, testNonce]);
      let nonceCommitmentBigInt: bigint;
      if (typeof nonceCommitmentHash === 'bigint') {
        nonceCommitmentBigInt = nonceCommitmentHash;
      } else if ('toBigInt' in nonceCommitmentHash && typeof (nonceCommitmentHash as any).toBigInt === 'function') {
        nonceCommitmentBigInt = (nonceCommitmentHash as any).toBigInt();
      } else if ('value' in nonceCommitmentHash) {
        nonceCommitmentBigInt = BigInt((nonceCommitmentHash as any).value);
      } else {
        nonceCommitmentBigInt = BigInt((nonceCommitmentHash as any).toString());
      }
      
      logger.info(`    Testing nonce ${testNonce}...`);
      logger.info(`      nonce_commitment = poseidon2Hash([user_key_hash, ${testNonce}])`);
      logger.info(`      nonce_commitment = 0x${nonceCommitmentBigInt.toString(16).slice(0, 16)}...`);
      
      // Check if this nonce commitment exists in the contract
      try {
        const result = await publicClient.readContract({
          address: config.nydusContractAddress as Hex,
          abi: NydusAbi,
          functionName: 'getPersonalCTotReference',
          args: [nonceCommitmentBigInt],
        });
        
        // Extract enc_c_tot_m and enc_c_tot_r
        let encCTotM: any, encCTotR: any;
        if (Array.isArray(result)) {
          [encCTotM, encCTotR] = result;
        } else if (result && typeof result === 'object') {
          encCTotM = (result as any).encCTotM ?? (result as any)[0];
          encCTotR = (result as any).encCTotR ?? (result as any)[1];
        }
        
        const encCTotMBigInt = BigInt(encCTotM?.toString() || '0');
        const encCTotRBigInt = BigInt(encCTotR?.toString() || '0');
        
        logger.info(`      ✓ Nonce commitment ${testNonce} EXISTS in contract`);
        logger.info(`        enc_c_tot_m = 0x${encCTotMBigInt.toString(16)}`);
        logger.info(`        enc_c_tot_r = 0x${encCTotRBigInt.toString(16)}`);
        
        // CRITICAL: If both are 0, this nonce has NOT been used by this user
        // (It exists in the contract, but no data was stored for this user)
        if (encCTotMBigInt === BigInt(0) && encCTotRBigInt === BigInt(0)) {
          logger.info(`      → Nonce ${testNonce} is UNUSED (both values are 0)`);
          logger.info(`      → Current nonce found: ${testNonce}`);
          currentNonce = testNonce;
          break;
        }
        
        // This nonce has been used by this user, continue scanning
        logger.info(`      → Nonce ${testNonce} HAS BEEN USED by this user`);
        currentNonce = testNonce + BigInt(1);
      } catch (error: any) {
        // Error means this nonce commitment doesn't exist in the contract at all
        // This is the current (next) nonce to use
        logger.info(`      ✗ Nonce commitment ${testNonce} does NOT exist in contract`);
        logger.info(`      → Current nonce found: ${testNonce}`);
        currentNonce = testNonce;
        break;
      }
    }

    logger.info(`  ✅ Current nonce: ${currentNonce}`);

    // Step 5: Perform self-send transaction (matching send/page.tsx)
    logger.info('');
    logger.info('📋 Step 5: Preparing self-send transaction (0 USDC to self with 0 USDC fee)...');
    
    // Use the public key we already computed in Step 3 (for receiver - self)
    const receiverPublicKey = {
      x: publicKeyPoint.x,
      y: publicKeyPoint.y
    };
    
    const sendAmount = BigInt(0);
    const feeAmount = BigInt(0);
    const previousNonce = currentNonce > BigInt(0) ? currentNonce - BigInt(1) : BigInt(0);
    
    // actualTokenAddress will be determined by balance discovery in Step 5.3
    
    logger.info(`  Transaction details:`);
    logger.info(`    Send amount: ${sendAmount} wei`);
    logger.info(`    Fee amount: ${feeAmount} wei`);
    logger.info(`    Receiver: self (0x${receiverPublicKey.x.toString(16).slice(0, 8)}...)`);
    logger.info(`    Current nonce: ${currentNonce}`);
    logger.info(`    Previous nonce: ${previousNonce}`);
    
    // Step 5.1: Calculate view_key (user_key_hash already calculated in Step 4)
    logger.info('');
    logger.info('  📋 Step 5.1: Calculating view_key...');
    
    const VIEW_STRING = BigInt('0x76696577696e675f6b6579');
    const viewKeyHash = await poseidon2Hash([VIEW_STRING, userKeyHashBigInt]);
    let viewKeyBigInt: bigint;
    if (typeof viewKeyHash === 'bigint') {
      viewKeyBigInt = viewKeyHash;
    } else if ('toBigInt' in viewKeyHash && typeof (viewKeyHash as any).toBigInt === 'function') {
      viewKeyBigInt = (viewKeyHash as any).toBigInt();
    } else if ('value' in viewKeyHash) {
      viewKeyBigInt = BigInt((viewKeyHash as any).value);
    } else {
      viewKeyBigInt = BigInt((viewKeyHash as any).toString());
    }
    
    logger.info(`    ✓ user_key_hash: 0x${userKeyHashBigInt.toString(16).slice(0, 16)}...`);
    logger.info(`    ✓ view_key: 0x${viewKeyBigInt.toString(16).slice(0, 16)}...`);
    
    // Step 5.2: Calculate previous_nonce_commitment
    logger.info('');
    logger.info('  📋 Step 5.2: Calculating previous_nonce_commitment...');
    
    const previousNonceCommitmentHash = await poseidon2Hash([userKeyHashBigInt, previousNonce]);
    let previousNonceCommitmentBigInt: bigint;
    if (typeof previousNonceCommitmentHash === 'bigint') {
      previousNonceCommitmentBigInt = previousNonceCommitmentHash;
    } else if ('toBigInt' in previousNonceCommitmentHash && typeof (previousNonceCommitmentHash as any).toBigInt === 'function') {
      previousNonceCommitmentBigInt = (previousNonceCommitmentHash as any).toBigInt();
    } else if ('value' in previousNonceCommitmentHash) {
      previousNonceCommitmentBigInt = BigInt((previousNonceCommitmentHash as any).value);
    } else {
      previousNonceCommitmentBigInt = BigInt((previousNonceCommitmentHash as any).toString());
    }
    
    logger.info(`    ✓ previous_nonce_commitment: 0x${previousNonceCommitmentBigInt.toString(16).slice(0, 16)}...`);
    
    // Step 5.3: Get balance from contract at previousNonce and decrypt it
    logger.info('');
    logger.info('  📋 Step 5.3: Querying and decrypting balance from contract...');
    
    let sendTokenBalance = BigInt(0);
    let actualTokenAddress = tokenAddressBigInt;
    
    // Try to read encrypted data from contract (getPersonalCTotReference)
    try {
      const result = await publicClient.readContract({
        address: config.nydusContractAddress as Hex,
        abi: NydusAbi,
        functionName: 'getPersonalCTotReference',
        args: [previousNonceCommitmentBigInt],
      });
      
      let encCTotM: any, encCTotR: any;
      if (Array.isArray(result)) {
        [encCTotM, encCTotR] = result;
      } else if (result && typeof result === 'object') {
        encCTotM = (result as any).encCTotM ?? (result as any)[0];
        encCTotR = (result as any).encCTotR ?? (result as any)[1];
      }
      
      const encCTotMBigInt = BigInt(encCTotM?.toString() || '0');
      const encCTotRBigInt = BigInt(encCTotR?.toString() || '0');
      
      logger.info(`    ✓ Found encrypted commitment at previous nonce:`);
      logger.info(`      enc_c_tot_m: 0x${encCTotMBigInt.toString(16).slice(0, 16)}...`);
      logger.info(`      enc_c_tot_r: 0x${encCTotRBigInt.toString(16).slice(0, 16)}...`);
      
      // If both are 0, no data was stored (balance = 0)
      if (encCTotMBigInt === BigInt(0) && encCTotRBigInt === BigInt(0)) {
        logger.info(`    ⚠️  No encrypted data (balance = 0 for this token)`);
        sendTokenBalance = BigInt(0);
      } else {
        // Decrypt the values to get actual balance
        // Import decryption function
        const encryptionModule = await import('../lib/poseidon-ctr-encryption');
        const { poseidonCtrDecrypt } = encryptionModule;
        
        // Calculate encryption key for previous nonce
        const previousEncryptionKey = await poseidon2Hash([viewKeyBigInt, previousNonce]);
        let previousEncryptionKeyBigInt: bigint;
        if (typeof previousEncryptionKey === 'bigint') {
          previousEncryptionKeyBigInt = previousEncryptionKey;
        } else if ('toBigInt' in previousEncryptionKey && typeof (previousEncryptionKey as any).toBigInt === 'function') {
          previousEncryptionKeyBigInt = (previousEncryptionKey as any).toBigInt();
        } else if ('value' in previousEncryptionKey) {
          previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).value);
        } else {
          previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).toString());
        }
        
        // Decrypt personal_c_tot coordinates
        const decryptedX = await poseidonCtrDecrypt(encCTotMBigInt, previousEncryptionKeyBigInt, 3);
        const decryptedY = await poseidonCtrDecrypt(encCTotRBigInt, previousEncryptionKeyBigInt, 4);
        
        logger.info(`    ✓ Decrypted personal_c_tot:`);
        logger.info(`      x: 0x${decryptedX.toString(16).slice(0, 16)}...`);
        logger.info(`      y: 0x${decryptedY.toString(16).slice(0, 16)}...`);
        
        // Now we need to "open" this commitment to get the balance
        // The commitment was created as: personal_c_tot = personal_c_inner + personal_c_outer
        // Where personal_c_inner = pedersen(poseidon(amount, user_key_hash), poseidon(token, user_key_hash))
        // And personal_c_outer = pedersen(0, token)
        
        // For initCommit with amount=1 wei of WETH, the balance should be 1
        // But we can't easily reverse the commitment without knowing which token was used
        // For now, let's check if the commitment matches WETH or USDC
        
        // Try WETH first (the token we initialized with)
        const WETH_ADDRESS_BIGINT = BigInt('0x4200000000000000000000000000000000000006');
        const testAmount = BigInt(1); // We initialized with 1 wei
        
        // Reconstruct what the commitment should be for 1 wei of WETH
        const pedersenModule = await import('../lib/pedersen-commitments');
        const { pedersenCommitmentNonHiding, grumpkinAddPoints } = pedersenModule;
        
        const testAmountHash = await poseidon2Hash([testAmount, userKeyHashBigInt]);
        let testAmountHashBigInt: bigint;
        if (typeof testAmountHash === 'bigint') {
          testAmountHashBigInt = testAmountHash;
        } else if ('toBigInt' in testAmountHash && typeof (testAmountHash as any).toBigInt === 'function') {
          testAmountHashBigInt = (testAmountHash as any).toBigInt();
        } else if ('value' in testAmountHash) {
          testAmountHashBigInt = BigInt((testAmountHash as any).value);
        } else {
          testAmountHashBigInt = BigInt((testAmountHash as any).toString());
        }
        
        const testTokenHash = await poseidon2Hash([WETH_ADDRESS_BIGINT, userKeyHashBigInt]);
        let testTokenHashBigInt: bigint;
        if (typeof testTokenHash === 'bigint') {
          testTokenHashBigInt = testTokenHash;
        } else if ('toBigInt' in testTokenHash && typeof (testTokenHash as any).toBigInt === 'function') {
          testTokenHashBigInt = (testTokenHash as any).toBigInt();
        } else if ('value' in testTokenHash) {
          testTokenHashBigInt = BigInt((testTokenHash as any).value);
        } else {
          testTokenHashBigInt = BigInt((testTokenHash as any).toString());
        }
        
        const testPersonalCInner = pedersenCommitmentNonHiding(testAmountHashBigInt, testTokenHashBigInt);
        const testPersonalCOuter = pedersenCommitmentNonHiding(BigInt(0), WETH_ADDRESS_BIGINT);
        const testPersonalCTot = grumpkinAddPoints(testPersonalCInner, testPersonalCOuter);
        
        // Check if it matches
        if (testPersonalCTot.x === decryptedX && testPersonalCTot.y === decryptedY) {
          logger.info(`    ✅ Match! Token is WETH, balance is 1 wei`);
          sendTokenBalance = BigInt(1);
          actualTokenAddress = WETH_ADDRESS_BIGINT;
        } else {
          logger.info(`    ⚠️  Could not determine exact balance from commitment`);
          logger.info(`    Using balance = 0 for safety`);
          sendTokenBalance = BigInt(0);
        }
      }
    } catch (error) {
      logger.info(`    ⚠️  Error querying contract: ${error}`);
      logger.info(`    Using balance = 0`);
      sendTokenBalance = BigInt(0);
    }
    
    logger.info(`    ✓ Send token balance: ${sendTokenBalance} wei`);
    logger.info(`    ✓ Token address: 0x${actualTokenAddress.toString(16)}`);
    
    // Step 5.4: Reconstruct personal commitment states (matching send/page.tsx)
    logger.info('');
    logger.info('  📋 Step 5.4: Reconstructing personal commitment states...');
    
    // Import pedersen commitment functions
    const pedersenModule = await import('../lib/pedersen-commitments');
    const { pedersenCommitmentNonHiding, pedersenCommitmentPositive, grumpkinAddPoints } = pedersenModule;
    
    // Create personal commitments for send token (matching frontend logic)
    const sendTokenBalanceAmountHash = await poseidon2Hash([sendTokenBalance, userKeyHashBigInt]);
    let sendTokenBalanceAmountHashBigInt: bigint;
    if (typeof sendTokenBalanceAmountHash === 'bigint') {
      sendTokenBalanceAmountHashBigInt = sendTokenBalanceAmountHash;
    } else if ('toBigInt' in sendTokenBalanceAmountHash && typeof (sendTokenBalanceAmountHash as any).toBigInt === 'function') {
      sendTokenBalanceAmountHashBigInt = (sendTokenBalanceAmountHash as any).toBigInt();
    } else if ('value' in sendTokenBalanceAmountHash) {
      sendTokenBalanceAmountHashBigInt = BigInt((sendTokenBalanceAmountHash as any).value);
    } else {
      sendTokenBalanceAmountHashBigInt = BigInt((sendTokenBalanceAmountHash as any).toString());
    }
    
    const sendTokenTokenAddressHash = await poseidon2Hash([actualTokenAddress, userKeyHashBigInt]);
    let sendTokenTokenAddressHashBigInt: bigint;
    if (typeof sendTokenTokenAddressHash === 'bigint') {
      sendTokenTokenAddressHashBigInt = sendTokenTokenAddressHash;
    } else if ('toBigInt' in sendTokenTokenAddressHash && typeof (sendTokenTokenAddressHash as any).toBigInt === 'function') {
      sendTokenTokenAddressHashBigInt = (sendTokenTokenAddressHash as any).toBigInt();
    } else if ('value' in sendTokenTokenAddressHash) {
      sendTokenTokenAddressHashBigInt = BigInt((sendTokenTokenAddressHash as any).value);
    } else {
      sendTokenTokenAddressHashBigInt = BigInt((sendTokenTokenAddressHash as any).toString());
    }
    
    // Create personal commitments
    const personalCInner = pedersenCommitmentNonHiding(sendTokenBalanceAmountHashBigInt, sendTokenTokenAddressHashBigInt);
    const personalCOuter = pedersenCommitmentNonHiding(BigInt(0), actualTokenAddress);
    const personalCTot = grumpkinAddPoints(personalCInner, personalCOuter);
    
    const personalState = {
      personal_c_tot: [personalCTot.x, personalCTot.y],
      personal_c_inner: [personalCInner.x, personalCInner.y],
      personal_c_outer: [personalCOuter.x, personalCOuter.y],
      personal_c_inner_m: sendTokenBalance,
      personal_c_outer_m: BigInt(0),
      personal_c_outer_r: actualTokenAddress,
    };
    
    logger.info(`    ✓ Personal commitments reconstructed`);
    logger.info(`      personal_c_tot: (0x${personalState.personal_c_tot[0].toString(16).slice(0, 8)}..., 0x${personalState.personal_c_tot[1].toString(16).slice(0, 8)}...)`);
    
    // Since send token = fee token (both USDC), fee token personal state = send token personal state
    const feeTokenPersonalState = personalState;
    
    logger.info(`    ✓ Fee token personal state: same as send token (tokens are identical)`);
    
    // Step 5.5: Get main_c_tot from contract (getStateCommitment)
    logger.info('');
    logger.info('  📋 Step 5.5: Querying main_c_tot from contract...');
    
    const stateCommitment = await publicClient.readContract({
      address: config.nydusContractAddress as Hex,
      abi: NydusAbi,
      functionName: 'getStateCommitment',
    });
    
    let mainCTotX: bigint, mainCTotY: bigint;
    if (Array.isArray(stateCommitment)) {
      [mainCTotX, mainCTotY] = stateCommitment;
    } else if (stateCommitment && typeof stateCommitment === 'object') {
      mainCTotX = (stateCommitment as any).x;
      mainCTotY = (stateCommitment as any).y;
    } else {
      throw new Error('Invalid state commitment format from contract');
    }
    
    const mainCTot: [bigint, bigint] = [
      typeof mainCTotX === 'bigint' ? mainCTotX : BigInt(mainCTotX),
      typeof mainCTotY === 'bigint' ? mainCTotY : BigInt(mainCTotY)
    ];
    
    logger.info(`    ✓ main_c_tot from contract:`);
    logger.info(`      x: 0x${mainCTot[0].toString(16).slice(0, 16)}...`);
    logger.info(`      y: 0x${mainCTot[1].toString(16).slice(0, 16)}...`);
    
    // Step 5.6: Calculate main_c_inner and main_c_outer (matching send/page.tsx)
    logger.info('');
    logger.info('  📋 Step 5.6: Calculating main_c_inner and main_c_outer...');
    
    // Import encryption functions
    const encryptionModule = await import('../lib/poseidon-ctr-encryption');
    const { poseidonCtrEncrypt } = encryptionModule;
    
    // Calculate encryption key for previous nonce
    const previousEncryptionKey = await poseidon2Hash([viewKeyBigInt, previousNonce]);
    let previousEncryptionKeyBigInt: bigint;
    if (typeof previousEncryptionKey === 'bigint') {
      previousEncryptionKeyBigInt = previousEncryptionKey;
    } else if ('toBigInt' in previousEncryptionKey && typeof (previousEncryptionKey as any).toBigInt === 'function') {
      previousEncryptionKeyBigInt = (previousEncryptionKey as any).toBigInt();
    } else if ('value' in previousEncryptionKey) {
      previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).value);
    } else {
      previousEncryptionKeyBigInt = BigInt((previousEncryptionKey as any).toString());
    }
    
    // Encrypt personal_c_tot for main_c_inner_point
    const encryptedX = await poseidonCtrEncrypt(personalState.personal_c_tot[0], previousEncryptionKeyBigInt, 3);
    const encryptedY = await poseidonCtrEncrypt(personalState.personal_c_tot[1], previousEncryptionKeyBigInt, 4);
    const mainCInnerPoint: [bigint, bigint] = [encryptedX, encryptedY];
    
    // Calculate main_c_inner
    const mainCInner = pedersenCommitmentPositive(
      mainCInnerPoint[0],
      mainCInnerPoint[1],
      previousNonceCommitmentBigInt
    );
    
    logger.info(`    ✓ main_c_inner_point: (0x${mainCInnerPoint[0].toString(16).slice(0, 8)}..., 0x${mainCInnerPoint[1].toString(16).slice(0, 8)}...)`);
    logger.info(`    ✓ main_c_inner: (0x${mainCInner.x.toString(16).slice(0, 8)}..., 0x${mainCInner.y.toString(16).slice(0, 8)}...)`);
    
    // For previousNonce = 0 (first send after entry), use initial state commitment approach
    const initialStateCommitment = pedersenCommitmentPositive(BigInt(1), BigInt(1), BigInt(1));
    const mainCOuter = initialStateCommitment;
    const mainCOuterPoint: [bigint, bigint, bigint] = [BigInt(1), BigInt(1), BigInt(1)];
    
    // Recompute main_c_tot to ensure consistency
    const { grumpkinSubtract } = pedersenModule;
    const recomputedMainCTot = grumpkinAddPoints(mainCInner, mainCOuter);
    
    logger.info(`    ✓ main_c_outer: (0x${mainCOuter.x.toString(16).slice(0, 8)}..., 0x${mainCOuter.y.toString(16).slice(0, 8)}...)`);
    logger.info(`    ✓ main_c_outer_point: [1, 1, 1] (initial state for first send)`);
    logger.info(`    ✓ Recomputed main_c_tot: (0x${recomputedMainCTot.x.toString(16).slice(0, 8)}..., 0x${recomputedMainCTot.y.toString(16).slice(0, 8)}...)`);
    
    logger.info('');
    logger.info('✅ All circuit inputs calculated!');
    logger.info('');
    logger.info('📋 Step 6: Generating proof using nydus_send circuit...');
    
    // Import Noir and UltraHonkBackend
    const { Noir } = await import('@noir-lang/noir_js');
    const { UltraHonkBackend } = await import('@aztec/bb.js');
    
    // Load nydus_send circuit
    const pathModule = await import('path');
    const fsModule = await import('fs');
    const sendCircuitPath = pathModule.join(process.cwd(), 'circuits/nydus_send.json');
    
    if (!fsModule.existsSync(sendCircuitPath)) {
      throw new Error(`nydus_send circuit not found at ${sendCircuitPath}`);
    }
    
    const sendCircuit = JSON.parse(fsModule.readFileSync(sendCircuitPath, 'utf-8'));
    logger.info(`  ✓ Circuit loaded`);
    
    // Initialize backend and Noir
    const backend = new UltraHonkBackend(sendCircuit.bytecode, { threads: 1 });
    const noir = new Noir(sendCircuit);
    logger.info(`  ✓ Backend initialized`);
    
    // Prepare circuit inputs (matching send/page.tsx format)
    const formatForNoir = (value: bigint): string => value.toString();
    
    const circuitInputs = {
      user_key: formatForNoir(userKey),
      token_address: formatForNoir(actualTokenAddress),
      amount: formatForNoir(sendAmount),
      previous_nonce: formatForNoir(previousNonce),
      main_c_tot: [recomputedMainCTot.x, recomputedMainCTot.y].map(formatForNoir),
      main_c_inner: [mainCInner.x, mainCInner.y].map(formatForNoir),
      main_c_outer: [mainCOuter.x, mainCOuter.y].map(formatForNoir),
      main_c_inner_point: mainCInnerPoint.map(formatForNoir),
      main_c_outer_point: mainCOuterPoint.map(formatForNoir),
      personal_c_tot: personalState.personal_c_tot.map(formatForNoir),
      personal_c_inner: personalState.personal_c_inner.map(formatForNoir),
      personal_c_outer: personalState.personal_c_outer.map(formatForNoir),
      personal_c_inner_m: formatForNoir(personalState.personal_c_inner_m),
      personal_c_outer_m: formatForNoir(personalState.personal_c_outer_m),
      personal_c_outer_r: formatForNoir(personalState.personal_c_outer_r),
      receiver_public_key: [formatForNoir(receiverPublicKey.x), formatForNoir(receiverPublicKey.y)],
      relay_fee_token_address: formatForNoir(actualTokenAddress), // Same as send token
      receiver_fee_amount: formatForNoir(feeAmount),
      fee_token_personal_c_inner: feeTokenPersonalState.personal_c_inner.map(formatForNoir),
      fee_token_personal_c_outer: feeTokenPersonalState.personal_c_outer.map(formatForNoir),
      fee_token_personal_c_inner_m: formatForNoir(feeTokenPersonalState.personal_c_inner_m),
      fee_token_personal_c_outer_m: formatForNoir(feeTokenPersonalState.personal_c_outer_m),
      fee_token_personal_c_outer_r: formatForNoir(feeTokenPersonalState.personal_c_outer_r),
    };
    
    logger.info(`  🔄 Generating witness...`);
    const witnessStartTime = Date.now();
    // @ts-ignore
    const { witness } = await noir.execute(circuitInputs, { keccak: true });
    const witnessTime = Date.now() - witnessStartTime;
    logger.info(`  ✅ Witness generated in ${witnessTime}ms`);
    
    logger.info(`  🔄 Generating proof (this may take a while)...`);
    const proofStartTime = Date.now();
    // @ts-ignore
    const proofResult = await backend.generateProof(witness, { keccak: true });
    const proofTime = Date.now() - proofStartTime;
    logger.info(`  ✅ Proof generated in ${proofTime}ms`);
    
    const proofHex = Buffer.from(proofResult.proof).toString('hex');
    const proofBytes = `0x${proofHex}` as Hex;
    
    // Extract public inputs (slice to 28 for send circuit)
    const publicInputsArray = (proofResult.publicInputs || []).slice(0, 28);
    const publicInputsBytes32: readonly Hex[] = publicInputsArray.map((input: any) => {
      if (typeof input === 'string' && input.startsWith('0x')) {
        return input as Hex;
      }
      if (typeof input === 'bigint') {
        return `0x${input.toString(16).padStart(64, '0')}` as Hex;
      }
      const hex = BigInt(input).toString(16);
      return `0x${hex.padStart(64, '0')}` as Hex;
    });
    
    logger.info(`  ✓ Proof size: ${proofBytes.length} chars`);
    logger.info(`  ✓ Public inputs: ${publicInputsBytes32.length} elements`);
    
    // Step 7: Submit transaction
    logger.info('');
    logger.info('📋 Step 7: Submitting send transaction to Nydus contract...');
    
    const txHash = await walletClient.writeContract({
      address: config.nydusContractAddress as Hex,
      abi: NydusAbi,
      functionName: 'send',
      args: [proofBytes, publicInputsBytes32],
      chain: baseSepolia,
    });
    
    logger.info(`  ✅ Transaction submitted: ${txHash}`);
    logger.info(`  ⏳ Waiting for confirmation...`);
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    
    logger.info(`  ✅ Transaction confirmed!`);
    logger.info(`     Block: ${receipt.blockNumber?.toString()}`);
    logger.info(`     Gas used: ${receipt.gasUsed?.toString()}`);
    logger.info(`     Status: ${receipt.status}`);
    
    if (receipt.status === 'reverted') {
      throw new Error('Transaction reverted on-chain');
    }
    
    logger.info('');
    logger.info('🎉 ✅ SEND TRANSACTION COMPLETE! 🎉');
    logger.info(`   Tx hash: ${txHash}`);
    logger.info(`   Sent: ${sendAmount} wei USDC to self`);
    logger.info(`   Fee: ${feeAmount} wei USDC`);
    
    logger.info('');
    logger.info('='.repeat(80));

  } catch (error) {
    logger.error('❌ Test failed:', error);
    if (error instanceof Error) {
      logger.error('  Error message:', error.message);
      logger.error('  Error stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testSendTransaction();

