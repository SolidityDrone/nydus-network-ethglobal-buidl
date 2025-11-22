import dotenv from 'dotenv';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config';
import { justaNameSDKService } from '../services/justaname-sdk';
import { deriveKeyFromParameter, derivePrivateKeyFromParameter } from '../utils/address';
import { logger } from '../utils/logger';
import {
  NYDUS_MESSAGE,
  computePrivateKeyFromSignature,
  generatePublicKey,
  isNydusInitialized,
  initializeNydusPosition,
  depositToNydus,
} from '../lib/nydus-wrapper';

// Load environment variables
dotenv.config();

/**
 * Transfer event signature
 * Topic0: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 */
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ETH_COIN_TYPE = 60;

interface SubdomainInfo {
  name: string;
  currentAddress: string;
  currentPrivateKey: string;
  nonce: number;
}

// Store our subdomains
const subdomains: SubdomainInfo[] = [];

/**
 * Create a subdomain with initial stealth address
 */
async function createSubdomain(index: number): Promise<SubdomainInfo> {
  const baseName = `stealth-${Date.now()}-${index}`;
  const nonce = 0;
  
  // Derive initial stealth address (nonce 0)
  const stealthParam = `${baseName}-${nonce}`;
  const derivedPrivateKey = derivePrivateKeyFromParameter(stealthParam);
  const derivedAddress = deriveKeyFromParameter(stealthParam);

  console.log(`\n📝 Creating subdomain #${index + 1}: ${baseName}.${config.ensDomain}`);
  console.log(`   Initial stealth address (nonce ${nonce}): ${derivedAddress}`);

  // Register subdomain with initial stealth address
  await justaNameSDKService.addSubname(
    baseName,
    derivedPrivateKey,
    derivedAddress,
    {
      description: `Stealth subdomain - nonce: ${nonce}`,
      'com.twitter': 'substream',
      'com.github': 'substream',
      url: 'https://www.substream.xyz',
    }
  );

  console.log(`✅ Subdomain created successfully!`);

  return {
    name: baseName,
    currentAddress: derivedAddress,
    currentPrivateKey: derivedPrivateKey,
    nonce: 0,
  };
}

/**
 * Rotate stealth address for a subdomain
 */
async function rotateStealthAddress(subdomain: SubdomainInfo): Promise<void> {
  const newNonce = subdomain.nonce + 1;
  const stealthParam = `${subdomain.name}-${newNonce}`;
  
  // Derive NEW stealth address
  const newPrivateKey = derivePrivateKeyFromParameter(stealthParam);
  const newAddress = deriveKeyFromParameter(stealthParam);

  console.log(`\n🔄 Rotating stealth address for ${subdomain.name}.${config.ensDomain}`);
  console.log(`   Old address (nonce ${subdomain.nonce}): ${subdomain.currentAddress}`);
  console.log(`   New address (nonce ${newNonce}): ${newAddress}`);

  // Update subdomain:
  // - Use CURRENT owner's private key to sign (authorization)
  // - Set NEW address as the new owner (in the update)
  await justaNameSDKService.updateSubname(
    subdomain.name,
    subdomain.currentPrivateKey, // Use CURRENT owner's key to authorize
    {
      description: `Stealth subdomain - nonce: ${newNonce}`,
      'com.twitter': 'substream',
      'com.github': 'substream',
      url: 'https://www.substream.xyz',
    },
    newAddress // Pass NEW address to change ownership
  );

  // Update our local state
  subdomain.currentAddress = newAddress;
  subdomain.currentPrivateKey = newPrivateKey;
  subdomain.nonce = newNonce;

  console.log(`✅ Stealth address rotated successfully!`);
  console.log(`   New resolution address: ${newAddress}`);
  console.log(`   New nonce: ${newNonce}`);
}

/**
 * Find subdomain by current address
 */
function findSubdomainByAddress(address: string): SubdomainInfo | undefined {
  return subdomains.find(
    (sub) => sub.currentAddress.toLowerCase() === address.toLowerCase()
  );
}

/**
 * Monitor transfers to all subdomain addresses
 */
