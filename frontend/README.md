# Nydus Frontend

A Next.js-based frontend application for the Nydus privacy-preserving payment network, built on Celo Sepolia. This frontend provides a user-friendly interface for managing zero-knowledge accounts, performing private transactions, and integrating with identity verification protocols.

## Important Note

**This repository's development work starts from commit `4ee70198a7152cdae17b8b022defea0adeb8a1b1`.** All code before this commit was reused from existing projects and is not part of the original work for this repository.

## Key Features & Additions

### 1. Self Protocol OFAC Sanctioned Users Prevention

I integrated the Self Protocol SDK to prevent OFAC (Office of Foreign Assets Control) sanctioned users from accessing the application. This implementation includes:

- **Self Protocol Integration**: Uses `@selfxyz/core` and `@selfxyz/qrcode` packages for identity verification
- **OFAC Compliance**: Built-in OFAC screening during the verification process
- **Geographic Restrictions**: Configurable country exclusions (currently excludes United States)
- **Age Verification**: Minimum age requirement (18+) enforcement
- **QR Code Flow**: Seamless mobile verification experience using Self Protocol's QR code system

The verification is integrated into the initialization flow (`/app/initialize/page.tsx`) and can be optionally included in ENS subdomain registration (`/app/naming/page.tsx`).

**Configuration:**
- `NEXT_PUBLIC_SELF_ENDPOINT`: Self Protocol endpoint URL
- `NEXT_PUBLIC_SELF_SCOPE_SEED`: Scope seed for the Self app
- `NEXT_PUBLIC_SELF_APP_NAME`: Application name for Self Protocol

### 2. ENS Subdomain for In-App Better UX

I implemented ENS subdomain management to improve user experience by providing human-readable names and storing important data in ENS text records:

- **Subdomain Registration**: Users can register custom ENS subdomains under `nydusns.eth`
- **Text Record Storage**: Stores OFAC verification status and zkAddress in ENS text records for easy retrieval
- **JustaName Integration**: Uses JustaName SDK for seamless ENS subdomain management
- **SIWE Authentication**: Secure Sign-In With Ethereum (SIWE) for subdomain ownership verification
- **Update Functionality**: Users can update their subdomain's resolution address and text records

**Features:**
- Subdomain availability checking
- Automatic zkAddress storage in the `description` text record
- Resolution address management
- List all user's subdomains
- Update existing subdomains

**API Routes:**
- `/api/subdomain/register`: Register a new subdomain
- `/api/subdomain/update`: Update an existing subdomain
- `/api/subdomain/names`: Get all subdomains for a user

**Configuration:**
- `ENS_DOMAIN`: ENS domain (default: `nydusns.eth`)
- `JUSTANAME_API_KEY`: JustaName API key
- `PRIVATE_KEY`: Private key for server-side operations
- `PROVIDER_URL`: Ethereum RPC provider URL
- `CHAIN_ID`: Chain ID (default: 11155111 for Sepolia)

### 3. Oasis for Low-End Mobile Devices

I integrated Oasis TEE (Trusted Execution Environment) for server-side proof generation to support low-end mobile devices that struggle with client-side zero-knowledge proof generation:

- **Remote Proof Generation**: Proofs are generated on a secure Oasis TEE server instead of the client device
- **Performance Optimization**: Significantly faster proof generation for resource-constrained devices
- **Fallback Support**: Automatic detection of proof server availability with graceful fallback
- **Circuit Support**: Supports all circuit types (entry, deposit, send, withdraw, absorb)

**Implementation:**
- Proof server client (`/lib/proof-server.ts`)
- Automatic server status checking
- Configurable proof server URL via environment variables
- Secure HTTPS communication with the proof server

**Configuration:**
- `NEXT_PUBLIC_PROOF_SERVER_URL`: Oasis TEE proof server URL (default: `https://p3001.m1108.test-proxy-b.rofl.app`)

**Usage:**
The proof generation automatically uses the remote server when available. The client checks server status and falls back to local generation if the server is unavailable.

## Technology Stack

- **Framework**: Next.js 15.3.1 (App Router)
- **Language**: TypeScript
- **UI**: React 19, Tailwind CSS 4
- **Blockchain**: Wagmi, Viem, Celo Sepolia
- **Zero-Knowledge**: Noir.js, Aztec BB.js
- **Identity**: Self Protocol SDK, JustaName SDK
- **State Management**: React Context, TanStack Query
- **Package Manager**: pnpm 9.15.0

## Prerequisites

- Node.js 18+ 
- pnpm 9.15.0+
- A wallet (MetaMask or compatible)
- Environment variables configured (see below)

## Installation

