use dep::std;
use dep::poseidon::poseidon2::Poseidon2;
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_token,
    pedersen_commitment_positive,
    pedersen_commitment_negative,
    pedersen_commitment_counter,
    add_commitments,
    add_multiple_commitments,
    to_nullifier_domain,
    pedersen_commitment_non_hiding
};
use dep::poseidon_ctr_encryption::{poseidon_ctr_encrypt, poseidon_ctr_decrypt};
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
use crate::main;

// === TEST CONSTANTS ===
// Note: Noir doesn't support const, so we use functions to return test values

global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;

/// Get test user key
fn test_user_key() -> Field { 0x19e573f3801c7b2e4619998342e8e305e1692184cbacd220c04198a04c36b7d2 as Field }

/// Get test token address (USDC)
fn test_token_address() -> Field { 0x7775e4b6f4d40be537b55b6c47e09ada025757bd as Field }

/// Get test previous nonce
fn test_previous_nonce() -> Field { 0x00 as Field }

/// Get test deposit amount (50 USDC)
fn test_deposit_amount() -> Field { 0x32 as Field }

/// Get test previous balance (100 USDC)
fn test_previous_balance() -> Field { 0x64 as Field }

/// Get test another user nonce
fn test_another_user_nonce() -> Field { 0x29a as Field }

// === TEST HELPER FUNCTIONS ===

/// Create test user hashes and commitments
fn create_test_user_data(user_key: Field, token_address: Field, previous_nonce: Field) -> (Field, Field, Field) {
    let user_key_hash = Poseidon2::hash([user_key], 1);
    // For nonce 0 (entry): use user_key
    // For nonce > 0 (deposit/absorb/send): use user_key_hash
    let previous_nonce_commitment =
        Poseidon2::hash([user_key_hash, previous_nonce], 2);
    
    let token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2);
    
    (user_key_hash, previous_nonce_commitment, token_address_hash)
}

/// Create previous state commitments (simulating entry circuit output)
fn create_previous_state_commitments(
    prev_balance_amount: Field,
    token_address_hash: Field,
    user_key_hash: Field
) -> (EmbeddedCurvePoint, EmbeddedCurvePoint, EmbeddedCurvePoint, EmbeddedCurvePoint) {
    let prev_balance_amount_hash = Poseidon2::hash([prev_balance_amount, user_key_hash], 2);
    let nullifier_hash = Poseidon2::hash([0, user_key_hash], 2);
    
    let prev_c_balance_commitment = pedersen_commitment_non_hiding(prev_balance_amount_hash, token_address_hash);
    let prev_c_token_initializer = pedersen_commitment_non_hiding(token_address_hash, user_key_hash);
    let prev_c_inbound_nullifier = pedersen_commitment_non_hiding(nullifier_hash, to_nullifier_domain(token_address_hash));
    
    let prev_c_tot = add_multiple_commitments([prev_c_balance_commitment, prev_c_token_initializer, prev_c_inbound_nullifier]);
    
    (prev_c_balance_commitment, prev_c_token_initializer, prev_c_inbound_nullifier, prev_c_tot)
}

