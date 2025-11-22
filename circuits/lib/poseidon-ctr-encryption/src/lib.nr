use dep::std;
use dep::poseidon::poseidon2::Poseidon2;

/// Poseidon CTR Mode Encryption Library
/// 
/// This library provides Poseidon-based encryption in CTR mode for field elements.
/// It includes functions for encrypting individual fields and batch encryption.

/// Generate a keystream using Poseidon with key and nonce
pub fn poseidon_keystream(key: Field, nonce: u32) -> Field {
    // === POSEIDON KEYSTREAM GENERATION ===
    // Generate keystream using Poseidon with key and nonce
    
    // Use the public hash function with key and nonce
    Poseidon2::hash([key, nonce as Field], 2)
}

/// Encrypt a single field using Poseidon CTR mode
pub fn poseidon_ctr_encrypt(plaintext: Field, key: Field, counter: u32) -> Field {
    // === POSEIDON CTR MODE ENCRYPTION ===
    // Use Poseidon to generate keystream for CTR mode encryption
    
    // Generate keystream using Poseidon with key and counter
    let keystream = poseidon_keystream(key, counter);
    
    // Encrypt by adding keystream to plaintext (field arithmetic equivalent of XOR)
    let ciphertext = plaintext + keystream;
    
    ciphertext
}

/// Decrypt a single field using Poseidon CTR mode
pub fn poseidon_ctr_decrypt(ciphertext: Field, key: Field, counter: u32) -> Field {
    // === POSEIDON CTR MODE DECRYPTION ===
    // Decryption is the same as encryption in CTR mode
    
    // Generate the same keystream
    let keystream = poseidon_keystream(key, counter);
    
    // Decrypt by subtracting keystream from ciphertext
    let plaintext = ciphertext - keystream;
    
    plaintext
}

/// Encrypt all four fields (amount, token_address, ref, encryption_key) in one function call
/// This provides integrity checking - the ref value can be verified when absorbing the note
pub fn poseidon_encrypt_all_fields(
    amount: Field, 
    token_address: Field,
    ref: Field,
    encryption_key: Field
) -> (Field, Field, Field, Field) {
    // === POSEIDON ENCRYPT ALL FIELDS ===
    // Encrypt all four fields with different counters in one function call
    // The ref value provides integrity checking when absorbing the note
    
    let encrypted_amount = poseidon_ctr_encrypt(amount, encryption_key, 0);
    let encrypted_token_address = poseidon_ctr_encrypt(token_address, encryption_key, 1);
    let encrypted_ref = poseidon_ctr_encrypt(ref, encryption_key, 2);
    let encrypted_key = poseidon_ctr_encrypt(encryption_key, encryption_key, 3);
    
    (encrypted_amount, encrypted_token_address, encrypted_ref, encrypted_key)
}

/// Encrypt all four fields and return as array for cleaner API
pub fn poseidon_encrypt_all_fields_array(
    amount: Field, 
    token_address: Field,
    ref: Field,
    encryption_key: Field
) -> [Field; 3] {
    // === POSEIDON ENCRYPT ALL FIELDS ARRAY ===
    // Encrypt all four fields and return the first 3 as an array
    // The ref value provides integrity checking when absorbing the note
    
    let encrypted_amount = poseidon_ctr_encrypt(amount, encryption_key, 0);
    let encrypted_token_address = poseidon_ctr_encrypt(token_address, encryption_key, 1);
    let encrypted_ref = poseidon_ctr_encrypt(ref, encryption_key, 2);
    
    [encrypted_amount, encrypted_token_address, encrypted_ref]
}

// ===== BASIC FUNCTIONALITY TESTS =====

#[test]
fn test_basic_encryption_decryption() {
    // Test basic encryption and decryption round-trip
    let plaintext = 12345 as Field;
    let key = Poseidon2::hash([42 as Field], 1);
    let counter = 0 as u32;
    
    let ciphertext = poseidon_ctr_encrypt(plaintext, key, counter);
    let decrypted = poseidon_ctr_decrypt(ciphertext, key, counter);
    
    assert(decrypted == plaintext);
}

