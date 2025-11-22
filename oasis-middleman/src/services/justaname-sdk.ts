import { JustaName } from '@justaname.id/sdk';
import type { ChainId } from '@justaname.id/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * JustaName SDK service
 * Uses the official @justaname.id/sdk instead of manual API calls
 */
class JustaNameSDKService {
  private justaname: JustaName | null = null;
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor() {
    const privateKey = config.privateKey.startsWith('0x')
      ? config.privateKey
      : `0x${config.privateKey}`;

    this.account = privateKeyToAccount(privateKey as `0x${string}`);
  }

  /**
   * Initialize JustaName SDK
   */
  async init(): Promise<void> {
    if (this.justaname) {
      return; // Already initialized
    }

    logger.info('Initializing JustaName SDK...');

    // Cast chainId to ChainId type
    const chainId = config.chainId as ChainId;

    this.justaname = await JustaName.init({
      networks: [
        {
          chainId: chainId,
          providerUrl: config.providerUrl,
        },
      ],
      ensDomains: [
        {
          chainId: chainId,
          domain: config.ensDomain,
        },
      ] as any, // Type assertion needed for EnsDomainByChainId array
      config: {
        // apiKey is passed via environment or in subname operations
      },
    });

    logger.info('JustaName SDK initialized successfully');
  }

  /**
   * Get the JustaName instance (initializes if needed)
   */
  private async getJustaName(): Promise<JustaName> {
    if (!this.justaname) {
      await this.init();
    }
    if (!this.justaname) {
      throw new Error('Failed to initialize JustaName SDK');
    }
    return this.justaname;
  }

  /**
   * Get the account address
   */
  getAddress(): string {
    return this.account.address;
  }

  /**
   * Request SIWE challenge
   */
  async requestChallenge(): Promise<{ challenge: string }> {
    const justaname = await this.getJustaName();
    const address = this.account.address;
    const chainId = config.chainId as ChainId;

    logger.info('Requesting SIWE challenge...', { address, chainId, origin: config.origin });

    const challenge = await justaname.siwe.requestChallenge({
      address,
      chainId: chainId,
      origin: config.origin,
      domain: config.ensDomain,
    });

    logger.debug('Challenge received', {
      challengeLength: challenge.challenge?.length || 0,
    });

    return {
      challenge: challenge.challenge || '',
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
      messagePreview: message.substring(0, 100),
    });

    const signature = await this.account.signMessage({
      message: message,
    });

