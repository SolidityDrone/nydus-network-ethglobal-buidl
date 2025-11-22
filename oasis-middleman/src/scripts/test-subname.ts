import dotenv from 'dotenv';
import { config } from '../config';
import { justaNameSDKService } from '../services/justaname-sdk';
import { deriveKeyFromParameter, derivePrivateKeyFromParameter } from '../utils/address';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

/**
 * Test: check existence, create subdomain, continuously update text record
 */
async function testSubname() {
  try {
    console.log('\n🧪 Testing subname operations with JustaName SDK...\n');

    // Step 1: Derive a random address and private key
    const randomName = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    console.log(`📝 Step 1: Deriving address and key for random name: ${randomName}`);

    const derivedPrivateKey = derivePrivateKeyFromParameter(randomName);
    const derivedAddress = deriveKeyFromParameter(randomName);
    console.log(`✅ Derived address: ${derivedAddress}\n`);

    // Step 2: Check if subdomain already exists
    console.log(`📝 Step 2: Checking if subdomain exists: ${randomName}.${config.ensDomain}`);
    const exists = await justaNameSDKService.subnameExists(randomName);

    if (exists) {
      console.log(`⚠️  Subdomain already exists! Skipping creation.\n`);
    } else {
      console.log(`✅ Subdomain does not exist, proceeding with creation.\n`);
    }

    // Step 3: Register subdomain (if it doesn't exist)
    let createResult: any = null;

    if (!exists) {
      console.log(`📝 Step 3: Registering subdomain: ${randomName}.${config.ensDomain}`);
      console.log(`   Owner address: ${derivedAddress}`);

      createResult = await justaNameSDKService.addSubname(
        randomName,
        derivedPrivateKey,
        derivedAddress,
        {
          description: `Test subdomain created at ${new Date().toISOString()}`,
          'com.twitter': 'substream',
          'com.github': 'substream',
          url: 'https://www.substream.xyz',
        }
      );

      console.log('✅ Subdomain registered successfully!');
      console.log(`   Subname: ${randomName}.${config.ensDomain}`);
      console.log(`   Result:`, JSON.stringify(createResult, null, 2));
      console.log('');
    }

    // Step 4: Verify initial state from creation response
    if (createResult) {
      console.log('');
      console.log(`📝 Step 4: Verifying subdomain details from creation response...`);
      const initialDescription = createResult.records?.texts?.find((t: any) => t.key === 'description')?.value;
      console.log('✅ Subdomain details verified!');
      console.log(`   Initial description: ${initialDescription || 'N/A'}`);
      console.log('');
    }

    // Step 5: Update text record description to "123456789"
    console.log(`📝 Step 5: Updating subdomain description to "123456789"...`);
    const updateResult = await justaNameSDKService.updateSubname(
      randomName,
      derivedPrivateKey,
      {
        description: '123456789',
        'com.twitter': 'substream',
        'com.github': 'substream',
        url: 'https://www.substream.xyz',
      }
    );
    console.log('✅ Subdomain updated successfully!');
    console.log(`   Update result:`, JSON.stringify(updateResult, null, 2));
    console.log('');

    // Step 6: Verify the description changed from update response
    console.log('🔍 Step 6: Verifying description update from response...');
    const updatedDescription = updateResult.records?.texts?.find((t: any) => t.key === 'description')?.value;
    if (updatedDescription === '123456789') {
      console.log('✅ Description successfully updated to "123456789"!');
      console.log(`   Updated description: ${updatedDescription}`);
    } else {
      console.log(`❌ Description mismatch!`);
      console.log(`   Expected: "123456789"`);
      console.log(`   Got: "${updatedDescription || 'N/A'}"`);
    }

    console.log('\n✅ All tests completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testSubname()
  .then(() => {
    console.log('🎉 Test script finished successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test script crashed:', error);
    process.exit(1);
  });