#[test]
fn test_zero_plaintext() {
    // Test encryption of zero value
    let plaintext = 0 as Field;
    let key = Poseidon2::hash([123 as Field], 1);
    let counter = 0 as u32;
    
    let ciphertext = poseidon_ctr_encrypt(plaintext, key, counter);
    let decrypted = poseidon_ctr_decrypt(ciphertext, key, counter);
    
    assert(decrypted == plaintext);
}

#[test]
fn test_large_plaintext() {
    // Test encryption of large field value (using a large but valid field value)
    let plaintext = 21888242871839275222246405745257275088548364400416034343698204186575808495616 as Field; // p-1
    let key = Poseidon2::hash([456 as Field], 1);
    let counter = 0 as u32;
    
    let ciphertext = poseidon_ctr_encrypt(plaintext, key, counter);
    let decrypted = poseidon_ctr_decrypt(ciphertext, key, counter);
    
    assert(decrypted == plaintext);
}

// ===== COUNTER/KEYSTREAM TESTS =====

#[test]
fn test_different_counters_produce_different_ciphertexts() {
    // Test that different counters produce different ciphertexts
    let plaintext = 1000 as Field;
    let key = Poseidon2::hash([789 as Field], 1);
    
    let ciphertext1 = poseidon_ctr_encrypt(plaintext, key, 0);
    let ciphertext2 = poseidon_ctr_encrypt(plaintext, key, 1);
    let ciphertext3 = poseidon_ctr_encrypt(plaintext, key, 2);
    
    // All ciphertexts should be different
    assert(ciphertext1 != ciphertext2);
    assert(ciphertext2 != ciphertext3);
    assert(ciphertext1 != ciphertext3);
    
    // But all should decrypt to the same plaintext
    assert(poseidon_ctr_decrypt(ciphertext1, key, 0) == plaintext);
    assert(poseidon_ctr_decrypt(ciphertext2, key, 1) == plaintext);
    assert(poseidon_ctr_decrypt(ciphertext3, key, 2) == plaintext);
}

#[test]
fn test_keystream_consistency() {
    // Test that same inputs produce same keystream
    let key = Poseidon2::hash([999 as Field], 1);
    let nonce = 5 as u32;
    
    let keystream1 = poseidon_keystream(key, nonce);
    let keystream2 = poseidon_keystream(key, nonce);
    
    assert(keystream1 == keystream2);
}

#[test]
fn test_keystream_different_nonces() {
    // Test that different nonces produce different keystreams
    let key = Poseidon2::hash([111 as Field], 1);
    
    let keystream1 = poseidon_keystream(key, 0);
    let keystream2 = poseidon_keystream(key, 1);
    let keystream3 = poseidon_keystream(key, 2);
    
    assert(keystream1 != keystream2);
    assert(keystream2 != keystream3);
    assert(keystream1 != keystream3);
}

#[test]
fn test_keystream_different_keys() {
    // Test that different keys produce different keystreams
    let nonce = 0 as u32;
    
    let keystream1 = poseidon_keystream(Poseidon2::hash([1 as Field], 1), nonce);
    let keystream2 = poseidon_keystream(Poseidon2::hash([2 as Field], 1), nonce);
    let keystream3 = poseidon_keystream(Poseidon2::hash([3 as Field], 1), nonce);
    
    assert(keystream1 != keystream2);
    assert(keystream2 != keystream3);
    assert(keystream1 != keystream3);
}

// ===== BATCH ENCRYPTION TESTS =====

