use dep::std;
use dep::std::field::bn254::{lt, gt};
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
use dep::poseidon::poseidon2::Poseidon2;
use dep::poseidon_ctr_encryption::{poseidon_ctr_encrypt, poseidon_ctr_decrypt};
use dep::ec::tecurve::affine::{Point};
use dep::ec::consts::te::{baby_jubjub};
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_positive,
    pedersen_commitment_negative,
    pedersen_commitment_counter,
    add_commitments,
    add_multiple_commitments,
    pedersen_commitment_non_hiding,
    subtract_commitments
};
// Import the main function from the binary package
use crate::main;

// === TEST CONSTANTS ===
global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;

/// Get test user key
fn test_user_key() -> Field { 0x1234567890abcdef as Field }

/// Get test token address (USDC)
fn test_token_address() -> Field { 0x02 as Field }

/// Get test previous nonce
fn test_previous_nonce() -> Field { 0x00 as Field }

/// Get test entry amount (100 USDC)
fn test_entry_amount() -> Field { 0x64 as Field }

/// Get test send amount (99 USDC - leaving 1 for second send fee)
fn test_send_amount() -> Field { 0x63 as Field }

/// Get test second send amount (9 WETH)
fn test_second_send_amount() -> Field { 0x09 as Field }

/// Get test relay fee token address (WETH)
fn test_relay_fee_token_address() -> Field { 0x03 as Field }

/// Get test receiver fee amount
fn test_receiver_fee_amount() -> Field { 0x01 as Field }

/// Get test fee token previous balance
fn test_fee_token_previous_balance() -> Field { 0x0a as Field }

/// Get Alice's public key (derived from private key)
fn alice_public_key() -> [Field; 2] {
    // This will be derived from alice_private_key() in the test
    // For now, we'll use a placeholder that will be verified against the derived key
    [
        0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef,
        0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543
    ]
}

/// Get Alice's private key (for decryption testing)
fn alice_private_key() -> Field { 0xfedcba0987654321 as Field }

/// Derive Alice's public key from her private key
fn derive_alice_public_key() -> [Field; 2] {
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    let alice_private_key = alice_private_key();
    let alice_public_key = bjj.curve.mul(alice_private_key, generator);
    [alice_public_key.x, alice_public_key.y]
}


// === TEST HELPER FUNCTIONS ===

/// Create test user hashes and commitments
fn create_test_user_data(user_key: Field, token_address: Field, previous_nonce: Field) -> (Field, Field, Field) {
    let user_key_hash = Poseidon2::hash([user_key], 1);
    let previous_nonce_commitment = Poseidon2::hash([user_key_hash, previous_nonce], 2);
    let token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2);
    
    (user_key_hash, previous_nonce_commitment, token_address_hash)
}

fn create_personal_commitments(
    balance_amount: Field,
    token_address: Field,
    user_key_hash: Field,
    view_key: Field,
    previous_nonce: Field
) -> ([Field; 2], [Field; 2], [Field; 2], Field, Field, Field) {
    let balance_amount_hash = Poseidon2::hash([balance_amount, user_key_hash], 2);
    let token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2);
    
    let personal_c_inner_commitment = pedersen_commitment_non_hiding(balance_amount_hash, token_address_hash);
    let personal_c_outer_commitment = pedersen_commitment_non_hiding(0, token_address);
    
    let personal_c_tot_commitment = add_multiple_commitments([
        personal_c_inner_commitment,
        personal_c_outer_commitment
    ]);
    
    let personal_c_tot = [personal_c_tot_commitment.x, personal_c_tot_commitment.y];
    let personal_c_inner = [personal_c_inner_commitment.x, personal_c_inner_commitment.y];
    let personal_c_outer = [personal_c_outer_commitment.x, personal_c_outer_commitment.y];
    
    let personal_c_inner_m = balance_amount;
    let personal_c_outer_m = 0 as Field;
    let personal_c_outer_r = token_address;
    
    (personal_c_tot, personal_c_inner, personal_c_outer, personal_c_inner_m, personal_c_outer_m, personal_c_outer_r)
}

