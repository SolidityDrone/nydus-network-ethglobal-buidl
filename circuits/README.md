# Nydus Cryptographic Circuits

This directory contains the Noir circuits that implement the core cryptographic primitives for the Nydus privacy-preserving payment protocol. Unlike traditional zero-knowledge systems that rely on Merkle trees, Nydus uses a novel architecture based on **Pedersen vector commitments** and **inner/outer product structures** to achieve privacy and scalability.

## Table of Contents

1. [Overview](#overview)
2. [Pedersen Commitments](#pedersen-commitments)
   - [Standard Pedersen Commitments](#standard-pedersen-commitments)
   - [Pedersen Vector Commitments](#pedersen-vector-commitments)
3. [Diffie-Hellman Key Exchange](#diffie-hellman-key-exchange)
4. [Poseidon CTR Encryption](#poseidon-ctr-encryption)
5. [Inner/Outer Product Structure](#innerouter-product-structure)
6. [Circuit Architecture](#circuit-architecture)

---

## Overview

Nydus implements a privacy-preserving payment system without Merkle trees. Instead, it uses:

- **Pedersen Commitments**: Both standard and vector commitments for hiding amounts and token types
- **Diffie-Hellman Key Exchange**: For secure shared key derivation between sender and receiver
- **Poseidon CTR Encryption**: For encrypting transaction details using counter mode
- **Inner/Outer Product Structure**: For organizing commitments into verifiable structures

The system operates on the **BN254 curve** (also known as the Barreto-Naehrig curve) and uses **Baby Jubjub** for elliptic curve operations.

---

## Pedersen Commitments

### Standard Pedersen Commitments

A **Pedersen commitment** is a cryptographic commitment scheme that allows one to commit to a value while keeping it hidden, with the ability to reveal it later.

#### Mathematical Definition

Given a cyclic group \( G \) of prime order \( p \), and generators \( G, H \in G \) where the discrete logarithm of \( H \) with respect to \( G \) is unknown (the **discrete logarithm assumption**), a Pedersen commitment to a message \( m \in \mathbb{Z}_p \) with blinding factor \( r \in \mathbb{Z}_p \) is:

\[
C(m, r) = m \cdot G + r \cdot H
\]

**Properties:**
- **Hiding**: The commitment \( C \) reveals no information about \( m \) (computationally hiding)
- **Binding**: It is computationally infeasible to find \( (m', r') \neq (m, r) \) such that \( C(m', r') = C(m, r) \)
- **Homomorphic**: \( C(m_1, r_1) + C(m_2, r_2) = C(m_1 + m_2, r_1 + r_2) \)

#### Implementation in Nydus

In Nydus, standard Pedersen commitments are used for **non-hiding commitments** (where the value is not secret):

```rust
pub fn pedersen_commitment_non_hiding(m: Field, token_address: Field) -> EmbeddedCurvePoint {
    // C = m*G + token_address*D
    // Uses 2 generators: G (for amount) and D (for token address)
    let generators = derive_generators("PEDERSEN_COMMITMENT_PERSONAL", 0);
    let G = generators[0];
    let D = generators[1];
    
    return m*G + token_address*D;
}
```

This is used for commitments that don't require hiding (e.g., personal commitment state that can be decrypted with a view key).

### Pedersen Vector Commitments

A **Pedersen vector commitment** extends the standard Pedersen commitment to commit to multiple values simultaneously using multiple generators.

#### Mathematical Definition

Given \( n \) generators \( G_1, G_2, \ldots, G_n \in G \) and a vector of messages \( \mathbf{m} = (m_1, m_2, \ldots, m_n) \in \mathbb{Z}_p^n \) with a single blinding factor \( r \in \mathbb{Z}_p \), a Pedersen vector commitment is:

\[
C(\mathbf{m}, r) = \sum_{i=1}^{n} m_i \cdot G_i + r \cdot H
\]

Or more generally, with individual blinding factors:

\[
C(\mathbf{m}, \mathbf{r}) = \sum_{i=1}^{n} m_i \cdot G_i + \sum_{i=1}^{n} r_i \cdot H_i
\]

#### Implementation in Nydus

Nydus uses **3-generator Pedersen vector commitments** for token commitments:

```rust
pub fn pedersen_commitment_token(m: Field, r: Field, token_address: Field) -> EmbeddedCurvePoint {
    // C = m*G + r*H + token_address*D
    // Where:
    // - G: generator for amount (m)
    // - H: generator for blinding factor (r)
    // - D: generator for token address (domain separation)
    
    let generators = derive_generators("PEDERSEN_COMMITMENT", 0);
    let G = generators[0];  // Amount generator
    let H = generators[1];  // Blinding factor generator
    let D = generators[2];  // Token address generator
    
    return m*G + r*H + token_address*D;
}
```

**Why Vector Commitments?**

1. **Token Type Hiding**: The token address is committed alongside the amount, preventing token mixing
2. **Domain Separation**: Different generators create distinct commitment spaces
3. **Efficiency**: Single commitment operation commits to multiple values

#### Domain Separation

Nydus uses **domain separation** to create distinct commitment spaces for positive and negative balances:

- **Positive Space**: \( C_{\text{pos}}(m, r, \text{token}) = m \cdot G + r \cdot H + (\text{token} + \text{NULLIFIER\_DOMAIN}) \cdot D \)
- **Negative Space**: \( C_{\text{neg}}(m, r, \text{token}) = m \cdot G + r \cdot H + \text{token} \cdot D \)

Where `NULLIFIER_DOMAIN_SEPARATOR = 0x100000000000000000000000000000000000000000000000000000000000000`

This ensures that:
- Deposits and incoming notes use the **positive space**
- Spent amounts use the **negative space**
- The same token address in different spaces cannot be mixed

#### Homomorphic Properties

Pedersen commitments are **additively homomorphic**:

\[
C(m_1, r_1) + C(m_2, r_2) = (m_1 + m_2) \cdot G + (r_1 + r_2) \cdot H + (\text{token}_1 + \text{token}_2) \cdot D
\]

This allows:
- **Balance Verification**: Prove \( C_{\text{neg}} - C_{\text{pos}} \geq 0 \) without revealing amounts
- **Commitment Aggregation**: Combine multiple commitments into a single commitment
- **Zero-Knowledge Proofs**: Prove balance constraints without revealing values

---

## Diffie-Hellman Key Exchange

Nydus uses **Elliptic Curve Diffie-Hellman (ECDH)** on the **Baby Jubjub curve** to establish a shared secret key between sender and receiver for encrypting transaction details.

### Mathematical Definition

Given:
- Sender's private key: \( s_{\text{priv}} \in \mathbb{Z}_p \)
- Sender's public key: \( S_{\text{pub}} = s_{\text{priv}} \cdot G \)
- Receiver's public key: \( R_{\text{pub}} = r_{\text{priv}} \cdot G \)

The shared secret is:

\[
K_{\text{shared}} = s_{\text{priv}} \cdot R_{\text{pub}} = s_{\text{priv}} \cdot r_{\text{priv}} \cdot G
\]

Both parties compute the same shared key:
- **Sender**: \( K = s_{\text{priv}} \cdot R_{\text{pub}} \)
- **Receiver**: \( K = r_{\text{priv}} \cdot S_{\text{pub}} = r_{\text{priv}} \cdot s_{\text{priv}} \cdot G \)

### Implementation in Nydus

```rust
fn perform_dh_key_exchange(
    sender_private_key: Field, 
    receiver_public_key: [Field; 2]
) -> ([Field; 2], Field) {
    // Create Baby Jubjub curve point for receiver
    let receiver_point = Point::new(
        receiver_public_key[0], 
        receiver_public_key[1]
    );
    
    // Compute shared secret: sender_private_key * receiver_public_key
    let shared_point = receiver_point * sender_private_key;
    
    // Return sender's derived public key and shared secret
    let sender_point = baby_jubjub::GENERATOR * sender_private_key;
    let shared_key = shared_point.x; // Use x-coordinate as shared key
    
    return ([sender_point.x, sender_point.y], shared_key);
}
```

**Why Diffie-Hellman?**

1. **Forward Secrecy**: Each transaction uses a unique shared key derived from the nonce
2. **No Pre-Shared Keys**: Sender and receiver don't need to exchange keys beforehand
3. **Public Key Cryptography**: Only the receiver with the corresponding private key can decrypt

**Key Derivation:**

The sender uses: \( s_{\text{priv}} = \text{user\_key} + \text{nonce} \)

This ensures:
- Each transaction has a unique key pair
- The shared key is transaction-specific
- Even if one key is compromised, previous transactions remain secure

---

## Poseidon CTR Encryption

Nydus uses **Poseidon hash function** in **Counter (CTR) mode** for symmetric encryption of transaction details.

### CTR Mode Overview

**Counter Mode (CTR)** is a block cipher mode of operation that turns a block cipher (or hash function) into a stream cipher:

1. Generate a **keystream** by hashing the key and counter
2. Encrypt by XORing (or adding in field arithmetic) the plaintext with the keystream
3. Decrypt by XORing (or subtracting) the ciphertext with the same keystream

### Mathematical Definition

Given:
- Plaintext: \( P \in \mathbb{F}_p \)
- Key: \( K \in \mathbb{F}_p \)
- Counter: \( c \in \mathbb{Z} \)

**Encryption:**
\[
\text{Keystream} = \text{Poseidon}(K, c)
\]
\[
C = P + \text{Keystream} \pmod{p}
\]

**Decryption:**
\[
P = C - \text{Keystream} \pmod{p}
\]

### Implementation in Nydus

```rust
pub fn poseidon_keystream(key: Field, nonce: u32) -> Field {
    // Generate keystream using Poseidon hash
    Poseidon2::hash([key, nonce as Field], 2)
}

pub fn poseidon_ctr_encrypt(plaintext: Field, key: Field, counter: u32) -> Field {
    let keystream = poseidon_keystream(key, counter);
    // Field arithmetic addition (equivalent to XOR in binary)
    plaintext + keystream
}

pub fn poseidon_ctr_decrypt(ciphertext: Field, key: Field, counter: u32) -> Field {
    let keystream = poseidon_keystream(key, counter);
    // Field arithmetic subtraction
    ciphertext - keystream
}
```

**Why Poseidon CTR?**

1. **Zero-Knowledge Friendly**: Poseidon is designed for ZK circuits (low constraint count)
2. **Field Arithmetic**: Works directly with field elements (no bit manipulation)
3. **Deterministic**: Same inputs produce same keystream (allows verification)
4. **Counter-Based**: Different counters produce different keystreams for multiple fields

**Multi-Field Encryption:**

Nydus encrypts multiple fields using different counters:

```rust
pub fn poseidon_encrypt_all_fields(
    amount: Field,
    token_address: Field,
    ref: Field,
    encryption_key: Field
) -> (Field, Field, Field, Field) {
    let encrypted_amount = poseidon_ctr_encrypt(amount, encryption_key, 0);
    let encrypted_token_address = poseidon_ctr_encrypt(token_address, encryption_key, 1);
    let encrypted_ref = poseidon_ctr_encrypt(ref, encryption_key, 2);
    let encrypted_key = poseidon_ctr_encrypt(encryption_key, encryption_key, 3);
    
    (encrypted_amount, encrypted_token_address, encrypted_ref, encrypted_key)
}
```

The `ref` field provides **integrity checking**: when decrypting, if the wrong key is used, the `ref` value won't match, indicating tampering.

---

## Inner/Outer Product Structure

Nydus organizes commitments into an **inner/outer product structure** to enable efficient verification and zero-knowledge proofs.

### Structure Overview

The inner/outer product structure splits commitments into two components:

1. **Inner Commitment** (\( C_{\text{inner}} \)): Commits to the **value/amount** and related data
2. **Outer Commitment** (\( C_{\text{outer}} \)): Commits to **metadata** or **public information**

The **total commitment** is:

\[
C_{\text{tot}} = C_{\text{inner}} + C_{\text{outer}}
\]

### Main Stack Commitments

For the **main stack** (user's transaction history):

- **\( C_{\text{main\_inner}} \)**: Commits to encrypted coordinates \( (x, y) \) and nonce commitment
  \[
  C_{\text{main\_inner}} = x \cdot G + y \cdot H + \text{nonce\_commitment} \cdot D
  \]

- **\( C_{\text{main\_outer}} \)**: Commits to token address hash and user key hash
  \[
  C_{\text{main\_outer}} = \text{token\_hash} \cdot G + \text{user\_key\_hash} \cdot H + \text{domain} \cdot D
  \]

- **\( C_{\text{main\_tot}} \)**: Total main commitment
  \[
  C_{\text{main\_tot}} = C_{\text{main\_inner}} + C_{\text{main\_outer}}
  \]

### Notes Stack Commitments

For **incoming notes** (received transactions):

- **\( C_{\text{notes\_inner}} \)**: Commits to amount, shared key hash, and token address
  \[
  C_{\text{notes\_inner}} = \text{amount} \cdot G + \text{shared\_key\_hash} \cdot H + \text{token\_address} \cdot D
  \]

- **\( C_{\text{notes\_outer}} \)**: Commits to receiver's public key
  \[
  C_{\text{notes\_outer}} = \text{pub\_x} \cdot G + \text{pub\_y} \cdot H + 1 \cdot D
  \]

- **Reference Commitment**: Same as \( C_{\text{notes\_outer}} \) (for integrity)
- **\( C_{\text{notes\_tot}} \)**: Total notes commitment
  \[
  C_{\text{notes\_tot}} = C_{\text{notes\_inner}} + C_{\text{notes\_outer}} + C_{\text{reference}}
  \]

### Personal Commitments

For **user balance state**:

- **\( C_{\text{personal\_inner}} \)**: Commits to balance amount hash and token address hash (non-hiding)
  \[
  C_{\text{personal\_inner}} = \text{balance\_hash} \cdot G + \text{token\_hash} \cdot D
  \]

- **\( C_{\text{personal\_outer}} \)**: Commits to metadata (non-hiding)
  \[
  C_{\text{personal\_outer}} = 0 \cdot G + \text{token\_address} \cdot D
  \]

- **\( C_{\text{personal\_tot}} \)**: Total personal commitment
  \[
  C_{\text{personal\_tot}} = C_{\text{personal\_inner}} + C_{\text{personal\_outer}} + C_{\text{nullifier}} + C_{\text{initializer}}
  \]

### Why Inner/Outer Structure?

1. **Separation of Concerns**: Inner commitments hide sensitive data, outer commitments contain public metadata
2. **Efficient Verification**: Can verify inner and outer commitments independently
3. **Zero-Knowledge Proofs**: Can prove properties about inner commitments without revealing values
4. **Scalability**: No tree depth limitations (unlike Merkle trees)

---

## Circuit Architecture

### Circuit Types

Nydus implements 5 main circuits:

1. **`nydus-entry`**: Initialize a new user account
2. **`nydus-deposit`**: Deposit funds into the system
3. **`nydus-send`**: Send funds to another user
4. **`nydus-absorb`**: Absorb incoming notes into balance
5. **`nydus-withdraw`**: Withdraw funds from the system

### Common Pattern

Each circuit follows a similar pattern:

1. **Input Verification**: Verify opening values for existing commitments
2. **Balance Checks**: Verify sufficient balance (without revealing amounts)
3. **Commitment Updates**: Compute new commitments for updated state
4. **Encryption**: Encrypt transaction details using DH + Poseidon CTR
5. **Output**: Return new commitments and encrypted data

### Example: Send Circuit

```rust
pub fn main(
    user_key: Field,
    token_address: pub Field,
    amount: pub Field,
    previous_nonce: Field,
    // ... commitment inputs ...
    receiver_public_key: pub [Field; 2],
    // ...
) -> pub (Field, [Field; 2], [Field; 7], ...) {
    // 1. Verify existing commitments
    verify_main_commitments(...);
    verify_personal_commitments(...);
    
    // 2. Check balance
    assert(current_balance >= amount + fee);
    
    // 3. Perform DH key exchange
    let (sender_pub_key, shared_key) = perform_dh_key_exchange(
        user_key + nonce, 
        receiver_public_key
    );
    
    // 4. Encrypt note details
    let encrypted_note = encrypt_operation_details(...);
    
    // 5. Create new commitments
    let new_main_commitment = create_new_commitments(...);
    let notes_c_tot = create_notes_commitment(amount, shared_key, token_address);
    
    // 6. Return outputs
    (new_nonce_commitment, new_main_commitment, encrypted_note, ...)
}
```

---

## Security Properties

### Privacy

1. **Amount Hiding**: Amounts are committed using Pedersen commitments (computationally hiding)
2. **Token Hiding**: Token addresses are committed (preventing token type analysis)
3. **Sender/Receiver Privacy**: Only the receiver can decrypt transaction details
4. **Balance Privacy**: Balances are hidden in commitments

### Integrity

1. **Binding**: Pedersen commitments are computationally binding
2. **Balance Verification**: Can prove balance constraints without revealing amounts
3. **Encryption Integrity**: The `ref` field provides integrity checking for encrypted notes

### Scalability

1. **No Merkle Trees**: Single commitment per user (no tree depth limitations)
2. **Constant Verification**: Commitment verification is O(1) (independent of transaction history)
3. **Efficient Proofs**: Inner/outer structure enables efficient zero-knowledge proofs

---

## Mathematical Foundations

### Discrete Logarithm Problem

The security of Pedersen commitments relies on the **Discrete Logarithm Problem (DLP)**:

Given \( G, H \in G \) and \( C = m \cdot G + r \cdot H \), it is computationally infeasible to find \( m, r \) without knowing them.

### Elliptic Curve Cryptography

Nydus uses:
- **BN254 curve**: For field arithmetic and Pedersen commitments
- **Baby Jubjub curve**: For Diffie-Hellman key exchange

Both curves provide:
- **128-bit security level**
- **Efficient arithmetic in ZK circuits**
- **Compatibility with Ethereum** (BN254 is used in Ethereum precompiles)

### Zero-Knowledge Proofs

The circuits generate **zero-knowledge proofs** that:
- Prove commitment openings are correct
- Prove balance constraints are satisfied
- Prove encryption was performed correctly

Without revealing:
- Private keys
- Amounts
- Token types
- Balance values

---

## References

- [Pedersen Commitments](https://en.wikipedia.org/wiki/Commitment_scheme#Pedersen_commitment)
- [Diffie-Hellman Key Exchange](https://en.wikipedia.org/wiki/Diffie%E2%80%93Hellman_key_exchange)
- [CTR Mode](https://en.wikipedia.org/wiki/Block_cipher_mode_of_operation#Counter_(CTR))
- [Poseidon Hash](https://www.poseidon-hash.info/)
- [Baby Jubjub Curve](https://eips.ethereum.org/EIPS/eip-2494)
- [BN254 Curve](https://hackmd.io/@aztec-network/ByzgNxBfd#2-Points--Curves-For-Snarks)