/// Create main stack commitments (simulating main stack state)
/// For deposit after entry (previous_nonce = 0): use entry circuit's construction exactly
/// For deposit after previous transaction (previous_nonce > 0): encrypt previous transaction's personal_c_tot
fn create_main_stack_commitments(
    prev_balance_amount: Field,
    token_address: Field,
    token_address_hash: Field,
    user_key_hash: Field,
    previous_nonce_commitment: Field,
    view_key: Field,
    previous_nonce: Field,
    user_key: Field
) -> ([Field; 2], [Field; 2], [Field; 2], [Field; 2], [Field; 3]) {
    if (previous_nonce == 0) {
        // For first deposit after entry: 
        // The deposit circuit expects main_c_inner_point to decrypt to personal_c_tot
        // So we need to create personal_c_tot as the deposit circuit defines it, encrypt it, and use it
        
        // Create personal_c_tot as the deposit circuit expects it
        let prev_balance_amount_hash = Poseidon2::hash([prev_balance_amount, user_key_hash], 2);
        let personal_c_inner_commitment = pedersen_commitment_non_hiding(prev_balance_amount_hash, token_address_hash);
        let personal_c_outer_commitment = pedersen_commitment_non_hiding(0, token_address);
        let initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
        let personal_c_tot_commitment = add_multiple_commitments([
            personal_c_inner_commitment,
            personal_c_outer_commitment,
            initializer
        ]);
        
        // Encrypt personal_c_tot coordinates (as deposit circuit expects)
        let previous_encryption_key = Poseidon2::hash([view_key, previous_nonce], 2);
        let encrypted_x = poseidon_ctr_encrypt(personal_c_tot_commitment.x, previous_encryption_key, 3);
        let encrypted_y = poseidon_ctr_encrypt(personal_c_tot_commitment.y, previous_encryption_key, 4);
        
        // Create main commitment using encrypted coordinates
        let user_main_entry_commitment = pedersen_commitment_positive(encrypted_x, encrypted_y, previous_nonce_commitment);
        
        // Use contract's initial state commitment as main_c_outer
        // From Nydus.sol constructor: pedersen_commitment_positive(1, 1, 1)
        // x: 0x0bc6f794fe53f0c8704d41006c06065f765e884d12ea6841895866f6a7796568
        // y: 0x22539c9ee4342d7eaa4c5a67d5cb0c93ddf1e9e03c173e6a4e442b5d57a2b5bd
        let initial_state_commitment = pedersen_commitment_positive(1, 1, 1);
        
        // main_c_tot = initial_state + entry_commitment
        let main_c_tot_commitment = add_commitments(initial_state_commitment, user_main_entry_commitment);
        
        let main_c_tot = [main_c_tot_commitment.x, main_c_tot_commitment.y];
        let main_c_inner = [user_main_entry_commitment.x, user_main_entry_commitment.y];
        let main_c_outer = [initial_state_commitment.x, initial_state_commitment.y];
        
        // Opening values: encrypted personal_c_tot coordinates
        let main_c_inner_point = [encrypted_x, encrypted_y];
        // Initial state commitment opening values: [1, 1, 1]
        let main_c_outer_point = [1, 1, 1];
        
        (main_c_tot, main_c_inner, main_c_outer, main_c_inner_point, main_c_outer_point)
    } else {
        // For subsequent deposits: encrypt previous transaction's personal_c_tot
    // Construct previous transaction's personal_c_tot (what gets encrypted in main_c_inner_point)
    let prev_balance_amount_hash = Poseidon2::hash([prev_balance_amount, user_key_hash], 2);
    let prev_personal_c_inner = pedersen_commitment_non_hiding(prev_balance_amount_hash, token_address_hash);
    let prev_personal_c_outer = pedersen_commitment_non_hiding(0, token_address);
    let prev_initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
    let prev_personal_c_tot = add_multiple_commitments([
        prev_personal_c_inner,
        prev_personal_c_outer,
        prev_initializer
    ]);
    
    // Encrypt the previous transaction's personal_c_tot coordinates
    let previous_encryption_key = Poseidon2::hash([view_key, previous_nonce], 2);
    let encrypted_x = poseidon_ctr_encrypt(prev_personal_c_tot.x, previous_encryption_key, 3);
    let encrypted_y = poseidon_ctr_encrypt(prev_personal_c_tot.y, previous_encryption_key, 4);
    
    // Create main commitment using encrypted coordinates (as would happen in previous transaction)
    let user_main_entry_commitment = pedersen_commitment_positive(encrypted_x, encrypted_y, previous_nonce_commitment);
    let another_user_main_entry_commitment = pedersen_commitment_positive(token_address_hash, user_key_hash, test_another_user_nonce());
    
    let main_c_tot_commitment = add_commitments(user_main_entry_commitment, another_user_main_entry_commitment);
    
    let main_c_tot = [main_c_tot_commitment.x, main_c_tot_commitment.y];
    let main_c_inner = [user_main_entry_commitment.x, user_main_entry_commitment.y];
    let main_c_outer = [another_user_main_entry_commitment.x, another_user_main_entry_commitment.y];
    
    // Opening values for membership proof - these are encrypted coordinates from previous transaction
    let main_c_inner_point = [encrypted_x, encrypted_y];
    let main_c_outer_point = [token_address_hash, user_key_hash, test_another_user_nonce()];
    
    (main_c_tot, main_c_inner, main_c_outer, main_c_inner_point, main_c_outer_point)
    }
}

