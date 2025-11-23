# Nydus Network

A privacy-preserving payment protocol built on Celo Sepolia using zero-knowledge proofs, Pedersen commitments, and elliptic curve cryptography.

## ⚠️ IMPORTANT DISCLAIMER

**This project was submitted at ETHGlobal as an personal otter project and workend to add features and is currently in ALPHA/TEST BUILD status.**

### ⛔️ NOT FOR PRODUCTION USE

- **This code is experimental and ever-changing**
- **NOT recommended for production deployment**
- **Strongly discouraged for reuse** due to known and unknown vulnerabilities
- **The developer(s) reject any and all responsibility** for misuse, loss of funds, security breaches, or any other damages resulting from the use of this code
- **Use at your own risk** - this software is provided "as is" without warranty of any kind

**By using this code, you acknowledge that:**
- The protocol may contain critical security vulnerabilities
- Funds may be lost or stolen
- The codebase is subject to constant changes
- No support or maintenance is guaranteed
- You assume full responsibility for any consequences

---

## Project Overview

Nydus is a privacy-preserving payment network that enables private transactions on EVM-compatible chains without relying on Merkle trees. Instead, it uses a novel architecture based on:

- **Pedersen Commitments**: Note stacks using point addition on Grumpkin curve
- **Zero-Knowledge Proofs**: Noir circuits with UltraHonk proving system
- **Elliptic Curve Cryptography**: Grumpkin curve for commitments, Baby Jubjub for key exchange
- **Poseidon CTR Encryption**: For encrypting transaction details

### Current Design: Permissionless

The protocol is currently designed to be **permissionless** with newly added Self Protocol features for OFAC compliance and identity verification. Users can:

- Create private zkAccounts
- Send and receive private transactions
- Deposit and withdraw funds
- Absorb incoming encrypted notes
- Register ENS subdomains for better UX

### Future Vision: Confidential Protocol for Institutions

**TBD - Future Development**

There is potential for Nydus to evolve into a **confidential protocol for institutional and merchant-oriented use cases**. This would involve:

- **Viewing Key Sharing**: Ability to share viewing keys with regulatory authorities or compliance officers
- **Controlled Transparency**: Enable protocol usage in regulated environments while maintaining user privacy
- **Institutional Features**: Enhanced compliance and audit capabilities

This future direction is **under consideration** and not yet implemented. The current codebase remains permissionless.

---

## Repository Structure

This monorepo contains three main components:

### 1. [Circuits](./circuits/) - Zero-Knowledge Proof Circuits

The cryptographic circuits implemented in Noir that power the privacy features.

**Key Features:**
- 5 main circuits: Entry, Deposit, Withdraw, Send, Absorb
- Pedersen vector commitments (3-generator system)
- Diffie-Hellman key exchange on Baby Jubjub curve
- Poseidon CTR encryption for transaction details
- Inner/outer product structure for efficient verification

**Technical Highlights:**
- No Merkle trees - uses commitment stacks instead
- Constant-time operations (O(1) gas cost)
- Efficient in both ZK circuits and Solidity
- Operates on BN254 curve with Baby Jubjub for ECDH

**See [circuits/README.md](./circuits/README.md) for detailed documentation.**

### 2. [Contracts](./contracts/) - Smart Contracts

The Solidity smart contracts that implement the on-chain protocol logic.

**Key Features:**
- Main Nydus contract with commitment stack management
- 5 verifier contracts (one per circuit)
- Grumpkin curve operations (gas-optimized)
- Poseidon2 hashing wrapper
- Self Protocol integration for OFAC compliance

**Technical Highlights:**
- **Note Stack Design**: Uses Pedersen commitments with point addition instead of Merkle trees
  - Fast insertion: ~21k gas per note (constant time)
  - No hash compromise: Avoids Keccak/Poseidon trade-offs
  - Efficient in both ZK and Solidity
- **Grumpkin Curve**: Default curve for Noir, optimal for Pedersen commitments
- **Two-Step Deployment**: Verifiers deployed first, then main contract

**Deployment:**
```bash
# Step 1: Deploy verifiers (saves addresses to VerifiersConst.sol)
forge script script/VerifierDeployer.s.sol:VerifierDeployer \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org \
  --keystore ~/.foundry/keystores/bob --broadcast

# Step 2: Deploy Nydus contract (uses verifiers from VerifiersConst.sol)
forge script script/Nydus.s.sol:NydusDeployer \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org \
  --keystore ~/.foundry/keystores/bob --broadcast --via-ir
```

**See [contracts/README.md](./contracts/README.md) for detailed documentation.**

### 3. [Frontend](./frontend/) - Web Application

Next.js-based frontend for interacting with the Nydus protocol.

**Key Features:**
- Account initialization with Self Protocol verification
- Private transaction interface (deposit, send, withdraw, absorb)
- ENS subdomain management
- Oasis TEE integration for server-side proof generation
- Transaction relayer for gasless transactions

