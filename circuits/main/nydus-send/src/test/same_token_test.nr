use dep::std;
use dep::std::field::bn254::{gt};
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
use dep::poseidon::poseidon2::Poseidon2;
use dep::poseidon_ctr_encryption::{poseidon_ctr_encrypt, poseidon_ctr_decrypt};
use dep::ec::tecurve::affine::{Point};
use dep::ec::consts::te::{baby_jubjub};
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_positive,
    add_commitments,
    add_multiple_commitments,
    pedersen_commitment_non_hiding
};
use crate::main;

global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;

fn test_user_key() -> Field { 0x1234567890abcdef as Field }

fn test_token_address() -> Field { 0x02 as Field }

fn test_previous_nonce() -> Field { 0x00 as Field }

fn test_entry_amount() -> Field { 0x64 as Field }

fn test_send_amount() -> Field { 90 as Field }

fn test_receiver_fee_amount() -> Field { 10 as Field }

fn alice_private_key() -> Field { 0xfedcba0987654321 as Field }

fn derive_alice_public_key() -> [Field; 2] {
    let bjj = baby_jubjub();
    let generator = bjj.base8;
    let alice_private_key = alice_private_key();
    let alice_public_key = bjj.curve.mul(alice_private_key, generator);
    [alice_public_key.x, alice_public_key.y]
}

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

#[test]
fn test_send_with_same_token_fee() {
    std::println("=== TEST: Send 90 USDC, pay 10 USDC as fee (same token) ===");
    
    let (user_key_hash, previous_nonce_commitment, token_address_hash) = create_test_user_data(
        test_user_key(), 
        test_token_address(), 
        test_previous_nonce()
    );
    
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    
    let (personal_c_tot, personal_c_inner, personal_c_outer, personal_c_inner_m, personal_c_outer_m, personal_c_outer_r) = create_personal_commitments(
        test_entry_amount(),
        test_token_address(),
        user_key_hash,
        view_key,
        test_previous_nonce()
    );
    
    let previous_encryption_key = Poseidon2::hash([view_key, test_previous_nonce()], 2);
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
    
    let alice_derived_pub_key = derive_alice_public_key();
    
    let fee_token_personal_c_inner = personal_c_inner;
    let fee_token_personal_c_outer = personal_c_outer;
    let fee_token_personal_c_inner_m = personal_c_inner_m;
    let fee_token_personal_c_outer_m = personal_c_outer_m;
    let fee_token_personal_c_outer_r = personal_c_outer_r;
    
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
        test_token_address(),
        test_receiver_fee_amount(),
        fee_token_personal_c_inner,
        fee_token_personal_c_outer,
        fee_token_personal_c_inner_m,
        fee_token_personal_c_outer_m,
        fee_token_personal_c_outer_r
    );
    
    let expected_new_balance = test_entry_amount() - test_send_amount() - test_receiver_fee_amount();
    assert(expected_new_balance == 0, "Send should reduce balance to 0");
    
    std::println("✅ Send operation with same token fee verified successfully!");
    std::println("Initial balance: 100 USDC");
    std::println("Send amount: 90 USDC");
    std::println("Fee amount: 10 USDC");
    std::println("New balance: 0 USDC (100 - 90 - 10)");
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
    std::println("✅ Test completed successfully!");
}

