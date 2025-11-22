use dep::std;
use dep::std::field::bn254::{assert_gt, assert_lt, lt};
use dep::poseidon::poseidon2::Poseidon2;
use dep::poseidon_ctr_encryption::{poseidon_ctr_encrypt, poseidon_ctr_decrypt};
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_positive,
    pedersen_commitment_negative,
    pedersen_commitment_counter,
    add_commitments, 
    add_multiple_commitments,
    pedersen_commitment_non_hiding
};
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
mod test;
// === NYDUS-DEPOSIT CIRCUIT ===



global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;


// === MAIN FUNCTION ===

fn main(
    user_key: Field,
    token_address: pub Field,
    amount: pub Field,                    // Deposit amount (always positive)
    previous_nonce: Field,
    
    main_c_tot: pub [Field; 2],               // Total commitment from previous operation
    main_c_inner: [Field; 2],             // Inner commitment (deposits)
    main_c_outer: [Field; 2],             // Outer commitment (rest/change)
    main_c_inner_point: [Field; 2],       // Opening values for inner commitment
    main_c_outer_point: [Field; 3],       // Opening values for outer commitment

    personal_c_tot: [Field; 2],           // Total commitment from previous operation
    personal_c_inner: [Field; 2],         // Inner commitment (deposits)
    personal_c_outer: [Field; 2],         // Outer commitment (rest/change)
    personal_c_inner_m: Field,            // Inner amount
    personal_c_outer_m: Field,            // Outer amount  
    personal_c_outer_r: Field,            // Total number of tokens in the commitment

) -> pub (Field, [Field; 2], [Field; 5], [Field; 2], [Field; 2]) {
    
    // === SETUP ===
    let user_key_hash = Poseidon2::hash([user_key], 1);
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    let previous_nonce_commitment = Poseidon2::hash([user_key_hash, previous_nonce as Field], 2);
    let current_balance = personal_c_inner_m;
    
    // === VERIFICATION ===
    verify_main_commitments(
        main_c_tot,
        main_c_inner,
        main_c_outer,
        main_c_inner_point,
        main_c_outer_point,
        previous_nonce_commitment,
        view_key,
        previous_nonce
    );
    
    let nullifier_was_initialized = verify_personal_commitments(
        personal_c_tot,
        personal_c_inner,
        personal_c_outer,
        personal_c_inner_m,
        personal_c_outer_m,
        personal_c_outer_r,
        token_address,
        user_key_hash,
        main_c_inner_point,
        view_key,
        previous_nonce
    );
    
    // === PROCESSING ===
    let nonce = previous_nonce + 1 as Field;
    let new_nonce_commitment = Poseidon2::hash([user_key_hash, nonce as Field], 2);
    
    let (new_main_commitment, enc_x, enc_y) = create_new_commitments(
        current_balance,
        amount,
        personal_c_outer,
        personal_c_outer_r,
        token_address,
        user_key_hash,
        new_nonce_commitment,
        nullifier_was_initialized,
        view_key,
        nonce
    );
    
    let encrypted_note = encrypt_operation_details(
        current_balance,
        token_address,
        nonce,
        view_key,
        personal_c_outer_m,
        personal_c_outer_r,
        amount,
        nullifier_was_initialized,
        user_key_hash
    );
   
    let nonce_discovery_entry = pedersen_commitment_non_hiding(1, new_nonce_commitment);
    
    // === RETURN VALUES ===
    (   
        new_nonce_commitment,
        [new_main_commitment.x, new_main_commitment.y],
        encrypted_note,
        [nonce_discovery_entry.x, nonce_discovery_entry.y],
        [enc_x, enc_y]
    )
}


// === HELPER FUNCTIONS ===

