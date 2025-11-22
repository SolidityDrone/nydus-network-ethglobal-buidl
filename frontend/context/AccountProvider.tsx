'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { computeZkAddress } from '@/lib/zk-address'

// Account model interface - can be extended based on your needs
interface AccountData {
    publicKeyX?: string
    publicKeyY?: string
    signature?: string
    messageHash?: string
    isInitialized?: boolean
    zkAddress?: string // Poseidon hash of the signed message
    // Add other account-related fields as needed
    [key: string]: any
}

interface AccountContextType {
    account: AccountData | null
    setAccount: (account: AccountData | null) => void
    updateAccount: (updates: Partial<AccountData>) => void
    clearAccount: () => void
    setZkAddress: (zkAddress: string, signature?: string) => void
}

const AccountContext = createContext<AccountContextType | undefined>(undefined)

const SESSION_STORAGE_KEY = 'nydus_account_session'

export function AccountProvider({ children }: { children: ReactNode }) {
    const [account, setAccountState] = useState<AccountData | null>(null)
    const [isRestoring, setIsRestoring] = useState(true)

    // Load account from sessionStorage on mount
    useEffect(() => {
        const restoreSession = async () => {
            try {
                const saved = sessionStorage.getItem(SESSION_STORAGE_KEY)
                if (saved) {
                    const savedAccount = JSON.parse(saved) as AccountData
                    if (savedAccount.signature && savedAccount.zkAddress) {
                        console.log('[AccountProvider] Restoring session from sessionStorage...')
                        
                        // Ensure Buffer polyfill is initialized before using signature
                        const { ensureBufferPolyfill } = await import('@/lib/zk-address')
                        await ensureBufferPolyfill()
                        
                        // Verify zkAddress matches signature (safety check)
                        try {
                            const computedZkAddr = await computeZkAddress(savedAccount.signature)
                            if (computedZkAddr === savedAccount.zkAddress) {
                                setAccountState(savedAccount)
                                console.log('[AccountProvider] Session restored successfully')
                            } else {
                                console.warn('[AccountProvider] Signature mismatch, clearing session')
                                sessionStorage.removeItem(SESSION_STORAGE_KEY)
                            }
                        } catch (error) {
                            console.error('[AccountProvider] Error verifying signature, clearing session:', error)
                            sessionStorage.removeItem(SESSION_STORAGE_KEY)
                        }
                    } else {
                        console.log('[AccountProvider] Saved session missing signature or zkAddress, clearing')
                        sessionStorage.removeItem(SESSION_STORAGE_KEY)
                    }
                }
            } catch (error) {
                console.error('[AccountProvider] Error restoring session:', error)
                try {
                    sessionStorage.removeItem(SESSION_STORAGE_KEY)
                } catch (e) {
                    // Ignore errors when clearing
                }
            } finally {
                setIsRestoring(false)
            }
        }

        restoreSession()
    }, [])

    const setAccount = useCallback((newAccount: AccountData | null) => {
        setAccountState(newAccount)
        // Save to sessionStorage
        if (newAccount?.signature && newAccount?.zkAddress) {
            try {
                sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newAccount))
            } catch (error) {
                console.error('[AccountProvider] Error saving to sessionStorage:', error)
            }
        } else {
            // Clear sessionStorage if account is cleared
            try {
                sessionStorage.removeItem(SESSION_STORAGE_KEY)
            } catch (error) {
                console.error('[AccountProvider] Error clearing sessionStorage:', error)
            }
        }
    }, [])

    const updateAccount = useCallback((updates: Partial<AccountData>) => {
        setAccountState((prev) => {
            const updated = prev ? { ...prev, ...updates } : { ...updates } as AccountData
            // Save to sessionStorage if signature and zkAddress are present
            if (updated.signature && updated.zkAddress) {
                try {
                    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated))
                } catch (error) {
                    console.error('[AccountProvider] Error saving to sessionStorage:', error)
                }
            }
            return updated
        })
    }, [])

    const clearAccount = useCallback(() => {
        setAccountState(null)
        try {
            sessionStorage.removeItem(SESSION_STORAGE_KEY)
        } catch (error) {
            console.error('[AccountProvider] Error clearing sessionStorage:', error)
        }
    }, [])

    const setZkAddress = useCallback((zkAddress: string, signature?: string) => {
        setAccountState((prev) => {
            const updated = {
                ...prev,
                zkAddress,
                signature,
                isInitialized: true
            } as AccountData
            
            // Save to sessionStorage
            if (signature && zkAddress) {
                try {
                    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated))
                    console.log('[AccountProvider] Saved account to sessionStorage')
                } catch (error) {
                    console.error('[AccountProvider] Error saving to sessionStorage:', error)
                }
            }
            
            return updated
        })
    }, [])

    // Don't render children until session restoration is complete
    // This prevents issues with components trying to use account before it's restored
    if (isRestoring) {
        return null // or a loading spinner
    }

    return (
        <AccountContext.Provider
            value={{
                account,
                setAccount,
                updateAccount,
                clearAccount,
                setZkAddress,
            }}
        >
            {children}
        </AccountContext.Provider>
    )
}

export function useAccount() {
    const context = useContext(AccountContext)
    if (context === undefined) {
        throw new Error('useAccount must be used within an AccountProvider')
    }
    return context
}

/**
 * Hook to get the zkAddress formatted as "zk{pubkey}"
 * The zkAddress stored is the public key hex (derived from poseidon hash private key)
 */
export function useZkAddress(): string | null {
    const { account } = useAccount()
    
    if (!account?.zkAddress) {
        return null
    }
    
    // zkAddress is already the public key hex (no 0x prefix)
    // Format as "zk{pubkey}"
    return `zk${account.zkAddress}`
}

