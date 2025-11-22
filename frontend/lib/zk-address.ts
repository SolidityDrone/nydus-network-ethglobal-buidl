// Note: keccak256 no longer needed - we use signature bytes directly

const NYDUS_MESSAGE = "Welcome to the Nydus! \n\nThis signature on this message will be used to access the Nydus network. This signature is your access key to the network and needed for clientside proving. \nMake sure you don't pass this signature to someone else! \n\nCaution: Please make sure that the domain you are connected to is correct.";

/**
 * Generate public key from private key using Baby Jubjub curve
 * Same as in dh-utils.ts
 */
async function generatePublicKey(privateKey: bigint): Promise<{ x: bigint; y: bigint }> {
    // Dynamic import to avoid SSR issues
    const { babyjubjub } = await import('@noble/curves/misc.js');

    // Use BASE8 (also called Base8), which is the standard base point for Baby Jubjub
    // BASE8 = 8 * Generator
    // Coordinates from: https://eips.ethereum.org/EIPS/eip-2494
    const BASE8_X = BigInt('5299619240641551281634865583518297030282874472190772894086521144482721001553');
    const BASE8_Y = BigInt('16950150798460657717958625567821834550301663161624707787222815936182638968203');

    const BASE8 = babyjubjub.Point.fromAffine({ x: BASE8_X, y: BASE8_Y });
    const publicKeyPoint = BASE8.multiply(privateKey);

    return { x: publicKeyPoint.x, y: publicKeyPoint.y };
}

/**
 * Polyfill for Buffer.writeBigUInt64BE if it doesn't exist
 * This is needed because the buffer package v6.0.3 doesn't include BigInt write methods
 */
export function polyfillBufferBigIntMethods(Buffer: typeof globalThis.Buffer) {
    if (!Buffer.prototype.writeBigUInt64BE) {
        Buffer.prototype.writeBigUInt64BE = function (value: bigint, offset: number = 0): number {
            // Write bigint as 64-bit big-endian using DataView
            const view = new DataView(new ArrayBuffer(8));
            view.setBigUint64(0, value, false); // false = big-endian
            const bytes = new Uint8Array(view.buffer);
            // Copy bytes into this Buffer
            for (let i = 0; i < 8; i++) {
                this[offset + i] = bytes[i];
            }
            return offset + 8;
        };
    }

    if (!Buffer.prototype.writeBigUInt64LE) {
        Buffer.prototype.writeBigUInt64LE = function (value: bigint, offset: number = 0): number {
            // Write bigint as 64-bit little-endian using DataView
            const view = new DataView(new ArrayBuffer(8));
            view.setBigUint64(0, value, true); // true = little-endian
            const bytes = new Uint8Array(view.buffer);
            // Copy bytes into this Buffer
            for (let i = 0; i < 8; i++) {
                this[offset + i] = bytes[i];
            }
            return offset + 8;
        };
    }

    if (!Buffer.prototype.readBigUInt64BE) {
        Buffer.prototype.readBigUInt64BE = function (offset: number = 0): bigint {
            // Create a view over this Buffer's underlying buffer
            const view = new DataView(
                this.buffer || this,
                this.byteOffset !== undefined ? this.byteOffset + offset : offset,
                8
            );
            return view.getBigUint64(0, false); // false = big-endian
        };
    }

    if (!Buffer.prototype.readBigUInt64LE) {
        Buffer.prototype.readBigUInt64LE = function (offset: number = 0): bigint {
            // Create a view over this Buffer's underlying buffer
            const view = new DataView(
                this.buffer || this,
                this.byteOffset !== undefined ? this.byteOffset + offset : offset,
                8
            );
            return view.getBigUint64(0, true); // true = little-endian
        };
    }
}

/**
 * Initialize Buffer polyfill if needed
 * Waits for Buffer to be available with retries
 */
