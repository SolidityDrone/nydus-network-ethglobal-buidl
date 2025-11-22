import { Router, Request, Response } from 'express';
import { erc20MonitorService } from '../services/erc20-monitor';
import { logger } from '../utils/logger';
import { successResponse, errorResponse } from '../utils/response';

const router = Router();

/**
 * GET /api/erc20/transfers/to/:address
 * Get ERC20 transfers TO a specific address
 * Query params: fromBlock, toBlock
 */
router.get('/transfers/to/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const fromBlock = req.query.fromBlock ? BigInt(req.query.fromBlock as string) : undefined;
    const toBlock = req.query.toBlock === 'latest' ? 'latest' : req.query.toBlock ? BigInt(req.query.toBlock as string) : undefined;

    logger.info('Fetching ERC20 transfers to address', { address, fromBlock: fromBlock?.toString(), toBlock });

    const transfers = await erc20MonitorService.getTransfersTo(address, fromBlock, toBlock);

    // Convert bigint to string for JSON serialization
    const serializedTransfers = transfers.map(t => ({
      ...t,
      value: t.value.toString(),
      blockNumber: t.blockNumber.toString(),
    }));

    res.json(successResponse({
      address,
      count: transfers.length,
      transfers: serializedTransfers,
    }));
  } catch (error) {
    logger.error('Error fetching ERC20 transfers to address', { error, address: req.params.address });
    res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Unknown error'));
  }
});

/**
 * GET /api/erc20/transfers/from/:address
 * Get ERC20 transfers FROM a specific address
 * Query params: fromBlock, toBlock
 */
router.get('/transfers/from/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const fromBlock = req.query.fromBlock ? BigInt(req.query.fromBlock as string) : undefined;
    const toBlock = req.query.toBlock === 'latest' ? 'latest' : req.query.toBlock ? BigInt(req.query.toBlock as string) : undefined;

    logger.info('Fetching ERC20 transfers from address', { address, fromBlock: fromBlock?.toString(), toBlock });

    const transfers = await erc20MonitorService.getTransfersFrom(address, fromBlock, toBlock);

    const serializedTransfers = transfers.map(t => ({
      ...t,
      value: t.value.toString(),
      blockNumber: t.blockNumber.toString(),
    }));

    res.json(successResponse({
      address,
      count: transfers.length,
      transfers: serializedTransfers,
    }));
  } catch (error) {
    logger.error('Error fetching ERC20 transfers from address', { error, address: req.params.address });
    res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Unknown error'));
  }
});

/**
 * GET /api/erc20/transfers/token/:tokenAddress
 * Get ERC20 transfers for a specific token contract
 * Query params: fromBlock, toBlock
 */
router.get('/transfers/token/:tokenAddress', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;
    const fromBlock = req.query.fromBlock ? BigInt(req.query.fromBlock as string) : undefined;
    const toBlock = req.query.toBlock === 'latest' ? 'latest' : req.query.toBlock ? BigInt(req.query.toBlock as string) : undefined;

    logger.info('Fetching ERC20 transfers for token', { tokenAddress, fromBlock: fromBlock?.toString(), toBlock });

    const transfers = await erc20MonitorService.getTransfersForToken(tokenAddress, fromBlock, toBlock);

    const serializedTransfers = transfers.map(t => ({
      ...t,
      value: t.value.toString(),
      blockNumber: t.blockNumber.toString(),
    }));

    res.json(successResponse({
      tokenAddress,
      count: transfers.length,
      transfers: serializedTransfers,
    }));
  } catch (error) {
    logger.error('Error fetching ERC20 transfers for token', { error, tokenAddress: req.params.tokenAddress });
    res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Unknown error'));
  }
});

/**
 * GET /api/erc20/block/current
 * Get the current block number
 */
router.get('/block/current', async (_req: Request, res: Response) => {
  try {
    const currentBlock = await erc20MonitorService.getCurrentBlock();

    res.json(successResponse({
      blockNumber: currentBlock.toString(),
    }));
  } catch (error) {
    logger.error('Error fetching current block', { error });
    res.status(500).json(errorResponse(error instanceof Error ? error.message : 'Unknown error'));
  }
});

export default router;