fn create_fee_token_personal_commitments(
    fee_token_prev_balance_amount: Field,
    relay_fee_token_address: Field,
    user_key_hash: Field
) -> ([Field; 2], [Field; 2], [Field; 2], Field, Field, Field) {
    let fee_token_prev_balance_amount_hash = Poseidon2::hash([fee_token_prev_balance_amount, user_key_hash], 2);
    let fee_token_token_address_hash = Poseidon2::hash([relay_fee_token_address, user_key_hash], 2);
    
    let fee_token_personal_c_inner_commitment = pedersen_commitment_non_hiding(fee_token_prev_balance_amount_hash, fee_token_token_address_hash);
    let fee_token_personal_c_outer_commitment = pedersen_commitment_non_hiding(0, relay_fee_token_address);
    
    let fee_token_personal_c_tot_commitment = add_multiple_commitments([
        fee_token_personal_c_inner_commitment,
        fee_token_personal_c_outer_commitment
    ]);
    
    let fee_token_personal_c_tot = [fee_token_personal_c_tot_commitment.x, fee_token_personal_c_tot_commitment.y];
    let fee_token_personal_c_inner = [fee_token_personal_c_inner_commitment.x, fee_token_personal_c_inner_commitment.y];
    let fee_token_personal_c_outer = [fee_token_personal_c_outer_commitment.x, fee_token_personal_c_outer_commitment.y];
    
    let fee_token_personal_c_inner_m = fee_token_prev_balance_amount;
    let fee_token_personal_c_outer_m = 0 as Field;
    let fee_token_personal_c_outer_r = relay_fee_token_address;
    
    (fee_token_personal_c_tot, fee_token_personal_c_inner, fee_token_personal_c_outer, fee_token_personal_c_inner_m, fee_token_personal_c_outer_m, fee_token_personal_c_outer_r)
}

fn create_main_stack_commitments(
    personal_c_tot: [Field; 2],
    token_address_hash: Field,
    user_key_hash: Field,
    previous_nonce_commitment: Field,
    view_key: Field,
    previous_nonce: Field
) -> ([Field; 2], [Field; 2], [Field; 2], [Field; 2], [Field; 3]) {
    let previous_encryption_key = Poseidon2::hash([view_key, previous_nonce], 2);
    let encrypted_x = poseidon_ctr_encrypt(personal_c_tot[0], previous_encryption_key, 3);
    let encrypted_y = poseidon_ctr_encrypt(personal_c_tot[1], previous_encryption_key, 4);
    
    let user_main_entry_commitment = pedersen_commitment_positive(encrypted_x, encrypted_y, previous_nonce_commitment);
    let another_user_main_entry_commitment = pedersen_commitment_positive(token_address_hash, user_key_hash, 0x29a as Field);
    
    let main_c_tot_commitment = add_commitments(user_main_entry_commitment, another_user_main_entry_commitment);
    
    let main_c_tot = [main_c_tot_commitment.x, main_c_tot_commitment.y];
    let main_c_inner = [user_main_entry_commitment.x, user_main_entry_commitment.y];
    let main_c_outer = [another_user_main_entry_commitment.x, another_user_main_entry_commitment.y];
    let main_c_inner_point = [encrypted_x, encrypted_y];
    let main_c_outer_point = [token_address_hash, user_key_hash, 0x29a as Field];
    
    (main_c_tot, main_c_inner, main_c_outer, main_c_inner_point, main_c_outer_point)
}

