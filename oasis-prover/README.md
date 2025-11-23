# Oasis Prover

Backend service for Oasis TEE TDX integration that provides server-side zero-knowledge proof generation for Nydus circuits.

## Why Server-Side Proof Generation?

Zero-knowledge proof generation is computationally intensive, especially for complex circuits like send/absorb operations (~50k gates, ~1k ACIR opcodes). On low-end mobile devices, these proofs can take 30+ seconds to generate client-side, making the app unusable. By offloading proof generation to a powerful Oasis TEE TDX server, proving time is reduced to just a few seconds, enabling smooth UX on any device.

## How It Works

The prover uses Aztec's UltraHonk backend (`@aztec/bb.js`) and Noir.js to execute circuits and generate proofs server-side. Circuits are preloaded on startup and cached for optimal performance. The service runs inside an Oasis TEE (Trusted Execution Environment) with TDX (Trust Domain Extensions), ensuring proofs are generated securely without exposing sensitive circuit inputs.

## Performance

- **Low-end mobile devices**: ~30 seconds for send/absorb circuits (50k gates, 1k ACIR opcodes)
- **Oasis TEE TDX server**: Few seconds for the same circuits
- **Improvement**: ~10x faster, enabling real-time transactions on any device

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm run dev
# Starts the server on port 3000 (or PORT env var)
# Exposes endpoints:
#   GET  /api/proof/status - Check server status
#   POST /api/proof/generate - Generate proof (body: { circuitType, inputs })

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

### Test Send Transaction

```bash
pnpm run test:send
```

Demonstrates a full send transaction flow (matching frontend send/page.tsx):
1. Derives `user_key` from `PRIVATE_KEY` signature using Poseidon2
2. Computes zkAddress (public key) using Baby Jubjub
3. Loads account data from Nydus contract (nonce discovery)
4. (TODO) Reconstructs personal commitment states
5. (TODO) Generates send proof for 0 USDC with 0 USDC fee
6. (TODO) Submits transaction to Nydus contract

**Token Address**: USDC on Base Sepolia (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`)

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