    logger.debug('Message signed', { signature, signatureLength: signature.length });
    return signature;
  }

  /**
   * Add a subname
   * @param username - The subname to register (without domain)
   * @param derivedPrivateKey - The derived private key for signing (hex string with 0x prefix)
   * @param ownerAddress - The owner address (should match the derived private key)
   * @param records - Optional text records
   */
  async addSubname(
    username: string,
    derivedPrivateKey: string,
    ownerAddress: string,
    records?: Record<string, string>
  ): Promise<any> {
    const justaname = await this.getJustaName();
    const chainId = config.chainId as ChainId;

    // Create account from derived private key
    const derivedAccount = privateKeyToAccount(derivedPrivateKey as `0x${string}`);
    const derivedAddress = derivedAccount.address;

    logger.info(`Adding subname: ${username}.${config.ensDomain}`, {
      derivedAddress,
      ownerAddress,
      match: derivedAddress.toLowerCase() === ownerAddress.toLowerCase(),
    });

    // Verify that the derived address matches the owner address
    if (derivedAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error(
        `Derived address (${derivedAddress}) does not match owner address (${ownerAddress})`
      );
    }

    // Step 1: Request challenge (for the derived address)
    const challengeResponse = await this.requestChallengeForAddress(derivedAddress);
    if (!challengeResponse.challenge) {
      throw new Error('Failed to get challenge');
    }

    // Step 2: Sign the challenge with the derived account
    const signature = await derivedAccount.signMessage({
      message: challengeResponse.challenge,
    });

    logger.debug('Message signed with derived account', {
      signature,
      signatureLength: signature.length,
    });

    // Step 3: Add subname with SIWE authentication
    // Note: For Ethereum addresses, the coinType is 60 (SLIP-44), not the chainId
    const ETH_COIN_TYPE = 60;

    const result = await justaname.subnames.addSubname(
      {
        username,
        ensDomain: config.ensDomain,
        chainId: chainId,
        apiKey: config.justanameApiKey,
        addresses: {
          [ETH_COIN_TYPE]: ownerAddress,
        },
        text: records || {},
      },
      {
        xMessage: challengeResponse.challenge,
        xAddress: derivedAddress,
        xSignature: signature,
      }
    );

    logger.info('Subname added successfully', { username, result });
    return result;
  }

  /**
   * Request SIWE challenge for a specific address
   */
  private async requestChallengeForAddress(address: string): Promise<{ challenge: string }> {
    const justaname = await this.getJustaName();
    const chainId = config.chainId as ChainId;

    logger.info('Requesting SIWE challenge for address...', { address, chainId, origin: config.origin });

    const challenge = await justaname.siwe.requestChallenge({
      address,
      chainId: chainId,
      origin: config.origin,
      domain: config.ensDomain,
    });

    logger.debug('Challenge received', {
      challengeLength: challenge.challenge?.length || 0,
    });

    return {
      challenge: challenge.challenge || '',
    };
  }

  /**
   * Check if a subname exists
   */
  async subnameExists(username: string): Promise<boolean> {
    const justaname = await this.getJustaName();
    const chainId = config.chainId as ChainId;

    try {
      logger.debug(`Checking if subname exists: ${username}.${config.ensDomain}`);
      
      const result = await justaname.subnames.getSubname({
        subname: username,
        chainId: chainId,
      });

      logger.debug('Subname exists', { username, result });
      return true;
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        logger.debug('Subname does not exist', { username });
        return false;
      }
      logger.error('Error checking subname existence', { error });
      throw error;
    }
  }

  /**
   * Get subname details
   */
  async getSubname(username: string): Promise<any> {
    const justaname = await this.getJustaName();
    const chainId = config.chainId as ChainId;

    logger.info(`Getting subname: ${username}.${config.ensDomain}`);

    const result = await justaname.subnames.getSubname({
      subname: username,
      chainId: chainId,
    });

    logger.debug('Subname retrieved', { username, result });
    return result;
  }

  /**
   * Update a subname's text records
   */
  async updateSubname(
    username: string,
    derivedPrivateKey: string,
    records: Record<string, string>
  ): Promise<any> {
    const justaname = await this.getJustaName();
    const chainId = config.chainId as ChainId;

    // Create account from derived private key
    const derivedAccount = privateKeyToAccount(derivedPrivateKey as `0x${string}`);
    const derivedAddress = derivedAccount.address;

    logger.info(`Updating subname: ${username}.${config.ensDomain}`, {
      derivedAddress,
      records,
    });

    // Step 1: Request challenge (for the derived address)
    const challengeResponse = await this.requestChallengeForAddress(derivedAddress);
    if (!challengeResponse.challenge) {
      throw new Error('Failed to get challenge');
    }

    // Step 2: Sign the challenge with the derived account
    const signature = await derivedAccount.signMessage({
      message: challengeResponse.challenge,
    });

    logger.debug('Message signed with derived account for update', {
      signature,
      signatureLength: signature.length,
    });

    // Step 3: Update subname with SIWE authentication
    const result = await justaname.subnames.updateSubname(
      {
        username,
        ensDomain: config.ensDomain,
        chainId: chainId,
        text: records,
      },
      {
        xMessage: challengeResponse.challenge,
        xAddress: derivedAddress,
        xSignature: signature,
      }
    );

    logger.info('Subname updated successfully', { username, result });
    return result;
  }
}

export const justaNameSDKService = new JustaNameSDKService();