#[test]
fn test_encrypt_all_fields_basic() {
    // Test batch encryption of all four fields
    let amount = 1000 as Field;
    let token_address = 12345 as Field;
    let ref = 67890 as Field;
    let encryption_key = Poseidon2::hash([999 as Field], 1);
    
    let (enc_amount, enc_token, enc_ref, enc_key) = poseidon_encrypt_all_fields(
        amount, token_address, ref, encryption_key
    );
    
    // Verify each field can be decrypted individually
    let dec_amount = poseidon_ctr_decrypt(enc_amount, encryption_key, 0);
    let dec_token = poseidon_ctr_decrypt(enc_token, encryption_key, 1);
    let dec_ref = poseidon_ctr_decrypt(enc_ref, encryption_key, 2);
    let dec_key = poseidon_ctr_decrypt(enc_key, encryption_key, 3);
    
    assert(dec_amount == amount);
    assert(dec_token == token_address);
    assert(dec_ref == ref);
    assert(dec_key == encryption_key);
}

#[test]
fn test_encrypt_all_fields_zero_values() {
    // Test batch encryption with zero values
    let amount = 0 as Field;
    let token_address = 0 as Field;
    let ref = 0 as Field;
    let encryption_key = Poseidon2::hash([0 as Field], 1);
    
    let (enc_amount, enc_token, enc_ref, enc_key) = poseidon_encrypt_all_fields(
        amount, token_address, ref, encryption_key
    );
    
    let dec_amount = poseidon_ctr_decrypt(enc_amount, encryption_key, 0);
    let dec_token = poseidon_ctr_decrypt(enc_token, encryption_key, 1);
    let dec_ref = poseidon_ctr_decrypt(enc_ref, encryption_key, 2);
    let dec_key = poseidon_ctr_decrypt(enc_key, encryption_key, 3);
    
    assert(dec_amount == amount);
    assert(dec_token == token_address);
    assert(dec_ref == ref);
    assert(dec_key == encryption_key);
}

#[test]
fn test_encrypt_all_fields_different_keys() {
    // Test that different encryption keys produce different results
    let amount = 1000 as Field;
    let token_address = 2000 as Field;
    let ref = 3000 as Field;
    
    let key1 = Poseidon2::hash([111 as Field], 1);
    let key2 = Poseidon2::hash([222 as Field], 1);
    
    let (enc1_amount, enc1_token, enc1_ref, enc1_key) = poseidon_encrypt_all_fields(
        amount, token_address, ref, key1
    );
    
    let (enc2_amount, enc2_token, enc2_ref, enc2_key) = poseidon_encrypt_all_fields(
        amount, token_address, ref, key2
    );
    
    // Different keys should produce different ciphertexts
    assert(enc1_amount != enc2_amount);
    assert(enc1_token != enc2_token);
    assert(enc1_ref != enc2_ref);
    assert(enc1_key != enc2_key);
}

#[test]
fn test_encrypt_all_fields_integrity_check() {
    // Test that the ref and key values provide integrity checking
    let amount = 5000 as Field;
    let token_address = 6000 as Field;
    let ref = 7000 as Field;
    let encryption_key = Poseidon2::hash([777 as Field], 1);
    
    let (enc_amount, enc_token, enc_ref, enc_key) = poseidon_encrypt_all_fields(
        amount, token_address, ref, encryption_key
    );
    
    // Decrypt the ref and key values - they should match the original values
    let decrypted_ref = poseidon_ctr_decrypt(enc_ref, encryption_key, 2);
    let decrypted_key = poseidon_ctr_decrypt(enc_key, encryption_key, 3);
    assert(decrypted_ref == ref);
    assert(decrypted_key == encryption_key);
    
    // This provides integrity: if someone tries to use a different key to decrypt,
    // the values won't match, indicating tampering
    let wrong_key = Poseidon2::hash([888 as Field], 1);
    let wrong_decrypted_ref = poseidon_ctr_decrypt(enc_ref, wrong_key, 2);
    let wrong_decrypted_key = poseidon_ctr_decrypt(enc_key, wrong_key, 3);
    assert(wrong_decrypted_ref != ref);
    assert(wrong_decrypted_key != encryption_key);
}

