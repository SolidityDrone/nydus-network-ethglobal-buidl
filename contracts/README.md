# Nydus Smart Contracts

The Nydus smart contracts implement a privacy-preserving payment network on Celo Sepolia using zero-knowledge proofs and elliptic curve cryptography. This repository contains the core Solidity contracts, verifiers, and deployment scripts for the Nydus protocol.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Technical Design](#technical-design)
- [Installation](#installation)
- [Building](#building)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contract Structure](#contract-structure)
- [Key Features](#key-features)

## Overview

Nydus is a zero-knowledge privacy protocol that enables private transactions on EVM-compatible chains. The protocol uses:

- **Zero-Knowledge Proofs**: Noir circuits with UltraHonk proving system
- **Grumpkin Curve**: Default elliptic curve for Noir operations
- **Pedersen Commitments**: Note stacks using point addition on Grumpkin curve
- **Self Protocol Integration**: OFAC-compliant identity verification

## Architecture

### Deployment Flow

The Nydus protocol requires a two-step deployment process:

1. **Verifier Deployment**: Deploy all 5 circuit verifiers (Entry, Deposit, Withdraw, Send, Absorb)
2. **Nydus Contract Deployment**: Deploy the main Nydus contract with verifier addresses

The verifiers are automatically saved as constants in `VerifiersConst.sol` during deployment, which are then used by the Nydus contract constructor. This design ensures verifier addresses are immutable and reduces deployment complexity.

### Contract Hierarchy

```
Nydus (Main Contract)
├── ProofOfHuman (Self Protocol integration)
├── Grumpkin (Curve operations)
├── Poseidon2YulWrapper (Hashing)
└── VerifiersConst (Verifier addresses)
    ├── Entry Verifier
    ├── Deposit Verifier
    ├── Withdraw Verifier
    ├── Send Verifier
    └── Absorb Verifier
```

## Technical Design

### Grumpkin Curve

Nydus uses the **Grumpkin curve** as its primary elliptic curve, which is the default curve for Noir operations. The Grumpkin curve is defined over the BN254 scalar field with the equation:

```
y² = x³ - 17
```

**Why Grumpkin?**
- Native support in Noir/Noir.js
- Efficient point operations in both ZK circuits and Solidity
- Compatible with Baby Jubjub for key generation
- Optimal for Pedersen commitments

### Note Stack Design: Pedersen Commitments vs. Merkle Trees

Nydus uses a **note stack architecture** with Pedersen commitments rather than traditional Merkle trees. This design choice provides significant advantages:

#### Advantages of Note Stacks

1. **Fast Insertion**: New notes are added using simple point addition on the Grumpkin curve:
   ```
   new_commitment = old_commitment + note_commitment
   ```
   This is a single elliptic curve point addition operation (~21k gas), compared to Merkle tree updates which require multiple hash operations and tree traversal.

2. **No Hash Compromise**: Traditional privacy protocols face a fundamental trade-off:
   - **Keccak256**: Excellent in Solidity (~30 gas), terrible in ZK circuits (thousands of constraints)
   - **MiMC**: Terrible in both Solidity and ZK circuits
   - **Poseidon**: Best for ZK (hundreds of constraints), but expensive on-chain (~50k+ gas per hash)

   By using point addition instead of hashing, Nydus completely avoids this compromise. Point addition is:
   - Efficient in ZK circuits (native curve operation)
   - Efficient in Solidity (single `ecAdd` or optimized assembly)

3. **Constant Gas Cost**: Note insertion has constant gas cost regardless of stack size, unlike Merkle trees which scale logarithmically with tree depth.

4. **Aggregated Openings**: The stack maintains aggregated opening values (m, r, d) for the Pedersen commitment, allowing efficient proof generation without storing individual note commitments.

#### Technical Implementation

The note stack uses a three-generator Pedersen commitment:
```
commitment = m·G + r·H + d·D
```

Where:
- `G`, `H`, `D` are generators on the Grumpkin curve
- `m` is the message (aggregated amount)
- `r` is the randomness (aggregated)
- `d` is an additional generator for enhanced privacy

When a new note is added:
```solidity
new_commitment_point = old_commitment_point + note_commitment_point
new_m = old_m + note_m
new_r = old_r + note_r
new_d = old_d + note_d
```

This allows the contract to verify that a user knows the opening values for their notes without revealing individual note amounts.

### Commitment Structure

The protocol maintains three types of commitment stacks:

1. **State Commitment (`main_c_tot`)**: Global state commitment aggregating all user balances
2. **Balance Commitment (`personal_c_tot`)**: Per-user balance commitment stack
3. **Note Commitment (`notes_c_tot`)**: Per-user note commitment stack for incoming notes

### Zero-Knowledge Circuits

Nydus uses 5 Noir circuits, each with its own verifier:

1. **Entry**: Initialize a new zkAccount
2. **Deposit**: Deposit funds from public address to zkAccount
3. **Withdraw**: Withdraw funds from zkAccount to public address
4. **Send**: Send funds privately between zkAccounts
5. **Absorb**: Absorb incoming encrypted notes into balance

Each circuit verifies:
- Knowledge of private keys (user_key)
- Correct commitment updates
- Balance conservation
- Nonce increment
- Nullifier generation (for absorb)

## Installation

### Prerequisites

- **Foundry**: Install from [getfoundry.sh](https://getfoundry.sh/)
- **Node.js**: v18+ (for pnpm/npm)
- **pnpm** or **npm**: Package manager

### Setup

1. **Install Foundry dependencies**:
   ```bash
   forge install
   ```

2. **Install Node.js dependencies**:
   ```bash
   # Using pnpm (recommended)
   pnpm install
   
   # Or using npm
   npm install
   ```

3. **Make extract-abi script executable**:
   ```bash
   cd contracts
   chmod +x ./extract-abi.sh
   ```

## Building

### Compile Contracts

```bash
forge build
```

This compiles all contracts including:
- Main Nydus contract
- Verifier contracts (generated from Noir circuits)
- Grumpkin curve library
- Poseidon2 hashing wrapper

### Extract ABI

After building, extract the Nydus ABI:

```bash
./extract-abi.sh
```

This creates `Nydus.abi.json` from the compiled contract, useful for frontend integration.

## Testing

### Run All Tests

```bash
forge test
```

### Run with Verbose Output

```bash
forge test -vvv
```

### Coverage Report

```bash
# Generate coverage
forge coverage

# Generate HTML report
pnpm test:coverage:report
```

### Test Files

- `test/Nydus.t.sol`: Main protocol tests
- `test/GrumpkinTest.sol`: Curve operation tests
- `test/CommitmentTest.sol`: Commitment stack tests
- `test/NoirCommitmentTest.sol`: ZK circuit compatibility tests

## Deployment

### Prerequisites

1. **Keystore Setup**: Create a keystore file using Foundry:
   ```bash
   forge wallet new bob
   ```

2. **Environment Variables**: Ensure you have:
   - RPC URL for Celo Sepolia
   - Blockscout API key for verification

### Step 1: Deploy Verifiers

Deploy all 5 circuit verifiers. The deployment script automatically writes verifier addresses to `src/VerifiersConst.sol`:

```bash
forge script script/VerifierDeployer.s.sol:VerifierDeployer \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org \
  --keystore ~/.foundry/keystores/bob \
  --broadcast \
  --skip src/**.sol \
  verify \
  --verifier blockscout \
  --verifier-url https://celo-sepolia.blockscout.com/<API_KEY>
```

**Important**: This script:
- Deploys all 5 verifiers (Entry, Deposit, Withdraw, Send, Absorb)
- Automatically writes addresses to `src/VerifiersConst.sol` as constants
- Verifies contracts on Blockscout

### Step 2: Deploy Nydus Contract

Deploy the main Nydus contract using verifiers from `VerifiersConst.sol`:

```bash
forge script script/Nydus.s.sol:NydusDeployer \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org \
  --keystore ~/.foundry/keystores/bob \
  --broadcast \
  --skip src/Verifiers/**.sol \
  verify \
  --verifier blockscout \
  --verifier-url https://celo-sepolia.blockscout.com/<API_KEY> \
  --via-ir
```

**Important Notes**:
- `--via-ir`: Enables IR-based code generation (required for large contracts)
- `--skip src/Verifiers/**.sol`: Skips verifying verifier contracts (already verified in step 1)
- The contract reads verifier addresses from `VerifiersConst.sol` constants

### Deployment Order

**Critical**: Always deploy verifiers first, then the Nydus contract. The Nydus contract constructor requires verifier addresses, which are provided via `VerifiersConst.sol` constants.

### Verification

Both scripts include contract verification on Blockscout. Ensure you:
1. Have a Blockscout API key
2. Replace `<API_KEY>` with your actual API key
3. Wait for deployment transactions to be confirmed before verification

## Contract Structure

### Core Contracts

#### `Nydus.sol`
Main protocol contract implementing:
- Commitment stack management
- Zero-knowledge proof verification
- Note encryption/decryption
- Balance tracking
- Self Protocol integration

**Key State Variables**:
- `stateCommitmentPoint`: Global state commitment
- `balanceCommitmentStack`: Per-user balance commitments
- `noteCommitmentStack`: Per-user note commitments
- `userEncryptedNotes`: Encrypted incoming notes

#### `Grumpkin.sol`
Gas-optimized Grumpkin curve operations:
- Point addition
- Point doubling
- Point negation
- Uses EVM's modexp precompile (0x05) for inversions

#### `Poseidon2YulWrapper.sol`
Wrapper for Poseidon2 hashing using Yul assembly for gas optimization.

#### `ProofOfHuman.sol`
Self Protocol integration for OFAC-compliant identity verification.

### Verifier Contracts

Located in `src/Verifiers/`:
- `VerifierEntry.sol`
- `VerifierDeposit.sol`
- `VerifierWithdraw.sol`
- `VerifierSend.sol`
- `VerifierAbsorb.sol`

Each verifier implements the `IVerifier` interface:
```solidity
function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) 
    external view returns (bool);
```

### Constants

#### `VerifiersConst.sol`
Library containing verifier addresses as constants. Automatically generated during verifier deployment:

```solidity
library VerifiersConst {
    address public constant ENTRY_VERIFIER = 0x...;
    address public constant SEND_VERIFIER = 0x...;
    address public constant ABSORB_VERIFIER = 0x...;
    address public constant DEPOSIT_VERIFIER = 0x...;
    address public constant WITHDRAW_VERIFIER = 0x...;
}
```

## Key Features

### 1. Privacy-Preserving Transactions

All transaction amounts, token addresses, and balances are encrypted using:
- Grumpkin curve public key cryptography
- Poseidon2-based encryption
- Zero-knowledge proofs for validity

### 2. Efficient Note Management

- **Constant-time insertion**: O(1) gas cost for adding notes
- **No Merkle tree overhead**: Avoids logarithmic scaling
- **Aggregated commitments**: Single point represents entire stack

### 3. Self Protocol Integration

- OFAC compliance checking
- Age verification (18+)
- Geographic restrictions
- Identity verification via Self Protocol

### 4. Gas Optimization

- **Grumpkin point operations**: ~21k gas per addition
- **Yul assembly**: Optimized Poseidon2 implementation
- **IR code generation**: `--via-ir` flag for large contracts
- **No hash compromise**: Point addition avoids expensive hashing

### 5. Circuit Verification

Each operation requires a zero-knowledge proof:
- Proves knowledge of private keys
- Verifies commitment updates
- Ensures balance conservation
- Prevents double-spending via nullifiers

## Development

### Format Code

```bash
forge fmt
```

### Lint

```bash
pnpm lint
```

### Clean Build Artifacts

```bash
pnpm clean
# or
rm -rf cache out
```

## Gas Costs

Typical gas costs (approximate):

- **Entry**: ~500k gas (initial account setup)
- **Deposit**: ~300k gas (public → private)
- **Withdraw**: ~300k gas (private → public)
- **Send**: ~400k gas (private → private)
- **Absorb**: ~350k gas (note absorption)

Note: Gas costs vary based on:
- Circuit complexity
- Commitment stack size
- Proof verification cost
- Contract state size

## Security Considerations

1. **Verifier Immutability**: Verifier addresses are constants, preventing upgrades
2. **Nonce Tracking**: Prevents replay attacks
3. **Nullifier System**: Prevents double-spending in absorb operations
4. **Self Protocol**: OFAC compliance and identity verification
5. **Commitment Integrity**: Historical commitments tracked to prevent state manipulation

## Troubleshooting

### Build Errors

- **Stack too deep**: Use `--via-ir` flag for large contracts
- **Missing dependencies**: Run `forge install` and `pnpm install`

### Deployment Errors

- **Verifier not found**: Ensure verifiers are deployed first
- **Verification failed**: Check API key and wait for transaction confirmation
- **Out of gas**: Increase gas limit or optimize contract size

### Test Failures

- **Circuit mismatch**: Ensure Noir circuits match verifier contracts
- **Commitment errors**: Verify Grumpkin curve operations
- **Proof verification**: Check public inputs format

## References

- [Foundry Documentation](https://book.getfoundry.sh/)
- [Noir Documentation](https://noir-lang.org/)
- [Grumpkin Curve](https://hackmd.io/@aztec-network/ByzgNxBfd#2-Grumpkin-Curve)
- [Self Protocol](https://docs.self.xyz/)
- [Celo Sepolia Explorer](https://celo-sepolia.blockscout.com/)

## License

UNLICENSED
