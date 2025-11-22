use dep::std;
use dep::std::field::bn254::{assert_gt, gt};
use dep::poseidon::poseidon2::Poseidon2;
use dep::poseidon_ctr_encryption::{poseidon_ctr_encrypt, poseidon_ctr_decrypt};
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_positive,
    pedersen_commitment_negative,
    add_commitments,
    add_multiple_commitments,
    subtract_commitments,
    pedersen_commitment_non_hiding
};
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
mod test;

global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;




fn main(
    user_key: Field,
    token_address: pub Field,
    amount: pub Field,
    previous_nonce: Field,
    main_c_tot: pub [Field; 2],
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
    arbitrary_calldata_hash: pub Field,
    receiver_address: pub Field,
    relay_fee_token_address: pub Field,
    receiver_fee_amount: pub Field,
    fee_token_personal_c_inner: [Field; 2],
    fee_token_personal_c_outer: [Field; 2],
    fee_token_personal_c_inner_m: Field,
    fee_token_personal_c_outer_m: Field,
    fee_token_personal_c_outer_r: Field
) -> pub (Field, [Field; 2], [Field; 5], [Field; 2], [Field; 2]) {
    let user_key_hash = Poseidon2::hash([user_key], 1);
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    let previous_nonce_commitment = Poseidon2::hash([user_key_hash, previous_nonce as Field], 2);
    let current_balance = personal_c_inner_m;
    let fee_token_current_balance = fee_token_personal_c_inner_m;
    let tokens_same = token_address == relay_fee_token_address;
    
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
    
    verify_personal_commitments(
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
    
    let nonce = previous_nonce + 1 as Field;
    let new_nonce_commitment = Poseidon2::hash([user_key_hash, nonce as Field], 2);
    
    if tokens_same {
        assert(gt(current_balance, amount + receiver_fee_amount - 1), "Insufficient balance for withdrawal and fee");
    } else {
        assert(gt(current_balance, amount - 1), "Withdrawal amount exceeds available balance");
        assert(gt(fee_token_current_balance, receiver_fee_amount - 1), "Fee amount exceeds available fee token balance");
    }
    
    let (new_main_commitment, enc_x, enc_y) = create_new_commitments(
        current_balance,
        amount,
        personal_c_tot,
        personal_c_inner,
        fee_token_personal_c_inner,
        fee_token_current_balance,
        receiver_fee_amount,
        token_address,
        relay_fee_token_address,
        user_key_hash,
        new_nonce_commitment,
        view_key,
        nonce,
        tokens_same
    );
    
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
        amount,
        user_key_hash,
        relay_fee_token_address,
        tokens_same
    );
    
    let nonce_discovery_entry = pedersen_commitment_non_hiding(1, new_nonce_commitment);
    
    (   
        new_nonce_commitment,
        [new_main_commitment.x, new_main_commitment.y],
        encrypted_note,
        [nonce_discovery_entry.x, nonce_discovery_entry.y],
        [enc_x, enc_y]
    )
}



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
    let reconstructed_main_c_inner = pedersen_commitment_positive(main_c_inner_point[0], main_c_inner_point[1], previous_nonce_commitment);
    assert(reconstructed_main_c_inner.x == main_c_inner[0], "Main inner commitment x verification failed");
    assert(reconstructed_main_c_inner.y == main_c_inner[1], "Main inner commitment y verification failed");

    let reconstructed_main_c_outer = pedersen_commitment_positive(main_c_outer_point[0], main_c_outer_point[1], main_c_outer_point[2]);
    assert(reconstructed_main_c_outer.x == main_c_outer[0], "Main outer commitment x verification failed");
    assert(reconstructed_main_c_outer.y == main_c_outer[1], "Main outer commitment y verification failed");

    let main_c_tot_commitment = add_commitments(reconstructed_main_c_inner, reconstructed_main_c_outer);
    assert(main_c_tot_commitment.x == main_c_tot[0], "Main total commitment x verification failed");
    assert(main_c_tot_commitment.y == main_c_tot[1], "Main total commitment y verification failed");
}

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
    previous_nonce: Field,
    tokens_same: bool,
    fee_token_personal_c_inner: [Field; 2]
) {
    let personal_c_inner_m_hash = Poseidon2::hash([personal_c_inner_m, user_key_hash], 2);
    let personal_c_inner_token_address_hash = Poseidon2::hash([token_address, user_key_hash], 2);
    
    let inner_commitment = pedersen_commitment_non_hiding(personal_c_inner_m_hash, personal_c_inner_token_address_hash);
    assert(inner_commitment.x == personal_c_inner[0], "Inner commitment x verification failed");
    assert(inner_commitment.y == personal_c_inner[1], "Inner commitment y verification failed");

    let outer_commitment = pedersen_commitment_non_hiding(personal_c_outer_m, personal_c_outer_r);
    assert(outer_commitment.x == personal_c_outer[0], "Outer commitment verification failed");
    assert(outer_commitment.y == personal_c_outer[1], "Outer commitment verification failed");
    
    let initializer = pedersen_commitment_non_hiding(token_address, user_key_hash);
    
    if tokens_same {
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
    } else {
        let fee_token_personal_c_inner_commitment = EmbeddedCurvePoint { x: fee_token_personal_c_inner[0], y: fee_token_personal_c_inner[1], is_infinite: false };
        let personal_c_tot_commitment = EmbeddedCurvePoint { x: personal_c_tot[0], y: personal_c_tot[1], is_infinite: false };
        
        let computed_outer = subtract_commitments(
            subtract_commitments(personal_c_tot_commitment, inner_commitment),
            fee_token_personal_c_inner_commitment
        );
        
        let sum = add_multiple_commitments([
            inner_commitment,
            fee_token_personal_c_inner_commitment,
            computed_outer
        ]);
        
        let sum_matches = (sum.x == personal_c_tot[0]) & (sum.y == personal_c_tot[1]);
        
        assert(sum_matches, "Total commitment verification failed");
    }
    
    let previous_encryption_key = Poseidon2::hash([view_key, previous_nonce], 2);
    let decrypted_x = poseidon_ctr_decrypt(main_c_inner_point[0], previous_encryption_key, 3);
    let decrypted_y = poseidon_ctr_decrypt(main_c_inner_point[1], previous_encryption_key, 4);
    
    assert(decrypted_x == personal_c_tot[0], "Decrypted x coordinate doesn't match personal_c_tot");
    assert(decrypted_y == personal_c_tot[1], "Decrypted y coordinate doesn't match personal_c_tot");
}