export async function ensureBufferPolyfill(maxRetries = 20, delay = 200): Promise<void> {
    if (typeof window === 'undefined') {
        return; // Server-side, skip
    }

    // If Buffer is already available and has the required methods, return immediately
    if (globalThis.Buffer &&
        typeof globalThis.Buffer.from === 'function' &&
        typeof globalThis.Buffer.prototype.writeBigUInt64BE === 'function') {
        return;
    }

    // Try to load Buffer immediately
    try {
        const { Buffer } = await import('buffer');
        globalThis.Buffer = Buffer;
        // @ts-ignore
        window.Buffer = Buffer;
        if (typeof global !== 'undefined') {
            // @ts-ignore
            global.Buffer = Buffer;
        }

        // Polyfill BigInt methods if they don't exist
        polyfillBufferBigIntMethods(Buffer);

        // Verify it has the required methods
        if (typeof Buffer.from === 'function' &&
            typeof Buffer.prototype.writeBigUInt64BE === 'function') {
            return;
        }
    } catch (error) {
        console.error('Failed to import buffer:', error);
    }

    // Wait and retry if BufferInit component is still loading it
    for (let i = 0; i < maxRetries; i++) {
        if (globalThis.Buffer &&
            typeof globalThis.Buffer.from === 'function' &&
            typeof globalThis.Buffer.prototype.writeBigUInt64BE === 'function') {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Final attempt to load
    if (!globalThis.Buffer ||
        typeof globalThis.Buffer.from !== 'function' ||
        typeof globalThis.Buffer.prototype.writeBigUInt64BE !== 'function') {
        try {
            const { Buffer } = await import('buffer');
            globalThis.Buffer = Buffer;
            // @ts-ignore
            window.Buffer = Buffer;
            if (typeof global !== 'undefined') {
                // @ts-ignore
                global.Buffer = Buffer;
            }
            // Polyfill BigInt methods if they don't exist
            polyfillBufferBigIntMethods(Buffer);

            if (typeof Buffer.from !== 'function' ||
                typeof Buffer.prototype.writeBigUInt64BE !== 'function') {
                throw new Error('Buffer polyfill loaded but missing required methods (writeBigUInt64BE)');
            }
        } catch (error) {
            throw new Error('Failed to load Buffer polyfill: ' + (error as Error).message);
        }
    }
}

/**
 * Compute zkAddress from an Ethereum signature
 * 
 * Flow:
 * 1. Split 65-byte Ethereum signature into chunks: 31, 31, 3 bytes
 * 2. Compute Poseidon2 hash of chunks → This is the private key (numeric)
 * 3. Derive Baby Jubjub public key from private key using BASE8 generator
 * 4. Format as zk+{pubkey_x}{pubkey_y} (concatenated hex coordinates)
 * 
 * The public key is derived on Baby Jubjub (BJJ) using the Poseidon2 hash
 * of the Ethereum signature chunks as the private key.
 * 
 * Uses dynamic import to avoid server-side execution issues
 */
export async function computeZkAddress(signature: string): Promise<string> {
    try {
        // Ensure Buffer is available before importing @aztec packages
        // This is critical because @aztec/bb.js uses Buffer during module evaluation
        await ensureBufferPolyfill();

        // Double-check Buffer is available and has the required method
        if (!globalThis.Buffer || typeof globalThis.Buffer.prototype.writeBigUInt64BE !== 'function') {
            throw new Error('Buffer polyfill is not properly initialized. writeBigUInt64BE method is missing.');
        }

        // Ensure Buffer is available in ALL possible scopes where @aztec/bb.js might look
        // This mimics how require() works in Node.js where Buffer is globally available
        if (typeof window !== 'undefined') {
            // @ts-ignore
            window.Buffer = globalThis.Buffer;
            // @ts-ignore
            (window as any).global = window;
            // @ts-ignore
            (window as any).global.Buffer = globalThis.Buffer;
        }
        if (typeof global !== 'undefined') {
            // @ts-ignore
            global.Buffer = globalThis.Buffer;
        }

        // Also check if webpack ProvidePlugin made Buffer available (for Turbopack compatibility)
        // @ts-ignore
        if (typeof Buffer !== 'undefined' && Buffer !== globalThis.Buffer) {
            // @ts-ignore
            globalThis.Buffer = Buffer;
        }

        // Polyfill BigInt methods if they don't exist (buffer v6.0.3 doesn't have them)
        polyfillBufferBigIntMethods(globalThis.Buffer);

        // Create a test buffer to verify writeBigUInt64BE works before importing
        const testBuf = globalThis.Buffer.alloc(8);

        // Check if the method exists after polyfill
        if (typeof testBuf.writeBigUInt64BE !== 'function') {
            throw new Error(
                `Buffer.writeBigUInt64BE is not available even after polyfill. ` +
                `This method is required by @aztec/bb.js`
            );
        }

        try {
            testBuf.writeBigUInt64BE(BigInt(1), 0);
        } catch (e) {
            throw new Error(
                `Buffer.writeBigUInt64BE exists but threw an error: ${(e as Error).message}. ` +
                `Buffer polyfill may be incomplete or incompatible.`
            );
        }

        // Now import @aztec/foundation/crypto
        // This uses the same path as dh-utils.ts but with dynamic import for browser
        // dh-utils.ts: const { poseidon2Hash } = require('@aztec/foundation/crypto');
        const cryptoModule = await import('@aztec/foundation/crypto');
        const { poseidon2Hash } = cryptoModule;

        // Convert signature hex string to Buffer (remove 0x prefix if present)
        const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
        const sigBuffer = globalThis.Buffer.from(sigHex, 'hex');

        // Verify signature is 65 bytes
        if (sigBuffer.length !== 65) {
            throw new Error(`Signature must be 65 bytes, got ${sigBuffer.length}`);
        }

        // Split signature into 31, 31, 3 bytes
        const chunk1 = sigBuffer.slice(0, 31);  // First 31 bytes
        const chunk2 = sigBuffer.slice(31, 62); // Next 31 bytes
        const chunk3 = sigBuffer.slice(62, 65); // Last 3 bytes

        // Convert each chunk to bigint (big-endian)
        // Each chunk fits in the BN254 field (31 bytes = 248 bits < 254 bits)
        const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
        const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
        const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));

        // Compute poseidon hash of the three chunks
        // This poseidon hash is the private key (numeric value, not converted to hex)
        const poseidonHash = await poseidon2Hash([chunk1BigInt, chunk2BigInt, chunk3BigInt]);

        // Convert poseidon2 result to bigint (keep as numeric, don't convert to hex)
        let privateKey: bigint;
        if (typeof poseidonHash === 'bigint') {
            privateKey = poseidonHash;
        } else if ('toBigInt' in poseidonHash && typeof (poseidonHash as any).toBigInt === 'function') {
            privateKey = (poseidonHash as any).toBigInt();
        } else if ('value' in poseidonHash) {
            privateKey = BigInt((poseidonHash as any).value);
        } else {
            privateKey = BigInt((poseidonHash as any).toString());
        }

        // Derive public key from private key using Baby Jubjub (like in dh-utils.ts)
        const publicKey = await generatePublicKey(privateKey);

        // Format public key as hex string: concatenate x and y coordinates
        // Remove 0x prefix if present and pad to ensure consistent length
        const pubKeyXHex = publicKey.x.toString(16).padStart(64, '0');
        const pubKeyYHex = publicKey.y.toString(16).padStart(64, '0');
        const pubKeyHex = pubKeyXHex + pubKeyYHex;

        // Return as hex string (will be formatted as zk+{pubkey} in useZkAddress hook)
        return pubKeyHex;
    } catch (error) {
        console.error('Error computing zkAddress:', error);
        throw error;
    }
}