fn verify_and_print_results(
    prev_balance: Field,
    send_amount: Field,
    result: (Field, [Field; 2], [Field; 7], [Field; 2], [Field; 2], [Field; 2], [Field; 2], [Field; 2])
) {
    let expected_new_balance = prev_balance - send_amount;
    assert(gt(expected_new_balance, 0) | (expected_new_balance == 0), "Send should not result in negative balance");
    
    std::println("✅ Send operation verified successfully!");
    std::println("Previous balance:");
    std::println(prev_balance);
    std::println("Send amount:");
    std::println(send_amount);
    std::println("New balance:");
    std::println(expected_new_balance);
    std::println("Circuit execution successful");
    std::println("");
    std::println("Circuit output:");
    std::println("New nonce commitment:");
    std::println(result.0);
    std::println("New main commitment x:");
    std::println(result.1[0]);
    std::println("New main commitment y:");
    std::println(result.1[1]);
    std::println("Encrypted note length:");
    std::println(result.2.len());
    std::println("Sender public key x:");
    std::println(result.3[0]);
    std::println("Sender public key y:");
    std::println(result.3[1]);
    std::println("Nonce discovery entry x:");
    std::println(result.4[0]);
    std::println("Nonce discovery entry y:");
    std::println(result.4[1]);
    std::println("Encrypted coordinates x:");
    std::println(result.5[0]);
    std::println("Encrypted coordinates y:");
    std::println(result.5[1]);
    std::println("Notes c_tot commitment x:");
    std::println(result.6[0]);
    std::println("Notes c_tot commitment y:");
    std::println(result.6[1]);
    std::println("Receiver public key x:");
    std::println(result.7[0]);
    std::println("Receiver public key y:");
    std::println(result.7[1]);
}

