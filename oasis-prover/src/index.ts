import express, { Request, Response } from 'express';
import { config } from './config';
import { logger } from './utils/logger';
import { createGreeting, createApiResponse } from './utils/response';
import subnameRoutes from './routes/subname';
import erc20Router from './routes/erc20';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
});

// Routes
app.use('/api', subnameRoutes);
app.use('/api/erc20', erc20Router);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'oasis-middleman',
        version: '1.0.0',
    });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
    res.json(createGreeting('🚀 Oasis TEE TDX Middleman Backend - Ready!'));
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date(),
    });
});

// Start server
app.listen(config.port, () => {
    logger.info(`🚀 Server is running on port ${config.port}`);
    logger.info(`📝 Environment: ${config.nodeEnv}`);
    logger.info(`🐳 Running in Docker: ${config.isDocker ? 'Yes' : 'No'}`);
    logger.info(`\n🌐 Available endpoints:`);
    logger.info(`   POST http://localhost:${config.port}/api/register`);
    logger.info(`   GET http://localhost:${config.port}/api/names`);
    logger.info(`   GET http://localhost:${config.port}/api/monitoring-status`);
    logger.info(`   GET http://localhost:${config.port}/api/monitoring-details`);
    logger.info(`   POST http://localhost:${config.port}/api/derive-address`);
    logger.info(`   GET http://localhost:${config.port}/health`);
});

