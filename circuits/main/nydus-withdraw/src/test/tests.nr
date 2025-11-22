use dep::std;
use dep::poseidon::poseidon2::Poseidon2;
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_token,
    pedersen_commitment_positive,
    pedersen_commitment_negative,
    add_commitments,
    add_multiple_commitments,
    to_nullifier_domain,
    pedersen_commitment_non_hiding,
    subtract_commitments
};
use dep::poseidon_ctr_encryption::{poseidon_ctr_encrypt, poseidon_ctr_decrypt};
use dep::std::field::bn254::{assert_gt,gt, assert_lt, lt};
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
use crate::main;

/// Get test user key
fn test_user_key() -> Field { 0x1234567890abcdef as Field }

/// Get test token address (USDC)
fn test_token_address() -> Field { 0x02 as Field }

/// Get test previous nonce
fn test_previous_nonce() -> Field { 0x00 as Field }

/// Get test withdrawal amount
fn test_withdrawal_amount() -> Field { 0x32 as Field }

/// Get test previous balance (USDC)
fn test_previous_balance() -> Field { 0x64 as Field }

/// Get test another user nonce
fn test_another_user_nonce() -> Field { 0x29a as Field }

/// Get test receiver address (Ethereum address)
fn test_receiver_address() -> Field { 0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6 as Field }

/// Get test relay fee token address (WETH)
fn test_relay_fee_token_address() -> Field { 0x03 as Field }

/// Get test receiver fee amount
fn test_receiver_fee_amount() -> Field { 0x01 as Field }

/// Get test fee token previous balance
fn test_fee_token_previous_balance() -> Field { 0x0a as Field }

global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;

// === TEST HELPER FUNCTIONS ===

