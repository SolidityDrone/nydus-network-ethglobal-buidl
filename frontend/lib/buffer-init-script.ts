/**
 * This script must be executed before any @aztec packages are imported
 * It initializes Buffer globally for browser compatibility
 */

if (typeof window !== 'undefined' && !globalThis.Buffer) {
    // Use require-like synchronous loading if possible
    // This is a fallback for when dynamic import isn't fast enough
    try {
        // Attempt to get Buffer from webpack's ProvidePlugin if available
        if (typeof Buffer !== 'undefined') {
            globalThis.Buffer = Buffer;
            // @ts-ignore
            window.Buffer = Buffer;
        }
    } catch (e) {
        // If not available, we'll need to load it asynchronously
        // but this should be handled by BufferInit component
    }
}

export {};

