use dep::poseidon::poseidon2::Poseidon2;
use dep::ec::tecurve::affine::Point;
use dep::ec::consts::te::{baby_jubjub};

// Generate public key from private key
fn generate_public_key(private_key: Field) -> [Field; 2] {
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    let public_key = bjj.curve.mul(private_key, generator);
    [public_key.x, public_key.y]
}

// Import the DH function from main
fn perform_dh_key_exchange(sender_private_key: Field, receiver_public_key: [Field; 2]) -> ([Field; 2], Field) {
    // === DIFFIE-HELLMAN KEY EXCHANGE ===
    // Create Baby Jubjub curve for DH
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    
    // Generate sender's public key: sender_pub_key = sender_private_key * generator
    let sender_public_key = bjj.curve.mul(sender_private_key, generator);
    
    // Reconstruct receiver's public key from the input
    let receiver_pub_key = Point::new(receiver_public_key[0], receiver_public_key[1]);
    
    // Compute shared secret: shared_secret = sender_private_key * receiver_public_key
    let shared_secret = bjj.curve.mul(sender_private_key, receiver_pub_key);
    
    // Hash the shared secret to get a final shared key
    let shared_key = Poseidon2::hash([shared_secret.x, shared_secret.y], 2);
    ([sender_public_key.x, sender_public_key.y], shared_key)
}

#[test]
fn test_dh_key_exchange_values() {
    std::println("========================================");
    std::println("DIFFIE-HELLMAN KEY EXCHANGE TEST");
    std::println("========================================");
    
    // === SETUP TWO KEYPAIRS ===
    // Sender (Alice)
    let alice_private_key = 0x1234567890abcdef as Field;
    let alice_nonce = 1 as Field;
    let alice_user_key = alice_private_key;
    
    // Receiver (Bob) - generate proper public key from private key
    let bob_private_key = 0x2b4c6d8e0f1a2b3c as Field;
    let bob_public_key = generate_public_key(bob_private_key);
    let bob_public_key_x = bob_public_key[0];
    let bob_public_key_y = bob_public_key[1];
    
    std::println("=== KEYPAIR SETUP ===");
    std::println("Alice private key:");
    std::println(alice_private_key);
    std::println("Alice nonce:");
    std::println(alice_nonce);
    std::println("Alice user key (private_key + nonce):");
    let alice_user_key_with_nonce = alice_user_key + alice_nonce;
    std::println(alice_user_key_with_nonce);
    
    std::println("Bob public key X:");
    std::println(bob_public_key_x);
    std::println("Bob public key Y:");
    std::println(bob_public_key_y);
    
    std::println("=== PERFORMING DH KEY EXCHANGE ===");
    
    // Perform DH key exchange directly
    let (sender_pub_key, shared_key) = perform_dh_key_exchange(alice_user_key_with_nonce, bob_public_key);
    
    std::println("=== DH KEY EXCHANGE RESULTS ===");
    std::println("Alice's sender public key X:");
    std::println(sender_pub_key[0]);
    std::println("Alice's sender public key Y:");
    std::println(sender_pub_key[1]);
    std::println("Shared key:");
    std::println(shared_key);
    
    std::println("========================================");
    std::println("✅ DH KEY EXCHANGE TEST COMPLETED");
    std::println("========================================");
    std::println("Copy these values to TypeScript test:");
    std::println("Alice private key:");
    std::println(alice_private_key);
    std::println("Alice nonce:");
    std::println(alice_nonce);
    std::println("Alice user key:");
    std::println(alice_user_key_with_nonce);
    std::println("Bob public key X:");
    std::println(bob_public_key_x);
    std::println("Bob public key Y:");
    std::println(bob_public_key_y);
    std::println("Alice sender public key X:");
    std::println(sender_pub_key[0]);
    std::println("Alice sender public key Y:");
    std::println(sender_pub_key[1]);
    std::println("Shared key:");
    std::println(shared_key);
    std::println("========================================");
}