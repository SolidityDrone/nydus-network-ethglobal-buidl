import { createPublicClient, http, parseAbiItem, type Log } from 'viem';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * ERC20 Transfer event signature
 * event Transfer(address indexed from, address indexed to, uint256 value)
 */
const TRANSFER_EVENT_ABI = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export interface ERC20Transfer {
  tokenAddress: string;
  from: string;
  to: string;
  value: bigint;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
}

/**
 * ERC20 Monitor Service
 * Monitors ERC20 transfer events to a specific address
 */
class ERC20MonitorService {
  private client: ReturnType<typeof createPublicClient>;

  constructor() {
    if (!config.rpcUrl) {
      throw new Error('RPC_URL environment variable is required for ERC20 monitoring');
    }

    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    });

    logger.info('ERC20 Monitor Service initialized', { rpcUrl: config.rpcUrl });
  }

  /**
   * Get ERC20 transfer events to a specific address
   * @param toAddress - The address to monitor (recipient)
   * @param fromBlock - Starting block number (optional, defaults to latest - 10000)
   * @param toBlock - Ending block number (optional, defaults to 'latest')
   */
  async getTransfersTo(
    toAddress: string,
    fromBlock?: bigint,
    toBlock?: bigint | 'latest'
  ): Promise<ERC20Transfer[]> {
    try {
      // Get latest block if not specified
      const latestBlock = await this.client.getBlockNumber();
      const startBlock = fromBlock || latestBlock - 10000n; // Default: last 10000 blocks
      const endBlock = toBlock || 'latest';

      logger.info('Fetching ERC20 transfers', {
        toAddress,
        fromBlock: startBlock.toString(),
        toBlock: endBlock.toString(),
      });

      // Fetch logs for Transfer events where 'to' is the specified address
      const logs = await this.client.getLogs({
        event: TRANSFER_EVENT_ABI,
        args: {
          to: toAddress as `0x${string}`,
        },
        fromBlock: startBlock,
        toBlock: endBlock,
      });

      logger.info('ERC20 transfers fetched', { count: logs.length });

      // Parse and return transfer data
      return logs.map((log) => this.parseTransferLog(log));
    } catch (error) {
      logger.error('Error fetching ERC20 transfers', { error, toAddress });
      throw error;
    }
  }

  /**
   * Get ERC20 transfer events from a specific address
   * @param fromAddress - The address to monitor (sender)
   * @param fromBlock - Starting block number (optional, defaults to latest - 10000)
   * @param toBlock - Ending block number (optional, defaults to 'latest')
   */
  async getTransfersFrom(
    fromAddress: string,
    fromBlock?: bigint,
    toBlock?: bigint | 'latest'
  ): Promise<ERC20Transfer[]> {
    try {
      const latestBlock = await this.client.getBlockNumber();
      const startBlock = fromBlock || latestBlock - 10000n;
      const endBlock = toBlock || 'latest';

      logger.info('Fetching ERC20 transfers from address', {
        fromAddress,
        fromBlock: startBlock.toString(),
        toBlock: endBlock.toString(),
      });

      const logs = await this.client.getLogs({
        event: TRANSFER_EVENT_ABI,
        args: {
          from: fromAddress as `0x${string}`,
        },
        fromBlock: startBlock,
        toBlock: endBlock,
      });

      logger.info('ERC20 transfers fetched', { count: logs.length });

      return logs.map((log) => this.parseTransferLog(log));
    } catch (error) {
      logger.error('Error fetching ERC20 transfers', { error, fromAddress });
      throw error;
    }
  }

  /**
   * Get ERC20 transfer events for a specific token contract
   * @param tokenAddress - The ERC20 token contract address
   * @param fromBlock - Starting block number (optional, defaults to latest - 10000)
   * @param toBlock - Ending block number (optional, defaults to 'latest')
   */
  async getTransfersForToken(
    tokenAddress: string,
    fromBlock?: bigint,
    toBlock?: bigint | 'latest'
  ): Promise<ERC20Transfer[]> {
    try {
      const latestBlock = await this.client.getBlockNumber();
      const startBlock = fromBlock || latestBlock - 10000n;
      const endBlock = toBlock || 'latest';

      logger.info('Fetching ERC20 transfers for token', {
        tokenAddress,
        fromBlock: startBlock.toString(),
        toBlock: endBlock.toString(),
      });

      const logs = await this.client.getLogs({
        address: tokenAddress as `0x${string}`,
        event: TRANSFER_EVENT_ABI,
        fromBlock: startBlock,
        toBlock: endBlock,
      });

      logger.info('ERC20 transfers fetched', { count: logs.length });

      return logs.map((log) => this.parseTransferLog(log));
    } catch (error) {
      logger.error('Error fetching ERC20 transfers', { error, tokenAddress });
      throw error;
    }
  }

  /**
   * Parse transfer log into structured data
   */
  private parseTransferLog(log: Log): ERC20Transfer {
    const args = log.args as { from: string; to: string; value: bigint };

    return {
      tokenAddress: log.address,
      from: args.from,
      to: args.to,
      value: args.value,
      blockNumber: log.blockNumber!,
      transactionHash: log.transactionHash!,
      logIndex: log.logIndex!,
    };
  }

  /**
   * Get the current block number
   */
  async getCurrentBlock(): Promise<bigint> {
    return await this.client.getBlockNumber();
  }
}

export const erc20MonitorService = new ERC20MonitorService();

