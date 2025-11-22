use dep::poseidon::poseidon2::Poseidon2;
use dep::poseidon_ctr_encryption::{poseidon_ctr_encrypt, poseidon_ctr_decrypt};
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
use dep::ec::tecurve::affine::{Point};
use dep::ec::consts::te::{baby_jubjub};
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_positive,
    add_commitments,
    add_multiple_commitments,
    pedersen_commitment_non_hiding,
    to_nullifier_domain
};

// Import the main circuit
use crate::main;

global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;

#[test]
fn test_absorb_circuit_standalone() {
    std::println("=== STANDALONE ABSORB CIRCUIT TEST ===");
    std::println("Testing Alice absorb operation with simulated previous state");
    std::println("");

    // === SIMULATED PREVIOUS STATE ===
    let alice_user_key = 0xfedcba0987654321;
    let token_address = 0x02; // USDC
    let alice_previous_nonce = 0;
    
    // Alice's personal commitments (using non-hiding pattern like send test)
    let alice_user_key_hash = Poseidon2::hash([alice_user_key], 1);
    let alice_entry_amount = 150 as Field; // Increased to have enough for fee
    
    // Create personal commitments using non-hiding pattern
    let alice_balance_amount_hash = Poseidon2::hash([alice_entry_amount, alice_user_key_hash], 2);
    let alice_token_address_hash = Poseidon2::hash([token_address, alice_user_key_hash], 2);
    
    let alice_personal_c_inner_commitment = pedersen_commitment_non_hiding(alice_balance_amount_hash, alice_token_address_hash);
    
    // Create personal_c_outer (no nonce_commitment included)
    let alice_personal_c_outer_commitment = pedersen_commitment_non_hiding(0, token_address);
    
    // For first absorb after entry: nullifier is 0, so we use initializer
    let alice_nullifier = 0 as Field;
    let alice_nullifier_hashed = Poseidon2::hash([alice_nullifier, alice_user_key_hash], 2);
    let nullifier_domain = to_nullifier_domain(token_address);
    let alice_nullifier_commitment = pedersen_commitment_non_hiding(alice_nullifier_hashed, nullifier_domain);
    
    // Since nullifier is 0, we use initializer: personal_c_tot = inner + outer + initializer
    let alice_initializer = pedersen_commitment_non_hiding(token_address, alice_user_key_hash);
    let alice_personal_c_tot_commitment: EmbeddedCurvePoint = add_multiple_commitments([
        alice_personal_c_inner_commitment,
        alice_personal_c_outer_commitment,
        alice_initializer
    ]);
    
    let alice_personal_c_tot = [alice_personal_c_tot_commitment.x, alice_personal_c_tot_commitment.y];
    let alice_personal_c_inner = [alice_personal_c_inner_commitment.x, alice_personal_c_inner_commitment.y];
    let alice_personal_c_outer = [alice_personal_c_outer_commitment.x, alice_personal_c_outer_commitment.y];
    
    // Opening values for personal commitments
    let alice_personal_c_inner_m = alice_entry_amount;
    let alice_personal_c_inner_r = alice_user_key; // For compatibility with print statements
    let alice_c_outer_m = 0 as Field;
    let alice_c_outer_r = token_address;
    
    // === MAIN STACK COMMITMENTS (user's own commitments) ===
    let alice_previous_nonce_commitment = Poseidon2::hash([alice_user_key_hash, alice_previous_nonce], 2);
    let token_address_hash = Poseidon2::hash([token_address, alice_user_key_hash], 2);
    
    // Compute view_key (same as in main circuit)
    let alice_view_key = Poseidon2::hash([VIEW_STRING, alice_user_key_hash], 2);
    
    // Encrypt the coordinates from previous transaction (simulating what was returned from previous operation)
    let previous_encryption_key = Poseidon2::hash([alice_view_key, alice_previous_nonce], 2);
    let encrypted_x = poseidon_ctr_encrypt(alice_personal_c_tot[0], previous_encryption_key, 3);
    let encrypted_y = poseidon_ctr_encrypt(alice_personal_c_tot[1], previous_encryption_key, 4);
    
    // Create main commitment components
    let user_main_entry_commitment = pedersen_commitment_positive(encrypted_x, encrypted_y, alice_previous_nonce_commitment);
    let another_user_main_entry_commitment = pedersen_commitment_positive(token_address_hash, alice_user_key_hash, 0x29a as Field);
    
    let main_c_inner = [user_main_entry_commitment.x, user_main_entry_commitment.y];
    let main_c_outer = [another_user_main_entry_commitment.x, another_user_main_entry_commitment.y];
    
    // Opening values for main commitments - these are encrypted coordinates from previous transaction
    let main_c_inner_point = [encrypted_x, encrypted_y];
    let main_c_outer_point = [token_address_hash, alice_user_key_hash, 0x29a as Field];
    
    // === NOTES STACK COMMITMENTS (incoming note commitments) ===
    // Structure: notes_c_inner (sum of notes) + notes_c_outer (pub key reference) = notes_c_tot
    let stack_amount = 100 as Field;
    let stack_blinding = 64 as Field; // shared_key_hash
    let inner_notes_count = 1 as Field; // Number of notes being absorbed
    
    // Derive Alice's public key (receiver's public key for the note)
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    let alice_public_key = bjj.curve.mul(alice_user_key, generator);
    
    // Notes inner commitment: sum of all notes for this token
    // For single note: amount*G + shared_key_hash*H + (token_address * count)*D
    let token_address_with_count = token_address * inner_notes_count;
    let notes_c_inner_commitment = pedersen_commitment_positive(stack_amount, stack_blinding, token_address_with_count);
    let notes_c_inner = [notes_c_inner_commitment.x, notes_c_inner_commitment.y];
    
    // Notes outer commitment: receiver's public key commitment (pub_x, pub_y, 1)
    let notes_c_outer_commitment = pedersen_commitment_positive(alice_public_key.x, alice_public_key.y, 1);
    let notes_c_outer = [notes_c_outer_commitment.x, notes_c_outer_commitment.y];
    
    // Reference commitment: pedersen_commitment_positive(pub_x, pub_y, 1) - same as notes_c_outer in this case
    // But for consistency with circuit, we calculate it separately
    let reference_commitment = pedersen_commitment_positive(alice_public_key.x, alice_public_key.y, 1);
    
    // Notes total commitment: notes_c_inner + notes_c_outer + reference_commitment
    let notes_c_tot_commitment = add_multiple_commitments([
        notes_c_inner_commitment,
        notes_c_outer_commitment,
        reference_commitment
    ]);
    let notes_c_tot = [notes_c_tot_commitment.x, notes_c_tot_commitment.y];
    
    // Opening values for notes commitments
    // notes_c_inner_point: [sum of amounts, sum of shared_key_hashes]
    let notes_c_inner_point = [stack_amount, stack_blinding];
    // notes_c_outer_point: [receiver_pub_x, receiver_pub_y, 1]
    let notes_c_outer_point = [alice_public_key.x, alice_public_key.y, 1];
    
    // === MAIN C_TOT (new structure: notes_c_tot + main_c_outer = main_c_tot) ===
    let main_c_outer_commitment = EmbeddedCurvePoint { x: main_c_outer[0], y: main_c_outer[1], is_infinite: false };
    let main_c_tot_commitment = add_commitments(notes_c_tot_commitment, main_c_outer_commitment);
    let main_c_tot = [main_c_tot_commitment.x, main_c_tot_commitment.y];

    // === FEE TOKEN COMMITMENTS ===
    let relay_fee_token_address = token_address; // Same token for fee
    let receiver_fee_amount = 10 as Field; // Fee amount to pay
    let fee_token_personal_c_inner = alice_personal_c_inner;
    let fee_token_personal_c_outer = alice_personal_c_outer;
    let fee_token_personal_c_inner_m = alice_personal_c_inner_m;
    let fee_token_personal_c_outer_m = alice_c_outer_m;
    let fee_token_personal_c_outer_r = alice_c_outer_r;

    std::println("✅ Simulated state setup completed");
    std::print("Alice personal c_tot: ");
    std::println(alice_personal_c_tot[0]);
    std::print("Notes c_tot: ");
    std::println(notes_c_tot[0]);
    std::println("");

    // === CALL ALICE'S ABSORB CIRCUIT ===
    std::println("=== CALLING ALICE'S ABSORB CIRCUIT ===");
    
    // Call the main circuit function with nullifier parameter and fee token parameters
    let absorb_result: (Field, [Field; 2], [Field; 7], [Field; 2], [Field; 2]) = main(
        alice_user_key,
        token_address,
        alice_previous_nonce,
        inner_notes_count,
        // Main stack commitments (user's own commitments)
        main_c_tot,
        main_c_inner,
        main_c_outer,
        main_c_inner_point,
        main_c_outer_point,
        // Notes stack commitments (incoming note commitments)
        notes_c_tot,
        notes_c_inner,
        notes_c_outer,
        notes_c_inner_point,
        notes_c_outer_point,
        // Personal commitments (user's balance state)
        alice_personal_c_tot,
        alice_personal_c_inner,
        alice_personal_c_outer,
        alice_personal_c_inner_m,
        alice_c_outer_m,
        alice_c_outer_r,
        alice_nullifier,
        // Fee token parameters
        relay_fee_token_address,
        receiver_fee_amount,
        fee_token_personal_c_inner,
        fee_token_personal_c_outer,
        fee_token_personal_c_inner_m,
        fee_token_personal_c_outer_m,
        fee_token_personal_c_outer_r
    );
    
    let new_nonce_commitment: Field = absorb_result.0;
    let new_main_commit: [Field; 2] = absorb_result.1;
    let encrypted_note: [Field; 7] = absorb_result.2;
    let nonce_discovery_entry: [Field; 2] = absorb_result.3;
    
    std::println("✅ Alice absorb circuit executed successfully!");
    std::print("New nonce commitment: ");
    std::println(new_nonce_commitment);
    std::print("New main commit x: ");
    std::println(new_main_commit[0]);
    std::print("New main commit y: ");
    std::println(new_main_commit[1]);
    std::print("Encrypted note length: ");
    std::println(encrypted_note.len());
    std::print("Nonce discovery entry x: ");
    std::println(nonce_discovery_entry[0]);
    std::print("Nonce discovery entry y: ");
    std::println(nonce_discovery_entry[1]);
    
    // Verify encrypted values can be decrypted correctly
    let new_nonce = alice_previous_nonce + 1;
    let encryption_key = Poseidon2::hash([alice_view_key, new_nonce], 2);
    
    // Decrypt new balance (counter 0) - this is what gets stored in contract
    let expected_new_balance = alice_entry_amount + stack_amount - receiver_fee_amount;
    let decrypted_new_balance = poseidon_ctr_decrypt(encrypted_note[3], encryption_key, 0);
    assert(decrypted_new_balance == expected_new_balance, "Decrypted new balance doesn't match expected");
    
    // Decrypt token address (counter 1)
    let decrypted_token_address = poseidon_ctr_decrypt(encrypted_note[1], encryption_key, 1);
    assert(decrypted_token_address == token_address, "Decrypted token address doesn't match");
    
    // Decrypt absorbed amount (counter 3)
    let decrypted_absorbed_amount = poseidon_ctr_decrypt(encrypted_note[0], encryption_key, 3);
    assert(decrypted_absorbed_amount == stack_amount, "Decrypted absorbed amount doesn't match");
    
    std::println("");
    std::print("Decrypted new balance: ");
    std::println(decrypted_new_balance);
    std::print("Expected new balance: ");
    std::println(expected_new_balance);
    std::println("");
    
    // === PROVER.TOML OUTPUT FOR ALICE ABSORB ===
    std::println("=== PROVER.TOML OUTPUT FOR ALICE ABSORB ===");
    std::println("");
    
    // User and operation info
    std::print("user_key = \"");
    std::print(alice_user_key);
    std::println("\"");
    std::println("");
    
    std::print("previous_nonce = \"");
    std::print(alice_previous_nonce);
    std::println("\"");
    std::println("");
    
    std::print("current_balance = \"");
    std::print(alice_entry_amount);
    std::println("\"");
    std::println("");
    
    std::print("token_address = \"");
    std::print(token_address);
    std::println("\"");
    std::println("");
    
    std::print("previous_spent_amount = \"");
    std::print(0);
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
    
    // Notes stack commitments
    std::print("inner_notes_count = \"");
    std::print(inner_notes_count);
    std::println("\"");
    std::println("");
    
    std::print("notes_c_tot = [\"");
    std::print(notes_c_tot[0]);
    std::print("\", \"");
    std::print(notes_c_tot[1]);
    std::println("\"]");
    std::println("");
    
    std::print("notes_c_inner = [\"");
    std::print(notes_c_inner[0]);
    std::print("\", \"");
    std::print(notes_c_inner[1]);
    std::println("\"]");
    std::println("");
    
    std::print("notes_c_outer = [\"");
    std::print(notes_c_outer[0]);
    std::print("\", \"");
    std::print(notes_c_outer[1]);
    std::println("\"]");
    std::println("");
    
    // Personal commitments
    std::print("personal_c_tot = [\"");
    std::print(alice_personal_c_tot[0]);
    std::print("\", \"");
    std::print(alice_personal_c_tot[1]);
    std::println("\"]");
    std::println("");
    
    std::print("personal_c_inner = [\"");
    std::print(alice_personal_c_inner[0]);
    std::print("\", \"");
    std::print(alice_personal_c_inner[1]);
    std::println("\"]");
    std::println("");
    
    std::print("personal_c_outer = [\"");
    std::print(alice_personal_c_outer[0]);
    std::print("\", \"");
    std::print(alice_personal_c_outer[1]);
    std::println("\"]");
    std::println("");
    
    // Opening values
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
    
    std::print("notes_c_inner_point = [\"");
    std::print(notes_c_inner_point[0]);
    std::print("\", \"");
    std::print(notes_c_inner_point[1]);
    std::println("\"]");
    std::println("");
    
    std::print("notes_c_outer_point = [\"");
    std::print(notes_c_outer_point[0]);
    std::print("\", \"");
    std::print(notes_c_outer_point[1]);
    std::print("\", \"");
    std::print(notes_c_outer_point[2]);
    std::println("\"]");
    std::println("");
    
    std::print("personal_c_inner_m = \"");
    std::print(alice_personal_c_inner_m);
    std::println("\"");
    std::println("");
    
    std::print("personal_c_outer_m = \"");
    std::print(alice_c_outer_m);
    std::println("\"");
    std::println("");
    
    std::print("personal_c_outer_r = \"");
    std::print(alice_c_outer_r);
    std::println("\"");
    std::println("");
    
    std::print("nullifier = \"");
    std::print(alice_nullifier);
    std::println("\"");
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
    
    std::println("=== STANDALONE ABSORB TEST COMPLETED ===");
    std::println("Circuit structure verified - ready for real proof generation!");
}

