const { poseidon2Hash } = require('@aztec/foundation/crypto');

/**
 * TypeScript implementation of Poseidon CTR Mode Encryption
 * 
 * This library provides Poseidon-based encryption in CTR mode for field elements.
 * It includes functions for encrypting individual fields and batch encryption.
 * 
 * Matches the Noir implementation in circuits/lib/poseidon-ctr-encryption/src/lib.nr
 */

/**
 * Generate a keystream using Poseidon with shared_key and nonce
 */
export async function poseidonKeystream(sharedKey: bigint, nonce: number): Promise<bigint> {
    // Use Poseidon2 to hash shared_key and nonce
    const result = await poseidon2Hash([sharedKey, BigInt(nonce)]);

    // Convert result to bigint
    let keystream: bigint;
    if (typeof result === 'bigint') {
        keystream = result;
    } else if ('toBigInt' in result && typeof (result as any).toBigInt === 'function') {
        keystream = (result as any).toBigInt();
    } else if ('value' in result) {
        keystream = BigInt((result as any).value);
    } else {
        keystream = BigInt((result as any).toString());
    }

    return keystream;
}

/**
 * Encrypt a single field using Poseidon CTR mode
 */
export async function poseidonCtrEncrypt(plaintext: bigint, sharedKey: bigint, counter: number): Promise<bigint> {
    // Generate keystream using Poseidon with shared_key and counter
    const keystream = await poseidonKeystream(sharedKey, counter);

    // Encrypt by adding keystream to plaintext (field arithmetic equivalent of XOR)
    const ciphertext = (plaintext + keystream) % BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

    return ciphertext;
}

/**
 * Decrypt a single field using Poseidon CTR mode
 */
export async function poseidonCtrDecrypt(ciphertext: bigint, sharedKey: bigint, counter: number): Promise<bigint> {
    // Generate the same keystream
    const keystream = await poseidonKeystream(sharedKey, counter);

    // Decrypt by subtracting keystream from ciphertext
    const plaintext = (ciphertext - keystream) % BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

    return plaintext;
}

/**
 * Encrypt all four fields (amount, token_address, ref, encryption_key) in one function call
 * This provides integrity checking - the ref value can be verified when absorbing the note
 */
export async function poseidonEncryptAllFields(
    amount: bigint,
    tokenAddress: bigint,
    ref: bigint,
    encryptionKey: bigint
): Promise<[bigint, bigint, bigint, bigint]> {
    // Encrypt all four fields with different counters
    const encryptedAmount = await poseidonCtrEncrypt(amount, encryptionKey, 0);
    const encryptedTokenAddress = await poseidonCtrEncrypt(tokenAddress, encryptionKey, 1);
    const encryptedRef = await poseidonCtrEncrypt(ref, encryptionKey, 2);
    const encryptedKey = await poseidonCtrEncrypt(encryptionKey, encryptionKey, 3);

    return [encryptedAmount, encryptedTokenAddress, encryptedRef, encryptedKey];
}

/**
 * Encrypt all four fields and return as array for cleaner API
 */
export async function poseidonEncryptAllFieldsArray(
    amount: bigint,
    tokenAddress: bigint,
    ref: bigint,
    encryptionKey: bigint
): Promise<[bigint, bigint, bigint]> {
    // Encrypt all four fields and return the first 3 as an array
    const encryptedAmount = await poseidonCtrEncrypt(amount, encryptionKey, 0);
    const encryptedTokenAddress = await poseidonCtrEncrypt(tokenAddress, encryptionKey, 1);
    const encryptedRef = await poseidonCtrEncrypt(ref, encryptionKey, 2);

    return [encryptedAmount, encryptedTokenAddress, encryptedRef];
}

/**
 * Test function to verify CTR encryption matches Noir implementation
 */
export async function testPoseidonCtrEncryption(
    amount: bigint,
    tokenAddress: bigint,
    ref: bigint,
    encryptionKey: bigint
): Promise<{
    encryptedAmount: bigint;
    encryptedTokenAddress: bigint;
    encryptedRef: bigint;
    encryptedKey: bigint;
    decryptedAmount: bigint;
    decryptedTokenAddress: bigint;
    decryptedRef: bigint;
    decryptedKey: bigint;
}> {
    console.log('=== TypeScript Poseidon CTR Encryption Test ===');

    console.log('Input values:');
    console.log('Amount:', amount.toString(16));
    console.log('Token Address:', tokenAddress.toString(16));
    console.log('Ref:', ref.toString(16));
    console.log('Encryption Key:', encryptionKey.toString(16));

    // Encrypt all fields
    const [encryptedAmount, encryptedTokenAddress, encryptedRef, encryptedKey] =
        await poseidonEncryptAllFields(amount, tokenAddress, ref, encryptionKey);

    console.log('\nEncrypted values:');
    console.log('Encrypted Amount:', encryptedAmount.toString(16));
    console.log('Encrypted Token Address:', encryptedTokenAddress.toString(16));
    console.log('Encrypted Ref:', encryptedRef.toString(16));
    console.log('Encrypted Key:', encryptedKey.toString(16));

    // Decrypt all fields
    const decryptedAmount = await poseidonCtrDecrypt(encryptedAmount, encryptionKey, 0);
    const decryptedTokenAddress = await poseidonCtrDecrypt(encryptedTokenAddress, encryptionKey, 1);
    const decryptedRef = await poseidonCtrDecrypt(encryptedRef, encryptionKey, 2);
    const decryptedKey = await poseidonCtrDecrypt(encryptedKey, encryptionKey, 3);

    console.log('\nDecrypted values:');
    console.log('Decrypted Amount:', decryptedAmount.toString(16));
    console.log('Decrypted Token Address:', decryptedTokenAddress.toString(16));
    console.log('Decrypted Ref:', decryptedRef.toString(16));
    console.log('Decrypted Key:', decryptedKey.toString(16));

    return {
        encryptedAmount,
        encryptedTokenAddress,
        encryptedRef,
        encryptedKey,
        decryptedAmount,
        decryptedTokenAddress,
        decryptedRef,
        decryptedKey
    };
}

/**
 * Convert hex string to bigint
 */
export function hexToBigInt(hex: string): bigint {
    return BigInt(hex);
}

/**
 * Convert bigint to hex string
 */
export function bigIntToHex(value: bigint): string {
    return '0x' + value.toString(16);
}
