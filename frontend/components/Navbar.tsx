'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAccount as useAccountContext, useZkAddress } from '@/context/AccountProvider';
import { useAccount as useWagmiAccount, useSignMessage } from 'wagmi';
import { AppKitButton } from '@reown/appkit/react';
import React, { useState, useCallback } from 'react';
import { computeZkAddress, NYDUS_MESSAGE } from '@/lib/zk-address';
import { useAccountModal } from './AccountModalProvider';
import { useAccountState } from '@/context/AccountStateProvider';
import { loadAccountDataOnSign } from '@/lib/loadAccountDataOnSign';
import { Button } from './ui/button';
import ZkAddressModal from './ZkAddressModal';

const allNavigation = [
    { name: 'Home', href: '/', icon: '🏠' },
    { name: 'Initialize', href: '/initialize', icon: '🔐' },
    { name: 'Deposit', href: '/deposit', icon: '⬇️' },
    { name: 'Send', href: '/send', icon: '📤' },
    { name: 'Withdraw', href: '/withdraw', icon: '⬆️' },
    { name: 'Absorb', href: '/absorb', icon: '💫' },
    { name: 'History', href: '/history', icon: '📜' },
];

export default function Navbar() {
    const pathname = usePathname();
    const { setZkAddress, clearAccount } = useAccountContext();
    const zkAddress = useZkAddress();
    const { address, isConnected } = useWagmiAccount();
    const { signMessageAsync, isPending: isSigning } = useSignMessage();
    const [isComputing, setIsComputing] = useState(false);
    const [bufferReady, setBufferReady] = useState(false);
    const { openModal } = useAccountModal();
    const { currentNonce, setCurrentNonce, setBalanceEntries, setUserKey, isSyncing, setPersonalCommitmentState, getPersonalCommitmentState, clearAccountState } = useAccountState();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [zkAddressModalOpen, setZkAddressModalOpen] = useState(false);

    // Filter navigation based on nonce
    const navigation = React.useMemo(() => {
        if (currentNonce === null || currentNonce === BigInt(0)) {
            return allNavigation.filter(item => item.name === 'Home' || item.name === 'Initialize');
        } else {
            return allNavigation.filter(item => item.name !== 'Initialize');
        }
    }, [currentNonce]);

    // Pre-initialize Buffer when component mounts
    React.useEffect(() => {
        if (typeof window !== 'undefined') {
            const initBuffer = async () => {
                if (!globalThis.Buffer) {
                    try {
                        const { Buffer } = await import('buffer');
                        globalThis.Buffer = Buffer;
                        // @ts-ignore
                        window.Buffer = Buffer;
                        if (typeof global !== 'undefined') {
                            // @ts-ignore
                            global.Buffer = Buffer;
                        }
                    } catch (error) {
                        console.error('❌ Failed to load Buffer polyfill:', error);
                        return;
                    }
                }

                const { polyfillBufferBigIntMethods } = await import('@/lib/zk-address');
                polyfillBufferBigIntMethods(globalThis.Buffer);

                if (globalThis.Buffer &&
                    typeof globalThis.Buffer.prototype.writeBigUInt64BE === 'function') {
                    setBufferReady(true);
                }
            };

            initBuffer();
        }
    }, []);

    const handleSignAndCompute = async () => {
        if (!isConnected || !address || !signMessageAsync) return;

        let retries = 0;
        while (!bufferReady && retries < 10) {
            await new Promise(resolve => setTimeout(resolve, 300));
            if (globalThis.Buffer && typeof globalThis.Buffer.prototype.writeBigUInt64BE === 'function') {
                setBufferReady(true);
                break;
            }
            retries++;
        }

        try {
            setIsComputing(true);
            const signature = await signMessageAsync({ message: NYDUS_MESSAGE });
            const zkAddr = await computeZkAddress(signature);
            setZkAddress(zkAddr, signature);

            // Load all saved account data from IndexedDB
            await loadAccountDataOnSign(zkAddr, {
                setCurrentNonce,
                setBalanceEntries,
                setUserKey,
            });
        } catch (error) {
            console.error('Error signing message:', error);
        } finally {
            setIsComputing(false);
        }
    };

    const handleCopy = async () => {
        if (!zkAddress) return;
        try {
            await navigator.clipboard.writeText(zkAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const handleLogout = useCallback(() => {
        // Clear account data from context
        clearAccount();
        clearAccountState();
        console.log('✅ Logged out - zkAddress cleared');
    }, [clearAccount, clearAccountState]);

    return (
        <>
            <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-[#333333] bg-black">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        {/* Logo/Home Link */}
                        <Link
                            href="/"
                            className="flex items-center space-x-2 hover:opacity-80 transition-opacity"
                        >
                            <Image
                                src="/nydus_logo.png"
                                alt="Nydus Logo"
                                width={120}
                                height={32}
                                className="h-8 w-auto"
                                priority
                            />
                        </Link>

                        {/* Desktop Navigation */}
                        <div className="hidden md:flex items-center space-x-1">
                            {navigation.map((item) => {
                                const isActive = pathname === item.href;
                                return (
                                    <Link
                                        key={item.name}
                                        href={item.href}
                                        className={`
                                        px-4 py-2 border border-[#333333] text-sm font-mono font-bold uppercase transition-all
                                        ${isActive
                                                ? 'bg-[rgba(182,255,62,1)] text-black border-[rgba(182,255,62,1)]'
                                                : 'text-white hover:bg-[#1a1a1a] hover:border-[rgba(182,255,62,0.5)]'
                                            }
                                    `}
                                    >
                                        {item.name}
                                    </Link>
                                );
                            })}
                        </div>

                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="md:hidden p-2 text-white hover:bg-[#1a1a1a] border border-[#333333] transition-colors font-mono"
                            aria-label="Toggle menu"
                        >
                            {mobileMenuOpen ? '[X]' : '[≡]'}
                        </button>

                        {/* Wallet Connect & Account Status */}
                        <div className="hidden md:flex items-center space-x-3">
                            {!isConnected ? (
                                <AppKitButton />
                            ) : isConnected && address && (
                                <div className="flex items-center space-x-3">
                                    <Button
                                        onClick={openModal}
                                        variant="outline"
                                        size="sm"
                                        className={`border-[#333333] hover:border-[rgba(182,255,62,1)] hover:text-[rgba(182,255,62,1)] transition-colors ${isSyncing ? "animate-pulse" : ""}`}
                                    >
                                        {isSyncing ? "SYNCING..." : "ACCOUNT"}
                                    </Button>

                                    {zkAddress ? (
                                        <div className="flex items-center space-x-2">
                                            <button
                                                onClick={() => setZkAddressModalOpen(true)}
                                                className="flex items-center space-x-2 px-3 py-1.5 border border-[#333333] bg-[#0a0a0a] hover:border-[rgba(182,255,62,1)] transition-colors"
                                            >
                                                <span className="text-sm text-white font-mono">
                                                    {zkAddress.slice(0, 6)}...{zkAddress.slice(-4)}
                                                </span>
                                            </button>
                                            <Button
                                                onClick={handleLogout}
                                                variant="outline"
                                                size="sm"
                                                className="font-mono text-xs border-[#333333] hover:border-[rgba(182,255,62,1)] hover:text-[rgba(182,255,62,1)] transition-colors"
                                            >
                                                LOGOUT
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            onClick={handleSignAndCompute}
                                            disabled={isSigning || isComputing}
                                            size="sm"
                                            className="bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSigning || isComputing ? 'Signing...' : 'Sign for ZK'}
                                        </Button>
                                    )}
                                </div>
                            )}

                        </div>
                    </div>

                    {/* Mobile Menu */}
                    {mobileMenuOpen && (
                        <div className="md:hidden py-4 border-t border-gray-800/50">
                            <div className="flex flex-col space-y-2">
                                {navigation.map((item) => {
                                    const isActive = pathname === item.href;
                                    return (
                                        <Link
                                            key={item.name}
                                            href={item.href}
                                            onClick={() => setMobileMenuOpen(false)}
                                            className={`
                                            px-4 py-3 border border-[#333333] text-sm font-mono font-bold uppercase transition-all
                                            ${isActive
                                                    ? 'bg-[rgba(182,255,62,1)] text-black border-[rgba(182,255,62,1)]'
                                                    : 'text-white hover:bg-[#1a1a1a] hover:border-[rgba(182,255,62,0.5)]'
                                                }
                                        `}
                                        >
                                            {item.name}
                                        </Link>
                                    );
                                })}
                            </div>

                            {/* Wallet Connect & Account Status for Mobile */}
                            <div className="mt-4 pt-4 border-t border-[#333333] space-y-2">
                                {!isConnected ? (
                                    <div className="w-full">
                                        <AppKitButton />
                                    </div>
                                ) : isConnected && address && (
                                    <>
                                        <Button
                                            onClick={() => {
                                                openModal();
                                                setMobileMenuOpen(false);
                                            }}
                                            variant="outline"
                                            className={`w-full border-[#333333] hover:border-[rgba(182,255,62,1)] hover:text-[rgba(182,255,62,1)] transition-colors ${isSyncing ? "animate-pulse" : ""}`}
                                        >
                                            {isSyncing ? "SYNCING..." : "ACCOUNT"}
                                        </Button>
                                        {zkAddress ? (
                                            <div className="space-y-2">
                                                <button
                                                    onClick={() => {
                                                        setZkAddressModalOpen(true);
                                                        setMobileMenuOpen(false);
                                                    }}
                                                    className="w-full flex items-center justify-between px-4 py-2 border border-[#333333] bg-[#0a0a0a] hover:border-[rgba(182,255,62,1)] transition-colors"
                                                >
                                                    <span className="text-sm text-white font-mono">
                                                        {zkAddress.slice(0, 8)}...{zkAddress.slice(-6)}
                                                    </span>
                                                </button>
                                                <Button
                                                    onClick={handleLogout}
                                                    variant="outline"
                                                    className="w-full font-mono text-xs border-[#333333] hover:border-[rgba(182,255,62,1)] hover:text-[rgba(182,255,62,1)] transition-colors"
                                                >
                                                    LOGOUT
                                                </Button>
                                            </div>
                                        ) : (
                                            <Button
                                                onClick={handleSignAndCompute}
                                                disabled={isSigning || isComputing}
                                                className="w-full bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isSigning || isComputing ? 'Signing...' : 'Sign for ZK'}
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </nav>
            {zkAddress && (
                <ZkAddressModal
                    isOpen={zkAddressModalOpen}
                    onClose={() => setZkAddressModalOpen(false)}
                    zkAddress={zkAddress}
                    onCopy={handleCopy}
                    copied={copied}
                />
            )}
        </>
    );
}
