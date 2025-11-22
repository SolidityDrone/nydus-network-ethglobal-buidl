import { justaNameService } from './justaname';
import { siweService } from './siwe';
import { deriveKeyFromParameter } from '../utils/address';
import { config } from '../config';
import { logger } from '../utils/logger';
import { JustaNameTextRecords, JustaNameSubnameResponse } from '../types';

/**
 * Helper function to get all subnames from JustaName API
 * This is separate to avoid circular dependency
 */
async function getAllSubnamesHelper(): Promise<
    Array<{ name: string; address: string; description?: string }>
> {
    try {
        // Try to get all subnames from JustaName API
        const subnames = await justaNameService.getAllSubnames();

        // If API returns empty (no list endpoint), return empty array
        // In production, you might want to maintain a local database/cache
        if (subnames.length === 0) {
            logger.warn('No subnames returned from API - list endpoint may not be available');
            return [];
        }

        return subnames.map((subname) => ({
            name: subname.name,
            address: subname.owner || '',
            description: subname.records?.description,
        }));
    } catch (error) {
        logger.error('Error getting all subnames:', error);
        // Return empty array instead of throwing to allow graceful degradation
        return [];
    }
}

/**
 * Check if a subname is already registered
 */
export async function isSubnameRegistered(name: string): Promise<boolean> {
    try {
        // Try to get the subname directly - if it exists, return true
        await justaNameService.getSubname(name);
        return true;
    } catch (error: any) {
        // If we get a 404, the subname doesn't exist
        if (error.message && error.message.includes('404')) {
            return false;
        }
        // For other errors, log and return false (assume not registered)
        logger.debug('Error checking if subname is registered:', error);
        return false;
    }
}

/**
 * Ensure SIWE authentication is active
 */
async function ensureAuthenticated(): Promise<void> {
    try {
        // Try to authenticate if not already authenticated
        const token = await siweService.authenticate();
        if (token) {
            justaNameService.setAuthToken(token);
            logger.info('SIWE authentication successful');
        } else {
            throw new Error('SIWE authentication failed');
        }
    } catch (error) {
        logger.error('Failed to authenticate with SIWE:', error);
        throw new Error('Authentication required. Please ensure SIWE authentication is configured.');
    }
}

/**
 * Register a new subname with description
 */
export async function registerSubname(
    subname: string,
    description?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
        // Ensure authentication before making authenticated requests
        // Re-authenticate each time to ensure fresh session
        await ensureAuthenticated();

        // Check if name is already registered
        // If check fails (404), assume it doesn't exist and proceed
        try {
            const exists = await isSubnameRegistered(subname);
            if (exists) {
                return {
                    success: false,
                    error: 'Subname is already registered',
                };
            }
        } catch (error: any) {
            // If check fails with 404, the subname doesn't exist, so proceed
            if (error.message && error.message.includes('404')) {
                logger.debug('Subname check returned 404, assuming it does not exist and proceeding');
            } else {
                // For other errors, log but still try to register
                logger.warn('Error checking if subname exists, proceeding anyway:', error);
            }
        }

        // Derive address from subname
        const derivedAddress = deriveKeyFromParameter(subname);

        const textRecords: JustaNameTextRecords = {
            'com.twitter': 'substream',
            'com.github': 'substream',
            url: 'https://www.substream.xyz',
            description: description || '',
            avatar: 'https://imagedelivery.net/UJ5oN2ajUBrk2SVxlns2Aw/e52988ee-9840-48a2-d8d9-8a92594ab200/public',
        };

        logger.info(`Registering subname: ${subname}.${config.ensDomain}`);

        // Get fresh SIWE authentication for this request
        // The API might require SIWE auth in the same request
        const siweToken = await siweService.authenticate();
        if (siweToken) {
            justaNameService.setAuthToken(siweToken);
        }

        const response = await justaNameService.addSubname(
            subname,
            derivedAddress,
            textRecords
        );

        return {
            success: true,
            data: {
                message: 'Registration completed successfully!',
                justaname_response: response,
                request_data: {
                    domain: config.ensDomain,
                    subname,
                    derived_address: derivedAddress,
                },
            },
        };
    } catch (error) {
        logger.error('Error registering subname:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Update subname description and resolution address
 */
export async function updateSubname(
    subname: string,
    description?: string,
    newResolutionAddress?: string
): Promise<{ success: boolean; data?: JustaNameSubnameResponse; error?: string }> {
    try {
        // Ensure authentication before making authenticated requests
        await ensureAuthenticated();

        const textRecords: JustaNameTextRecords = {
            'com.twitter': 'substream',
            'com.github': 'substream',
            url: 'https://www.substream.xyz',
            description: description,
            avatar: 'https://imagedelivery.net/UJ5oN2ajUBrk2SVxlns2Aw/e52988ee-9840-48a2-d8d9-8a92594ab200/public',
        };

        logger.info(`Updating subname: ${subname}.${config.ensDomain}`);

        // If newResolutionAddress is provided, update owner; otherwise keep existing
        const response = await justaNameService.updateSubname(
            subname,
            newResolutionAddress, // Update resolution address if provided
            textRecords
        );

        return {
            success: true,
            data: response,
        };
    } catch (error) {
        logger.error('Error updating subname:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get all registered subnames with their addresses
 * Note: Since JustaName API might not have a direct list endpoint,
 * this function may need to maintain a local cache or use a different approach
 */
export async function getAllSubnames(): Promise<
    Array<{ name: string; address: string; description?: string }>
> {
    return getAllSubnamesHelper();
}

/**
 * Get subname details
 */
export async function getSubname(name: string): Promise<JustaNameSubnameResponse | null> {
    try {
        return await justaNameService.getSubname(name);
    } catch (error) {
        logger.error('Error getting subname:', error);
        return null;
    }
}
