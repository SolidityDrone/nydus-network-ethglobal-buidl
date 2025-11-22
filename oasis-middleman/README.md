# Oasis Middleman

Backend service for Oasis TEE TDX integration.

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm run dev

# Build
pnpm run build

# Run production build
pnpm start

# Run subname test script
pnpm run test:subname

# Monitor ERC20 transfers to a subdomain
pnpm run monitor:transfers <subdomain-name>
```

## Docker

```bash
# Build Docker image
docker build -t oasis-middleman .

# Run Docker container
docker run -p 3000:3000 oasis-middleman
```

## Scripts

### Test Subname Operations

```bash
pnpm run test:subname
```

Creates a subdomain, updates it, and verifies the changes.

### Monitor ERC20 Transfers

```bash
pnpm run monitor:transfers
```

Watches for ERC20 transfers to a hardcoded address (0x223677a35623ad17bf1b110d185842917605c7f3). Prints transfer details and exits when detected.

### Test Stealth Address Rotation with Nydus

```bash
pnpm run test:stealth
```

Complete integration test:
1. Initializes Nydus position (derives zkAddress from signature)
2. Creates 5 subdomains with stealth addresses
3. Monitors them for ERC20 transfers
4. When transfer detected:
   - Creates Nydus deposit proof
   - Rotates stealth address (increments nonce, updates ENS resolution)
   - Exits after first transfer

## Environment Variables

- `JUSTNAME_API_KEY` - JustaName API key (required)
- `ENS_DOMAIN` - ENS domain for subnames (required, e.g., stealthmax.eth)
- `PRIVATE_KEY` - Private key for address derivation and SIWE signing (required)
- `RPC_URL` - RPC provider URL for monitoring transfers and Nydus operations (required)
- `NYDUS_CONTRACT_ADDRESS` - Nydus protocol contract address on Base Sepolia (required for stealth test)
- `ALCHEMY_KEY` - Alchemy API key for RPC provider (required, or use PROVIDER_URL)
- `PROVIDER_URL` - RPC provider URL (optional, defaults to Alchemy if ALCHEMY_KEY is set)
- `ORIGIN` - Origin URL for SIWE authentication (default: http://localhost:3000)
- `CHAIN_ID` - Chain ID for blockchain operations (default: 11155111 for Sepolia)
- `PORT` - Server port (default: 3000)