/// Verify main stack commitments using opening values
fn verify_main_commitments(
    main_c_tot: [Field; 2],
    main_c_inner: [Field; 2], 
    main_c_outer: [Field; 2],
    main_c_inner_point: [Field; 2],
    main_c_outer_point: [Field; 3],
    previous_nonce_commitment: Field,
    view_key: Field,
    previous_nonce: Field
) {
    // Verify that main_c_inner was created using the encrypted coordinates in main_c_inner_point
    let reconstructed_main_c_inner = pedersen_commitment_positive(main_c_inner_point[0], main_c_inner_point[1], previous_nonce_commitment);
    assert(reconstructed_main_c_inner.x == main_c_inner[0], "Main inner commitment x verification failed");
    assert(reconstructed_main_c_inner.y == main_c_inner[1], "Main inner commitment y verification failed");

    // Verify outer commitment
    let reconstructed_main_c_outer = pedersen_commitment_positive(main_c_outer_point[0], main_c_outer_point[1], main_c_outer_point[2]);
    assert(reconstructed_main_c_outer.x == main_c_outer[0], "Main outer commitment x verification failed");
    assert(reconstructed_main_c_outer.y == main_c_outer[1], "Main outer commitment y verification failed");

    // Verify total commitment
    let main_c_tot_commitment = add_commitments(reconstructed_main_c_inner, reconstructed_main_c_outer);
    assert(main_c_tot_commitment.x == main_c_tot[0], "Main total commitment x verification failed");
    assert(main_c_tot_commitment.y == main_c_tot[1], "Main total commitment y verification failed");
}

/// Verify personal commitments and determine if nullifier was initialized
fn verify_personal_commitments(
    personal_c_tot: [Field; 2],
    personal_c_inner: [Field; 2],
    personal_c_outer: [Field; 2],
    personal_c_inner_m: Field,
    personal_c_outer_m: Field,
    personal_c_outer_r: Field,
    token_address: Field,
    user_key_hash: Field,
    main_c_inner_point: [Field; 2],
    view_key: Field,
    previous_nonce: Field
) -> bool {
    // Hash inner commitment parameters
    let personal_c_inner_m_hash = Poseidon2::hash([personal_c_inner_m, user_key_hash], 2);
    let personal_c_inner_token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2);
    
    // Verify inner commitment
    let inner_commitment = pedersen_commitment_non_hiding(personal_c_inner_m_hash, personal_c_inner_token_address_hash);
    assert(inner_commitment.x == personal_c_inner[0], "Inner commitment x verification failed");
    assert(inner_commitment.y == personal_c_inner[1], "Inner commitment y verification failed");

    // Verify outer commitment
    let outer_commitment = pedersen_commitment_non_hiding(personal_c_outer_m, personal_c_outer_r);
    assert(outer_commitment.x == personal_c_outer[0], "Outer commitment verification failed");
    assert(outer_commitment.y == personal_c_outer[1], "Outer commitment verification failed");
    
    // Check if nullifier was already initialized
    let initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
    
    // Check both cases: with and without initializer (for first deposit after entry)
    let sum_with_initializer = add_multiple_commitments([
        inner_commitment,
        outer_commitment,
        initializer
    ]);
    
    let sum_without_initializer = add_multiple_commitments([
        inner_commitment,
        outer_commitment
    ]);
    
    let with_initializer_matches = (sum_with_initializer.x == personal_c_tot[0]) & (sum_with_initializer.y == personal_c_tot[1]);
    let without_initializer_matches = (sum_without_initializer.x == personal_c_tot[0]) & (sum_without_initializer.y == personal_c_tot[1]);
    
    assert(with_initializer_matches | without_initializer_matches, "Total commitment verification failed");
    
    // Decrypt the encrypted coordinates from main_c_inner_point and verify they match personal_c_tot
    let previous_encryption_key = Poseidon2::hash([view_key, previous_nonce], 2);
    let decrypted_x = poseidon_ctr_decrypt(main_c_inner_point[0], previous_encryption_key, 3);
    let decrypted_y = poseidon_ctr_decrypt(main_c_inner_point[1], previous_encryption_key, 4);
    
    // Verify decrypted coordinates match personal_c_tot
    assert(decrypted_x == personal_c_tot[0], "Decrypted x coordinate doesn't match personal_c_tot");
    assert(decrypted_y == personal_c_tot[1], "Decrypted y coordinate doesn't match personal_c_tot");
    
    with_initializer_matches
}