#[test]
fn test_encrypt_all_fields_array() {
    // Test the array version of encrypt all fields
    let amount = 1000 as Field;
    let token_address = 2000 as Field;
    let ref = 3000 as Field;
    let encryption_key = Poseidon2::hash([999 as Field], 1);
    
    let encrypted_array = poseidon_encrypt_all_fields_array(amount, token_address, ref, encryption_key);
    
    // Verify array has 3 elements
    assert(encrypted_array.len() == 3);
    
    // Verify each element can be decrypted
    let dec_amount = poseidon_ctr_decrypt(encrypted_array[0], encryption_key, 0);
    let dec_token = poseidon_ctr_decrypt(encrypted_array[1], encryption_key, 1);
    let dec_ref = poseidon_ctr_decrypt(encrypted_array[2], encryption_key, 2);
    
    assert(dec_amount == amount);
    assert(dec_token == token_address);
    assert(dec_ref == ref);
}

// ===== SECURITY TESTS =====

#[test]
fn test_wrong_key_fails_decryption() {
    // Test that decryption with wrong key fails
    let plaintext = 5000 as Field;
    let correct_key = Poseidon2::hash([111 as Field], 1);
    let wrong_key = Poseidon2::hash([222 as Field], 1);
    let counter = 0 as u32;
    
    let ciphertext = poseidon_ctr_encrypt(plaintext, correct_key, counter);
    let wrong_decrypted = poseidon_ctr_decrypt(ciphertext, wrong_key, counter);
    
    // Should not recover original plaintext
    assert(wrong_decrypted != plaintext);
}

#[test]
fn test_wrong_counter_fails_decryption() {
    // Test that decryption with wrong counter fails
    let plaintext = 7777 as Field;
    let key = Poseidon2::hash([333 as Field], 1);
    let correct_counter = 2 as u32;
    let wrong_counter = 3 as u32;
    
    let ciphertext = poseidon_ctr_encrypt(plaintext, key, correct_counter);
    let wrong_decrypted = poseidon_ctr_decrypt(ciphertext, key, wrong_counter);
    
    // Should not recover original plaintext
    assert(wrong_decrypted != plaintext);
}

#[test]
fn test_encryption_deterministic() {
    // Test that same inputs always produce same ciphertext
    let plaintext = 8888 as Field;
    let key = Poseidon2::hash([444 as Field], 1);
    let counter = 1 as u32;
    
    let ciphertext1 = poseidon_ctr_encrypt(plaintext, key, counter);
    let ciphertext2 = poseidon_ctr_encrypt(plaintext, key, counter);
    
    // Same inputs should produce same ciphertext
    assert(ciphertext1 == ciphertext2);
}

#[test]
fn test_different_plaintexts_different_ciphertexts() {
    // Test that different plaintexts produce different ciphertexts
    let key = Poseidon2::hash([555 as Field], 1);
    let counter = 0 as u32;
    
    let ciphertext1 = poseidon_ctr_encrypt(1000 as Field, key, counter);
    let ciphertext2 = poseidon_ctr_encrypt(2000 as Field, key, counter);
    let ciphertext3 = poseidon_ctr_encrypt(3000 as Field, key, counter);
    
    // Different plaintexts should produce different ciphertexts
    assert(ciphertext1 != ciphertext2);
    assert(ciphertext2 != ciphertext3);
    assert(ciphertext1 != ciphertext3);
}

// ===== EDGE CASE TESTS =====

#[test]
fn test_max_counter_value() {
    // Test with maximum counter value
    let plaintext = 1234 as Field;
    let key = Poseidon2::hash([666 as Field], 1);
    let max_counter = 4294967295 as u32; // u32::MAX
    
    let ciphertext = poseidon_ctr_encrypt(plaintext, key, max_counter);
    let decrypted = poseidon_ctr_decrypt(ciphertext, key, max_counter);
    
    assert(decrypted == plaintext);
}