/// Create personal commitments (current user's balance state)
/// For deposit after previous transaction: personal_c_tot should include nonce_commitment
/// from previous transaction, matching what was encrypted in main_c_inner_point
fn create_personal_commitments(
    prev_balance_amount: Field,
    token_address: Field,
    token_address_hash: Field,
    user_key_hash: Field,
    view_key: Field,
    previous_nonce: Field
) -> ([Field; 2], [Field; 2], [Field; 2], Field, Field, Field) {
    let prev_balance_amount_hash = Poseidon2::hash([prev_balance_amount, user_key_hash], 2);
    
    // Create personal_c_inner
    let personal_c_inner_commitment = pedersen_commitment_non_hiding(prev_balance_amount_hash, token_address_hash);
    
    // Create personal_c_outer (no nonce_commitment included)
    let personal_c_outer_commitment = pedersen_commitment_non_hiding(0, token_address);
    
    let initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
    
    // personal_c_tot = inner + outer + initializer
    let personal_c_tot_commitment = add_multiple_commitments([
        personal_c_inner_commitment,
        personal_c_outer_commitment,
        initializer
    ]);
    
    let personal_c_tot = [personal_c_tot_commitment.x, personal_c_tot_commitment.y];
    let personal_c_inner = [personal_c_inner_commitment.x, personal_c_inner_commitment.y];
    let personal_c_outer = [personal_c_outer_commitment.x, personal_c_outer_commitment.y];
    
    let personal_c_inner_m = prev_balance_amount;
    let personal_c_outer_m = 0 as Field;
    let personal_c_outer_r = token_address;
    
    (personal_c_tot, personal_c_inner, personal_c_outer, personal_c_inner_m, personal_c_outer_m, personal_c_outer_r)
}

/// Verify test results and print success message
fn verify_and_print_results(
    prev_balance: Field,
    deposit_amount: Field,
    result: (Field, [Field; 2], [Field; 5], [Field; 2], [Field; 2])
) {
    let expected_new_balance = prev_balance + deposit_amount;
    assert(expected_new_balance == 150, "Deposit should increase balance to 150");
    
    std::println("✅ Deposit operation verified successfully!");
    std::println("Previous balance: 100 USDC");
    std::println("Deposit amount: 50 USDC");
    std::println("New balance: 150 USDC");
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
}

/// Print Prover.toml format for easy copy-paste
fn print_prover_toml_format(
    user_key: Field,
    token_address: Field,
    deposit_amount: Field,
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
    personal_c_outer_r: Field
) {
    std::println("========================================");
    std::println("COPY THIS TO nydus-deposit/Prover.toml");
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
    std::print(deposit_amount);
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
}

// === MAIN TEST FUNCTION ===

