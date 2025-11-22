// Simple wrapper around UltraHonkBackend with IndexedDB caching
import { UltraHonkBackend } from '@aztec/bb.js';

// Define types locally since they're not exported from @aztec/bb.js
type BackendOptions = { threads: number };
type CircuitOptions = { recursive: boolean };

// IndexedDB cache for backend instances
const DB_NAME = 'BackendCache';
const DB_VERSION = 1;
const STORE_NAME = 'backend_instances';

interface CachedBackend {
    key: string;
    acirBytecode: string;
    backendOptions: BackendOptions;
    circuitOptions: CircuitOptions;
    timestamp: number;
}

class BackendCache {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;

    private async initDB(): Promise<void> {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };
        });
    }

    private async ensureDB(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.initDB();
        }
        return this.initPromise;
    }

    async getCachedBackend(key: string): Promise<CachedBackend | null> {
        try {
            await this.ensureDB();
            if (!this.db) return null;

            return new Promise((resolve, reject) => {
                const transaction = this.db!.transaction([STORE_NAME], 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(key);

                request.onsuccess = () => {
                    const result = request.result as CachedBackend | undefined;
                    if (result) {
                        // Check if cache is still valid (24 hours)
                        const now = Date.now();
                        const cacheAge = now - result.timestamp;
                        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

                        if (cacheAge < maxAge) {
                            console.log(`✅ Found cached backend (age: ${Math.round(cacheAge / 1000)}s)`);
                            resolve(result);
                        } else {
                            console.log('⚠️ Cached backend expired, will recreate');
                            resolve(null);
                        }
                    } else {
                        console.log('❌ No cached backend found');
                        resolve(null);
                    }
                };

                request.onerror = () => {
                    console.warn('Failed to read from backend cache:', request.error);
                    resolve(null);
                };
            });
        } catch (error) {
            console.warn('Backend cache error:', error);
            return null;
        }
    }

    async setCachedBackend(key: string, acirBytecode: string, backendOptions: BackendOptions, circuitOptions: CircuitOptions): Promise<void> {
        try {
            await this.ensureDB();
            if (!this.db) return;

            const cachedBackend: CachedBackend = {
                key,
                acirBytecode,
                backendOptions,
                circuitOptions,
                timestamp: Date.now()
            };

            return new Promise((resolve, reject) => {
                const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put(cachedBackend);

                request.onsuccess = () => {
                    console.log('✅ Backend cached in IndexedDB');
                    resolve();
                };

                request.onerror = () => {
                    console.warn('Failed to cache backend:', request.error);
                    resolve(); // Don't fail the whole operation
                };
            });
        } catch (error) {
            console.warn('Backend cache error:', error);
        }
    }

    async clearCache(): Promise<void> {
        try {
            await this.ensureDB();
            if (!this.db) return;

            return new Promise((resolve, reject) => {
                const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.clear();

                request.onsuccess = () => {
                    console.log('✅ Backend cache cleared from IndexedDB');
                    resolve();
                };

                request.onerror = () => {
                    console.warn('Failed to clear backend cache:', request.error);
                    resolve();
                };
            });
        } catch (error) {
            console.warn('Backend cache error:', error);
        }
    }

    async getCacheInfo(): Promise<{ size: number; entries: string[] }> {
        try {
            await this.ensureDB();
            if (!this.db) return { size: 0, entries: [] };

            return new Promise((resolve, reject) => {
                const transaction = this.db!.transaction([STORE_NAME], 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.getAll();

                request.onsuccess = () => {
                    const entries = request.result as CachedBackend[];
                    resolve({
                        size: entries.length,
                        entries: entries.map(e => e.key)
                    });
                };

                request.onerror = () => {
                    console.warn('Failed to get cache info:', request.error);
                    resolve({ size: 0, entries: [] });
                };
            });
        } catch (error) {
            console.warn('Backend cache error:', error);
            return { size: 0, entries: [] };
        }
    }
}

// Global cache instance
const backendCache = new BackendCache();

export class CachedUltraHonkBackend extends UltraHonkBackend {
    private cacheKey: string;
    private acirBytecode: string;

    constructor(
        acirBytecode: string,
        protected backendOptions: BackendOptions = { threads: 1 },
        protected circuitOptions: CircuitOptions = { recursive: false },
    ) {
        super(acirBytecode, backendOptions, circuitOptions);

        // Store the bytecode for our own use
        this.acirBytecode = acirBytecode;

        // Create a cache key based on bytecode and options
        this.cacheKey = this.createCacheKey(acirBytecode, backendOptions);
    }

    private createCacheKey(bytecode: string, options: BackendOptions): string {
        const optionsStr = JSON.stringify(options);
        return `backend_${bytecode.slice(0, 20)}_${optionsStr}`;
    }

    // Override generateProof to use cached backend
    async generateProof(compressedWitness: Uint8Array, options?: any): Promise<any> {
        // Check if we have a cached backend in IndexedDB
        const cachedBackendData = await backendCache.getCachedBackend(this.cacheKey);

        if (cachedBackendData) {
            console.log('✅ Using cached backend from IndexedDB');
            // Create a new backend instance with cached data
            const cachedBackend = new UltraHonkBackend(
                cachedBackendData.acirBytecode,
                cachedBackendData.backendOptions,
                cachedBackendData.circuitOptions
            );
            return cachedBackend.generateProof(compressedWitness, options);
        }

        console.log('🔄 Creating new backend instance (first time)');

        // Create new backend
        const newBackend = new UltraHonkBackend(
            this.acirBytecode,
            this.backendOptions,
            this.circuitOptions
        );

        // Generate proof with new backend
        const result = await newBackend.generateProof(compressedWitness, options);

        // Cache the backend configuration in IndexedDB for future use
        await backendCache.setCachedBackend(
            this.cacheKey,
            this.acirBytecode,
            this.backendOptions,
            this.circuitOptions
        );
        console.log('✅ Backend configuration cached in IndexedDB');

        return result;
    }

    // Override verifyProof to use cached backend
    async verifyProof(proofData: any): Promise<boolean> {
        const cachedBackendData = await backendCache.getCachedBackend(this.cacheKey);

        if (cachedBackendData) {
            const cachedBackend = new UltraHonkBackend(
                cachedBackendData.acirBytecode,
                cachedBackendData.backendOptions,
                cachedBackendData.circuitOptions
            );
            return cachedBackend.verifyProof(proofData);
        }

        // If no cached backend, create new one
        const newBackend = new UltraHonkBackend(
            this.acirBytecode,
            this.backendOptions,
            this.circuitOptions
        );

        const result = await newBackend.verifyProof(proofData);
        await backendCache.setCachedBackend(
            this.cacheKey,
            this.acirBytecode,
            this.backendOptions,
            this.circuitOptions
        );

        return result;
    }


    // Static method to clear the cache
    static async clearCache(): Promise<void> {
        await backendCache.clearCache();
        console.log('✅ Backend cache cleared from IndexedDB');
    }

    // Static method to get cache info
    static async getCacheInfo(): Promise<{ size: number; keys: string[] }> {
        const info = await backendCache.getCacheInfo();
        return {
            size: info.size,
            keys: info.entries
        };
    }
}