#[test]
fn test_absorb_with_zero_balance_pay_fee_from_absorbed() {
    std::println("=== TEST: Bob absorbs 100 USDC with 0 balance, pays 10 USDC fee from absorbed amount ===");
    
    // === BOB'S STATE (0 USDC balance) ===
    let bob_user_key = 0x9876543210fedcba;
    let token_address = 0x02; // USDC
    let bob_previous_nonce = 0;
    
    let bob_user_key_hash = Poseidon2::hash([bob_user_key], 1);
    let bob_entry_amount = 0 as Field; // Bob has 0 USDC
    
    // Create personal commitments for 0 balance
    let bob_balance_amount_hash = Poseidon2::hash([bob_entry_amount, bob_user_key_hash], 2);
    let bob_token_address_hash = Poseidon2::hash([token_address, bob_user_key_hash], 2);
    
    let bob_personal_c_inner_commitment = pedersen_commitment_non_hiding(bob_balance_amount_hash, bob_token_address_hash);
    let bob_personal_c_outer_commitment = pedersen_commitment_non_hiding(0, token_address);
    
    let bob_nullifier = 0 as Field;
    let bob_initializer = pedersen_commitment_non_hiding(token_address, bob_user_key_hash);
    let bob_personal_c_tot_commitment: EmbeddedCurvePoint = add_multiple_commitments([
        bob_personal_c_inner_commitment,
        bob_personal_c_outer_commitment,
        bob_initializer
    ]);
    
    let bob_personal_c_tot = [bob_personal_c_tot_commitment.x, bob_personal_c_tot_commitment.y];
    let bob_personal_c_inner = [bob_personal_c_inner_commitment.x, bob_personal_c_inner_commitment.y];
    let bob_personal_c_outer = [bob_personal_c_outer_commitment.x, bob_personal_c_outer_commitment.y];
    
    let bob_personal_c_inner_m = bob_entry_amount;
    let bob_c_outer_m = 0 as Field;
    let bob_c_outer_r = token_address;
    
    // === MAIN STACK COMMITMENTS ===
    let bob_previous_nonce_commitment = Poseidon2::hash([bob_user_key_hash, bob_previous_nonce], 2);
    let bob_view_key = Poseidon2::hash([VIEW_STRING, bob_user_key_hash], 2);
    
    let previous_encryption_key = Poseidon2::hash([bob_view_key, bob_previous_nonce], 2);
    let encrypted_x = poseidon_ctr_encrypt(bob_personal_c_tot[0], previous_encryption_key, 3);
    let encrypted_y = poseidon_ctr_encrypt(bob_personal_c_tot[1], previous_encryption_key, 4);
    
    let user_main_entry_commitment = pedersen_commitment_positive(encrypted_x, encrypted_y, bob_previous_nonce_commitment);
    let another_user_main_entry_commitment = pedersen_commitment_positive(bob_token_address_hash, bob_user_key_hash, 0x29a as Field);
    
    let main_c_inner = [user_main_entry_commitment.x, user_main_entry_commitment.y];
    let main_c_outer = [another_user_main_entry_commitment.x, another_user_main_entry_commitment.y];
    let main_c_inner_point = [encrypted_x, encrypted_y];
    let main_c_outer_point = [bob_token_address_hash, bob_user_key_hash, 0x29a as Field];
    
    // === NOTES STACK COMMITMENTS (Alice sent 100 USDC) ===
    let stack_amount = 100 as Field;
    let stack_blinding = 64 as Field; // shared_key_hash
    let inner_notes_count = 1 as Field; // Number of notes being absorbed
    
    // Derive Bob's public key (receiver's public key)
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    let bob_public_key = bjj.curve.mul(bob_user_key, generator);
    
    // Notes inner commitment: sum of all notes for this token
    // For single note: amount*G + shared_key_hash*H + (token_address * count)*D
    let token_address_with_count = token_address * inner_notes_count;
    let notes_c_inner_commitment = pedersen_commitment_positive(stack_amount, stack_blinding, token_address_with_count);
    let notes_c_inner = [notes_c_inner_commitment.x, notes_c_inner_commitment.y];
    
    // Notes outer commitment: receiver's public key commitment (pub_x, pub_y, 1)
    let notes_c_outer_commitment = pedersen_commitment_positive(bob_public_key.x, bob_public_key.y, 1);
    let notes_c_outer = [notes_c_outer_commitment.x, notes_c_outer_commitment.y];
    
    // Reference commitment: pedersen_commitment_positive(pub_x, pub_y, 1) - same as notes_c_outer in this case
    // But for consistency with circuit, we calculate it separately
    let reference_commitment = pedersen_commitment_positive(bob_public_key.x, bob_public_key.y, 1);
    
    // Notes total commitment: notes_c_inner + notes_c_outer + reference_commitment
    let notes_c_tot_commitment = add_multiple_commitments([
        notes_c_inner_commitment,
        notes_c_outer_commitment,
        reference_commitment
    ]);
    let notes_c_tot = [notes_c_tot_commitment.x, notes_c_tot_commitment.y];
    
    // Opening values for notes commitments
    // notes_c_inner_point: [sum of amounts, sum of shared_key_hashes]
    let notes_c_inner_point = [stack_amount, stack_blinding];
    // notes_c_outer_point: [receiver_pub_x, receiver_pub_y, 1]
    let notes_c_outer_point = [bob_public_key.x, bob_public_key.y, 1];
    
    // === MAIN C_TOT (new structure: notes_c_tot + main_c_outer = main_c_tot) ===
    let main_c_outer_commitment = EmbeddedCurvePoint { x: main_c_outer[0], y: main_c_outer[1], is_infinite: false };
    let main_c_tot_commitment = add_commitments(notes_c_tot_commitment, main_c_outer_commitment);
    let main_c_tot = [main_c_tot_commitment.x, main_c_tot_commitment.y];
    
    // === FEE TOKEN COMMITMENTS (same token, fee from absorbed amount) ===
    let relay_fee_token_address = token_address; // Same token for fee
    let receiver_fee_amount = 10 as Field; // Fee to pay
    let fee_token_personal_c_inner = bob_personal_c_inner;
    let fee_token_personal_c_outer = bob_personal_c_outer;
    let fee_token_personal_c_inner_m = bob_personal_c_inner_m;
    let fee_token_personal_c_outer_m = bob_c_outer_m;
    let fee_token_personal_c_outer_r = bob_c_outer_r;
    
    std::println("Bob's initial balance: 0 USDC");
    std::println("Absorbing: 100 USDC");
    std::println("Fee to pay: 10 USDC (from absorbed amount)");
    std::println("Expected new balance: 90 USDC (100 - 10)");
    std::println("");
    
    // === CALL BOB'S ABSORB CIRCUIT ===
    let absorb_result: (Field, [Field; 2], [Field; 7], [Field; 2], [Field; 2]) = main(
        bob_user_key,
        token_address,
        bob_previous_nonce,
        inner_notes_count,
        main_c_tot,
        main_c_inner,
        main_c_outer,
        main_c_inner_point,
        main_c_outer_point,
        notes_c_tot,
        notes_c_inner,
        notes_c_outer,
        notes_c_inner_point,
        notes_c_outer_point,
        bob_personal_c_tot,
        bob_personal_c_inner,
        bob_personal_c_outer,
        bob_personal_c_inner_m,
        bob_c_outer_m,
        bob_c_outer_r,
        bob_nullifier,
        relay_fee_token_address,
        receiver_fee_amount,
        fee_token_personal_c_inner,
        fee_token_personal_c_outer,
        fee_token_personal_c_inner_m,
        fee_token_personal_c_outer_m,
        fee_token_personal_c_outer_r
    );
    
    let new_nonce_commitment: Field = absorb_result.0;
    let new_main_commit: [Field; 2] = absorb_result.1;
    let encrypted_note: [Field; 7] = absorb_result.2;
    let nonce_discovery_entry: [Field; 2] = absorb_result.3;
    
    std::println("✅ Bob absorb circuit executed successfully!");
    std::print("New nonce commitment: ");
    std::println(new_nonce_commitment);
    std::print("New main commit x: ");
    std::println(new_main_commit[0]);
    std::print("New main commit y: ");
    std::println(new_main_commit[1]);
    std::print("Encrypted note length: ");
    std::println(encrypted_note.len());
    
    // Verify the new balance: 0 + 100 - 10 = 90
    let expected_new_balance = bob_entry_amount + stack_amount - receiver_fee_amount;
    
    // Decrypt and verify encrypted values
    let new_nonce = bob_previous_nonce + 1;
    let encryption_key = Poseidon2::hash([bob_view_key, new_nonce], 2);
    
    // Decrypt new balance (counter 0) - this is what gets stored in contract
    let decrypted_new_balance = poseidon_ctr_decrypt(encrypted_note[3], encryption_key, 0);
    assert(decrypted_new_balance == expected_new_balance, "Decrypted new balance doesn't match expected");
    
    // Decrypt token address (counter 1)
    let decrypted_token_address = poseidon_ctr_decrypt(encrypted_note[1], encryption_key, 1);
    assert(decrypted_token_address == token_address, "Decrypted token address doesn't match");
    
    // Decrypt absorbed amount (counter 3)
    let decrypted_absorbed_amount = poseidon_ctr_decrypt(encrypted_note[0], encryption_key, 3);
    assert(decrypted_absorbed_amount == stack_amount, "Decrypted absorbed amount doesn't match");
    
    std::println("");
    std::print("Decrypted new balance: ");
    std::println(decrypted_new_balance);
    std::print("Expected new balance: ");
    std::println(expected_new_balance);
    std::println("");
    std::println("✅ Test passed! Bob successfully absorbed 100 USDC and paid 10 USDC fee from the absorbed amount");
    std::println("Final balance: 90 USDC (0 + 100 - 10)");
}

