use dep::keccak256::keccak256;

// Publicly exported common types
pub type Address = [u8; 20];
pub type Bytes32 = [u8; 32];
pub type Bytes = [u8; 32];

// Convert Address (20 bytes) to Field
fn address_to_field(address: Address) -> Field {
    let mut result: Field = 0;
    for i in 0..20 { result = (result * 256) + (address[i] as Field); }
    result
}

// Convert u64 to bytes
fn nonce_to_bytes(nonce: u64) -> [u8; 8] {
    let mut bytes = [0; 8];
    bytes[0] = (nonce & 0xFF) as u8;
    bytes[1] = ((nonce >> 8) & 0xFF) as u8;
    bytes[2] = ((nonce >> 16) & 0xFF) as u8;
    bytes[3] = ((nonce >> 24) & 0xFF) as u8;
    bytes[4] = ((nonce >> 32) & 0xFF) as u8;
    bytes[5] = ((nonce >> 40) & 0xFF) as u8;
    bytes[6] = ((nonce >> 48) & 0xFF) as u8;
    bytes[7] = ((nonce >> 56) & 0xFF) as u8;
    bytes
}

// Hash a u64 value using Keccak256 of its ASCII digits
fn hash_u64(value: u64) -> [u8; 32] {
    let digits = unsafe { u64_to_ascii_bytes(value) };
    let mut digit_count = 0;
    for i in 0..20 { if digits[i] != 0 { digit_count += 1; } }
    let mut message: [u8; 64] = [0; 64];
    for i in 0..20 { if i < digit_count { message[i] = digits[20 - digit_count + i]; } }
    keccak256(message, digit_count)
}

// Unconstrained: convert u64 to ASCII bytes
unconstrained fn u64_to_ascii_bytes(value: u64) -> [u8; 20] {
    let mut result: [u8; 20] = [0; 20];
    let mut temp = value;
    let mut pos = 19;
    if value == 0 { result[19] = 48; }
    else {
        while temp > 0 {
            let digit = (temp % 10) as u8;
            result[pos] = digit + 48;
            temp = temp / 10;
            if pos > 0 { pos -= 1; }
        }
    }
    let mut shifted: [u8; 20] = [0; 20];
    let mut count = 0;
    for i in 0..20 { if result[i] != 0 { count += 1; } }
    for i in 0..count { shifted[20 - count + i] = result[20 - count + i]; }
    shifted
}

// Convert 32 bytes (big-endian) into a Field
fn bytes_to_field_32_be(bytes: [u8; 32]) -> Field {
    let mut result: Field = 0;
    for i in 0..32 { result = result * 256 + (bytes[i] as Field); }
    result
}

// Convert Field to 32 bytes (big-endian)
fn field_to_32_bytes(field_val: Field) -> [u8; 32] {
    let mut bytes = [0; 32];
    let mut val = field_val as u64;
    for i in 0..32 { bytes[31 - i] = (val % 256) as u8; val = val / 256; }
    bytes
}

// Truncate 32-byte array to Field (user helper)
fn field_from_bytes_32_trunc(bytes32: [u8; 32]) -> Field {
    let mut v = 1;
    let mut high = 0 as Field;
    let mut low = 0 as Field;
    for i in 0..15 {
        low = low + (bytes32[15 + 15 - i] as Field) * v;
        v = v * 256;
        high = high + (bytes32[14 - i] as Field) * v;
    }
    low = low + (bytes32[15] as Field) * v;
    low + high * v
}

// Re-exports for convenience
pub fn utils_address_to_field(a: [u8; 20]) -> Field { address_to_field(a) }
pub fn utils_nonce_to_bytes(n: u64) -> [u8; 8] { nonce_to_bytes(n) }
pub fn utils_hash_u64(n: u64) -> [u8; 32] { hash_u64(n) }
pub fn utils_bytes_to_field_32_be(b: [u8; 32]) -> Field { bytes_to_field_32_be(b) }
pub fn utils_field_to_32_bytes(f: Field) -> [u8; 32] { field_to_32_bytes(f) }
pub fn utils_field_from_bytes_32_trunc(b: [u8; 32]) -> Field { field_from_bytes_32_trunc(b) }