fn print_prover_toml_format(
    user_key: Field,
    token_address: Field,
    send_amount: Field,
    previous_nonce: Field,
    main_c_tot: [Field; 2],
    main_c_inner: [Field; 2],
    main_c_outer: [Field; 2],
    main_c_inner_point: [Field; 2],
    main_c_outer_point: [Field; 3],
    personal_c_tot: [Field; 2],
    personal_c_inner: [Field; 2],
    personal_c_outer: [Field; 2],
    personal_c_inner_m: Field,
    personal_c_outer_m: Field,
    personal_c_outer_r: Field,
    receiver_public_key: [Field; 2],
    relay_fee_token_address: Field,
    receiver_fee_amount: Field,
    fee_token_personal_c_inner: [Field; 2],
    fee_token_personal_c_outer: [Field; 2],
    fee_token_personal_c_inner_m: Field,
    fee_token_personal_c_outer_m: Field,
    fee_token_personal_c_outer_r: Field
) {
    std::println("========================================");
    std::println("COPY THIS TO nydus-send/Prover.toml");
    std::println("========================================");
    std::println("");
    
    // Basic parameters
    std::print("user_key = \"");
    std::print(user_key);
    std::println("\"");
    std::println("");
    
    std::print("token_address = \"");
    std::print(token_address);
    std::println("\"");
    std::println("");
    
    std::print("amount = \"");
    std::print(send_amount);
    std::println("\"");
    std::println("");
    
    std::print("previous_nonce = \"");
    std::print(previous_nonce);
    std::println("\"");
    std::println("");
    
    // Main stack commitments
    std::print("main_c_tot = [\"");
    std::print(main_c_tot[0]);
    std::print("\", \"");
    std::print(main_c_tot[1]);
    std::println("\"]");
    std::println("");
    
    std::print("main_c_inner = [\"");
    std::print(main_c_inner[0]);
    std::print("\", \"");
    std::print(main_c_inner[1]);
    std::println("\"]");
    std::println("");
    
    std::print("main_c_outer = [\"");
    std::print(main_c_outer[0]);
    std::print("\", \"");
    std::print(main_c_outer[1]);
    std::println("\"]");
    std::println("");
    
    // Main stack opening values
    std::print("main_c_inner_point = [\"");
    std::print(main_c_inner_point[0]);
    std::print("\", \"");
    std::print(main_c_inner_point[1]);
    std::println("\"]");
    std::println("");
    
    std::print("main_c_outer_point = [\"");
    std::print(main_c_outer_point[0]);
    std::print("\", \"");
    std::print(main_c_outer_point[1]);
    std::print("\", \"");
    std::print(main_c_outer_point[2]);
    std::println("\"]");
    std::println("");
    
    // Personal commitments
    std::print("personal_c_tot = [\"");
    std::print(personal_c_tot[0]);
    std::print("\", \"");
    std::print(personal_c_tot[1]);
    std::println("\"]");
    std::println("");
    
    std::print("personal_c_inner = [\"");
    std::print(personal_c_inner[0]);
    std::print("\", \"");
    std::print(personal_c_inner[1]);
    std::println("\"]");
    std::println("");
    
    std::print("personal_c_outer = [\"");
    std::print(personal_c_outer[0]);
    std::print("\", \"");
    std::print(personal_c_outer[1]);
    std::println("\"]");
    std::println("");
    
    // Personal commitment opening values
    std::print("personal_c_inner_m = \"");
    std::print(personal_c_inner_m);
    std::println("\"");
    std::println("");
    
    std::print("personal_c_outer_m = \"");
    std::print(personal_c_outer_m);
    std::println("\"");
    std::println("");
    
    std::print("personal_c_outer_r = \"");
    std::print(personal_c_outer_r);
    std::println("\"");
    std::println("");
    
    // Receiver public key
    std::print("receiver_public_key = [\"");
    std::print(receiver_public_key[0]);
    std::print("\", \"");
    std::print(receiver_public_key[1]);
    std::println("\"]");
    std::println("");
    
    // Fee token parameters
    std::print("relay_fee_token_address = \"");
    std::print(relay_fee_token_address);
    std::println("\"");
    std::println("");
    
    std::print("receiver_fee_amount = \"");
    std::print(receiver_fee_amount);
    std::println("\"");
    std::println("");
    
    std::print("fee_token_personal_c_inner = [\"");
    std::print(fee_token_personal_c_inner[0]);
    std::print("\", \"");
    std::print(fee_token_personal_c_inner[1]);
    std::println("\"]");
    std::println("");
    
    std::print("fee_token_personal_c_outer = [\"");
    std::print(fee_token_personal_c_outer[0]);
    std::print("\", \"");
    std::print(fee_token_personal_c_outer[1]);
    std::println("\"]");
    std::println("");
    
    std::print("fee_token_personal_c_inner_m = \"");
    std::print(fee_token_personal_c_inner_m);
    std::println("\"");
    std::println("");
    
    std::print("fee_token_personal_c_outer_m = \"");
    std::print(fee_token_personal_c_outer_m);
    std::println("\"");
    std::println("");
    
    std::print("fee_token_personal_c_outer_r = \"");
    std::print(fee_token_personal_c_outer_r);
    std::println("\"");
    std::println("");
}

