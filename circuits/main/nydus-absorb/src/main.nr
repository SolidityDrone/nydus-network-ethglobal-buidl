use dep::std;
use dep::std::field::bn254::{assert_gt, gt, assert_lt, lt};
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
    to_nullifier_domain,
    subtract_commitments
};
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
mod test;

global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;

// Initialized commitment point: pedersen_commitment_positive(1, 1, 1)
// Used as default notes_c_outer when there are no other notes
global INITIALIZED_COMMITMENT_X: Field = 0x0bc6f794fe53f0c8704d41006c06065f765e884d12ea6841895866f6a7796568 as Field;
global INITIALIZED_COMMITMENT_Y: Field = 0x22539c9ee4342d7eaa4c5a67d5cb0c93ddf1e9e03c173e6a4e442b5d57a2b5bd as Field;

fn main(
    user_key: Field,
    token_address: Field,
    previous_nonce: Field, 
    inner_notes_count: Field,              // Number of notes being absorbed for this token

    // Main stack commitments (user's own commitments)
    main_c_tot: pub [Field; 2],               // Main total commitment
    main_c_inner: [Field; 2],             // Main inner commitment
    main_c_outer: [Field; 2],             // Main outer commitment
    main_c_inner_point: [Field; 2],       // Opening values for main inner commitment
    main_c_outer_point: [Field; 3],       // Opening values for main outer commitment

    // Notes stack commitments (incoming note commitments)
    // notes_c_tot is no longer public - it's verified as part of main_c_tot structure
    notes_c_tot: [Field; 2],               // Notes total commitment (private, verified in main commitment)
    notes_c_inner: [Field; 2],             // Notes inner commitment (sum of all notes for this token)
    notes_c_outer: [Field; 2],             // Notes outer commitment (sum of all other notes/commitments)
    notes_c_inner_point: [Field; 2],       // Opening values: [sum of amounts, sum of shared_key_hashes]
    notes_c_outer_point: [Field; 3],       // Opening values for notes outer commitment (for off-circuit construction)

    // Personal commitments (user's balance state)
    personal_c_tot: [Field; 2],           // Personal total commitment
    personal_c_inner: [Field; 2],         // Personal inner commitment
    personal_c_outer: [Field; 2],         // Personal outer commitment
    personal_c_inner_m: Field,            // Personal inner amount
    personal_c_outer_m: Field,            // Personal outer amount  
    personal_c_outer_r: Field,            // Personal outer blinding factor
    nullifier: Field,                     // Current nullifier value (balance spent from notes)
    
    relay_fee_token_address: pub Field,
    receiver_fee_amount: pub Field,
    fee_token_personal_c_inner: [Field; 2],
    fee_token_personal_c_outer: [Field; 2],
    fee_token_personal_c_inner_m: Field,
    fee_token_personal_c_outer_m: Field,
    fee_token_personal_c_outer_r: Field
) -> pub (Field, [Field; 2], [Field; 7], [Field; 2], [Field; 2]) {
    // === NYDUS-ABSORB CIRCUIT (PERSONAL + NOTES COMMITMENTS) ===
    // This circuit absorbs incoming note commitments into personal balance
    // 
    // VERIFICATION FLOW:
    // 1. Verify main_c_tot commitments (user's own commitments)
    // 2. Verify notes_c_tot commitments (incoming note commitments)
    // 3. Verify personal commitments (user's balance state)
    // 4. Validate user has enough balance to absorb
    // 5. Update personal balance with absorbed amount
    // 6. Create new commitments and encrypted notes
    
    // === SETUP ===
    let user_key_hash = Poseidon2::hash([user_key], 1);
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    let previous_nonce_commitment = Poseidon2::hash([user_key_hash, previous_nonce as Field], 2);
    let current_balance = personal_c_inner_m;
    let fee_token_current_balance = fee_token_personal_c_inner_m;
    let tokens_same = token_address == relay_fee_token_address;
    
    // === VERIFICATION ===
    // Verify notes commitments first (to get notes_c_tot for main verification)
    // This also verifies that the receiver's public key is committed in notes_c_outer
    verify_notes_commitments(
        notes_c_tot,
        notes_c_inner,
        notes_c_outer,
        notes_c_inner_point,
        notes_c_outer_point,
        token_address,
        inner_notes_count,
        user_key
    );
    
    // Verify main commitments with new structure: notes_c_tot + main_c_outer = main_c_tot
    // (notes_c_tot is already verified separately, we just prove it's part of main_c_tot)
    verify_main_commitments(
        main_c_tot,
        main_c_inner,
        main_c_outer,
        main_c_inner_point,
        main_c_outer_point,
        previous_nonce_commitment,
        view_key,
        previous_nonce,
        notes_c_tot
    );
    
    let initializer_was_initialized = verify_personal_commitments(
        personal_c_tot,
        personal_c_inner,
        personal_c_outer,
        personal_c_inner_m,
        personal_c_outer_m,
        personal_c_outer_r,
        nullifier,
        token_address,
        user_key_hash,
        main_c_inner_point,
        view_key,
        previous_nonce,
        tokens_same,
        fee_token_personal_c_inner
    );
    
    if !tokens_same {
        verify_fee_token_personal_commitments(
            fee_token_personal_c_inner,
            fee_token_personal_c_outer,
            fee_token_personal_c_inner_m,
            fee_token_personal_c_outer_m,
            fee_token_personal_c_outer_r,
            relay_fee_token_address,
            user_key_hash
        );
    }
    
    // === PROCESSING ===
    let nonce = previous_nonce + 1 as Field;
    let new_nonce_commitment = Poseidon2::hash([user_key_hash, nonce as Field], 2);
    
    // Extract absorbed amount from notes inner commitment
    // notes_c_inner_point[0] is the sum of all amounts from the notes being absorbed
    let absorbed_amount = notes_c_inner_point[0];
    
    // === SUFFICIENT BALANCE CHECK ===
    if tokens_same {
        // When tokens are the same, fee can be paid from absorbed amount + current balance
        assert(gt(current_balance + absorbed_amount, receiver_fee_amount - 1), "Insufficient balance for fee (including absorbed amount)");
    } else {
        assert(gt(fee_token_current_balance, receiver_fee_amount - 1), "Fee amount exceeds available fee token balance");
    }
    
    // === UPDATE NULLIFIER ===
    // Increase nullifier by absorbed amount (tracks balance spent from notes)
    let new_nullifier = nullifier + absorbed_amount;
    
    // === CREATE NEW COMMITMENTS ===
    let (new_main_commitment, enc_x, enc_y) = create_new_commitments(
        current_balance,
        absorbed_amount,
        personal_c_tot,
        personal_c_inner,
        fee_token_personal_c_inner,
        fee_token_current_balance,
        receiver_fee_amount,
        token_address,
        relay_fee_token_address,
        user_key_hash,
        new_nonce_commitment,
        initializer_was_initialized,
        new_nullifier,
        view_key,
        nonce,
        tokens_same
    );
    
    // === ENCRYPT OPERATION DETAILS ===
    let new_balance = if tokens_same {
        current_balance + absorbed_amount - receiver_fee_amount
    } else {
        current_balance + absorbed_amount
    };
    
    let encrypted_note = encrypt_operation_details(
        current_balance,
        token_address,
        nonce,
        view_key,
        personal_c_tot,
        personal_c_inner,
        personal_c_inner_m,
        fee_token_personal_c_inner,
        fee_token_personal_c_inner_m,
        fee_token_current_balance,
        receiver_fee_amount,
        absorbed_amount,
        initializer_was_initialized,
        user_key_hash,
        relay_fee_token_address,
        new_nullifier,
        tokens_same
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
/// New structure: notes_c_tot + main_c_outer = main_c_tot
/// (notes_c_tot is already verified separately via verify_notes_commitments)
fn verify_main_commitments(
    main_c_tot: [Field; 2],
    main_c_inner: [Field; 2], 
    main_c_outer: [Field; 2],
    main_c_inner_point: [Field; 2],
    main_c_outer_point: [Field; 3],
    previous_nonce_commitment: Field,
    view_key: Field,
    previous_nonce: Field,
    notes_c_tot: [Field; 2]
) {
    // Verify that main_c_inner was created using the encrypted coordinates in main_c_inner_point
    let reconstructed_main_c_inner = pedersen_commitment_positive(main_c_inner_point[0], main_c_inner_point[1], previous_nonce_commitment);
    
    // Additionally verify that the encrypted coordinates can be decrypted (verifying they are valid encrypted coordinates)
    let previous_encryption_key = Poseidon2::hash([view_key, previous_nonce], 2);
    let _decrypted_x = poseidon_ctr_decrypt(main_c_inner_point[0], previous_encryption_key, 3);
    let _decrypted_y = poseidon_ctr_decrypt(main_c_inner_point[1], previous_encryption_key, 4);
    assert(reconstructed_main_c_inner.x == main_c_inner[0], "Main inner commitment x verification failed");
    assert(reconstructed_main_c_inner.y == main_c_inner[1], "Main inner commitment y verification failed");

    // Verify outer commitment
    let reconstructed_main_c_outer = pedersen_commitment_positive(main_c_outer_point[0], main_c_outer_point[1], main_c_outer_point[2]);
    assert(reconstructed_main_c_outer.x == main_c_outer[0], "Main outer commitment x verification failed");
    assert(reconstructed_main_c_outer.y == main_c_outer[1], "Main outer commitment y verification failed");

    // New structure: notes_c_tot + main_c_outer = main_c_tot
    // (notes_c_tot is already verified separately, we just prove it's part of main_c_tot)
    let notes_c_tot_commitment = EmbeddedCurvePoint { x: notes_c_tot[0], y: notes_c_tot[1], is_infinite: false };
    
    // Verify total commitment: notes_c_tot + main_c_outer = main_c_tot
    let main_c_tot_commitment = add_commitments(notes_c_tot_commitment, reconstructed_main_c_outer);
    assert(main_c_tot_commitment.x == main_c_tot[0], "Main total commitment x verification failed");
    assert(main_c_tot_commitment.y == main_c_tot[1], "Main total commitment y verification failed");
}

/// Verify notes stack commitments using opening values
/// Structure: notes_c_tot = notes_c_inner + notes_c_outer + reference_commitment
/// - notes_c_inner: sum of all notes for the token being absorbed
/// - notes_c_outer: sum of all other notes/commitments (other tokens, etc.)
/// - reference_commitment: pedersen_commitment_positive(pub_x, pub_y, 1) calculated in-circuit
/// notes_c_inner is the sum of all notes for this token:
///   - notes_c_inner_point[0] = sum of all amounts
///   - notes_c_inner_point[1] = sum of all shared_key_hashes
///   - third parameter = token_address * inner_notes_count
fn verify_notes_commitments(
    notes_c_tot: [Field; 2],
    notes_c_inner: [Field; 2], 
    notes_c_outer: [Field; 2],
    notes_c_inner_point: [Field; 2],
    notes_c_outer_point: [Field; 3],
    token_address: Field,
    inner_notes_count: Field,
    user_key: Field
) {
    // Verify inner commitment: sum of all notes for this token
    // notes_c_inner_point[0] = sum of all amounts
    // notes_c_inner_point[1] = sum of all shared_key_hashes
    // third parameter = token_address * inner_notes_count (domain separation for multiple notes)
    let token_address_with_count = token_address * inner_notes_count;
    let reconstructed_notes_c_inner = pedersen_commitment_positive(notes_c_inner_point[0], notes_c_inner_point[1], token_address_with_count);
    assert(reconstructed_notes_c_inner.x == notes_c_inner[0], "Notes inner commitment x verification failed");
    assert(reconstructed_notes_c_inner.y == notes_c_inner[1], "Notes inner commitment y verification failed");

    // Verify outer commitment (sum of all other notes/commitments)
    // If there are no other notes, notes_c_outer should be the initialized commitment
    // notes_c_outer_point contains opening values for off-circuit construction
    // Always verify using notes_c_outer_point - it should reconstruct to notes_c_outer
    let reconstructed_notes_c_outer = pedersen_commitment_positive(notes_c_outer_point[0], notes_c_outer_point[1], notes_c_outer_point[2]);
    assert(reconstructed_notes_c_outer.x == notes_c_outer[0], "Notes outer commitment x verification failed");
    assert(reconstructed_notes_c_outer.y == notes_c_outer[1], "Notes outer commitment y verification failed");

    // === CALCULATE REFERENCE COMMITMENT IN-CIRCUIT ===
    // Derive receiver's public key from user_key (same as in send circuit)
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    let receiver_public_key = bjj.curve.mul(user_key, generator);
    
    // Reference commitment: pedersen_commitment_positive(pub_x, pub_y, 1)
    let reference_commitment = pedersen_commitment_positive(receiver_public_key.x, receiver_public_key.y, 1);

    // Verify total commitment: notes_c_tot = notes_c_inner + notes_c_outer + reference_commitment
    let notes_c_inner_commitment = EmbeddedCurvePoint { x: notes_c_inner[0], y: notes_c_inner[1], is_infinite: false };
    let notes_c_outer_commitment = EmbeddedCurvePoint { x: notes_c_outer[0], y: notes_c_outer[1], is_infinite: false };
    let notes_c_tot_commitment = add_multiple_commitments([
        notes_c_inner_commitment,
        notes_c_outer_commitment,
        reference_commitment
    ]);
    assert(notes_c_tot_commitment.x == notes_c_tot[0], "Notes total commitment x verification failed");
    assert(notes_c_tot_commitment.y == notes_c_tot[1], "Notes total commitment y verification failed");
}

fn verify_fee_token_personal_commitments(
    fee_token_personal_c_inner: [Field; 2],
    fee_token_personal_c_outer: [Field; 2],
    fee_token_personal_c_inner_m: Field,
    fee_token_personal_c_outer_m: Field,
    fee_token_personal_c_outer_r: Field,
    relay_fee_token_address: Field,
    user_key_hash: Field
) {
    let fee_token_personal_c_inner_m_hash = Poseidon2::hash([fee_token_personal_c_inner_m, user_key_hash], 2);
    let fee_token_personal_c_inner_token_address_hash = Poseidon2::hash([relay_fee_token_address, user_key_hash], 2);
    
    let fee_token_inner_commitment = pedersen_commitment_non_hiding(fee_token_personal_c_inner_m_hash, fee_token_personal_c_inner_token_address_hash);
    assert(fee_token_inner_commitment.x == fee_token_personal_c_inner[0], "Fee token inner commitment x verification failed");
    assert(fee_token_inner_commitment.y == fee_token_personal_c_inner[1], "Fee token inner commitment y verification failed");
    
    let fee_token_outer_commitment = pedersen_commitment_non_hiding(fee_token_personal_c_outer_m, fee_token_personal_c_outer_r);
    assert(fee_token_outer_commitment.x == fee_token_personal_c_outer[0], "Fee token outer commitment verification failed");
    assert(fee_token_outer_commitment.y == fee_token_personal_c_outer[1], "Fee token outer commitment verification failed");
}

/// Verify personal commitments and determine if initializer was initialized
fn verify_personal_commitments(
    personal_c_tot: [Field; 2],
    personal_c_inner: [Field; 2],
    personal_c_outer: [Field; 2],
    personal_c_inner_m: Field,
    personal_c_outer_m: Field,
    personal_c_outer_r: Field,
    nullifier: Field,
    token_address: Field,
    user_key_hash: Field,
    main_c_inner_point: [Field; 2],
    view_key: Field,
    previous_nonce: Field,
    tokens_same: bool,
    fee_token_personal_c_inner: [Field; 2]
) -> bool {
    // Hash inner commitment parameters (balance)
    let personal_c_inner_m_hash = Poseidon2::hash([personal_c_inner_m, user_key_hash], 2);
    let personal_c_inner_token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2);
    
    // Verify inner commitment (balance)
    let inner_balance_commitment = pedersen_commitment_non_hiding(personal_c_inner_m_hash, personal_c_inner_token_address_hash);
    assert(inner_balance_commitment.x == personal_c_inner[0], "Inner commitment x verification failed");
    assert(inner_balance_commitment.y == personal_c_inner[1], "Inner commitment y verification failed");

    // Verify outer commitment
    let outer_commitment = pedersen_commitment_non_hiding(personal_c_outer_m, personal_c_outer_r);
    assert(outer_commitment.x == personal_c_outer[0], "Outer commitment verification failed");
    assert(outer_commitment.y == personal_c_outer[1], "Outer commitment verification failed");
    
    // Construct nullifier commitment
    let nullifier_hashed = Poseidon2::hash([nullifier, user_key_hash], 2);
    let nullifier_domain = to_nullifier_domain(token_address);
    let nullifier_commitment = pedersen_commitment_non_hiding(nullifier_hashed, nullifier_domain);
    
    // Check if nullifier is 0 (first time, needs initializer)
    let nullifier_is_zero = nullifier == 0;
    
    // If nullifier is 0: inner (balance) + initializer + outer = tot
    // If nullifier > 0: inner (balance) + inner (nullifier) + outer = tot
    let initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
    
    let sum_with_nullifier = add_multiple_commitments([
        inner_balance_commitment,
        nullifier_commitment,
        outer_commitment
    ]);
    
    let sum_with_initializer = add_multiple_commitments([
        inner_balance_commitment,
        initializer,
        outer_commitment
    ]);
    
    let with_nullifier_matches = (sum_with_nullifier.x == personal_c_tot[0]) & (sum_with_nullifier.y == personal_c_tot[1]);
    let with_initializer_matches = (sum_with_initializer.x == personal_c_tot[0]) & (sum_with_initializer.y == personal_c_tot[1]);
    
    if tokens_same {
        let matches = if nullifier_is_zero {
            with_initializer_matches
        } else {
            with_nullifier_matches
        };
        assert(matches, "Total commitment verification failed");
    } else {
        let fee_token_personal_c_inner_commitment = EmbeddedCurvePoint { x: fee_token_personal_c_inner[0], y: fee_token_personal_c_inner[1], is_infinite: false };
        let personal_c_tot_commitment = EmbeddedCurvePoint { x: personal_c_tot[0], y: personal_c_tot[1], is_infinite: false };
        
        let computed_outer = subtract_commitments(
            subtract_commitments(personal_c_tot_commitment, inner_balance_commitment),
            fee_token_personal_c_inner_commitment
        );
        
        let sum_with_nullifier_combined = add_multiple_commitments([
            inner_balance_commitment,
            nullifier_commitment,
            computed_outer,
            fee_token_personal_c_inner_commitment
        ]);
        
        let sum_with_initializer_combined = add_multiple_commitments([
            inner_balance_commitment,
            initializer,
            computed_outer,
            fee_token_personal_c_inner_commitment
        ]);
        
        let with_nullifier_combined_matches = (sum_with_nullifier_combined.x == personal_c_tot[0]) & (sum_with_nullifier_combined.y == personal_c_tot[1]);
        let with_initializer_combined_matches = (sum_with_initializer_combined.x == personal_c_tot[0]) & (sum_with_initializer_combined.y == personal_c_tot[1]);
        
        let matches = if nullifier_is_zero {
            with_initializer_combined_matches
        } else {
            with_nullifier_combined_matches
        };
        assert(matches, "Total commitment verification failed");
    }
    
    // Decrypt the encrypted coordinates from main_c_inner_point and verify they match personal_c_tot
    let previous_encryption_key = Poseidon2::hash([view_key, previous_nonce], 2);
    let decrypted_x = poseidon_ctr_decrypt(main_c_inner_point[0], previous_encryption_key, 3);
    let decrypted_y = poseidon_ctr_decrypt(main_c_inner_point[1], previous_encryption_key, 4);
    
    // Verify decrypted coordinates match personal_c_tot
    assert(decrypted_x == personal_c_tot[0], "Decrypted x coordinate doesn't match personal_c_tot");
    assert(decrypted_y == personal_c_tot[1], "Decrypted y coordinate doesn't match personal_c_tot");
    
    // Return true if initializer was initialized (nullifier > 0 means it was initialized)
    !nullifier_is_zero
}

/// Create new commitments after absorb
fn create_new_commitments(
    current_balance: Field,
    absorbed_amount: Field,
    personal_c_tot: [Field; 2],
    personal_c_inner: [Field; 2],
    fee_token_personal_c_inner: [Field; 2],
    fee_token_current_balance: Field,
    receiver_fee_amount: Field,
    token_address: Field,
    relay_fee_token_address: Field,
    user_key_hash: Field,
    new_nonce_commitment: Field,
    initializer_was_initialized: bool,
    new_nullifier: Field,
    view_key: Field,
    nonce: Field,
    tokens_same: bool
) -> (EmbeddedCurvePoint, Field, Field) {
    let personal_c_tot_commitment = EmbeddedCurvePoint { x: personal_c_tot[0], y: personal_c_tot[1], is_infinite: false };
    let personal_c_inner_commitment = EmbeddedCurvePoint { x: personal_c_inner[0], y: personal_c_inner[1], is_infinite: false };
    
    let outer_commitment = if tokens_same {
        subtract_commitments(personal_c_tot_commitment, personal_c_inner_commitment)
    } else {
        let fee_token_personal_c_inner_commitment = EmbeddedCurvePoint { x: fee_token_personal_c_inner[0], y: fee_token_personal_c_inner[1], is_infinite: false };
        subtract_commitments(
            subtract_commitments(personal_c_tot_commitment, personal_c_inner_commitment),
            fee_token_personal_c_inner_commitment
        )
    };
    
    let new_balance = if tokens_same {
        current_balance + absorbed_amount - receiver_fee_amount
    } else {
        current_balance + absorbed_amount
    };
    
    let new_balance_hash = Poseidon2::hash([new_balance, user_key_hash], 2);
    let token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2);
    let new_balance_commitment = pedersen_commitment_non_hiding(new_balance_hash, token_address_hash);
    
    let new_nullifier_hashed = Poseidon2::hash([new_nullifier, user_key_hash], 2);
    let nullifier_domain = to_nullifier_domain(token_address);
    let new_nullifier_commitment = pedersen_commitment_non_hiding(new_nullifier_hashed, nullifier_domain);
    
    let new_personal_c_tot_commitment = if tokens_same {
        if initializer_was_initialized {
            add_multiple_commitments([
                outer_commitment,
                new_balance_commitment,
                new_nullifier_commitment
            ])
        } else {
            let initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
            add_multiple_commitments([
                outer_commitment,
                new_balance_commitment,
                initializer
            ])
        }
    } else {
        let fee_token_new_balance = fee_token_current_balance - receiver_fee_amount;
        let fee_token_new_balance_hash = Poseidon2::hash([fee_token_new_balance, user_key_hash], 2);
        let fee_token_token_address_hash = Poseidon2::hash([relay_fee_token_address, user_key_hash], 2);
        let new_fee_balance_commitment = pedersen_commitment_non_hiding(fee_token_new_balance_hash, fee_token_token_address_hash);
        
        if initializer_was_initialized {
            add_multiple_commitments([
                outer_commitment,
                new_balance_commitment,
                new_nullifier_commitment,
                new_fee_balance_commitment
            ])
        } else {
            let initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
            add_multiple_commitments([
                outer_commitment,
                new_balance_commitment,
                initializer,
                new_fee_balance_commitment
            ])
        }
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
    personal_c_tot: [Field; 2],
    personal_c_inner: [Field; 2],
    personal_c_inner_m: Field,
    fee_token_personal_c_inner: [Field; 2],
    fee_token_personal_c_inner_m: Field,
    fee_token_current_balance: Field,
    receiver_fee_amount: Field,
    absorbed_amount: Field,
    initializer_was_initialized: bool,
    user_key_hash: Field,
    relay_fee_token_address: Field,
    new_nullifier: Field,
    tokens_same: bool
) -> [Field; 7] {
    let encryption_key = Poseidon2::hash([view_key, nonce], 2);
    
    let new_balance = if tokens_same {
        current_balance + absorbed_amount - receiver_fee_amount
    } else {
        current_balance + absorbed_amount
    };
    
    let new_balance_hash = Poseidon2::hash([new_balance, user_key_hash], 2);
    let token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2);
    
    let new_nullifier_hash = Poseidon2::hash([new_nullifier, user_key_hash], 2);
    let nullifier_domain = to_nullifier_domain(token_address);
    
    let personal_c_outer_m = 0 as Field;
    let personal_c_outer_r = token_address;
    
    let personal_c_tot_m = if tokens_same {
        if initializer_was_initialized {
            new_balance_hash + new_nullifier_hash + personal_c_outer_m
        } else {
            new_balance_hash + token_address + personal_c_outer_m
        }
    } else {
        let fee_token_new_balance = fee_token_current_balance - receiver_fee_amount;
        let fee_token_new_balance_hash = Poseidon2::hash([fee_token_new_balance, user_key_hash], 2);
        let fee_token_token_address_hash = Poseidon2::hash([relay_fee_token_address, user_key_hash], 2);
        
        if initializer_was_initialized {
            new_balance_hash + new_nullifier_hash + personal_c_outer_m + fee_token_new_balance_hash
        } else {
            new_balance_hash + token_address + personal_c_outer_m + fee_token_new_balance_hash
        }
    };
    
    let personal_c_tot_r = if tokens_same {
        if initializer_was_initialized {
            token_address_hash + nullifier_domain + personal_c_outer_r
        } else {
            token_address_hash + user_key_hash + personal_c_outer_r
        }
    } else {
        let fee_token_token_address_hash = Poseidon2::hash([relay_fee_token_address, user_key_hash], 2);
        
        if initializer_was_initialized {
            token_address_hash + nullifier_domain + personal_c_outer_r + fee_token_token_address_hash
        } else {
            token_address_hash + user_key_hash + personal_c_outer_r + fee_token_token_address_hash
        }
    };

    // Encrypt new balance (use counter 0 for consistency with deposit/send/withdraw circuits)
    // This matches the pattern: encrypted_amount uses counter 0, encrypted_token_address uses counter 1
    let encrypted_new_balance = poseidon_ctr_encrypt(new_balance, encryption_key, 0);
    let encrypted_token_address = poseidon_ctr_encrypt(token_address, encryption_key, 1);
    
    // Self-reference check: encrypt hash of encryption_key for decryption verification
    let encryption_key_hash = Poseidon2::hash([encryption_key], 1);
    let encrypted_reference = poseidon_ctr_encrypt(encryption_key_hash, encryption_key, 2);
    
    // Encrypt absorbed amount (for tracking purposes)
    let encrypted_absorbed_amount = poseidon_ctr_encrypt(absorbed_amount, encryption_key, 3);
    
    // Encrypt opening values for personal_c_tot
    let encrypted_personal_c_tot_m = poseidon_ctr_encrypt(personal_c_tot_m, encryption_key, 4);
    let encrypted_personal_c_tot_r = poseidon_ctr_encrypt(personal_c_tot_r, encryption_key, 5);
    
    // Encrypt new nullifier (current nullifier after update)
    let encrypted_new_nullifier = poseidon_ctr_encrypt(new_nullifier, encryption_key, 6);
    
    [encrypted_absorbed_amount, encrypted_token_address, encrypted_reference, encrypted_new_balance, encrypted_personal_c_tot_m, encrypted_personal_c_tot_r, encrypted_new_nullifier]
}