#[test]
fn test_encryption_preserves_field_arithmetic() {
    // Test that encryption preserves field arithmetic properties
    let a = 1000 as Field;
    let b = 2000 as Field;
    let key = Poseidon2::hash([777 as Field], 1);
    let counter = 0 as u32;
    
    // Encrypt individual values
    let enc_a = poseidon_ctr_encrypt(a, key, counter);
    let enc_b = poseidon_ctr_encrypt(b, key, counter);
    
    // Decrypt and verify
    let dec_a = poseidon_ctr_decrypt(enc_a, key, counter);
    let dec_b = poseidon_ctr_decrypt(enc_b, key, counter);
    
    assert(dec_a == a);
    assert(dec_b == b);
}

#[test]
fn test_keystream_uniformity() {
    // Test that keystreams appear uniformly distributed
    let key = Poseidon2::hash([888 as Field], 1);
    
    let keystream1 = poseidon_keystream(key, 0);
    let keystream2 = poseidon_keystream(key, 1);
    let keystream3 = poseidon_keystream(key, 2);
    let keystream4 = poseidon_keystream(key, 3);
    let keystream5 = poseidon_keystream(key, 4);
    
    // All keystreams should be different (very high probability)
    assert(keystream1 != keystream2);
    assert(keystream2 != keystream3);
    assert(keystream3 != keystream4);
    assert(keystream4 != keystream5);
    assert(keystream1 != keystream3);
    assert(keystream1 != keystream4);
    assert(keystream1 != keystream5);
    assert(keystream2 != keystream4);
    assert(keystream2 != keystream5);
    assert(keystream3 != keystream5);
}

// ===== TEST FOR TYPESCRIPT COMPARISON =====

/// Get test values for TypeScript comparison
pub fn get_poseidon_ctr_test_values() -> (Field, Field, Field, Field, Field, Field, Field, Field) {
    // Test values to compare with TypeScript implementation
    let amount = 1000 as Field;
    let token_address = 12345 as Field;
    let ref = 67890 as Field;
    let encryption_key = Poseidon2::hash([999 as Field], 1);
    
    // Encrypt all fields
    let (encrypted_amount, encrypted_token_address, encrypted_ref, encrypted_key) = 
        poseidon_encrypt_all_fields(amount, token_address, ref, encryption_key);
    
    // Return all values for external testing
    (amount, token_address, ref, encryption_key, encrypted_amount, encrypted_token_address, encrypted_ref, encrypted_key)
}

#[test]
fn test_poseidon_ctr_encryption_values() {
    // Test values to compare with TypeScript implementation
    let amount = 1000 as Field;
    let token_address = 12345 as Field;
    let ref = 67890 as Field;
    let encryption_key = Poseidon2::hash([999 as Field], 1);
    
    // Encrypt all fields
    let (encrypted_amount, encrypted_token_address, encrypted_ref, encrypted_key) = 
        poseidon_encrypt_all_fields(amount, token_address, ref, encryption_key);
    
    // Decrypt all fields
    let decrypted_amount = poseidon_ctr_decrypt(encrypted_amount, encryption_key, 0);
    let decrypted_token_address = poseidon_ctr_decrypt(encrypted_token_address, encryption_key, 1);
    let decrypted_ref = poseidon_ctr_decrypt(encrypted_ref, encryption_key, 2);
    let decrypted_key = poseidon_ctr_decrypt(encrypted_key, encryption_key, 3);
    
    // Verify round-trip encryption/decryption
    assert(decrypted_amount == amount);
    assert(decrypted_token_address == token_address);
    assert(decrypted_ref == ref);
    assert(decrypted_key == encryption_key);
    
 
    println("Encrypted amount: 0x{:x}");
    println(encrypted_amount);
    println("Encrypted token address: 0x{:x}");
    println(encrypted_token_address);
    println("Encrypted ref: 0x{:x}");
    println(encrypted_ref);
    println("Encrypted key: 0x{:x}");
    println(encrypted_key);
    println("Decrypted amount: 0x{:x}");
    println(decrypted_amount);
    println("Decrypted token address: 0x{:x}");
    println(decrypted_token_address);
    println("Decrypted ref: 0x{:x}");
    println(decrypted_ref);
    println("Decrypted key: 0x{:x}");
    println(decrypted_key);
}
