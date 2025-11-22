'use client'

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { BalanceEntry, PersonalCommitmentState } from '@/hooks/useNonceDiscovery'

interface AccountStateContextType {
  balanceEntries: BalanceEntry[]
  setBalanceEntries: (entries: BalanceEntry[]) => void
  personalCommitmentStates: Map<string, PersonalCommitmentState> // Key: `${nonce}-${tokenAddress}`
  setPersonalCommitmentState: (nonce: bigint, tokenAddress: bigint, state: PersonalCommitmentState) => void
  getPersonalCommitmentState: (nonce: bigint, tokenAddress: bigint) => PersonalCommitmentState | null
  currentNonce: bigint | null
  setCurrentNonce: (nonce: bigint | null) => void
  userKey: bigint | null
  setUserKey: (key: bigint | null) => void
  clearAccountState: () => void
  isSyncing: boolean
  setIsSyncing: (syncing: boolean) => void
}

const AccountStateContext = createContext<AccountStateContextType | undefined>(undefined)

export function AccountStateProvider({ children }: { children: ReactNode }) {
  const [balanceEntries, setBalanceEntriesState] = useState<BalanceEntry[]>([])
  const [personalCommitmentStates, setPersonalCommitmentStatesState] = useState<Map<string, PersonalCommitmentState>>(new Map())
  const [currentNonce, setCurrentNonceState] = useState<bigint | null>(null)
  const [userKey, setUserKeyState] = useState<bigint | null>(null)
  const [isSyncing, setIsSyncingState] = useState<boolean>(false)

  const setBalanceEntries = useCallback((entries: BalanceEntry[]) => {
    setBalanceEntriesState(entries)
  }, [])

  const setPersonalCommitmentState = useCallback((nonce: bigint, tokenAddress: bigint, state: PersonalCommitmentState) => {
    const key = `${nonce.toString()}-${tokenAddress.toString()}`
    setPersonalCommitmentStatesState((prev) => {
      const newMap = new Map(prev)
      newMap.set(key, state)
      return newMap
    })
  }, [])

  const getPersonalCommitmentState = useCallback((nonce: bigint, tokenAddress: bigint): PersonalCommitmentState | null => {
    const key = `${nonce.toString()}-${tokenAddress.toString()}`
    return personalCommitmentStates.get(key) || null
  }, [personalCommitmentStates])

  const setCurrentNonce = useCallback((nonce: bigint | null) => {
    setCurrentNonceState(nonce)
  }, [])

  const setUserKey = useCallback((key: bigint | null) => {
    setUserKeyState(key)
  }, [])

  const setIsSyncing = useCallback((syncing: boolean) => {
    setIsSyncingState(syncing)
  }, [])

  const clearAccountState = useCallback(() => {
    setBalanceEntriesState([])
    setPersonalCommitmentStatesState(new Map())
    setCurrentNonceState(null)
    setUserKeyState(null)
  }, [])

  return (
    <AccountStateContext.Provider
      value={{
        balanceEntries,
        setBalanceEntries: setBalanceEntries,
        personalCommitmentStates,
        setPersonalCommitmentState,
        getPersonalCommitmentState,
        currentNonce,
        setCurrentNonce,
        userKey,
        setUserKey,
        clearAccountState,
        isSyncing,
        setIsSyncing,
      }}
    >
      {children}
    </AccountStateContext.Provider>
  )
}

export function useAccountState() {
  const context = useContext(AccountStateContext)
  if (context === undefined) {
    throw new Error('useAccountState must be used within an AccountStateProvider')
  }
  return context
}


