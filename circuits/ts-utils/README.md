# TypeScript Utilities for Nydus Protocol

This directory contains TypeScript utilities for testing and verifying the Nydus protocol implementation.

## Diffie-Hellman Key Exchange Testing

This utility tests that the TypeScript implementation of Diffie-Hellman key exchange matches the Noir implementation.

### Setup

1. Install dependencies:
```bash
cd ts-utils
npm install
```

2. Run the Noir test to get the expected values:
```bash
cd ../nydus/main/nydus-send
nargo test --show-output test_dh_key_exchange_values
```

3. Copy the printed values from the Noir test output and update the constants in `test/dh-test.ts`

4. Run the TypeScript test:
```bash
npm test
```

### Files

- `src/dh-utils.ts` - TypeScript implementation of DH key exchange
- `test/dh-test.ts` - Test file that compares TS and Noir results
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration

### Usage

The test will:
1. Run the TypeScript DH key exchange with the same inputs as Noir
2. Compare the results with the expected values from Noir
3. Report whether the implementations match

### Expected Output

When the implementations match, you should see:
```
✅ TypeScript DH implementation matches Noir implementation!
```

When they don't match, you'll see:
```
❌ TypeScript DH implementation does not match Noir implementation
```

This helps ensure that the TypeScript utilities produce the same cryptographic results as the Noir circuits.
