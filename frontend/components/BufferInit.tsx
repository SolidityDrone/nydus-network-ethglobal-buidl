'use client';

/**
 * Initialize Buffer polyfill synchronously before any @aztec packages load
 * This must run before any other client components that use @aztec
 * Uses require-like approach similar to dh-utils.ts but adapted for browser
 */
export function BufferInit() {
    // Initialize Buffer immediately when component mounts
    if (typeof window !== 'undefined') {
        // Use a synchronous approach if possible, otherwise async
        // We need Buffer to be available before any modules that depend on it load
        const initBuffer = async () => {
            if (!globalThis.Buffer) {
                try {
                    const { Buffer } = await import('buffer');
                    
                    // Set Buffer in all possible locations where @aztec/bb.js might look
                    globalThis.Buffer = Buffer;
                    // @ts-ignore
                    window.Buffer = Buffer;
                    
                    // Create a global reference if needed
                    if (typeof global !== 'undefined') {
                        // @ts-ignore
                        global.Buffer = Buffer;
                    }
                    
                    // Also set on window.global for compatibility
                    // @ts-ignore
                    (window as any).global = window;
                    // @ts-ignore
                    (window as any).global.Buffer = Buffer;
                    
                    // Polyfill BigInt methods if they don't exist
                    const { polyfillBufferBigIntMethods } = await import('@/lib/zk-address');
                    polyfillBufferBigIntMethods(Buffer);

                    // Verify Buffer has the required method
                    if (Buffer.prototype.writeBigUInt64BE) {
                        console.log('✅ Buffer polyfill initialized with writeBigUInt64BE');
                    } else {
                        console.warn('⚠️ Buffer loaded but writeBigUInt64BE method missing');
                    }
                } catch (error) {
                    console.error('❌ Failed to load Buffer polyfill:', error);
                }
            } else {
                console.log('✅ Buffer already available');
            }
        };
        
        // Start initialization immediately
        initBuffer();
    }

    return null;
}

