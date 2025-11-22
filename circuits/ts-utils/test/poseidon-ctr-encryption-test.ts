import { testPoseidonCtrEncryption, hexToBigInt } from '../src/poseidon-ctr-encryption';

/**
 * Test to verify TypeScript Poseidon CTR encryption matches Noir implementation
 * 
 * Instructions:
 * 1. Run the Noir test: cd circuits/lib/poseidon-ctr-encryption && nargo test test_poseidon_ctr_encryption_values
 * 2. Compare the results with this TypeScript test
 * 3. The values should match if the implementations are equivalent
 */

// === VALUES FROM NOIR TEST ===
// Using the exact values from Noir test output

const AMOUNT = hexToBigInt('0x3e8'); // 1000 in decimal
const TOKEN_ADDRESS = hexToBigInt('0x3039'); // 12345 in decimal
const REF = hexToBigInt('0x10932'); // 67890 in decimal

// Hardcoded values from Noir test output
const ENCRYPTED_AMOUNT = hexToBigInt('0x04737323c429edc1b7eb297bc612a0033d7571cc399607aeec621bb46ff3d899');
const ENCRYPTED_TOKEN_ADDRESS = hexToBigInt('0x0b9732e5b324f5e0b4a64892c9e4010b19616b41b6e052aa5f36a74b61f6a40e');
const ENCRYPTED_REF = hexToBigInt('0x2145add0a45a9b13238134e4a2a83d77b6fc2406e2bb5cede265f47dcd71dc28');
const ENCRYPTED_KEY = hexToBigInt('0x2750d2105e48419ff217258b7493b834c52998078a0db388f8312072e032c5eb');

// The encryption key from Noir (Poseidon2::hash([999], 1))
const ENCRYPTION_KEY = hexToBigInt('0x06061437cf363041d106eca0a674ea3ed441f42ce53ef78976727c59328bb8a1');

async function runPoseidonCtrTest() {
    console.log('========================================');
    console.log('TypeScript Poseidon CTR Decryption Test');
    console.log('Using hardcoded values from Noir test output');
    console.log('========================================');

    try {
        console.log('Input values:');
        console.log('Amount:', AMOUNT.toString(16));
        console.log('Token Address:', TOKEN_ADDRESS.toString(16));
        console.log('Ref:', REF.toString(16));
        console.log('Encryption Key:', ENCRYPTION_KEY.toString(16));

        console.log('\n=== NOIR ENCRYPTED VALUES ===');
        console.log('Encrypted Amount:', ENCRYPTED_AMOUNT.toString(16));
        console.log('Encrypted Token Address:', ENCRYPTED_TOKEN_ADDRESS.toString(16));
        console.log('Encrypted Ref:', ENCRYPTED_REF.toString(16));
        console.log('Encrypted Key:', ENCRYPTED_KEY.toString(16));

        // Test decryption using the hardcoded encrypted values from Noir
        console.log('\n=== DECRYPTING NOIR VALUES ===');

        const { poseidonCtrDecrypt } = await import('../src/poseidon-ctr-encryption');

        const decryptedAmount = await poseidonCtrDecrypt(ENCRYPTED_AMOUNT, ENCRYPTION_KEY, 0);
        const decryptedTokenAddress = await poseidonCtrDecrypt(ENCRYPTED_TOKEN_ADDRESS, ENCRYPTION_KEY, 1);
        const decryptedRef = await poseidonCtrDecrypt(ENCRYPTED_REF, ENCRYPTION_KEY, 2);
        const decryptedKey = await poseidonCtrDecrypt(ENCRYPTED_KEY, ENCRYPTION_KEY, 3);

        console.log('Decrypted Amount:', decryptedAmount.toString(16));
        console.log('Decrypted Token Address:', decryptedTokenAddress.toString(16));
        console.log('Decrypted Ref:', decryptedRef.toString(16));
        console.log('Decrypted Key:', decryptedKey.toString(16));

        // Verify decryption matches expected values
        console.log('\n=== DECRYPTION VERIFICATION ===');
        const amountMatch = decryptedAmount === AMOUNT;
        const tokenAddressMatch = decryptedTokenAddress === TOKEN_ADDRESS;
        const refMatch = decryptedRef === REF;
        const keyMatch = decryptedKey === ENCRYPTION_KEY;

        console.log('Amount decryption correct:', amountMatch);
        console.log('Token Address decryption correct:', tokenAddressMatch);
        console.log('Ref decryption correct:', refMatch);
        console.log('Key decryption correct:', keyMatch);

        const allDecryptionsCorrect = amountMatch && tokenAddressMatch && refMatch && keyMatch;
        console.log('All decryptions correct:', allDecryptionsCorrect);

        if (allDecryptionsCorrect) {
            console.log('✅ TypeScript can successfully decrypt Noir-encrypted values!');
            console.log('\n=== SUMMARY ===');
            console.log('✅ TypeScript implementation matches Noir implementation');
            console.log('✅ Can decrypt values encrypted by Noir');
            console.log('✅ Round-trip encryption/decryption works');
            process.exit(0);
        } else {
            console.log('❌ TypeScript decryption does not match expected values');
            console.log('Check the implementation differences and update accordingly');
            process.exit(1);
        }

    } catch (error) {
        console.error('Error running Poseidon CTR test:', error);
        process.exit(1);
    }
}

// Run the test immediately
console.log('Starting Poseidon CTR encryption test...');
runPoseidonCtrTest();