/// Create new commitments after deposit
fn create_new_commitments(
    current_balance: Field,
    amount: Field,
    personal_c_outer: [Field; 2],
    personal_c_outer_r: Field,
    token_address: Field,
    user_key_hash: Field,
    new_nonce_commitment: Field,
    nullifier_was_initialized: bool,
    view_key: Field,
    nonce: Field
) -> (EmbeddedCurvePoint, Field, Field) {
    let new_balance = current_balance + amount;
    let new_balance_commitment = pedersen_commitment_non_hiding(new_balance, token_address);
    
    let personal_c_outer_commitment = EmbeddedCurvePoint { x: personal_c_outer[0], y: personal_c_outer[1], is_infinite: false };
    
    let new_personal_c_tot_commitment = if nullifier_was_initialized {
        add_multiple_commitments([
            personal_c_outer_commitment,
            new_balance_commitment
        ])
    } else {
        let initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
        add_multiple_commitments([
            personal_c_outer_commitment,
            new_balance_commitment,
            initializer
        ])
    };
    
    let encryption_key = Poseidon2::hash([view_key, nonce], 2);
    let enc_x = poseidon_ctr_encrypt(new_personal_c_tot_commitment.x, encryption_key, 3);
    let enc_y = poseidon_ctr_encrypt(new_personal_c_tot_commitment.y, encryption_key, 4);
    
    let new_main_commitment = pedersen_commitment_positive(
        enc_x,
        enc_y,
        new_nonce_commitment
    );
    
    // Return the new main commitment and encrypted coordinates
    (new_main_commitment, enc_x, enc_y)
}

/// Encrypt operation details for privacy
fn encrypt_operation_details(
    current_balance: Field,
    token_address: Field,
    nonce: Field,
    view_key: Field,
    personal_c_outer_m: Field,
    personal_c_outer_r: Field,
    amount: Field,
    nullifier_was_initialized: bool,
    user_key_hash: Field
) -> [Field; 5] {
    let encryption_key = Poseidon2::hash([view_key, nonce], 2);

    let new_balance = current_balance + amount;
    
    // Calculate opening values for new personal_c_tot commitment
    // Components: outer (m=personal_c_outer_m, r=personal_c_outer_r) + new_balance (m=new_balance, r=token_address) + optionally initializer (m=token_address, r=user_key_hash)
    let personal_c_tot_m = if nullifier_was_initialized {
        personal_c_outer_m + new_balance
    } else {
        personal_c_outer_m + new_balance + token_address
    };
    
    let personal_c_tot_r = if nullifier_was_initialized {
        personal_c_outer_r + token_address
    } else {
        personal_c_outer_r + token_address + user_key_hash
    };

    let encrypted_amount = poseidon_ctr_encrypt(new_balance, encryption_key, 0);
    let encrypted_token_address = poseidon_ctr_encrypt(token_address, encryption_key, 1);
    
    // Self-reference check: encrypt hash of encryption_key for decryption verification
    let view_key_hash = Poseidon2::hash([encryption_key], 1);
    let encrypted_reference = poseidon_ctr_encrypt(view_key_hash, encryption_key, 2);
    
    // Encrypt opening values for personal_c_tot
    let encrypted_personal_c_tot_m = poseidon_ctr_encrypt(personal_c_tot_m, encryption_key, 3);
    let encrypted_personal_c_tot_r = poseidon_ctr_encrypt(personal_c_tot_r, encryption_key, 4);
    
    [encrypted_amount, encrypted_token_address, encrypted_reference, encrypted_personal_c_tot_m, encrypted_personal_c_tot_r]
}