/**
 * Sign message and compute zkAddress
 */
export async function signAndComputeZkAddress(
    signMessage: (message: string) => Promise<string>
): Promise<string> {
    const signature = await signMessage(NYDUS_MESSAGE);
    return await computeZkAddress(signature);
}

/**
 * Parse zkAddress back to x and y coordinates
 * 
 * Format: zk{pubkey_x}{pubkey_y}
 * - pubkey_x: 64 hex characters (256 bits)
 * - pubkey_y: 64 hex characters (256 bits)
 * 
 * @param zkAddress - The zkAddress string (with or without "zk" prefix)
 * @returns Object with x and y coordinates as bigints
 */
export function parseZkAddress(zkAddress: string): { x: bigint; y: bigint } {
    // Remove "zk" prefix if present
    let pubKeyHex = zkAddress.startsWith('zk') ? zkAddress.slice(2) : zkAddress;
    
    // Remove "0x" prefix if present
    pubKeyHex = pubKeyHex.startsWith('0x') ? pubKeyHex.slice(2) : pubKeyHex;
    
    // Each coordinate is 64 hex characters (256 bits)
    // Total should be 128 hex characters
    if (pubKeyHex.length !== 128) {
        throw new Error(`Invalid zkAddress format: expected 128 hex characters (64 for x + 64 for y), got ${pubKeyHex.length}`);
    }
    
    // Extract x and y coordinates
    const pubKeyXHex = pubKeyHex.slice(0, 64);
    const pubKeyYHex = pubKeyHex.slice(64, 128);
    
    // Convert to bigints
    const x = BigInt('0x' + pubKeyXHex);
    const y = BigInt('0x' + pubKeyYHex);
    
    return { x, y };
}

/**
 * Construct zkAddress from x and y coordinates
 * 
 * @param x - X coordinate as bigint or string
 * @param y - Y coordinate as bigint or string
 * @returns zkAddress string in format zk{pubkey_x}{pubkey_y}
 */
export function constructZkAddress(x: bigint | string, y: bigint | string): string {
    const xBigInt = typeof x === 'string' ? BigInt(x) : x;
    const yBigInt = typeof y === 'string' ? BigInt(y) : y;
    
    // Convert to hex and pad to 64 characters each
    const pubKeyXHex = xBigInt.toString(16).padStart(64, '0');
    const pubKeyYHex = yBigInt.toString(16).padStart(64, '0');
    
    // Concatenate and add "zk" prefix
    return 'zk' + pubKeyXHex + pubKeyYHex;
}

export { NYDUS_MESSAGE };

