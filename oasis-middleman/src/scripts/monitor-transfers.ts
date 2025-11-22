import dotenv from 'dotenv';
import { createPublicClient, http, parseAbiItem, type Log } from 'viem';
import { config } from '../config';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

/**
 * ERC20 Transfer event signature
 * event Transfer(address indexed from, address indexed to, uint256 value)
 * 
 * Topic0 hash: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 */
const TRANSFER_EVENT_ABI = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Monitor ERC20 transfers to a hardcoded address
 */
async function monitorTransfers() {
  try {
    console.log('\n🔍 Starting ERC20 transfer monitoring...\n');

    if (!config.rpcUrl) {
      throw new Error('RPC_URL environment variable is required');
    }

    // Hardcoded address to monitor
    const resolutionAddress = '0x223677a35623ad17bf1b110d185842917605c7f3';
    
    console.log(`📝 Step 1: Monitoring address: ${resolutionAddress}\n`);

    // Step 3: Create public client for monitoring
    console.log(`📡 Step 2: Connecting to RPC: ${config.rpcUrl}`);
    const client = createPublicClient({
      transport: http(config.rpcUrl),
    });

    const currentBlock = await client.getBlockNumber();
    console.log(`✅ Connected! Current block: ${currentBlock}\n`);

    // Step 4: Get current block and start from there
    const startBlock = currentBlock;
    console.log(`👀 Step 3: Watching for ERC20 transfers to ${resolutionAddress}...`);
    console.log(`   Starting from block: ${startBlock}`);
    console.log(`   (Press Ctrl+C to stop)\n`);

    let lastCheckedBlock = startBlock;

    // Watch for new blocks and check for transfers
    const unwatch = client.watchBlocks({
      onBlock: async (block) => {
        try {
          // Only check new blocks
          if (block.number <= lastCheckedBlock) {
            return;
          }

          console.log(`🔎 Checking block ${block.number} for transfers...`);
          lastCheckedBlock = block.number;

          // Get ALL logs with Transfer event signature (topic0)
          // This catches any ERC20/ERC721 Transfer event
          const logs = await client.getLogs({
            fromBlock: block.number,
            toBlock: block.number,
          } as any);

          // Filter for Transfer events only (topic0)
          const transferLogs = logs.filter((log) => 
            log.topics[0]?.toLowerCase() === TRANSFER_EVENT_TOPIC.toLowerCase()
          );

          console.log(`   Found ${transferLogs.length} Transfer events in block`);

          // Filter for transfers TO our address (topic2 = dst/to)
          const relevantLogs = transferLogs.filter((log) => {
            // Topic2 is the "to" address in Transfer events
            // Remove padding to get the actual address
            if (log.topics.length >= 3 && log.topics[2]) {
              const toAddress = '0x' + log.topics[2].slice(-40).toLowerCase();
              const targetAddress = resolutionAddress.toLowerCase();
              
              if (toAddress === targetAddress) {
                console.log(`   ✅ Match found! Token: ${log.address}`);
                return true;
              }
            }
            return false;
          });

          if (relevantLogs.length > 0) {
            console.log(`\n🎉 Transfer detected in block ${block.number}!\n`);
            
            for (const log of relevantLogs) {
              // Extract addresses from topics
              const fromAddress = log.topics[1] ? '0x' + log.topics[1].slice(-40) : 'unknown';
              const toAddress = log.topics[2] ? '0x' + log.topics[2].slice(-40) : 'unknown';
              
              // Extract value from data (32 bytes = uint256)
              const value = log.data ? BigInt(log.data) : 0n;
              
              console.log('📋 Transfer Details:');
              console.log(`   Token Contract: ${log.address}`);
              console.log(`   From (src/topic[1]): ${fromAddress}`);
              console.log(`   To (dst/topic[2]): ${toAddress}`);
              console.log(`   Value (wad/data): ${value.toString()}`);
              console.log(`   Block Number: ${log.blockNumber}`);
              console.log(`   Transaction Hash: ${log.transactionHash}`);
              console.log(`   Log Index: ${log.logIndex}`);
              console.log('');
              console.log('📦 Full Log:');
              console.log(JSON.stringify(log, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
              console.log('');
              console.log('🔗 Topics:');
              console.log(`   0 (event signature): ${log.topics[0]}`);
              console.log(`   1 (src/from): ${log.topics[1]}`);
              console.log(`   2 (dst/to): ${log.topics[2]}`);
              console.log(`   Data (value): ${log.data}`);
              console.log('');
            }

            console.log(`✅ Transfer monitoring completed! Found ${relevantLogs.length} transfer(s).`);
            console.log('🛑 Stopping monitoring and exiting...\n');
            
            // Unwatch and exit
            unwatch();
            process.exit(0);
          }
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

  } catch (error) {
    console.error('\n❌ Monitoring failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the monitoring
monitorTransfers();