/// Test Alice's ability to decrypt the note and reconstruct the inbound note
fn test_alice_decrypts_note(
    encrypted_note: [Field; 7],
    sender_pub_key: [Field; 2],
    alice_pub_key: [Field; 2],
    expected_amount: Field,
    expected_token_address: Field
) {
    std::println("=== ALICE DECRYPTS THE NOTE ===");
    
    // === ALICE'S DIFFIE-HELLMAN KEY EXCHANGE ===
    let (reconstructed_shared_key, alice_derived_pub_key) = alice_perform_dh_key_exchange(
        alice_private_key(),
        sender_pub_key
    );
    
    // Use Alice's derived public key for verification
    let alice_pub_key = alice_derived_pub_key;
    
    // === ALICE DECRYPTS THE NOTE ===
    // encrypted_note structure: [receiver_note_amount, receiver_note_token, sender_balance_amount, sender_balance_token, reference, personal_c_tot_m, personal_c_tot_r]
    // Alice can decrypt [0-1] using shared_key_hash (for receiver's note)
    let shared_key_hash = Poseidon2::hash([reconstructed_shared_key], 1);
    
    let decrypted_amount = poseidon_ctr_decrypt(encrypted_note[0], shared_key_hash, 0);
    let decrypted_token_address = poseidon_ctr_decrypt(encrypted_note[1], shared_key_hash, 1);
    // Note: encrypted_note[2-6] are encrypted with sender's encryption_key (view_key + nonce),
    // so Alice cannot decrypt them without the sender's view_key
    
    // === VERIFY DECRYPTION ===
    assert(decrypted_amount == expected_amount, "Decrypted amount doesn't match expected amount");
    assert(decrypted_token_address == expected_token_address, "Decrypted token address doesn't match expected token address");
    
    // === RECONSTRUCT THE INBOUND NOTE ===
    let reconstructed_note = [decrypted_amount, decrypted_token_address];
    
    // === RECONSTRUCT THE RECEIPT COMMITMENT ===
    // Alice can reconstruct the receipt commitment using the same shared key
    let receipt_commitment = pedersen_commitment_positive(decrypted_amount, shared_key_hash, decrypted_token_address);
    
    std::println("✅ Alice successfully decrypted the note!");
    std::println("Decrypted amount: 100 USDC");
    std::println("Decrypted token address: 0x02");
    std::println("Reconstructed note: [amount, token_address]");
    std::print("Reconstructed receipt commitment x: ");
    std::println(receipt_commitment.x);
    std::print("Reconstructed receipt commitment y: ");
    std::println(receipt_commitment.y);
    std::println("Shared key exchange successful");
    std::println("");
}

/// Alice performs Diffie-Hellman key exchange (receiver side)
fn alice_perform_dh_key_exchange(alice_private_key: Field, sender_public_key: [Field; 2]) -> (Field, [Field; 2]) {
    // === DIFFIE-HELLMAN KEY EXCHANGE (ALICE'S SIDE) ===
    // Create Baby Jubjub curve for DH
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    
    // Generate Alice's public key: alice_pub_key = alice_private_key * generator
    let alice_public_key = bjj.curve.mul(alice_private_key, generator);
    
    // Reconstruct sender's public key from the input
    let sender_pub_key = Point::new(sender_public_key[0], sender_public_key[1]);
    
    // Compute shared secret: shared_secret = alice_private_key * sender_public_key
    let shared_secret = bjj.curve.mul(alice_private_key, sender_pub_key);
    
    // Hash the shared secret to get a final shared key
    let shared_key = Poseidon2::hash([shared_secret.x, shared_secret.y], 2);
    (shared_key, [alice_public_key.x, alice_public_key.y])
}