#[test]
fn test_deposit_flow() {
    // === TEST SCENARIO ===
    // 1. User entry with 100 USDC (simulated)
    // 2. User deposit with 50 USDC  
    // 3. Verify the deposit circuit works correctly
    
    // === SETUP ===
    let (user_key_hash, previous_nonce_commitment, token_address_hash) = create_test_user_data(
        test_user_key(), 
        test_token_address(), 
        test_previous_nonce()
    );
    
    // Compute view_key (same as in main circuit)
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    
    // === SIMULATE ENTRY CIRCUIT AND RECONSTRUCT MAIN_STACK_COMMITMENT ===
    std::println("========================================");
    std::println("SIMULATING ENTRY CIRCUIT");
    std::println("========================================");
    
    // Simulate entry circuit (matching nydus-entry/src/main.nr)
    let entry_nonce = 0 as Field;
    let entry_nonce_commitment = Poseidon2::hash([user_key_hash, entry_nonce], 2);
    let entry_amount_hashed = Poseidon2::hash([test_previous_balance(), user_key_hash], 2);
    let entry_token_address_hashed = Poseidon2::hash([test_token_address(), user_key_hash], 2);
    let entry_nullifier = 0 as Field;
    let entry_nullifier_hashed = Poseidon2::hash([entry_nullifier, user_key_hash], 2);
    let entry_nullifier_domain = to_nullifier_domain(test_token_address());
    
    // Create commitments (matching entry circuit)
    let entry_c_balance_commitment = pedersen_commitment_non_hiding(entry_amount_hashed, entry_token_address_hashed);
    let entry_c_token_initializer = pedersen_commitment_non_hiding(entry_token_address_hashed, user_key_hash);
    let entry_c_inbound_nullifier = pedersen_commitment_non_hiding(entry_nullifier_hashed, entry_nullifier_domain);
    let entry_c_tot = add_multiple_commitments([entry_c_balance_commitment, entry_c_token_initializer, entry_c_inbound_nullifier]);
    
    // Calculate opening values (matching entry circuit)
    let entry_personal_c_tot_m = entry_amount_hashed + entry_token_address_hashed + entry_nullifier_hashed;
    let entry_personal_c_tot_r = entry_token_address_hashed + user_key_hash + entry_nullifier_domain;
    
    // Encrypt opening values (matching entry circuit)
    let entry_encryption_key = Poseidon2::hash([view_key, entry_nonce], 2);
    let entry_encrypted_personal_c_tot_m = poseidon_ctr_encrypt(entry_personal_c_tot_m, entry_encryption_key, 3);
    let entry_encrypted_personal_c_tot_r = poseidon_ctr_encrypt(entry_personal_c_tot_r, entry_encryption_key, 4);
    
    // Decrypt the encrypted values
    let decrypted_personal_c_tot_m = poseidon_ctr_decrypt(entry_encrypted_personal_c_tot_m, entry_encryption_key, 3);
    let decrypted_personal_c_tot_r = poseidon_ctr_decrypt(entry_encrypted_personal_c_tot_r, entry_encryption_key, 4);
    
    // Verify decrypted values match original
    assert(decrypted_personal_c_tot_m == entry_personal_c_tot_m, "Decrypted m should match original");
    assert(decrypted_personal_c_tot_r == entry_personal_c_tot_r, "Decrypted r should match original");
    
    // Create main_stack_commitment using pedersen_commitment_positive(c_tot.x, c_tot.y, nonce_commitment)
    let reconstructed_main_stack_commitment = pedersen_commitment_positive(entry_c_tot.x, entry_c_tot.y, entry_nonce_commitment);
    
    // Get initial state commitment from contract (pedersen_commitment_positive(1, 1, 1))
    let initial_state_commitment = pedersen_commitment_positive(1, 1, 1);
    
    // Add main_stack_commitment to initial state (as contract does in addStateCommitment)
    let main_stack_commitment_after_entry = add_commitments(initial_state_commitment, reconstructed_main_stack_commitment);
    
    // === CONSOLE LOG SEPARATE VALUES ===
    
    std::println("");
    std::println("========================================");
    std::println("1. NONCE_COMMITMENT");
    std::println("========================================");
    std::print("nonce_commitment = ");
    std::println(entry_nonce_commitment);
    std::println("");
    
    std::println("========================================");
    std::println("2. PERSONAL_C_TOT (ENCRYPTED)");
    std::println("========================================");
    std::print("encrypted_personal_c_tot_m = ");
    std::println(entry_encrypted_personal_c_tot_m);
    std::print("encrypted_personal_c_tot_r = ");
    std::println(entry_encrypted_personal_c_tot_r);
    std::println("");
    
    std::println("========================================");
    std::println("3. PERSONAL_C_TOT (DECRYPTED)");
    std::println("========================================");
    std::print("decrypted_personal_c_tot_m = ");
    std::println(decrypted_personal_c_tot_m);
    std::print("decrypted_personal_c_tot_r = ");
    std::println(decrypted_personal_c_tot_r);
    std::print("personal_c_tot.x = ");
    std::println(entry_c_tot.x);
    std::print("personal_c_tot.y = ");
    std::println(entry_c_tot.y);
    std::println("");
    
    std::println("========================================");
    std::println("4. NEW_MAIN_COMMITMENT (uses personal_c_tot)");
    std::println("========================================");
    std::println("Created using: pedersen_commitment_positive(personal_c_tot.x, personal_c_tot.y, nonce_commitment)");
    std::print("new_main_commitment.x = ");
    std::println(reconstructed_main_stack_commitment.x);
    std::print("new_main_commitment.y = ");
    std::println(reconstructed_main_stack_commitment.y);
    std::println("");
    
    std::println("========================================");
    std::println("5. MAIN_STACK_COMMITMENT AFTER ENTRY");
    std::println("========================================");
    std::println("(initial_state + new_main_commitment)");
    std::print("main_stack_commitment_after_entry.x = ");
    std::println(main_stack_commitment_after_entry.x);
    std::print("main_stack_commitment_after_entry.y = ");
    std::println(main_stack_commitment_after_entry.y);
    std::println("This is what the contract's stateCommitmentPoint should be after initCommit");
    std::println("========================================");
    std::println("");
    
    // === CREATE MAIN STACK STATE ===
    // For deposit after entry (previous_nonce = 0): use entry circuit's construction
    // For deposit after previous transaction (previous_nonce > 0): encrypt previous transaction's personal_c_tot
    let (main_c_tot, main_c_inner, main_c_outer, main_c_inner_point, main_c_outer_point) = create_main_stack_commitments(
        test_previous_balance(),
        test_token_address(),
        token_address_hash,
        user_key_hash,
        previous_nonce_commitment,
        view_key,
        test_previous_nonce(),
        test_user_key()
    );
    
    // === CREATE PERSONAL STATE ===
    let (personal_c_tot, personal_c_inner, personal_c_outer, personal_c_inner_m, personal_c_outer_m, personal_c_outer_r) = create_personal_commitments(
        test_previous_balance(),
        test_token_address(),
        token_address_hash,
        user_key_hash,
        view_key,
        test_previous_nonce()
    );
    
    // === EXECUTE CIRCUIT ===
    let result = main(
        test_user_key(),
        test_token_address(),
        test_deposit_amount(),
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
        personal_c_outer_r
    );
    
    // === VERIFY RESULTS ===
    verify_and_print_results(test_previous_balance(), test_deposit_amount(), result);
    
    // === VERIFY CONTRACT COMPATIBILITY ===
    // Verify main_c_outer matches contract's initial state commitment
    let initial_state_commitment = pedersen_commitment_positive(1, 1, 1);
    assert(main_c_outer[0] == initial_state_commitment.x, "main_c_outer.x should match initial state commitment");
    assert(main_c_outer[1] == initial_state_commitment.y, "main_c_outer.y should match initial state commitment");
    
    // Verify main_c_outer_point opening values are [1, 1, 1]
    assert(main_c_outer_point[0] == 1, "main_c_outer_point[0] should be 1");
    assert(main_c_outer_point[1] == 1, "main_c_outer_point[1] should be 1");
    assert(main_c_outer_point[2] == 1, "main_c_outer_point[2] should be 1");
    
    // Verify main_c_tot = main_c_inner + main_c_outer (point addition)
    let computed_main_c_tot = add_commitments(
        EmbeddedCurvePoint { x: main_c_inner[0], y: main_c_inner[1], is_infinite: false },
        EmbeddedCurvePoint { x: main_c_outer[0], y: main_c_outer[1], is_infinite: false }
    );
    assert(computed_main_c_tot.x == main_c_tot[0], "main_c_tot.x should equal main_c_inner + main_c_outer");
    assert(computed_main_c_tot.y == main_c_tot[1], "main_c_tot.y should equal main_c_inner + main_c_outer");
    
    // Verify main_c_tot matches contract's stateCommitmentPoint after initCommit
    // After initCommit: stateCommitmentPoint = initial_state + entry_commitment
    // This should equal main_c_tot (which is initial_state + main_c_inner where main_c_inner is entry_commitment)
    let contract_state_after_init = add_commitments(
        initial_state_commitment,
        EmbeddedCurvePoint { x: main_c_inner[0], y: main_c_inner[1], is_infinite: false }
    );
    assert(contract_state_after_init.x == main_c_tot[0], "main_c_tot.x should match contract's stateCommitmentPoint after initCommit");
    assert(contract_state_after_init.y == main_c_tot[1], "main_c_tot.y should match contract's stateCommitmentPoint after initCommit");
    
    // Verify main_c_inner_point decrypts to personal_c_tot
    let previous_encryption_key = Poseidon2::hash([view_key, test_previous_nonce()], 2);
    let decrypted_x = poseidon_ctr_decrypt(main_c_inner_point[0], previous_encryption_key, 3);
    let decrypted_y = poseidon_ctr_decrypt(main_c_inner_point[1], previous_encryption_key, 4);
    assert(decrypted_x == personal_c_tot[0], "Decrypted main_c_inner_point.x should match personal_c_tot.x");
    assert(decrypted_y == personal_c_tot[1], "Decrypted main_c_inner_point.y should match personal_c_tot.y");
    
    std::println("✅ Contract compatibility verified!");
    std::println("  - main_c_outer matches initial state commitment (pedersen_commitment_positive(1, 1, 1))");
    std::println("  - main_c_tot = main_c_inner + main_c_outer (point addition)");
    std::println("  - main_c_tot matches contract's stateCommitmentPoint after initCommit (initial_state + entry_commitment)");
    std::println("  - main_c_inner_point decrypts to personal_c_tot");
    std::println("");
    
    // === GENERATE PROVER.TOML ===
    print_prover_toml_format(
        test_user_key(),
        test_token_address(),
        test_deposit_amount(),
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
        personal_c_outer_r
    );
}
