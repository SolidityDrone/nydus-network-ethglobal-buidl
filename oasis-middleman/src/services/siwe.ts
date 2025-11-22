import { config } from '../config';
import { logger } from '../utils/logger';
import { justaNameService } from './justaname';
import { privateKeyToAccount } from 'viem/accounts';
import type { JustaNameRequestChallengeResponse, JustaNameVerifyMessageResponse } from '../types';

/**
 * SIWE (Sign-In with Ethereum) service for JustaName authentication
 */
class SIWEService {
    private account: ReturnType<typeof privateKeyToAccount>;

    constructor() {
        const privateKey = config.privateKey.startsWith('0x') 
            ? config.privateKey 
            : `0x${config.privateKey}`;
        
        this.account = privateKeyToAccount(privateKey as `0x${string}`);
    }

    /**
     * Request a challenge message for SIWE authentication
     */
    async requestChallenge(): Promise<JustaNameRequestChallengeResponse> {
        logger.info('Requesting SIWE challenge...');

        const response = await justaNameService.requestChallenge(
            this.account.address,
            config.ensDomain,
            config.providerUrl,
            config.ensDomain,
            config.origin,
            config.chainId
        );

        // JustaName API returns 'challenge' instead of 'message'
        const challengeMessage = response.challenge || response.message;
        
        logger.info('Challenge received', { 
            nonce: response.nonce,
            messageLength: challengeMessage?.length || 0,
            messagePreview: challengeMessage?.substring(0, 100) || 'No message',
            hasMessage: !!challengeMessage,
            hasChallenge: !!response.challenge,
            fullResponse: JSON.stringify(response, null, 2)
        });
        
        if (!challengeMessage) {
            logger.error('Challenge response structure:', { 
                response,
                responseType: typeof response,
                responseKeys: response && typeof response === 'object' ? Object.keys(response) : [],
                fullResponseString: JSON.stringify(response, null, 2)
            });
            throw new Error('Challenge response missing challenge/message. Please ensure you are using Ethereum Sepolia (chain ID 11155111) and the correct provider URL.');
        }
        
        // Return response with message field set for compatibility
        return {
            ...response,
            message: challengeMessage,
        };
    }

    /**
     * Sign a message using the configured private key
     */
    async signMessage(message: string): Promise<string> {
        if (!message || typeof message !== 'string') {
            throw new Error('Invalid message: message must be a non-empty string');
        }

        logger.debug('Signing message for SIWE...', { 
            messageLength: message.length,
            messagePreview: message.substring(0, 100)
        });

        // Use the account's signMessage method directly
        // viem's account.signMessage expects a string message
        const signature = await this.account.signMessage({
            message: message,
        });

        logger.debug('Message signed', { signature, signatureLength: signature.length });
        return signature;
    }

    /**
     * Verify the signed message and get authentication token
     */
    async verifyMessage(
        message: string,
        signature: string
    ): Promise<JustaNameVerifyMessageResponse> {
        logger.info('Verifying SIWE message...');

        const response = await justaNameService.verifyMessage(
            this.account.address,
            message,
            signature,
            config.ensDomain,
            config.providerUrl
        );

        // JustaName API returns 'verified' instead of 'success'
        const isVerified = response.verified ?? response.success ?? false;
        const token = response.token || response.accessToken;

        logger.debug('SIWE verify response', {
            response,
            responseType: typeof response,
            responseKeys: response && typeof response === 'object' ? Object.keys(response) : [],
            hasVerified: 'verified' in (response || {}),
            hasSuccess: 'success' in (response || {}),
            verified: (response as any)?.verified,
            success: (response as any)?.success,
            hasToken: !!token,
            token: token ? `${token.substring(0, 20)}...` : undefined,
            fullResponse: JSON.stringify(response, null, 2)
        });

        if (isVerified) {
            if (token) {
                logger.info('SIWE authentication successful with token');
                // Set the token in the justaNameService
                justaNameService.setAuthToken(token);
            } else {
                logger.warn('SIWE verification successful but no token in response', {
                    verified: response.verified,
                    success: response.success,
                    response
                });
                // If verified but no token, we might still be able to proceed
                // Some APIs don't return tokens in the verify response
                // Try to use a placeholder or check if auth is session-based
            }
        } else {
            logger.warn('SIWE authentication failed', {
                verified: response.verified,
                success: response.success,
                hasToken: !!token,
                response
            });
        }

        // Return normalized response
        return {
            ...response,
            success: isVerified,
            verified: isVerified,
            token: token
        };
    }

    /**
     * Complete SIWE flow: request challenge, sign, and verify
     * Returns the authentication token
     */
    async authenticate(): Promise<string | null> {
        try {
            // Step 1: Request challenge
            const challenge = await this.requestChallenge();

            // The requestChallenge method now ensures message is set (from challenge field)
            if (!challenge.message) {
                throw new Error('Challenge response missing message');
            }

            // Step 2: Sign the challenge message
            const signature = await this.signMessage(challenge.message);

            // Step 3: Verify the signature
            const verification = await this.verifyMessage(challenge.message, signature);

            // Check both verified and success fields, and get token from either field
            const isVerified = verification.verified ?? verification.success ?? false;
            const token = verification.token || verification.accessToken;

            if (isVerified) {
                if (token) {
                    logger.info('SIWE authentication successful, token obtained');
                    return token;
                } else {
                    // If verified but no token, the API might use session-based auth
                    // or the token might be in a cookie/header. For now, return a placeholder
                    logger.warn('SIWE verified but no token returned. API might use session-based auth.', {
                        verified: verification.verified,
                        success: verification.success,
                        verification
                    });
                    // Return a placeholder token to indicate authentication succeeded
                    // The actual auth might be handled via cookies/session
                    return 'verified';
                }
            }

            logger.warn('SIWE verification failed', { 
                verified: verification.verified,
                success: verification.success,
                hasToken: !!token,
                verification
            });
            return null;
        } catch (error) {
            logger.error('SIWE authentication failed:', error);
            throw error;
        }
    }

    /**
     * Get the current account address
     */
    getAddress(): string {
        return this.account.address;
    }
}

export const siweService = new SIWEService();

