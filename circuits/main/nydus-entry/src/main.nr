use dep::std;
use dep::poseidon::poseidon2::Poseidon2;
use dep::poseidon_ctr_encryption::{poseidon_ctr_encrypt};
use dep::ec::tecurve::affine::{Curve, Point};
use dep::ec::consts::te::{baby_jubjub};
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_positive,
    pedersen_commitment_negative,
    pedersen_commitment_counter,
    add_multiple_commitments,
    to_nullifier_domain,
    pedersen_commitment_non_hiding
};
use dep::keccak::keccak256;
mod test;

global VIEW_STRING: Field = 0x76696577696e675f6b6579 as Field;

pub fn main(
    user_key: Field,
    token_address: pub Field,
    amount: pub Field
) -> pub (Field, [Field; 2], [Field; 2], [Field; 2]) {

    let nonce = 0 as Field;
    let user_key_hash = Poseidon2::hash([user_key], 1);
    let nonce_commitment = Poseidon2::hash([user_key_hash, nonce], 2);
    
 
    let amount_hashed = Poseidon2::hash([amount, user_key_hash], 2);
    let token_address_hashed = Poseidon2::hash([token_address, user_key_hash], 2);
    let nullifier = 0 as Field;
    let nullifier_hashed = Poseidon2::hash([nullifier, user_key_hash], 2);
    let nullifier_domain = to_nullifier_domain(token_address);
    
    
    let c_balance_commitment = pedersen_commitment_non_hiding(amount_hashed, token_address_hashed);
    let c_token_initializer = pedersen_commitment_non_hiding(token_address_hashed, user_key_hash);
    let c_inbound_nullifier = pedersen_commitment_non_hiding(nullifier_hashed, nullifier_domain);
    let c_notes_blinder = pedersen_commitment_non_hiding(user_key_hash, 0x46);
    let c_tot = add_multiple_commitments([c_balance_commitment, c_token_initializer, c_inbound_nullifier]);
    
    let main_stack_commitment = pedersen_commitment_positive(c_tot.x, c_tot.y, nonce_commitment);
    
    let view_key = Poseidon2::hash([VIEW_STRING, user_key_hash], 2);
    
    // Calculate opening values for personal_c_tot commitment (c_tot)
    // c_tot = c_balance_commitment + c_token_initializer + c_inbound_nullifier
    // Opening values: m_total = amount_hashed + token_address_hashed + nullifier_hashed
    //                 r_total = token_address_hashed + user_key_hash + nullifier_domain
    let personal_c_tot_m = amount_hashed + token_address_hashed + nullifier_hashed;
    let personal_c_tot_r = token_address_hashed + user_key_hash + nullifier_domain;
    
    // Encrypt opening values using view_key
    let encryption_key = Poseidon2::hash([view_key, nonce], 2);
    let encrypted_personal_c_tot_m = poseidon_ctr_encrypt(personal_c_tot_m, encryption_key, 3);
    let encrypted_personal_c_tot_r = poseidon_ctr_encrypt(personal_c_tot_r, encryption_key, 4);
    
    let nonce_discovery_entry = pedersen_commitment_non_hiding(1, nonce_commitment);
    (        
        nonce_commitment,                      
        [main_stack_commitment.x, main_stack_commitment.y],
        [nonce_discovery_entry.x, nonce_discovery_entry.y],
        [encrypted_personal_c_tot_m, encrypted_personal_c_tot_r]
    )
}





