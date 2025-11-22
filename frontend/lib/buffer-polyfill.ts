/**
 * Initialize Buffer polyfill for browser
 * This must be called before any @aztec packages are imported
 */
export function initBufferPolyfill() {
    if (typeof window !== 'undefined' && !globalThis.Buffer) {
        // Dynamic import to avoid SSR issues
        import('buffer').then(({ Buffer }) => {
            globalThis.Buffer = Buffer;
            // @ts-ignore
            window.Buffer = Buffer;
        });
    }
}

