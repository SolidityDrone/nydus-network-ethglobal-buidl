import { Router, Request, Response } from 'express';
import { registerSubname, getAllSubnames, isSubnameRegistered } from '../services/subname';
import { deriveKeyFromParameter } from '../utils/address';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/register
 * Register a new subname
 */
router.post('/register', async (req: Request, res: Response) => {
    logger.info('Register endpoint called', { body: req.body });

    try {
        const { subname, description } = req.body;

        // Validate required fields
        if (!subname) {
            return res.status(400).json(
                createErrorResponse('Missing required field: subname is required', 400)
            );
        }

        logger.info('All fields provided, checking name availability...', { subname });

        // Check if name is already registered
        const exists = await isSubnameRegistered(subname);
        if (exists) {
            logger.warn('Subname already registered', { subname });
            return res.status(409).json(
                createErrorResponse('Subname is already registered', 409)
            );
        }

        logger.info('Name is available, registering...', { subname });

        // Register the subname
        const result = await registerSubname(subname, description);

        if (result.success) {
            res.json(createApiResponse(result.data));
        } else {
            res.status(500).json(createErrorResponse(result.error || 'Registration failed', 500));
        }
    } catch (error) {
        logger.error('Register error:', error);
        res.status(500).json(
            createErrorResponse(
                error instanceof Error ? error.message : 'Unknown error',
                500
            )
        );
    }
});

/**
 * GET /api/names
 * Get all registered subnames
 */
router.get('/names', async (req: Request, res: Response) => {
    logger.info('Get names endpoint called');

    try {
        const subnames = await getAllSubnames();

        res.json(
            createApiResponse({
                count: subnames.length,
                names: subnames.map((s) => ({
                    name: s.name,
                    address: s.address,
                })),
            })
        );
    } catch (error) {
        logger.error('Get names error:', error);
        res.status(500).json(
            createErrorResponse(
                error instanceof Error ? error.message : 'Failed to retrieve names',
                500
            )
        );
    }
});

/**
 * POST /api/derive-address
 * Derive an Ethereum address from a parameter
 */
router.post('/derive-address', async (req: Request, res: Response) => {
    try {
        const { parameter } = req.body;

        if (!parameter) {
            return res.status(400).json(
                createErrorResponse('Parameter is required', 400)
            );
        }

        const derivedAddress = deriveKeyFromParameter(parameter);

        res.json(
            createApiResponse({
                parameter,
                derived_address: derivedAddress,
            })
        );
    } catch (error) {
        logger.error('Derivation error:', error);
        res.status(500).json(
            createErrorResponse(
                error instanceof Error ? error.message : 'Failed to derive address',
                500
            )
        );
    }
});

/**
 * GET /api/monitoring-status
 * Get current monitoring status
 */
router.get('/monitoring-status', async (req: Request, res: Response) => {
    try {
        const subnames = await getAllSubnames();

        const addresses = subnames.map((s) => ({
            name: s.name,
            address: s.address,
            etherscan: `https://sepolia.etherscan.io/address/${s.address}`,
        }));

        res.json(
            createApiResponse({
                monitoring: true,
                network: 'sepolia',
                addresses_count: addresses.length,
                addresses,
                last_updated: new Date().toISOString(),
            })
        );
    } catch (error) {
        logger.error('Monitoring status error:', error);
        res.status(500).json(
            createErrorResponse(
                error instanceof Error ? error.message : 'Failed to get monitoring status',
                500
            )
        );
    }
});

/**
 * GET /api/monitoring-details
 * Get full monitoring details with text records
 */
router.get('/monitoring-details', async (req: Request, res: Response) => {
    try {
        const subnames = await getAllSubnames();
        const { config } = await import('../config');

        const detailedAddresses = subnames.map((s) => ({
            name: s.name,
            subdomain: `${s.name}.${config.ensDomain}`,
            ethereum_address: s.address,
            description: s.description || 'Not set',
            etherscan: `https://sepolia.etherscan.io/address/${s.address}`,
        }));

        res.json(
            createApiResponse({
                monitoring: true,
                network: 'sepolia',
                domain: config.ensDomain,
                addresses_count: detailedAddresses.length,
                addresses: detailedAddresses,
                last_updated: new Date().toISOString(),
            })
        );
    } catch (error) {
        logger.error('Monitoring details error:', error);
        res.status(500).json(
            createErrorResponse(
                error instanceof Error ? error.message : 'Failed to get monitoring details',
                500
            )
        );
    }
});

export default router;