1. **Clone the repository** (if not already done):
   ```bash
   git clone <repository-url>
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Set up environment variables**:
   Create a `.env.local` file in the `frontend` directory with the following variables:

   ```env
   # Blockchain Configuration
   NEXT_PUBLIC_CONTRACT_HOST_RPC=https://forno.celo-sepolia.celo-testnet.org
   NEXT_PUBLIC_PROJECT_ID=your-walletconnect-project-id

   # Self Protocol Configuration
   NEXT_PUBLIC_SELF_ENDPOINT=your-self-endpoint
   NEXT_PUBLIC_SELF_SCOPE_SEED=your-scope-seed
   NEXT_PUBLIC_SELF_APP_NAME=Nydus

   # ENS/JustaName Configuration
   ENS_DOMAIN=nydusns.eth
   JUSTANAME_API_KEY=your-justaname-api-key
   PRIVATE_KEY=your-server-private-key
   PROVIDER_URL=https://ethereum-sepolia-rpc.publicnode.com
   ORIGIN=http://localhost:3000

   # Oasis Proof Server (Optional)
   NEXT_PUBLIC_PROOF_SERVER_URL=https://p3001.m1108.test-proxy-b.rofl.app
   ```

4. **Precompile circuits** (if needed):
   ```bash
   pnpm run precompile
   ```

## Running the Application

### Development Mode

Start the development server with Turbopack:

```bash
pnpm dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

### Production Build

1. **Build the application**:
   ```bash
   pnpm build
   ```

2. **Start the production server**:
   ```bash
   pnpm start
   ```

### Clean Build

If you encounter build issues, you can clean the build cache:

```bash
bash clean-build.sh
# or manually:
rm -rf .next
rm -f tsconfig.tsbuildinfo
pnpm build
```

## Project Structure

```
frontend/
├── app/                    # Next.js App Router pages
│   ├── initialize/        # Account initialization with Self verification
│   ├── deposit/           # Deposit funds to zkAccount
│   ├── send/              # Send funds privately
│   ├── withdraw/          # Withdraw funds from zkAccount
│   ├── absorb/            # Absorb funds from another account
│   ├── naming/            # ENS subdomain management
│   ├── verification/      # Self Protocol verification page
│   └── api/               # API routes
│       └── subdomain/     # ENS subdomain API endpoints
├── components/            # React components
│   ├── ui/                # Reusable UI components
│   └── ...                # Feature-specific components
├── lib/                   # Utility libraries
│   ├── circuits/          # Noir circuit JSON files
│   ├── proof-server.ts    # Oasis proof server client
│   ├── justaname-api.ts   # JustaName/ENS integration
│   └── ...                # Other utilities
├── context/               # React Context providers
├── hooks/                 # Custom React hooks
├── config/                # Configuration files
└── types/                # TypeScript type definitions
```

## Key Workflows

### 1. Account Initialization

1. Connect wallet
2. Complete Self Protocol verification (OFAC screening)
3. Register ENS subdomain (optional)
4. Generate zkAddress and initialize account on-chain

### 2. ENS Subdomain Management

1. Navigate to `/naming`
2. Check subdomain availability
3. Register subdomain with zkAddress stored in text records
4. Update subdomain as needed

### 3. Private Transactions

All transactions (deposit, send, withdraw, absorb) support:
- Client-side proof generation (for capable devices)
- Server-side proof generation via Oasis (for low-end devices)
- Automatic fallback between methods

## Development Notes

- **Circuit Precompilation**: Circuits are precompiled before build. The `precompile-circuit.js` script handles this.
- **Buffer Polyfill**: The app includes a Buffer polyfill for browser compatibility with crypto libraries.
- **Webpack Configuration**: Custom webpack config handles Node.js module compatibility in the browser.
- **TypeScript**: Strict TypeScript is enabled. Build errors are not ignored by default.

## Troubleshooting

### Proof Generation Issues

- **Server unavailable**: Check `NEXT_PUBLIC_PROOF_SERVER_URL` and ensure the Oasis server is running
- **Local generation slow**: This is expected on low-end devices. Use the Oasis server for better performance
- **Circuit errors**: Ensure circuits are precompiled with `pnpm run precompile`

### ENS Subdomain Issues

- **Registration fails**: Check `JUSTANAME_API_KEY` and `PRIVATE_KEY` are set correctly
- **SIWE errors**: Ensure wallet is connected and can sign messages
- **Text records not updating**: Verify the subdomain exists and you have ownership

### Self Protocol Issues

- **Verification fails**: Check `NEXT_PUBLIC_SELF_ENDPOINT` and `NEXT_PUBLIC_SELF_SCOPE_SEED`
- **QR code not showing**: Ensure Self Protocol environment variables are configured
- **OFAC check fails**: This is expected for sanctioned users - the app will prevent access

## Contributing

When contributing, please note:
- This project uses pnpm for package management
- Follow the existing code style and TypeScript conventions
- Test on both desktop and mobile devices
- Ensure all environment variables are documented

## License

[Add your license information here]

## Support

For issues related to:
- **Self Protocol**: Check [Self Protocol documentation](https://docs.self.xyz)
- **JustaName/ENS**: Check [JustaName documentation](https://docs.justaname.id)
- **Oasis**: Check [Oasis documentation](https://docs.oasis.io)
- **Nydus Network**: Check the main project repository
