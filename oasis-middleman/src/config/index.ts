import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  ensDomain: process.env.ENS_DOMAIN || '',
  justanameApiKey: process.env.JUSTNAME_API_KEY || '',
  privateKey: process.env.PRIVATE_KEY || '',
  alchemyKey: process.env.ALCHEMY_KEY || '',
  rpcUrl: process.env.RPC_URL || '',
  providerUrl: (() => {
    // If RPC_URL is set, use it (priority)
    if (process.env.RPC_URL) {
      return process.env.RPC_URL;
    }
    // If PROVIDER_URL is explicitly set, use it
    if (process.env.PROVIDER_URL) {
      const url = process.env.PROVIDER_URL;
      // Ensure it's for Ethereum Sepolia, not Base Sepolia
      if (url.includes('base-sepolia')) {
        throw new Error('PROVIDER_URL points to Base Sepolia. Please use Ethereum Sepolia (eth-sepolia) for chain ID 11155111');
      }
      return url;
    }
    // If ALCHEMY_KEY is set and doesn't look like a URL, construct the Alchemy URL for Ethereum Sepolia
    if (process.env.ALCHEMY_KEY && !process.env.ALCHEMY_KEY.startsWith('http')) {
      return `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`;
    }
    // If ALCHEMY_KEY looks like a URL, check it's not Base Sepolia
    if (process.env.ALCHEMY_KEY && process.env.ALCHEMY_KEY.startsWith('http')) {
      const url = process.env.ALCHEMY_KEY;
      if (url.includes('base-sepolia')) {
        throw new Error('ALCHEMY_KEY URL points to Base Sepolia. Please use Ethereum Sepolia (eth-sepolia) for chain ID 11155111');
      }
      return url;
    }
    // Default fallback to Ethereum Sepolia
    return 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY';
  })(),
  origin: process.env.ORIGIN || 'http://localhost:3000',
  chainId: parseInt(process.env.CHAIN_ID || '11155111', 10), // Sepolia testnet default
  nodeEnv: process.env.NODE_ENV || 'development',
  isDocker: !!process.env.DOCKER_CONTAINER,
};

// Validate required environment variables
if (!config.justanameApiKey) {
  throw new Error('JUSTNAME_API_KEY environment variable is required');
}

if (!config.ensDomain) {
  throw new Error('ENS_DOMAIN environment variable is required');
}

if (!config.privateKey) {
  throw new Error('PRIVATE_KEY environment variable is required');
}

if (!config.alchemyKey && !config.providerUrl.includes('YOUR_INFURA_KEY')) {
  // Provider URL will be set from ALCHEMY_KEY if available
  if (!config.providerUrl || config.providerUrl.includes('YOUR_INFURA_KEY')) {
    throw new Error('Either ALCHEMY_KEY or PROVIDER_URL environment variable is required');
  }
}