**Technical Highlights:**
- **Self Protocol Integration**: OFAC compliance, age verification, geographic restrictions
- **ENS Subdomains**: Human-readable names with zkAddress storage in text records
- **Oasis TEE**: Server-side proof generation for low-end mobile devices
  - Reduces proof time from ~30 seconds to a few seconds
  - Supports all circuit types (entry, deposit, send, withdraw, absorb)
- **Transaction Relayer**: Server-side transaction broadcasting using PRIVATE_KEY

**Technology Stack:**
- Next.js 15.3.1 (App Router)
- React 19, TypeScript
- Wagmi, Viem for blockchain interaction
- Noir.js, Aztec BB.js for ZK proofs
- Self Protocol SDK, JustaName SDK

**See [frontend/README.md](./frontend/README.md) for detailed documentation.**

---

## Quick Start

### Prerequisites

- **Foundry**: [Install from getfoundry.sh](https://getfoundry.sh/)
- **Node.js**: v18+
- **pnpm** or **npm**

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd nydus-ethglobal
   ```

2. **Install dependencies**:
   ```bash
   # Install Foundry dependencies
   cd contracts && forge install && cd ..
   
   # Install Node.js dependencies
   cd frontend && pnpm install && cd ..
   ```

3. **Build circuits** (see [circuits/README.md](./circuits/README.md)):
   ```bash
   cd circuits
   ./build_circuits.sh
   ```

4. **Build contracts**:
   ```bash
   cd contracts
   forge build
   ```

5. **Run frontend**:
   ```bash
   cd frontend
   pnpm dev
   ```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                    │
│  • Self Protocol Integration                             │
│  • ENS Subdomain Management                              │
│  • Oasis TEE Proof Generation                            │
│  • Transaction Relayer                                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ ZK Proofs + Transactions
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Smart Contracts (Solidity)                  │
│  • Nydus Main Contract                                   │
│  • Commitment Stack Management                           │
│  • Grumpkin Curve Operations                             │
│  • Verifier Contracts (5 circuits)                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Verifies
                     ▼
┌─────────────────────────────────────────────────────────┐
│            Zero-Knowledge Proof (Noir)                  │
└─────────────────────────────────────────────────────────┘
```

---

## Key Technical Innovations

### 1. Note Stack Architecture

Unlike traditional privacy protocols that use Merkle trees, Nydus uses **Pedersen commitment stacks**:

- **Fast Insertion**: Point addition on Grumpkin curve (~21k gas)
- **No Hash Compromise**: Avoids Keccak/Poseidon trade-offs
- **Constant Time**: O(1) operations regardless of stack size
- **ZK-Friendly**: Native curve operations in circuits

### 2. Grumpkin Curve Optimization

- Default curve for Noir operations
- Efficient in both ZK circuits and Solidity
- Optimal for Pedersen commitments
- Compatible with Baby Jubjub for key generation

### 3. Three-Generator Pedersen Commitments

```
C = m·G + r·H + token·D
```

- **G**: Amount generator
- **H**: Blinding factor generator  
- **D**: Token address generator (domain separation)

### 4. Inner/Outer Product Structure

Separates commitments into:
- **Inner**: Hidden sensitive data
- **Outer**: Public metadata
- Enables efficient verification and ZK proofs

---

## Development Status

**Current Version**: Alpha/Test Build

- ✅ Core protocol implementation
- ✅ 5 ZK circuits (Entry, Deposit, Withdraw, Send, Absorb)
- ✅ Smart contract deployment
- ✅ Frontend with Self Protocol integration
- ✅ ENS subdomain management
- ✅ Oasis TEE proof generation
- ⚠️ Not audited
- ⚠️ Known and unknown vulnerabilities may exist
- ⚠️ Codebase is constantly changing

---

## Contributing

**⚠️ WARNING**: This is an experimental project. Contributions are welcome but:

- Code may change without notice
- No guarantee of merge or review
- Security vulnerabilities should be reported responsibly
- No production use is recommended

---

## License

See individual component licenses:
- [contracts/LICENSE](./contracts/)
- [frontend/LICENSE](./frontend/)
- [circuits/LICENSE](./circuits/)

---

## Support & Resources

- **Circuits Documentation**: [circuits/README.md](./circuits/README.md)
- **Contracts Documentation**: [contracts/README.md](./contracts/README.md)
- **Frontend Documentation**: [frontend/README.md](./frontend/README.md)

**External Resources:**
- [Noir Documentation](https://noir-lang.org/)
- [Foundry Documentation](https://book.getfoundry.sh/)
- [Self Protocol](https://docs.self.xyz/)
- [Grumpkin Curve](https://hackmd.io/@aztec-network/ByzgNxBfd#2-Grumpkin-Curve)

---

## Acknowledgments

- Built for ETHGlobal hackathon
- Uses Noir for zero-knowledge circuits
- Integrates Self Protocol for compliance
- Oasis TEE for proof generation optimization

---

**Remember: This is ALPHA software. Use at your own risk. Not for production.**
