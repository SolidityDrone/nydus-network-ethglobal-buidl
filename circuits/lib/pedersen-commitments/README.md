# Pedersen Commitments Library

This library provides vector commitments with domain separation for privacy-preserving token transfers.

## Features

- **Vector Commitments**: Commit to multiple values (amount, blinding, token_address)
- **Domain Separation**: Create distinct spaces for positive/negative balances
- **Homomorphic Arithmetic**: Add/subtract commitments
- **Balance Verification**: Prove sufficient funds without revealing amounts

## Usage

### Basic Commitment

```rust
use dep::pedersen_commitments::pedersen_commitments::pedersen_commitment_token;

let amount = 100 as Field;
let blinding = 0x1234567890abcdef as Field;
let token_address = 0x01 as Field;

let commitment = pedersen_commitment_token(amount, blinding, token_address);
```

### Positive/Negative Domain Separation

```rust
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_positive,
    pedersen_commitment_negative
};

// Positive space (deposited + incoming)
let positive_commitment = pedersen_commitment_positive(amount, blinding, token_address);

// Negative space (spent)
let negative_commitment = pedersen_commitment_negative(amount, blinding, token_address);
```

### Balance Verification

```rust
use dep::pedersen_commitments::pedersen_commitments::verify_balance_proof;

let balance_valid = verify_balance_proof(
    positive_commitment,
    negative_commitment,
    total_commitment,
    positive_amount,
    positive_blinding,
    negative_amount,
    negative_blinding,
    token_address
);
```

## Architecture

### Single Commitment Per User
- Each user has one commitment representing their net balance
- Domain separation prevents token mixing
- No complex tree structures needed

### Commitment Structure
```
C = amount*G + blinding*H + token_address*D

Where:
- G, H, D are generators
- amount = value
- blinding = randomness
- token_address = domain separator
```

### Positive/Negative Spaces
```
Positive: token_address + 0x10000000000000000000000000000000000000000000000000000000000000000 (deposited + incoming)
Negative: token_address (spent)

Example:
Token: 0x00000000000000000000000058002bee8f43bf203964d38c54fa03e62d615959fa
Positive: 0x00000000000000000000000158002bee8f43bf203964d38c54fa03e62d615959fa
Negative: 0x00000000000000000000000058002bee8f43bf203964d38c54fa03e62d615959fa
```

## Benefits

1. **Privacy**: Amounts and token types are hidden
2. **Efficiency**: Single commitment per user
3. **Flexibility**: Easy to prove balance
4. **Scalability**: No tree depth limitations
