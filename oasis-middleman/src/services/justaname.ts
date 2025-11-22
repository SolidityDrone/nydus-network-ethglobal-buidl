import { config } from '../config';
import { logger } from '../utils/logger';
import {
    JustaNameAddSubnameRequest,
    JustaNameUpdateSubnameRequest,
    JustaNameSubnameResponse,
    JustaNameRecordsResponse,
    JustaNameTextRecords,
    JustaNameRequestChallengeRequest,
    JustaNameRequestChallengeResponse,
    JustaNameVerifyMessageRequest,
    JustaNameVerifyMessageResponse,
    JustaNameAddMappPermissionRequest,
} from '../types';

const JUSTANAME_API_BASE = 'https://api.justaname.id';

class JustaNameService {
    private apiKey: string;
    private baseUrl: string;
    private authToken: string | null = null;

    constructor() {
        this.apiKey = config.justanameApiKey;
        this.baseUrl = JUSTANAME_API_BASE;
    }

    /**
     * Set authentication token for authenticated requests
     */
    setAuthToken(token: string): void {
        this.authToken = token;
        logger.debug('Auth token set');
    }

    /**
     * Clear authentication token
     */
    clearAuthToken(): void {
        this.authToken = null;
        logger.debug('Auth token cleared');
    }

    private async makeRequest<T>(
        endpoint: string,
        options: RequestInit = {},
        requireAuth: boolean = false
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-API-KEY': this.apiKey,
            ...(options.headers as Record<string, string>),
        };

        // Add authentication headers if token is available and required
        if (requireAuth) {
            // Always re-authenticate before each authenticated request
            // The API might require fresh SIWE auth for each request
            logger.debug('Re-authenticating before authenticated request');
            const { siweService } = await import('./siwe');
            const token = await siweService.authenticate();
            if (token && token !== 'verified') {
                this.authToken = token;
                headers['Authorization'] = `Bearer ${this.authToken}`;
            } else if (token === 'verified') {
                // Session-based auth - cookies should be handled by fetch with credentials: 'include'
                logger.debug('Using session-based auth (verified but no token)');
                // Don't add Authorization header for session-based auth
            } else {
                logger.warn('SIWE authentication failed, proceeding without auth token');
            }
        }

        logger.debug(`Making request to ${url}`, {
            method: options.method || 'GET',
            requireAuth,
            hasAuthToken: !!this.authToken,
            authTokenType: this.authToken === 'verified' ? 'session-based' : 'bearer',
            fullUrl: `${this.baseUrl}${url}`
        });