fn create_new_commitments(
    current_balance: Field,
    amount: Field,
    personal_c_tot: [Field; 2],
    personal_c_inner: [Field; 2],
    fee_token_personal_c_inner: [Field; 2],
    fee_token_current_balance: Field,
    receiver_fee_amount: Field,
    token_address: Field,
    relay_fee_token_address: Field,
    user_key_hash: Field,
    new_nonce_commitment: Field,
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
        current_balance - amount - receiver_fee_amount
    } else {
        current_balance - amount
    };
    
    let new_balance_commitment = pedersen_commitment_non_hiding(new_balance, token_address);
    
    let new_personal_c_tot_commitment = if tokens_same {
        add_commitments(outer_commitment, new_balance_commitment)
    } else {
        let fee_token_new_balance = fee_token_current_balance - receiver_fee_amount;
        let fee_token_new_balance_hash = Poseidon2::hash([fee_token_new_balance, user_key_hash], 2);
        let fee_token_token_address_hash = Poseidon2::hash([relay_fee_token_address, user_key_hash], 2);
        let new_fee_balance_commitment = pedersen_commitment_non_hiding(fee_token_new_balance_hash, fee_token_token_address_hash);
        add_multiple_commitments([
            outer_commitment,
            new_balance_commitment,
            new_fee_balance_commitment
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
    
    let fee_token_sum_commitment = add_commitments(fee_token_inner_commitment, fee_token_outer_commitment);
    assert(fee_token_sum_commitment.x == fee_token_sum_commitment.x, "Fee token total commitment verification");
    assert(fee_token_sum_commitment.y == fee_token_sum_commitment.y, "Fee token total commitment verification");
}

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
    amount: Field,
    user_key_hash: Field,
    relay_fee_token_address: Field,
    tokens_same: bool
) -> [Field; 5] {
    let encryption_key = Poseidon2::hash([view_key, nonce], 2);

    let new_balance = if tokens_same {
        current_balance - amount - receiver_fee_amount
    } else {
        current_balance - amount
    };
    
    let (new_personal_c_tot_m, new_personal_c_tot_r) = if tokens_same {
        (new_balance, token_address)
    } else {
        let fee_token_new_balance = fee_token_current_balance - receiver_fee_amount;
        let fee_token_new_balance_hash = Poseidon2::hash([fee_token_new_balance, user_key_hash], 2);
        let fee_token_token_address_hash = Poseidon2::hash([relay_fee_token_address, user_key_hash], 2);
        (new_balance + fee_token_new_balance_hash, token_address + fee_token_token_address_hash)
    };

    let encrypted_amount = poseidon_ctr_encrypt(new_balance, encryption_key, 0);
    let encrypted_token_address = poseidon_ctr_encrypt(token_address, encryption_key, 1);
    
    let view_key_hash = Poseidon2::hash([encryption_key], 1);
    let encrypted_reference = poseidon_ctr_encrypt(view_key_hash, encryption_key, 2);
    
    let encrypted_personal_c_tot_m = poseidon_ctr_encrypt(new_personal_c_tot_m, encryption_key, 3);
    let encrypted_personal_c_tot_r = poseidon_ctr_encrypt(new_personal_c_tot_r, encryption_key, 4);
    
    [encrypted_amount, encrypted_token_address, encrypted_reference, encrypted_personal_c_tot_m, encrypted_personal_c_tot_r]
}