#[test]
fn test_absorb_two_different_tokens() {
    std::println("=== TEST: User absorbs 2 different tokens sequentially ===");
    std::println("Step 1: Absorb 100 USDC (token 0x02)");
    std::println("Step 2: Absorb 50 WETH (token 0x03)");
    std::println("");
    
    // === USER'S INITIAL STATE (0 balance for both tokens) ===
    let user_key = 0xabcdef1234567890;
    let token1_address = 0x02; // USDC
    let token2_address = 0x03; // WETH
    let user_previous_nonce = 0;
    
    let user_key_hash = Poseidon2::hash([user_key], 1);
    let user_view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    
    // === INITIAL PERSONAL COMMITMENTS (0 balance for token 1) ===
    let token1_balance = 0 as Field;
    let token1_balance_hash = Poseidon2::hash([token1_balance, user_key_hash], 2);
    let token1_address_hash = Poseidon2::hash([token1_address, user_key_hash], 2);
    
    let token1_personal_c_inner_commitment = pedersen_commitment_non_hiding(token1_balance_hash, token1_address_hash);
    let token1_personal_c_outer_commitment = pedersen_commitment_non_hiding(0, token1_address);
    
    let token1_nullifier = 0 as Field;
    let token1_initializer = pedersen_commitment_non_hiding(token1_address, user_key_hash);
    let token1_personal_c_tot_commitment: EmbeddedCurvePoint = add_multiple_commitments([
        token1_personal_c_inner_commitment,
        token1_personal_c_outer_commitment,
        token1_initializer
    ]);
    
    let token1_personal_c_tot = [token1_personal_c_tot_commitment.x, token1_personal_c_tot_commitment.y];
    let token1_personal_c_inner = [token1_personal_c_inner_commitment.x, token1_personal_c_inner_commitment.y];
    let token1_personal_c_outer = [token1_personal_c_outer_commitment.x, token1_personal_c_outer_commitment.y];
    
    // === INITIAL MAIN STACK COMMITMENTS ===
    let user_previous_nonce_commitment = Poseidon2::hash([user_key_hash, user_previous_nonce], 2);
    let previous_encryption_key = Poseidon2::hash([user_view_key, user_previous_nonce], 2);
    let encrypted_x = poseidon_ctr_encrypt(token1_personal_c_tot[0], previous_encryption_key, 3);
    let encrypted_y = poseidon_ctr_encrypt(token1_personal_c_tot[1], previous_encryption_key, 4);
    
    let user_main_entry_commitment = pedersen_commitment_positive(encrypted_x, encrypted_y, user_previous_nonce_commitment);
    let another_user_main_entry_commitment = pedersen_commitment_positive(token1_address_hash, user_key_hash, 0x29a as Field);
    
    let main_c_inner = [user_main_entry_commitment.x, user_main_entry_commitment.y];
    let main_c_outer = [another_user_main_entry_commitment.x, another_user_main_entry_commitment.y];
    let main_c_inner_point = [encrypted_x, encrypted_y];
    let main_c_outer_point = [token1_address_hash, user_key_hash, 0x29a as Field];
    
    // === FIRST NOTE: 100 USDC (token 1) ===
    std::println("=== FIRST ABSORB: 100 USDC ===");
    let note1_amount = 100 as Field;
    let note1_shared_key_hash = 64 as Field;
    let inner_notes_count_1 = 1 as Field;
    
    // Derive user's public key
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    let user_public_key = bjj.curve.mul(user_key, generator);
    
    // Notes commitments for token 1
    let token1_with_count = token1_address * inner_notes_count_1;
    let notes1_c_inner_commitment = pedersen_commitment_positive(note1_amount, note1_shared_key_hash, token1_with_count);
    let notes1_c_inner = [notes1_c_inner_commitment.x, notes1_c_inner_commitment.y];
    
    let notes1_c_outer_commitment = pedersen_commitment_positive(user_public_key.x, user_public_key.y, 1);
    let notes1_c_outer = [notes1_c_outer_commitment.x, notes1_c_outer_commitment.y];
    
    // Reference commitment: pedersen_commitment_positive(pub_x, pub_y, 1)
    let reference_commitment_1 = pedersen_commitment_positive(user_public_key.x, user_public_key.y, 1);
    
    // Notes total commitment: notes_c_inner + notes_c_outer + reference_commitment
    let notes1_c_tot_commitment = add_multiple_commitments([
        notes1_c_inner_commitment,
        notes1_c_outer_commitment,
        reference_commitment_1
    ]);
    let notes1_c_tot = [notes1_c_tot_commitment.x, notes1_c_tot_commitment.y];
    
    let notes1_c_inner_point = [note1_amount, note1_shared_key_hash];
    let notes1_c_outer_point = [user_public_key.x, user_public_key.y, 1];
    
    // Main c_tot for first absorb
    let main_c_outer_commitment = EmbeddedCurvePoint { x: main_c_outer[0], y: main_c_outer[1], is_infinite: false };
    let main_c_tot_commitment = add_commitments(notes1_c_tot_commitment, main_c_outer_commitment);
    let main_c_tot = [main_c_tot_commitment.x, main_c_tot_commitment.y];
    
    // Fee token (same as token 1 for first absorb)
    let relay_fee_token_address_1 = token1_address;
    let receiver_fee_amount_1 = 10 as Field;
    let fee_token_personal_c_inner_1 = token1_personal_c_inner;
    let fee_token_personal_c_outer_1 = token1_personal_c_outer;
    let fee_token_personal_c_inner_m_1 = token1_balance;
    let fee_token_personal_c_outer_m_1 = 0 as Field;
    let fee_token_personal_c_outer_r_1 = token1_address;
    
    // === FIRST ABSORB OPERATION ===
    let absorb_result_1: (Field, [Field; 2], [Field; 7], [Field; 2], [Field; 2]) = main(
        user_key,
        token1_address,
        user_previous_nonce,
        inner_notes_count_1,
        main_c_tot,
        main_c_inner,
        main_c_outer,
        main_c_inner_point,
        main_c_outer_point,
        notes1_c_tot,
        notes1_c_inner,
        notes1_c_outer,
        notes1_c_inner_point,
        notes1_c_outer_point,
        token1_personal_c_tot,
        token1_personal_c_inner,
        token1_personal_c_outer,
        token1_balance,
        0 as Field,
        token1_address,
        token1_nullifier,
        relay_fee_token_address_1,
        receiver_fee_amount_1,
        fee_token_personal_c_inner_1,
        fee_token_personal_c_outer_1,
        fee_token_personal_c_inner_m_1,
        fee_token_personal_c_outer_m_1,
        fee_token_personal_c_outer_r_1
    );
    
    let new_nonce_1 = user_previous_nonce + 1;
    let new_nonce_commitment_1 = absorb_result_1.0;
    let new_main_commit_1 = absorb_result_1.1;
    let encrypted_note_1 = absorb_result_1.2;
    
    // Verify encrypted values for first absorb
    let encryption_key_1 = Poseidon2::hash([user_view_key, new_nonce_1], 2);
    let expected_new_balance_1 = token1_balance + note1_amount - receiver_fee_amount_1;
    let decrypted_new_balance_1 = poseidon_ctr_decrypt(encrypted_note_1[3], encryption_key_1, 0);
    assert(decrypted_new_balance_1 == expected_new_balance_1, "First absorb: Decrypted new balance doesn't match expected");
    let decrypted_token_address_1 = poseidon_ctr_decrypt(encrypted_note_1[1], encryption_key_1, 1);
    assert(decrypted_token_address_1 == token1_address, "First absorb: Decrypted token address doesn't match");
    
    std::println("✅ First absorb successful!");
    std::println("Token 1 (USDC) balance after first absorb: 90 (0 + 100 - 10)");
    std::println("");
    
    // === UPDATE STATE FOR SECOND ABSORB ===
    // The encrypted coordinates from first absorb are already in absorb_result_1.4
    // These are encrypted with new_nonce_1's encryption key, which becomes the previous_nonce for second absorb
    
    // === INITIAL PERSONAL COMMITMENTS FOR TOKEN 2 (0 balance) ===
    let token2_balance = 0 as Field;
    let token2_balance_hash = Poseidon2::hash([token2_balance, user_key_hash], 2);
    let token2_address_hash = Poseidon2::hash([token2_address, user_key_hash], 2);
    
    let token2_personal_c_inner_commitment = pedersen_commitment_non_hiding(token2_balance_hash, token2_address_hash);
    let token2_personal_c_outer_commitment = pedersen_commitment_non_hiding(0, token2_address);
    
    let token2_nullifier = 0 as Field;
    let token2_initializer = pedersen_commitment_non_hiding(token2_address, user_key_hash);
    let token2_personal_c_tot_commitment: EmbeddedCurvePoint = add_multiple_commitments([
        token2_personal_c_inner_commitment,
        token2_personal_c_outer_commitment,
        token2_initializer
    ]);
    
    let token2_personal_c_tot = [token2_personal_c_tot_commitment.x, token2_personal_c_tot_commitment.y];
    let token2_personal_c_inner = [token2_personal_c_inner_commitment.x, token2_personal_c_inner_commitment.y];
    let token2_personal_c_outer = [token2_personal_c_outer_commitment.x, token2_personal_c_outer_commitment.y];
    
    // === SECOND NOTE: 50 WETH (token 2) ===
    std::println("=== SECOND ABSORB: 50 WETH ===");
    let note2_amount = 50 as Field;
    let note2_shared_key_hash = 128 as Field;
    let inner_notes_count_2 = 1 as Field;
    
    // Notes commitments for token 2
    let token2_with_count = token2_address * inner_notes_count_2;
    let notes2_c_inner_commitment = pedersen_commitment_positive(note2_amount, note2_shared_key_hash, token2_with_count);
    let notes2_c_inner = [notes2_c_inner_commitment.x, notes2_c_inner_commitment.y];
    
    let notes2_c_outer_commitment = pedersen_commitment_positive(user_public_key.x, user_public_key.y, 1);
    let notes2_c_outer = [notes2_c_outer_commitment.x, notes2_c_outer_commitment.y];
    
    // Reference commitment: pedersen_commitment_positive(pub_x, pub_y, 1)
    let reference_commitment_2 = pedersen_commitment_positive(user_public_key.x, user_public_key.y, 1);
    
    // Notes total commitment: notes_c_inner + notes_c_outer + reference_commitment
    let notes2_c_tot_commitment = add_multiple_commitments([
        notes2_c_inner_commitment,
        notes2_c_outer_commitment,
        reference_commitment_2
    ]);
    let notes2_c_tot = [notes2_c_tot_commitment.x, notes2_c_tot_commitment.y];
    
    let notes2_c_inner_point = [note2_amount, note2_shared_key_hash];
    let notes2_c_outer_point = [user_public_key.x, user_public_key.y, 1];
    
    // Main stack for second absorb
    // For token2's first operation, we need to encrypt token2's initial personal_c_tot
    // with the previous nonce (new_nonce_1) so the circuit can verify it matches
    let previous_encryption_key_2 = Poseidon2::hash([user_view_key, new_nonce_1], 2);
    let encrypted_x_2 = poseidon_ctr_encrypt(token2_personal_c_tot[0], previous_encryption_key_2, 3);
    let encrypted_y_2 = poseidon_ctr_encrypt(token2_personal_c_tot[1], previous_encryption_key_2, 4);
    
    let user_main_entry_commitment_2 = pedersen_commitment_positive(encrypted_x_2, encrypted_y_2, new_nonce_commitment_1);
    let another_user_main_entry_commitment_2 = pedersen_commitment_positive(token2_address_hash, user_key_hash, 0x29a as Field);
    
    let main_c_inner_2 = [user_main_entry_commitment_2.x, user_main_entry_commitment_2.y];
    let main_c_outer_2 = [another_user_main_entry_commitment_2.x, another_user_main_entry_commitment_2.y];
    let main_c_inner_point_2 = [encrypted_x_2, encrypted_y_2];
    let main_c_outer_point_2 = [token2_address_hash, user_key_hash, 0x29a as Field];
    
    // Main c_tot for second absorb
    let main_c_outer_commitment_2 = EmbeddedCurvePoint { x: main_c_outer_2[0], y: main_c_outer_2[1], is_infinite: false };
    let main_c_tot_commitment_2 = add_commitments(notes2_c_tot_commitment, main_c_outer_commitment_2);
    let main_c_tot_2 = [main_c_tot_commitment_2.x, main_c_tot_commitment_2.y];
    
    // Fee token (same as token 2 for second absorb)
    let relay_fee_token_address_2 = token2_address;
    let receiver_fee_amount_2 = 5 as Field;
    let fee_token_personal_c_inner_2 = token2_personal_c_inner;
    let fee_token_personal_c_outer_2 = token2_personal_c_outer;
    let fee_token_personal_c_inner_m_2 = token2_balance;
    let fee_token_personal_c_outer_m_2 = 0 as Field;
    let fee_token_personal_c_outer_r_2 = token2_address;
    
    // === SECOND ABSORB OPERATION ===
    let absorb_result_2: (Field, [Field; 2], [Field; 7], [Field; 2], [Field; 2]) = main(
        user_key,
        token2_address,
        new_nonce_1,
        inner_notes_count_2,
        main_c_tot_2,
        main_c_inner_2,
        main_c_outer_2,
        main_c_inner_point_2,
        main_c_outer_point_2,
        notes2_c_tot,
        notes2_c_inner,
        notes2_c_outer,
        notes2_c_inner_point,
        notes2_c_outer_point,
        token2_personal_c_tot,
        token2_personal_c_inner,
        token2_personal_c_outer,
        token2_balance,
        0 as Field,
        token2_address,
        token2_nullifier,
        relay_fee_token_address_2,
        receiver_fee_amount_2,
        fee_token_personal_c_inner_2,
        fee_token_personal_c_outer_2,
        fee_token_personal_c_inner_m_2,
        fee_token_personal_c_outer_m_2,
        fee_token_personal_c_outer_r_2
    );
    
    let new_nonce_2 = new_nonce_1 + 1;
    let new_nonce_commitment_2 = absorb_result_2.0;
    let new_main_commit_2 = absorb_result_2.1;
    let encrypted_note_2 = absorb_result_2.2;
    
    // Verify encrypted values for second absorb
    let encryption_key_2 = Poseidon2::hash([user_view_key, new_nonce_2], 2);
    let expected_new_balance_2 = token2_balance + note2_amount - receiver_fee_amount_2;
    let decrypted_new_balance_2 = poseidon_ctr_decrypt(encrypted_note_2[3], encryption_key_2, 0);
    assert(decrypted_new_balance_2 == expected_new_balance_2, "Second absorb: Decrypted new balance doesn't match expected");
    let decrypted_token_address_2 = poseidon_ctr_decrypt(encrypted_note_2[1], encryption_key_2, 1);
    assert(decrypted_token_address_2 == token2_address, "Second absorb: Decrypted token address doesn't match");
    
    std::println("✅ Second absorb successful!");
    std::println("Token 2 (WETH) balance after second absorb: 45 (0 + 50 - 5)");
    std::println("");
    
    // === FINAL VERIFICATION ===
    std::println("=== FINAL VERIFICATION ===");
    std::println("Initial Token 1 (USDC): 0");
    std::println("First absorb: +100 USDC, -10 USDC fee");
    std::println("Final Token 1 (USDC): 90");
    std::println("");
    std::println("Initial Token 2 (WETH): 0");
    std::println("Second absorb: +50 WETH, -5 WETH fee");
    std::println("Final Token 2 (WETH): 45");
    std::println("");
    std::println("✅ Test passed! User successfully absorbed 2 different tokens sequentially");
    std::println("Final balances: 90 USDC, 45 WETH");
}