async function monitorTransfers() {
  if (!config.rpcUrl) {
    throw new Error('RPC_URL environment variable is required');
  }

  console.log(`\n📡 Step 2: Connecting to RPC: ${config.rpcUrl}`);
  const client = createPublicClient({
    transport: http(config.rpcUrl),
  });

  const currentBlock = await client.getBlockNumber();
  console.log(`✅ Connected! Current block: ${currentBlock}\n`);

  // Get all monitored addresses
  const monitoredAddresses = subdomains.map((sub) => sub.currentAddress.toLowerCase());
  console.log(`👀 Step 3: Watching for ERC20 transfers to ${monitoredAddresses.length} addresses...`);
  console.log(`   Addresses: ${monitoredAddresses.join(', ')}`);
  console.log(`   (Press Ctrl+C to stop)\n`);

  let lastCheckedBlock = currentBlock;

  // Watch for new blocks and check for transfers
  const unwatch = client.watchBlocks({
    onBlock: async (block) => {
      try {
        // Only check new blocks
        if (block.number <= lastCheckedBlock) {
          return;
        }

        // Check all blocks between lastCheckedBlock and current block (inclusive)
        const blocksToCheck: bigint[] = [];
        for (let i = lastCheckedBlock + 1n; i <= block.number; i++) {
          blocksToCheck.push(i);
        }

        for (const blockNum of blocksToCheck) {
          console.log(`🔎 Checking block ${blockNum} for transfers...`);

          // Get ALL logs in this block
          const logs = await client.getLogs({
            fromBlock: blockNum,
            toBlock: blockNum,
          } as any);

          // Filter for Transfer events only (topic0)
          const transferLogs = logs.filter((log) =>
            log.topics[0]?.toLowerCase() === TRANSFER_EVENT_TOPIC.toLowerCase()
          );

          console.log(`   Found ${transferLogs.length} Transfer events in block`);

          // Check if any transfers are to our monitored addresses
          for (const log of transferLogs) {
            if (log.topics.length >= 3 && log.topics[2]) {
              const toAddress = '0x' + log.topics[2].slice(-40).toLowerCase();
              
              if (monitoredAddresses.includes(toAddress)) {
                // Extract details
                const fromAddress = log.topics[1] ? '0x' + log.topics[1].slice(-40) : 'unknown';
                const value = log.data ? BigInt(log.data) : 0n;
                
                console.log(`\n🎉 Transfer detected to monitored address!`);
                console.log(`   Token Contract: ${log.address}`);
                console.log(`   From: ${fromAddress}`);
                console.log(`   To: ${toAddress}`);
                console.log(`   Value: ${value.toString()}`);
                console.log(`   Block: ${log.blockNumber}`);
                console.log(`   Tx Hash: ${log.transactionHash}`);

                // Find which subdomain received the transfer
                const subdomain = findSubdomainByAddress(toAddress);
                
                if (subdomain) {
                  console.log(`\n🎯 Transfer received by: ${subdomain.name}.${config.ensDomain}`);
                  console.log(`   Current nonce: ${subdomain.nonce}`);
                  
                  try {
                    // Step 3: Create Nydus deposit proof
                    console.log(`\n💰 Creating Nydus deposit...`);
                    
                    // Get Nydus private key from master signature
                    const masterPrivateKey = config.privateKey.startsWith('0x') 
                      ? config.privateKey 
                      : `0x${config.privateKey}`;
                    const masterAccount = privateKeyToAccount(masterPrivateKey as `0x${string}`);
                    const nydusSignature = await masterAccount.signMessage({ message: NYDUS_MESSAGE });
                    const nydusPrivateKey = await computePrivateKeyFromSignature(nydusSignature);
                    
                    const depositResult = await depositToNydus(
                      nydusPrivateKey,
                      log.address, // token address
                      value,       // amount
                      fromAddress  // from address
                    );
                    
                    if (depositResult.success) {
                      console.log(`✅ Nydus deposit created! Tx: ${depositResult.txHash}`);
                    } else {
                      console.log(`⚠️  Nydus deposit warning: ${depositResult.error}`);
                      console.log('   Continuing with ENS rotation...');
                    }
                    
                    // Step 4: Rotate the stealth address in ENS
                    console.log(`\n🔄 Rotating ENS record...`);
                    await rotateStealthAddress(subdomain);
                    
                    // Update monitored addresses list
                    const index = monitoredAddresses.indexOf(toAddress);
                    if (index !== -1) {
                      monitoredAddresses[index] = subdomain.currentAddress.toLowerCase();
                    }
                    
                    console.log(`\n✅ Stealth rotation completed!`);
                    console.log(`   Now monitoring new address: ${subdomain.currentAddress}`);
                    console.log(`   Updated monitored addresses: ${monitoredAddresses.join(', ')}`);
                    
                    // Exit after first transfer (as requested)
                    console.log(`\n🎉 Test completed successfully! Exiting...\n`);
                    unwatch();
                    process.exit(0);
                    
                  } catch (error) {
                    console.error(`❌ Error processing transfer:`, error);
                  }
                }
              }
            }
          }
        }

        // Update last checked block
        lastCheckedBlock = block.number;
      } catch (error) {
        logger.error('Error checking block for transfers', { error, blockNumber: block.number });
      }
    },
    onError: (error) => {
      console.error('❌ Error watching blocks:', error);
      process.exit(1);
    },
  });

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Monitoring stopped by user');
    unwatch();
    process.exit(0);
  });
}