        try {
            // For session-based auth, we need to include credentials
            const fetchOptions: RequestInit = {
                ...options,
                headers,
                credentials: 'include', // Include cookies for session-based auth
            };

            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`JustaName API error: ${response.status}`, { error: errorText });
                throw new Error(`JustaName API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json() as unknown;

            // Type guard for object
            const isObject = (val: unknown): val is Record<string, unknown> => {
                return val !== null && typeof val === 'object';
            };

            logger.debug('JustaName API response', {
                hasResult: isObject(data) && 'result' in data,
                hasData: isObject(data) && 'data' in data,
                keys: isObject(data) ? Object.keys(data) : [],
                fullResponse: JSON.stringify(data).substring(0, 500)
            });

            // JustaName API returns data in a result.data structure
            // Check if the response has a result wrapper
            if (isObject(data) && 'result' in data) {
                const result = data.result;
                // If result has a data field, return that
                if (isObject(result) && 'data' in result && result.data !== null) {
                    logger.debug('Returning result.data', {
                        keys: isObject(result.data) ? Object.keys(result.data) : []
                    });
                    return result.data as T;
                }
                // If result exists but no data field, return result itself (might be the actual response)
                if (isObject(result)) {
                    logger.debug('Returning result', { keys: Object.keys(result) });
                    return result as T;
                }
            }

            // If no result wrapper, return data as-is
            logger.debug('Returning data as-is', {
                keys: isObject(data) ? Object.keys(data) : []
            });
            return data as T;
        } catch (error) {
            logger.error('JustaName API request failed', { error });
            throw error;
        }
    }

    /**
     * Request SIWE challenge
     * POST /ens/v1/siwe/request-challenge
     */
    async requestChallenge(
        address: string,
        ens: string,
        providerUrl: string,
        domain: string,
        origin: string,
        chainId: number
    ): Promise<JustaNameRequestChallengeResponse> {
        const request: JustaNameRequestChallengeRequest = {
            ens,
            address,
            providerUrl,
            domain,
            origin,
            chainId,
        };

        logger.info('Requesting SIWE challenge', { address, ens, domain, origin, chainId });
        logger.debug('SIWE challenge request body', { request });

        const response = await this.makeRequest<JustaNameRequestChallengeResponse>(
            `/ens/v1/siwe/request-challenge`,
            {
                method: 'POST',
                body: JSON.stringify(request),
            }
        );

        logger.debug('SIWE challenge raw response', {
            response,
            responseType: typeof response,
            responseKeys: response && typeof response === 'object' ? Object.keys(response) : []
        });

        return response;
    }

    /**
     * Verify SIWE message
     * POST /ens/v1/siwe/verify-message
     */
    async verifyMessage(
        address: string,
        message: string,
        signature: string,
        ens: string,
        providerUrl: string
    ): Promise<JustaNameVerifyMessageResponse> {
        const request: JustaNameVerifyMessageRequest = {
            ens,
            address,
            message,
            signature,
            providerUrl,
        };

        logger.info('Verifying SIWE message', { address, ens });
        logger.debug('SIWE verify request', {
            address,
            messageLength: message.length,
            signatureLength: signature.length,
            ens,
            providerUrl
        });

        const response = await this.makeRequest<JustaNameVerifyMessageResponse>(
            `/ens/v1/siwe/verify-message`,
            {
                method: 'POST',
                body: JSON.stringify(request),
            }
        );

        logger.debug('SIWE verify raw response', {
            response,
            responseType: typeof response,
            responseKeys: response && typeof response === 'object' ? Object.keys(response) : []
        });

        return response;
    }

    /**
     * Add mApp permission
     * POST /ens/v1/siwe/mapp/add-permission
     */
    async addMappPermission(
        name: string,
        mappId: string,
        fields: string[]
    ): Promise<any> {
        const request: JustaNameAddMappPermissionRequest = {
            ens: config.ensDomain,
            name: `${name}.${config.ensDomain}`,
            mappId,
            fields,
            providerUrl: config.providerUrl,
        };

        logger.info('Adding mApp permission', { name, mappId, fields });

        return this.makeRequest<any>(
            `/ens/v1/siwe/mapp/add-permission`,
            {
                method: 'POST',
                body: JSON.stringify(request),
            },
            true // Require authentication
        );
    }

    /**
     * Add a new subname
     * POST /ens/v1/subname/add
     */
    async addSubname(
        name: string,
        owner: string,
        records?: JustaNameTextRecords,
        duration?: number,
        resolver?: string
    ): Promise<JustaNameSubnameResponse> {
        const request: JustaNameAddSubnameRequest = {
            ens: config.ensDomain,
            name: `${name}.${config.ensDomain}`,
            owner,
            providerUrl: config.providerUrl,
            records,
            duration,
            resolver,
        };

        logger.info(`Adding subname: ${name}.${config.ensDomain}`);

        return this.makeRequest<JustaNameSubnameResponse>(
            `/ens/v1/subname/add`,
            {
                method: 'POST',
                body: JSON.stringify(request),
            },
            true // Require authentication
        );
    }

    /**
     * Update an existing subname
     * POST /ens/v1/subname/update
     */
    async updateSubname(
        name: string,
        owner?: string,
        records?: JustaNameTextRecords,
        resolver?: string
    ): Promise<JustaNameSubnameResponse> {
        const request: JustaNameUpdateSubnameRequest = {
            ens: config.ensDomain,
            name: `${name}.${config.ensDomain}`,
            owner,
            providerUrl: config.providerUrl,
            records,
            resolver,
        };

        logger.info(`Updating subname: ${name}.${config.ensDomain}`);

        return this.makeRequest<JustaNameSubnameResponse>(
            `/ens/v1/subname/update`,
            {
                method: 'POST',
                body: JSON.stringify(request),
            },
            true // Require authentication
        );
    }

    /**
     * Get records for a subname
     * GET /ens/v1/subname/records?subname={name}&chainId={chainId}
     * Note: The API expects only the subname (without domain), not the full name
     */
    async getRecords(name: string): Promise<JustaNameRecordsResponse> {
        // Extract just the subname part (in case full name is passed)
        const subnameOnly = name.includes('.') ? name.split('.')[0] : name;
        const fullName = `${subnameOnly}.${config.ensDomain}`;

        // Build query string with ens parameter first to ensure it's recognized
        const queryParams = new URLSearchParams({
            ens: config.ensDomain,
            subname: subnameOnly,
            chainId: config.chainId.toString(),
            providerUrl: config.providerUrl,
        });

        const url = `/ens/v1/subname/records?${queryParams.toString()}`;
        logger.debug(`Getting records for: ${fullName}`, {
            subnameOnly,
            ensDomain: config.ensDomain,
            url
        });

        return this.makeRequest<JustaNameRecordsResponse>(url);
    }

    /**
     * Get subname details
     * GET /ens/v1/subname/subname?subname={name}&chainId={chainId}
     * Note: The API expects only the subname (without domain), not the full name
     */
    async getSubname(name: string): Promise<JustaNameSubnameResponse> {
        // Extract just the subname part (in case full name is passed)
        const subnameOnly = name.includes('.') ? name.split('.')[0] : name;
        const fullName = `${subnameOnly}.${config.ensDomain}`;

        // Build query string with ens parameter first to ensure it's recognized
        const queryParams = new URLSearchParams({
            ens: config.ensDomain,
            subname: subnameOnly,
            chainId: config.chainId.toString(),
            providerUrl: config.providerUrl,
        });

        const url = `/ens/v1/subname/subname?${queryParams.toString()}`;
        logger.debug(`Getting subname: ${fullName}`, {
            subnameOnly,
            ensDomain: config.ensDomain,
            url
        });

        return this.makeRequest<JustaNameSubnameResponse>(url);
    }

    /**
     * Get all subnames for the main domain
     * Note: JustaName API might not have a direct list endpoint
     * This is a placeholder - you may need to maintain a local cache or use a different approach
     */
    async getAllSubnames(): Promise<JustaNameSubnameResponse[]> {
        logger.debug(`Getting all subnames for domain: ${config.ensDomain}`);

        // JustaName API might not have a direct list endpoint
        // This is a placeholder - you may need to maintain a local cache or use a different approach
        // For now, return empty array and let the calling code handle it
        logger.warn('getAllSubnames: Direct list endpoint may not be available in JustaName API');
        return [];
    }

    /**
     * Search for a subname by trying to get its records
     */
    async searchSubname(name: string, exactMatch: boolean = true): Promise<JustaNameSubnameResponse[]> {
        const fullName = `${name}.${config.ensDomain}`;
        logger.debug(`Searching for subname: ${fullName}`);

        try {
            // Try to get records - if it exists, return it
            const records = await this.getRecords(name);
            // Extract name from full name (remove domain)
            const nameOnly = name.split('.')[0];
            return [{
                name: nameOnly,
                owner: '', // Owner might not be in records response
                resolver: '',
                records: records.records,
            }];
        } catch (error) {
            // If records don't exist, return empty array
            logger.debug(`Subname not found: ${fullName}`);
            return [];
        }
    }
}

export const justaNameService = new JustaNameService();