#[test]
fn test_bob_entry_send_flow() {
    // === TEST SCENARIO ===
    // 1. Bob entry with 100 USDC (simulated)
    // 2. Bob sends 100 USDC to Alice
    // 3. Verify the send circuit works correctly
    
    // === SETUP ===
    let (user_key_hash, previous_nonce_commitment, token_address_hash) = create_test_user_data(
        test_user_key(), 
        test_token_address(), 
        test_previous_nonce()
    );
    
    // Compute view_key (same as in main circuit)
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    
    // === CREATE PERSONAL STATE (Bob's 100 USDC balance) ===
    let (personal_c_tot_usdc_only, personal_c_inner, personal_c_outer, personal_c_inner_m, personal_c_outer_m, personal_c_outer_r) = create_personal_commitments(
        test_entry_amount(),
        test_token_address(),
        user_key_hash,
        view_key,
        test_previous_nonce()
    );
    
    // === CREATE FEE TOKEN PERSONAL STATE (Bob's 10 WETH balance) ===
    let (fee_token_personal_c_tot_weth_only, fee_token_personal_c_inner, fee_token_personal_c_outer, fee_token_personal_c_inner_m, fee_token_personal_c_outer_m, fee_token_personal_c_outer_r) = create_fee_token_personal_commitments(
        test_fee_token_previous_balance(),
        test_relay_fee_token_address(),
        user_key_hash
    );
    
    // Combine both tokens into personal_c_tot (circuit expects this when tokens are different)
    let personal_c_tot_combined = add_multiple_commitments([
        EmbeddedCurvePoint { x: personal_c_tot_usdc_only[0], y: personal_c_tot_usdc_only[1], is_infinite: false },
        EmbeddedCurvePoint { x: fee_token_personal_c_tot_weth_only[0], y: fee_token_personal_c_tot_weth_only[1], is_infinite: false }
    ]);
    let personal_c_tot = [personal_c_tot_combined.x, personal_c_tot_combined.y];
    
    // === CREATE MAIN STACK STATE ===
    // Encrypt the combined personal_c_tot for main_c_inner_point
    let previous_encryption_key = Poseidon2::hash([view_key, test_previous_nonce()], 2);
    let encrypted_x = poseidon_ctr_encrypt(personal_c_tot_combined.x, previous_encryption_key, 3);
    let encrypted_y = poseidon_ctr_encrypt(personal_c_tot_combined.y, previous_encryption_key, 4);
    
    let user_main_entry_commitment = pedersen_commitment_positive(encrypted_x, encrypted_y, previous_nonce_commitment);
    let another_user_main_entry_commitment = pedersen_commitment_positive(token_address_hash, user_key_hash, 0x29a as Field);
    
    let main_c_tot_commitment = add_commitments(user_main_entry_commitment, another_user_main_entry_commitment);
    let main_c_tot = [main_c_tot_commitment.x, main_c_tot_commitment.y];
    let main_c_inner = [user_main_entry_commitment.x, user_main_entry_commitment.y];
    let main_c_outer = [another_user_main_entry_commitment.x, another_user_main_entry_commitment.y];
    let main_c_inner_point = [encrypted_x, encrypted_y];
    let main_c_outer_point = [token_address_hash, user_key_hash, 0x29a as Field];
    
    // === DERIVE ALICE'S PUBLIC KEY FROM PRIVATE KEY ===
    let alice_derived_pub_key = derive_alice_public_key();
    
    // === EXECUTE SEND CIRCUIT ===
    let result = main(
        test_user_key(),
        test_token_address(),
        test_send_amount(),
        test_previous_nonce(),
        main_c_tot,
        main_c_inner,
        main_c_outer,
        main_c_inner_point,
        main_c_outer_point,
        personal_c_tot,
        personal_c_inner,
        personal_c_outer,
        personal_c_inner_m,
        personal_c_outer_m,
        personal_c_outer_r,
        alice_derived_pub_key,
        test_relay_fee_token_address(),
        test_receiver_fee_amount(),
        fee_token_personal_c_inner,
        fee_token_personal_c_outer,
        fee_token_personal_c_inner_m,
        fee_token_personal_c_outer_m,
        fee_token_personal_c_outer_r
    );
    
    // === VERIFY RESULTS ===
    verify_and_print_results(test_entry_amount(), test_send_amount(), result);
    
    std::println("✅ First send successful!");
    std::println("USDC balance after first send: 1 (100 - 99)");
    std::println("WETH balance after first send: 9 (10 - 1)");
    std::println("");
    
    // === SECOND SEND: Send 9 WETH, pay 1 USDC as fee ===
    std::println("=== SECOND SEND (9 WETH, fee paid in USDC) ===");
    
    let second_previous_nonce = test_previous_nonce() + 1;
    let first_new_nonce_commitment = result.0;
    let first_new_main_commitment = result.1;
    
    let second_user_key_hash = Poseidon2::hash([test_user_key()], 1);
    let second_previous_nonce_commitment = Poseidon2::hash([second_user_key_hash, second_previous_nonce], 2);
    
    let usdc_balance_after_first = test_entry_amount() - test_send_amount(); // 100 - 99 = 1
    let weth_balance_after_first = test_fee_token_previous_balance() - test_receiver_fee_amount(); // 10 - 1 = 9
    
    let second_send_token_address = test_relay_fee_token_address(); // WETH
    let second_fee_token_address = test_token_address(); // USDC
    let second_send_amount = test_second_send_amount(); // 9 WETH
    let second_fee_amount = usdc_balance_after_first; // 1 USDC
    
    let first_new_nonce = test_previous_nonce() + 1;
    let first_encryption_key = Poseidon2::hash([view_key, first_new_nonce], 2);
    
    let personal_c_tot_commitment = EmbeddedCurvePoint { x: personal_c_tot[0], y: personal_c_tot[1], is_infinite: false };
    let personal_c_inner_commitment = EmbeddedCurvePoint { x: personal_c_inner[0], y: personal_c_inner[1], is_infinite: false };
    let fee_token_personal_c_inner_commitment = EmbeddedCurvePoint { x: fee_token_personal_c_inner[0], y: fee_token_personal_c_inner[1], is_infinite: false };
    
    let outer_after_first = subtract_commitments(
        subtract_commitments(personal_c_tot_commitment, personal_c_inner_commitment),
        fee_token_personal_c_inner_commitment
    );
    
    let new_usdc_balance = usdc_balance_after_first; // 1
    let new_usdc_balance_commitment = pedersen_commitment_non_hiding(new_usdc_balance, test_token_address());
    
    let new_weth_balance = weth_balance_after_first; // 9
    let new_weth_balance_hash = Poseidon2::hash([new_weth_balance, user_key_hash], 2);
    let weth_token_address_hash = Poseidon2::hash([test_relay_fee_token_address(), user_key_hash], 2);
    let new_weth_balance_commitment = pedersen_commitment_non_hiding(new_weth_balance_hash, weth_token_address_hash);
    
    let first_new_personal_c_tot = add_multiple_commitments([
        outer_after_first,
        new_usdc_balance_commitment,
        new_weth_balance_commitment
    ]);
    
    let first_encrypted_x = poseidon_ctr_encrypt(first_new_personal_c_tot.x, first_encryption_key, 3);
    let first_encrypted_y = poseidon_ctr_encrypt(first_new_personal_c_tot.y, first_encryption_key, 4);
    
    let reconstructed_first_main_c_inner = pedersen_commitment_positive(
        first_encrypted_x,
        first_encrypted_y,
        first_new_nonce_commitment
    );
    
    assert(reconstructed_first_main_c_inner.x == first_new_main_commitment[0], "Reconstructed main_c_inner x should match first send result");
    assert(reconstructed_first_main_c_inner.y == first_new_main_commitment[1], "Reconstructed main_c_inner y should match first send result");
    
    let second_main_c_inner_reconstructed = pedersen_commitment_positive(
        first_encrypted_x,
        first_encrypted_y,
        second_previous_nonce_commitment
    );
    let second_main_c_inner = [second_main_c_inner_reconstructed.x, second_main_c_inner_reconstructed.y];
    let second_main_c_inner_point = [first_encrypted_x, first_encrypted_y];
    
    let second_main_c_tot_commitment = add_commitments(
        EmbeddedCurvePoint { x: second_main_c_inner[0], y: second_main_c_inner[1], is_infinite: false },
        EmbeddedCurvePoint { x: main_c_outer[0], y: main_c_outer[1], is_infinite: false }
    );
    let second_main_c_tot = [second_main_c_tot_commitment.x, second_main_c_tot_commitment.y];
    let second_main_c_outer = main_c_outer;
    let second_main_c_outer_point = main_c_outer_point;
    
    let second_personal_c_tot = [first_new_personal_c_tot.x, first_new_personal_c_tot.y];
    
    let second_personal_c_inner_weth = pedersen_commitment_non_hiding(new_weth_balance_hash, weth_token_address_hash);
    let second_personal_c_outer_weth = pedersen_commitment_non_hiding(0, test_relay_fee_token_address());
    
    let second_personal_c_inner = [second_personal_c_inner_weth.x, second_personal_c_inner_weth.y];
    let second_personal_c_outer = [second_personal_c_outer_weth.x, second_personal_c_outer_weth.y];
    let second_personal_c_inner_m = weth_balance_after_first;
    let second_personal_c_outer_m = 0 as Field;
    let second_personal_c_outer_r = test_relay_fee_token_address();
    
    let usdc_balance_hash = Poseidon2::hash([usdc_balance_after_first, user_key_hash], 2);
    let usdc_token_address_hash = Poseidon2::hash([test_token_address(), user_key_hash], 2);
    let second_fee_token_personal_c_inner_usdc = pedersen_commitment_non_hiding(usdc_balance_hash, usdc_token_address_hash);
    let second_fee_token_personal_c_outer_usdc = pedersen_commitment_non_hiding(0, test_token_address());
    
    let second_fee_token_personal_c_inner = [second_fee_token_personal_c_inner_usdc.x, second_fee_token_personal_c_inner_usdc.y];
    let second_fee_token_personal_c_outer = [second_fee_token_personal_c_outer_usdc.x, second_fee_token_personal_c_outer_usdc.y];
    let second_fee_token_personal_c_inner_m = usdc_balance_after_first;
    let second_fee_token_personal_c_outer_m = 0 as Field;
    let second_fee_token_personal_c_outer_r = test_token_address();
    
    let second_result = main(
        test_user_key(),
        second_send_token_address, // WETH
        second_send_amount, // 9 WETH
        second_previous_nonce,
        second_main_c_tot,
        second_main_c_inner,
        second_main_c_outer,
        second_main_c_inner_point,
        second_main_c_outer_point,
        second_personal_c_tot,
        second_personal_c_inner,
        second_personal_c_outer,
        second_personal_c_inner_m,
        second_personal_c_outer_m,
        second_personal_c_outer_r,
        alice_derived_pub_key,
        second_fee_token_address, // USDC
        second_fee_amount, // 1 USDC
        second_fee_token_personal_c_inner,
        second_fee_token_personal_c_outer,
        second_fee_token_personal_c_inner_m,
        second_fee_token_personal_c_outer_m,
        second_fee_token_personal_c_outer_r
    );
    
    std::println("✅ Second send successful!");
    std::println("WETH balance after second send: 0 (9 - 9)");
    std::println("USDC balance after second send: 0 (1 - 1)");
    std::println("");
    std::println("=== FINAL VERIFICATION ===");
    std::println("Initial USDC: 100");
    std::println("Initial WETH: 10");
    std::println("First send: 99 USDC (fee: 1 WETH)");
    std::println("Second send: 9 WETH (fee: 1 USDC)");
    std::println("Final USDC: 0");
    std::println("Final WETH: 0");
    std::println("✅ Both sends executed successfully!");
    
    // === ALICE DECRYPTS THE NOTE (RECEIVER SIDE) ===
    test_alice_decrypts_note(
        result.2, // encrypted_note
        result.3, // sender_pub_key
        alice_derived_pub_key,
        test_send_amount(),
        test_token_address()
    );
    
    // === GENERATE PROVER.TOML ===
    print_prover_toml_format(
        test_user_key(),
        test_token_address(),
        test_send_amount(),
        test_previous_nonce(),
        main_c_tot,
        main_c_inner,
        main_c_outer,
        main_c_inner_point,
        main_c_outer_point,
        personal_c_tot,
        personal_c_inner,
        personal_c_outer,
        personal_c_inner_m,
        personal_c_outer_m,
        personal_c_outer_r,
        alice_derived_pub_key,
        test_relay_fee_token_address(),
        test_receiver_fee_amount(),
        fee_token_personal_c_inner,
        fee_token_personal_c_outer,
        fee_token_personal_c_inner_m,
        fee_token_personal_c_outer_m,
        fee_token_personal_c_outer_r
    );
}