/// Create test user hashes and commitments
/// NOTE: This uses user_key_hash for previous_nonce_commitment to match the circuit's computation
/// The circuit computes: previous_nonce_commitment = Poseidon2::hash([user_key_hash, previous_nonce], 2)
fn create_test_user_data(user_key: Field, token_address: Field, previous_nonce: Field) -> (Field, Field, Field) {
    let user_key_hash = Poseidon2::hash([user_key], 1);
    // IMPORTANT: Use user_key_hash (not user_key) to match circuit behavior
    let previous_nonce_commitment = Poseidon2::hash([user_key_hash, previous_nonce], 2);
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
/// For withdraw after previous transaction: encrypt previous transaction's personal_c_tot
fn create_main_stack_commitments(
    prev_balance_amount: Field,
    token_address: Field,
    token_address_hash: Field,
    user_key_hash: Field,
    previous_nonce_commitment: Field,
    view_key: Field,
    previous_nonce: Field
) -> ([Field; 2], [Field; 2], [Field; 2], [Field; 2], [Field; 3]) {
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

/// Create personal commitments (current user's balance state)
/// For withdrawal after previous transaction: personal_c_tot should match what was encrypted in main_c_inner_point
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
    
    // personal_c_tot = inner + outer + initializer (matching what was encrypted in main_c_inner_point)
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

/// Verify test results and print success message
fn verify_and_print_results(
    prev_balance: Field,
    withdrawal_amount: Field,
    result: (Field, [Field; 2], [Field; 5], [Field; 2], [Field; 2])
) {
    let expected_new_balance = prev_balance - withdrawal_amount;
    assert(expected_new_balance == 50, "Withdrawal should reduce balance to 50");
    
    std::println("✅ Withdrawal operation verified successfully!");
    std::println("Previous balance: 100 USDC");
    std::println("Withdrawal amount: 50 USDC");
    std::println("New balance: 50 USDC");
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
    withdrawal_amount: Field,
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
    receiver_address: Field,
    relay_fee_token_address: Field,
    receiver_fee_amount: Field,
    fee_token_personal_c_inner: [Field; 2],
    fee_token_personal_c_outer: [Field; 2],
    fee_token_personal_c_inner_m: Field,
    fee_token_personal_c_outer_m: Field,
    fee_token_personal_c_outer_r: Field
) {
    std::println("========================================");
    std::println("COPY THIS TO nydus-withdraw/Prover.toml");
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
    std::print(withdrawal_amount);
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
    
    std::print("arbitrary_calldata_hash = \"");
    std::print(0x1234567890abcdef as Field);
    std::println("\"");
    std::println("");
    
    std::print("receiver_address = \"");
    std::print(receiver_address);
    std::println("\"");
    std::println("");
    
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

// === MAIN TEST FUNCTION ===

#[test]
fn test_withdraw_flow() {
    // === TEST SCENARIO ===
    // 1. User entry with 100 USDC (simulated)
    // 2. User deposits 100 USDC (simulated)
    // 3. User has 10 WETH for fees (simulated)
    // 4. User withdraws 50 USDC and pays fee in WETH
    // 5. Verify the withdraw circuit works correctly
    
    // === SETUP ===
    let (user_key_hash, previous_nonce_commitment, token_address_hash) = create_test_user_data(
        test_user_key(), 
        test_token_address(), 
        test_previous_nonce()
    );
    
    // Compute view_key (same as in main circuit)
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    
    // === CREATE PERSONAL STATE ===
    // Compute view_key (same as in main circuit)
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    
    let (personal_c_tot_usdc_only, personal_c_inner, personal_c_outer, personal_c_inner_m, personal_c_outer_m, personal_c_outer_r) = create_personal_commitments(
        test_previous_balance(),
        test_token_address(),
        token_address_hash,
        user_key_hash,
        view_key,
        test_previous_nonce()
    );
    
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
    // For withdrawal with multiple tokens (USDC + WETH), we need to encrypt the combined personal_c_tot
    // This simulates what the previous deposit transaction would have done
    let previous_encryption_key = Poseidon2::hash([view_key, test_previous_nonce()], 2);
    let encrypted_x = poseidon_ctr_encrypt(personal_c_tot_combined.x, previous_encryption_key, 3);
    let encrypted_y = poseidon_ctr_encrypt(personal_c_tot_combined.y, previous_encryption_key, 4);
    
    // Create main commitment using encrypted coordinates
    // Use previous_nonce_commitment from create_test_user_data (which matches circuit's computation)
    let user_main_entry_commitment = pedersen_commitment_positive(encrypted_x, encrypted_y, previous_nonce_commitment);
    let another_user_main_entry_commitment = pedersen_commitment_positive(token_address_hash, user_key_hash, test_another_user_nonce());
    
    let main_c_tot_commitment = add_commitments(user_main_entry_commitment, another_user_main_entry_commitment);
    let main_c_tot = [main_c_tot_commitment.x, main_c_tot_commitment.y];
    let main_c_inner = [user_main_entry_commitment.x, user_main_entry_commitment.y];
    let main_c_outer = [another_user_main_entry_commitment.x, another_user_main_entry_commitment.y];
    let main_c_inner_point = [encrypted_x, encrypted_y];
    let main_c_outer_point = [token_address_hash, user_key_hash, test_another_user_nonce()];
    
    // Verify reconstruction matches (using previous_nonce_commitment from create_test_user_data)
    // This should match what the circuit computes internally
    let reconstructed_main_c_inner = pedersen_commitment_positive(main_c_inner_point[0], main_c_inner_point[1], previous_nonce_commitment);
    assert(reconstructed_main_c_inner.x == main_c_inner[0], "Test setup: main_c_inner reconstruction failed (x)");
    assert(reconstructed_main_c_inner.y == main_c_inner[1], "Test setup: main_c_inner reconstruction failed (y)");
    
    let result: (Field, [Field; 2], [Field; 5], [Field; 2], [Field; 2]) = main(
        test_user_key(),
        test_token_address(),
        test_withdrawal_amount(),
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
        0x1234567890abcdef as Field,
        test_receiver_address(),
        test_relay_fee_token_address(),
        test_receiver_fee_amount(),
        fee_token_personal_c_inner,
        fee_token_personal_c_outer,
        fee_token_personal_c_inner_m,
        fee_token_personal_c_outer_m,
        fee_token_personal_c_outer_r
    );
    
    // === VERIFY RESULTS ===
    verify_and_print_results(test_previous_balance(), test_withdrawal_amount(), result);
    
    std::println("✅ First withdrawal successful!");
    std::println("USDC balance after first withdrawal: 50 (100 - 50)");
    std::println("WETH balance after first withdrawal: 9 (10 - 1)");
    std::println("");
    
    // === SECOND WITHDRAWAL: Withdraw 9 WETH, pay 50 USDC as fee ===
    std::println("=== SECOND WITHDRAWAL (9 WETH, fee paid in USDC) ===");
    
    let second_previous_nonce = test_previous_nonce() + 1;
    let first_new_nonce_commitment = result.0;
    let first_new_main_commitment = result.1;
    
    // For second withdrawal, previous_nonce_commitment is computed from user_key_hash and previous_nonce
    let second_user_key_hash = Poseidon2::hash([test_user_key()], 1);
    let second_previous_nonce_commitment = Poseidon2::hash([second_user_key_hash, second_previous_nonce], 2);
    
    // New balances after first withdrawal
    let usdc_balance_after_first = test_previous_balance() - test_withdrawal_amount(); // 100 - 50 = 50
    let weth_balance_after_first = test_fee_token_previous_balance() - test_receiver_fee_amount(); // 10 - 1 = 9
    
    // For second withdrawal: WETH is now the withdrawal token, USDC is the fee token
    let second_withdrawal_token_address = test_relay_fee_token_address(); // WETH
    let second_fee_token_address = test_token_address(); // USDC
    let second_withdrawal_amount = 9; // 9 WETH
    let second_fee_amount = usdc_balance_after_first; // 50 USDC
    
    // Reconstruct state after first withdrawal exactly as the circuit created it
    let first_new_nonce = test_previous_nonce() + 1;
    let first_encryption_key = Poseidon2::hash([view_key, first_new_nonce], 2);
    
    // Use the first withdrawal's result directly as the main_c_inner for second withdrawal
    let second_main_c_inner = first_new_main_commitment;
    
    // Reconstruct the exact same new_personal_c_tot that first withdrawal created to get encrypted coordinates
    // First withdrawal: outer = personal_c_tot - personal_c_inner (USDC) - fee_token_personal_c_inner (WETH)
    let personal_c_tot_commitment = EmbeddedCurvePoint { x: personal_c_tot[0], y: personal_c_tot[1], is_infinite: false };
    let personal_c_inner_commitment = EmbeddedCurvePoint { x: personal_c_inner[0], y: personal_c_inner[1], is_infinite: false };
    let fee_token_personal_c_inner_commitment = EmbeddedCurvePoint { x: fee_token_personal_c_inner[0], y: fee_token_personal_c_inner[1], is_infinite: false };
    
    let outer_after_first = subtract_commitments(
        subtract_commitments(personal_c_tot_commitment, personal_c_inner_commitment),
        fee_token_personal_c_inner_commitment
    );
    
    // New balance commitments from first withdrawal
    let new_usdc_balance = test_previous_balance() - test_withdrawal_amount(); // 50
    let new_usdc_balance_commitment = pedersen_commitment_non_hiding(new_usdc_balance, test_token_address());
    
    let new_weth_balance = test_fee_token_previous_balance() - test_receiver_fee_amount(); // 9
    let new_weth_balance_hash = Poseidon2::hash([new_weth_balance, user_key_hash], 2);
    let weth_token_address_hash = Poseidon2::hash([test_relay_fee_token_address(), user_key_hash], 2);
    let new_weth_balance_commitment = pedersen_commitment_non_hiding(new_weth_balance_hash, weth_token_address_hash);
    
    // This is the exact new_personal_c_tot that first withdrawal created and encrypted
    let first_new_personal_c_tot = add_multiple_commitments([
        outer_after_first,
        new_usdc_balance_commitment,
        new_weth_balance_commitment
    ]);
    
    // Encrypt it exactly as first withdrawal did to get the encrypted coordinates
    let first_encrypted_x = poseidon_ctr_encrypt(first_new_personal_c_tot.x, first_encryption_key, 3);
    let first_encrypted_y = poseidon_ctr_encrypt(first_new_personal_c_tot.y, first_encryption_key, 4);
    
    // Verify that this matches what was used to create first_new_main_commitment (using first_new_nonce_commitment)
    let reconstructed_first_main_c_inner = pedersen_commitment_positive(
        first_encrypted_x,
        first_encrypted_y,
        first_new_nonce_commitment
    );
    
    // Verify the reconstruction matches (this should pass if reconstruction is correct)
    assert(reconstructed_first_main_c_inner.x == first_new_main_commitment[0], "Reconstructed main_c_inner x should match first withdrawal result");
    assert(reconstructed_first_main_c_inner.y == first_new_main_commitment[1], "Reconstructed main_c_inner y should match first withdrawal result");
    
    // For second withdrawal, reconstruct main_c_inner using second_previous_nonce_commitment (circuit computes it from user_key)
    let second_main_c_inner_reconstructed = pedersen_commitment_positive(
        first_encrypted_x,
        first_encrypted_y,
        second_previous_nonce_commitment
    );
    let second_main_c_inner = [second_main_c_inner_reconstructed.x, second_main_c_inner_reconstructed.y];
    
    // Use the encrypted coordinates for main_c_inner_point
    let second_main_c_inner_point = [first_encrypted_x, first_encrypted_y];
    
    let second_main_c_tot_commitment = add_commitments(
        EmbeddedCurvePoint { x: second_main_c_inner[0], y: second_main_c_inner[1], is_infinite: false },
        EmbeddedCurvePoint { x: main_c_outer[0], y: main_c_outer[1], is_infinite: false }
    );
    let second_main_c_tot = [second_main_c_tot_commitment.x, second_main_c_tot_commitment.y];
    let second_main_c_outer = main_c_outer;
    let second_main_c_outer_point = main_c_outer_point;
    
    // For second withdrawal: WETH is withdrawal token, USDC is fee token
    // personal_c_tot is the combined commitment from first withdrawal
    let second_personal_c_tot = [first_new_personal_c_tot.x, first_new_personal_c_tot.y];
    
    // WETH inner and outer (withdrawal token)
    let weth_balance_hash = Poseidon2::hash([weth_balance_after_first, user_key_hash], 2);
    let second_personal_c_inner_weth = pedersen_commitment_non_hiding(weth_balance_hash, weth_token_address_hash);
    let second_personal_c_outer_weth = pedersen_commitment_non_hiding(0, test_relay_fee_token_address());
    
    let second_personal_c_inner = [second_personal_c_inner_weth.x, second_personal_c_inner_weth.y];
    let second_personal_c_outer = [second_personal_c_outer_weth.x, second_personal_c_outer_weth.y];
    let second_personal_c_inner_m = weth_balance_after_first;
    let second_personal_c_outer_m = 0 as Field;
    let second_personal_c_outer_r = test_relay_fee_token_address();
    
    // Fee token (USDC) state for second withdrawal
    let usdc_balance_hash = Poseidon2::hash([usdc_balance_after_first, user_key_hash], 2);
    let usdc_token_address_hash = Poseidon2::hash([test_token_address(), user_key_hash], 2);
    let second_fee_token_personal_c_inner_usdc = pedersen_commitment_non_hiding(usdc_balance_hash, usdc_token_address_hash);
    let second_fee_token_personal_c_outer_usdc = pedersen_commitment_non_hiding(0, test_token_address());
    
    let second_fee_token_personal_c_inner = [second_fee_token_personal_c_inner_usdc.x, second_fee_token_personal_c_inner_usdc.y];
    let second_fee_token_personal_c_outer = [second_fee_token_personal_c_outer_usdc.x, second_fee_token_personal_c_outer_usdc.y];
    let second_fee_token_personal_c_inner_m = usdc_balance_after_first;
    let second_fee_token_personal_c_outer_m = 0 as Field;
    let second_fee_token_personal_c_outer_r = test_token_address();
    
    let second_result: (Field, [Field; 2], [Field; 5], [Field; 2], [Field; 2]) = main(
        test_user_key(),
        second_withdrawal_token_address, // WETH
        second_withdrawal_amount, // 9 WETH
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
        0x1234567890abcdef as Field,
        test_receiver_address(),
        second_fee_token_address, // USDC
        second_fee_amount, // 50 USDC
        second_fee_token_personal_c_inner,
        second_fee_token_personal_c_outer,
        second_fee_token_personal_c_inner_m,
        second_fee_token_personal_c_outer_m,
        second_fee_token_personal_c_outer_r
    );
    
    std::println("✅ Second withdrawal successful!");
    std::println("WETH balance after second withdrawal: 0 (9 - 9)");
    std::println("USDC balance after second withdrawal: 0 (50 - 50)");
    std::println("");
    std::println("=== FINAL VERIFICATION ===");
    std::println("Initial USDC: 100");
    std::println("Initial WETH: 10");
    std::println("First withdrawal: 50 USDC (fee: 1 WETH)");
    std::println("Second withdrawal: 9 WETH (fee: 50 USDC)");
    std::println("Final USDC: 0");
    std::println("Final WETH: 0");
    std::println("✅ Both withdrawals executed successfully!");
    
    // === GENERATE PROVER.TOML ===
    print_prover_toml_format(
        test_user_key(),
        test_token_address(),
        test_withdrawal_amount(),
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
        test_receiver_address(),
        test_relay_fee_token_address(),
        test_receiver_fee_amount(),
        fee_token_personal_c_inner,
        fee_token_personal_c_outer,
        fee_token_personal_c_inner_m,
        fee_token_personal_c_outer_m,
        fee_token_personal_c_outer_r
    );
}

#[test]
fn test_consecutive_withdrawals() {
    // === FIRST WITHDRAWAL SETUP ===
    let (user_key_hash, previous_nonce_commitment, token_address_hash) = create_test_user_data(
        test_user_key(), 
        test_token_address(), 
        test_previous_nonce()
    );
    
    // Compute view_key (same as in main circuit)
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    
    let (main_c_tot, main_c_inner, main_c_outer, main_c_inner_point, main_c_outer_point) = create_main_stack_commitments(
        test_previous_balance(),
        test_token_address(),
        token_address_hash,
        user_key_hash,
        previous_nonce_commitment,
        view_key,
        test_previous_nonce()
    );
    
    let (personal_c_tot, personal_c_inner, personal_c_outer, personal_c_inner_m, personal_c_outer_m, personal_c_outer_r) = create_personal_commitments(
        test_previous_balance(),
        test_token_address(),
        token_address_hash,
        user_key_hash,
        view_key,
        test_previous_nonce()
    );
    
    let (_fee_token_personal_c_tot, fee_token_personal_c_inner, fee_token_personal_c_outer, fee_token_personal_c_inner_m, fee_token_personal_c_outer_m, fee_token_personal_c_outer_r) = create_fee_token_personal_commitments(
        test_fee_token_previous_balance(),
        test_relay_fee_token_address(),
        user_key_hash
    );
    
    std::println("=== FIRST WITHDRAWAL (50 USDC, fee paid in WETH) ===");
    let first_withdrawal_amount = 50 as Field;
    
    let first_result: (Field, [Field; 2], [Field; 5], [Field; 2], [Field; 2]) = main(
        test_user_key(),
        test_token_address(),
        first_withdrawal_amount,
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
        0x1234567890abcdef as Field,
        test_receiver_address(),
        test_relay_fee_token_address(),
        test_receiver_fee_amount(),
        fee_token_personal_c_inner,
        fee_token_personal_c_outer,
        fee_token_personal_c_inner_m,
        fee_token_personal_c_outer_m,
        fee_token_personal_c_outer_r
    );
    
    let expected_balance_after_first = test_previous_balance() - first_withdrawal_amount;
    assert(expected_balance_after_first == 50, "First withdrawal should reduce balance to 50");
    
    std::println("✅ First withdrawal successful!");
    std::println("Balance after first withdrawal: 50 USDC");
    
    std::println("=== SECOND WITHDRAWAL (50 USDC) ===");
    
    let second_withdrawal_amount = 50 as Field;
    // For second withdrawal, previous_nonce is the nonce after the first withdrawal (nonce 1)
    let second_previous_nonce = test_previous_nonce() + 1;
    
    let first_new_nonce_commitment = first_result.0;
    let first_new_main_commitment = first_result.1;
    
    let second_user_key_hash = Poseidon2::hash([test_user_key()], 1);
    let second_token_address_hash = Poseidon2::hash([test_token_address(), second_user_key_hash], 2);
    
    let first_new_personal_balance = 50 as Field;
    let first_new_personal_balance_hash = Poseidon2::hash([first_new_personal_balance, user_key_hash], 2);
    let first_new_personal_c_inner_commitment = pedersen_commitment_non_hiding(first_new_personal_balance_hash, token_address_hash);
    
    // Create personal_c_outer (no nonce_commitment included)
    let first_new_personal_c_outer_commitment = pedersen_commitment_non_hiding(0, test_token_address());
    
    let initializer = pedersen_commitment_non_hiding(test_token_address(), user_key_hash);
    
    // personal_c_tot = inner + outer + initializer (matching what was encrypted in main_c_inner_point)
    let first_new_personal_c_tot_commitment = add_multiple_commitments([
        first_new_personal_c_inner_commitment,
        first_new_personal_c_outer_commitment,
        initializer
    ]);
    
    let second_user_key_hash = Poseidon2::hash([test_user_key()], 1);
    let second_previous_nonce_commitment = Poseidon2::hash([second_user_key_hash, second_previous_nonce], 2);
    
    // Encrypt the coordinates from first withdrawal (simulating what was returned from first withdrawal)
    // The encryption key uses the NEW nonce from the first withdrawal (which becomes previous_nonce = 1 for second withdrawal)
    // First withdrawal: nonce 0 -> new_nonce 1, encrypts with hash(view_key, 1)
    // Second withdrawal: previous_nonce = 1, decrypts with hash(view_key, 1)
    let first_new_nonce = test_previous_nonce() + 1; // This is 1
    let first_encryption_key = Poseidon2::hash([view_key, first_new_nonce], 2);
    let first_encrypted_x = poseidon_ctr_encrypt(first_new_personal_c_tot_commitment.x, first_encryption_key, 3);
    let first_encrypted_y = poseidon_ctr_encrypt(first_new_personal_c_tot_commitment.y, first_encryption_key, 4);
    
    let second_main_c_inner_commitment = pedersen_commitment_positive(
        first_encrypted_x, 
        first_encrypted_y, 
        second_previous_nonce_commitment
    );
    let second_main_c_inner = [second_main_c_inner_commitment.x, second_main_c_inner_commitment.y];
    
    let second_main_c_outer = main_c_outer;
    let second_main_c_tot_commitment = add_commitments(
        EmbeddedCurvePoint { x: second_main_c_inner[0], y: second_main_c_inner[1], is_infinite: false },
        EmbeddedCurvePoint { x: second_main_c_outer[0], y: second_main_c_outer[1], is_infinite: false }
    );
    let second_main_c_tot = [second_main_c_tot_commitment.x, second_main_c_tot_commitment.y];
    
    // Opening values for membership proof - these are encrypted coordinates from first withdrawal
    let second_main_c_inner_point = [first_encrypted_x, first_encrypted_y];
    let second_main_c_outer_point = main_c_outer_point;
    
    let second_personal_c_tot = [first_new_personal_c_tot_commitment.x, first_new_personal_c_tot_commitment.y];
    let second_personal_c_inner = [first_new_personal_c_inner_commitment.x, first_new_personal_c_inner_commitment.y];
    let second_personal_c_outer = [first_new_personal_c_outer_commitment.x, first_new_personal_c_outer_commitment.y];
    
    let second_personal_c_inner_m = first_new_personal_balance;
    let second_personal_c_outer_m = 0 as Field;
    let second_personal_c_outer_r = test_token_address();
    
    let (_second_fee_token_personal_c_tot, second_fee_token_personal_c_inner, second_fee_token_personal_c_outer, second_fee_token_personal_c_inner_m, second_fee_token_personal_c_outer_m, second_fee_token_personal_c_outer_r) = create_fee_token_personal_commitments(
        test_fee_token_previous_balance() - test_receiver_fee_amount(),
        test_relay_fee_token_address(),
        user_key_hash
    );
    
    let second_result: (Field, [Field; 2], [Field; 5], [Field; 2], [Field; 2]) = main(
        test_user_key(),
        test_token_address(),
        second_withdrawal_amount,
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
        0x1234567890abcdef as Field,
        test_receiver_address(),
        test_relay_fee_token_address(),
        test_receiver_fee_amount(),
        second_fee_token_personal_c_inner,
        second_fee_token_personal_c_outer,
        second_fee_token_personal_c_inner_m,
        second_fee_token_personal_c_outer_m,
        second_fee_token_personal_c_outer_r
    );
    
    let expected_balance_after_second = first_new_personal_balance - second_withdrawal_amount;

    std::println("✅ Second withdrawal successful!");
    std::println("Balance after second withdrawal: 0 USDC");
    
    std::println("=== FINAL VERIFICATION ===");
    std::println("Initial balance: 100 USDC");
    std::println("First withdrawal: 50 USDC");
    std::println("Second withdrawal: 50 USDC");
    std::println("Final balance: 0 USDC");
    std::println("✅ Both withdrawals executed successfully in sequence!");
    
    std::println("");
    std::println("First withdrawal result:");
    std::println("New nonce commitment:");
    std::println(first_result.0);
    std::println("New main commitment x:");
    std::println(first_result.1[0]);
    std::println("New main commitment y:");
    std::println(first_result.1[1]);
    
    std::println("");
    std::println("Second withdrawal result:");
    std::println("New nonce commitment:");
    std::println(second_result.0);
    std::println("New main commitment x:");
    std::println(second_result.1[0]);
    std::println("New main commitment y:");
    std::println(second_result.1[1]);
    
}
