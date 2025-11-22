'use client';

import { useState, createContext, useContext, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import AccountModal from './AccountModal';

interface AccountModalContextType {
  isOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const AccountModalContext = createContext<AccountModalContextType | undefined>(undefined);

export function AccountModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openModal = () => setIsOpen(true);
  const closeModal = () => {
    // Use setTimeout to allow DOM update even during heavy computations
    // This gives the browser a chance to render the close before continuing
    setTimeout(() => {
      flushSync(() => {
        setIsOpen(false);
      });
    }, 0);
  };

  return (
    <AccountModalContext.Provider value={{ isOpen, openModal, closeModal }}>
      {children}
      <AccountModal isOpen={isOpen} onClose={closeModal} />
    </AccountModalContext.Provider>
  );
}

export function useAccountModal() {
  const context = useContext(AccountModalContext);
  if (context === undefined) {
    throw new Error('useAccountModal must be used within AccountModalProvider');
  }
  return context;
}

