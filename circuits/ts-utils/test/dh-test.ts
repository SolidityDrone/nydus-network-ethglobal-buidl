import { testDHKeyExchange, hexToBigInt } from '../src/dh-utils';

/**
 * Test to verify TypeScript DH implementation matches Noir implementation
 * 
 * Instructions:
 * 1. Run the Noir test: cd nydus/main/nydus-send && nargo test --show-output test_dh_key_exchange_values
 * 2. Copy the printed values below
 * 3. Run this test: npm test
 * 4. Compare the results
 */

// === VALUES FROM NOIR TEST ===
// Updated with actual values from the Noir test output

const ALICE_PRIVATE_KEY = hexToBigInt('0x1234567890abcdef');
const ALICE_NONCE = hexToBigInt('0x01');
const ALICE_USER_KEY = hexToBigInt('0x1234567890abcdf0');
const BOB_PUBLIC_KEY_X = hexToBigInt('0x2951c943a3f90de6f57a83018d7a8821fcf8170d5726d7e5fa38adc47fa28279');
const BOB_PUBLIC_KEY_Y = hexToBigInt('0x0374f623106f029bbe46fdd51f76ddb8430513637a04faead415f64ea77425f9');
const AMOUNT = hexToBigInt('0x32'); // 50 in decimal
const TOKEN_ADDRESS = hexToBigInt('0x58002bee8f43bf203964d38c54fa03e62d615959fa');

// Expected values from Noir test
const EXPECTED_ALICE_SENDER_PUBLIC_KEY_X = hexToBigInt('0x1895e9f5db896210ae41caed720e9a7a758dec36719f501fc20c0426a8fb763f');
const EXPECTED_ALICE_SENDER_PUBLIC_KEY_Y = hexToBigInt('0x07ca0daf7b78e6ba76c9c00098ca2ed11ed108549c8bc02ce0765184a00bf489');
const EXPECTED_SHARED_KEY = hexToBigInt('0x2a1dca96e3525d773210461d8378e42d8b639d150e5a8624c9c1321f97da6a44');

async function runDHTest() {
  console.log('========================================');
  console.log('TypeScript DH Key Exchange Test');
  console.log('========================================');

  try {
    // Run the DH key exchange test
    const result = await testDHKeyExchange(
      ALICE_USER_KEY, // Use Alice's user key (private_key + nonce)
      ALICE_NONCE,
      BOB_PUBLIC_KEY_X,
      BOB_PUBLIC_KEY_Y,
      AMOUNT,
      TOKEN_ADDRESS
    );

    console.log('\n=== COMPARISON WITH NOIR ===');
    console.log('TypeScript Results:');
    console.log('Alice sender public key X:', result.senderPublicKey.x.toString(16));
    console.log('Alice sender public key Y:', result.senderPublicKey.y.toString(16));
    console.log('Shared key:', result.sharedKey.toString(16));

    console.log('\nExpected Noir Results:');
    console.log('Alice sender public key X:', EXPECTED_ALICE_SENDER_PUBLIC_KEY_X.toString(16));
    console.log('Alice sender public key Y:', EXPECTED_ALICE_SENDER_PUBLIC_KEY_Y.toString(16));
    console.log('Shared key:', EXPECTED_SHARED_KEY.toString(16));

    // Compare results
    const senderKeyXMatch = result.senderPublicKey.x === EXPECTED_ALICE_SENDER_PUBLIC_KEY_X;
    const senderKeyYMatch = result.senderPublicKey.y === EXPECTED_ALICE_SENDER_PUBLIC_KEY_Y;
    const sharedKeyMatch = result.sharedKey === EXPECTED_SHARED_KEY;

    console.log('\n=== VERIFICATION RESULTS ===');
    console.log('Sender public key X match:', senderKeyXMatch);
    console.log('Sender public key Y match:', senderKeyYMatch);
    console.log('Shared key match:', sharedKeyMatch);

    const allMatch = senderKeyXMatch && senderKeyYMatch && sharedKeyMatch;
    console.log('All results match:', allMatch);

    if (allMatch) {
      console.log('✅ TypeScript DH implementation matches Noir implementation!');
      process.exit(0);
    } else {
      console.log('❌ TypeScript DH implementation does not match Noir implementation');
      console.log('Check the implementation differences and update accordingly');
      process.exit(1);
    }

  } catch (error) {
    console.error('Error running DH test:', error);
    process.exit(1);
  }
}

// Run the test immediately
console.log('Starting test...');
runDHTest();