/**
 * Main test function
 */
async function testStealthRotation() {
  try {
    console.log('\n🧪 Starting Stealth Address Rotation Test with Nydus Integration...\n');

    // Step 0: Initialize Nydus position
    console.log('📝 Step 0: Initializing Nydus position...\n');
    
    // Get master private key and sign NYDUS_MESSAGE
    const masterPrivateKey = config.privateKey.startsWith('0x') 
      ? config.privateKey 
      : `0x${config.privateKey}`;
    
    const masterAccount = privateKeyToAccount(masterPrivateKey as `0x${string}`);
    console.log(`   Master Ethereum Address: ${masterAccount.address}`);
    
    // Sign NYDUS_MESSAGE to derive Nydus private key
    const nydusSignature = await masterAccount.signMessage({ message: NYDUS_MESSAGE });
    console.log(`   NYDUS signature: ${nydusSignature.slice(0, 20)}...`);
    
    // Compute Nydus private key from signature
    const nydusPrivateKey = await computePrivateKeyFromSignature(nydusSignature);
    console.log(`   Nydus private key: 0x${nydusPrivateKey.toString(16).slice(0, 16)}...`);
    
    // Generate Nydus public key (zkAddress)
    const nydusPublicKey = await generatePublicKey(nydusPrivateKey);
    console.log(`   Nydus public key X: 0x${nydusPublicKey.x.toString(16).slice(0, 16)}...`);
    console.log(`   Nydus public key Y: 0x${nydusPublicKey.y.toString(16).slice(0, 16)}...`);
    
    // Check if already initialized
    const isInitialized = await isNydusInitialized(nydusPublicKey.x, nydusPublicKey.y);
    
    if (!isInitialized) {
      console.log('   Initializing Nydus position (generating proof)...');
      const initResult = await initializeNydusPosition(nydusPrivateKey, nydusPublicKey);
      
      if (initResult.success) {
        console.log(`✅ Nydus position initialized! Tx: ${initResult.txHash}`);
      } else {
        console.log(`⚠️  Nydus initialization warning: ${initResult.error}`);
        console.log('   Continuing with test...');
      }
    } else {
      console.log('✅ Nydus position already initialized!');
    }
    
    console.log('');

    // Step 1: Create 5 subdomains with initial stealth addresses
    console.log('📝 Step 1: Creating 5 subdomains with stealth addresses...\n');
    
    for (let i = 0; i < 5; i++) {
      const subdomain = await createSubdomain(i);
      subdomains.push(subdomain);
      
      // Small delay between creations to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(`\n✅ Successfully created ${subdomains.length} subdomains!`);
    console.log('\n📋 Subdomain Summary:');
    subdomains.forEach((sub, index) => {
      console.log(`\n${index + 1}. ${sub.name}.${config.ensDomain}`);
      console.log(`   Address: ${sub.currentAddress}`);
      console.log(`   Nonce: ${sub.nonce}`);
    });

    // Step 2: Start monitoring for transfers
    console.log('\n' + '='.repeat(80));
    await monitorTransfers();

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testStealthRotation();

