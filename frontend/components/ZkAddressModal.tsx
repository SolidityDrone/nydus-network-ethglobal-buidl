'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, QrCode, Info, X } from 'lucide-react';
import Link from 'next/link';
import { AppKitButton } from '@reown/appkit/react';
import QRModal from './QRModal';

interface ZkAddressModalProps {
    isOpen: boolean;
    onClose: () => void;
    zkAddress: string;
    onCopy: () => void;
    copied: boolean;
}

export default function ZkAddressModal({ isOpen, onClose, zkAddress, onCopy, copied }: ZkAddressModalProps) {
    const [mounted, setMounted] = useState(false);
    const [infoMenuOpen, setInfoMenuOpen] = useState(false);
    const [qrModalOpen, setQrModalOpen] = useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    if (!isOpen || !mounted) return null;

    return createPortal(
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-[9998] bg-black opacity-95"
                onClick={onClose}
            />
            
            {/* Modal */}
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                <div className="relative bg-[#0a0a0a] border-2 border-[#333333] max-w-md w-full">
                    <div className="p-6 space-y-4">
                        {/* Header */}
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-mono font-bold text-white uppercase">ZK ADDRESS</h2>
                            <button
                                onClick={onClose}
                                className="text-[#888888] hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* ZkAddress Display */}
                        <div className="px-4 py-3 bg-[#1a1a1a] border border-[#333333] rounded">
                            <p className="text-sm text-white font-mono break-all text-center">
                                {zkAddress}
                            </p>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center justify-center gap-3">
                            {/* Copy Button */}
                            <button
                                onClick={onCopy}
                                className="flex items-center gap-2 px-4 py-2 bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold text-xs uppercase transition-colors"
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-4 h-4" />
                                        COPIED
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" />
                                        COPY
                                    </>
                                )}
                            </button>

                            {/* QR Code Button */}
                            <button
                                onClick={() => setQrModalOpen(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold text-xs uppercase transition-colors"
                            >
                                <QrCode className="w-4 h-4" />
                                QR CODE
                            </button>

                            {/* Info Button */}
                            <div className="relative">
                                <button
                                    onClick={() => setInfoMenuOpen(!infoMenuOpen)}
                                    className="flex items-center gap-2 px-4 py-2 bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold text-xs uppercase transition-colors"
                                >
                                    <Info className="w-4 h-4" />
                                    INFO
                                </button>

                                {/* Info Dropdown Menu */}
                                {infoMenuOpen && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-[10000]"
                                            onClick={() => setInfoMenuOpen(false)}
                                        />
                                        <div className="absolute right-0 mt-2 w-48 bg-[#0a0a0a] border-2 border-[#333333] z-[10001]">
                                            <div className="py-2">
                                                {/* Wallet Connect */}
                                                <div className="px-4 py-2 border-b border-[#333333]">
                                                    <AppKitButton />
                                                </div>
                                                
                                                {/* Naming Link */}
                                                <Link
                                                    href="/naming"
                                                    onClick={() => {
                                                        setInfoMenuOpen(false);
                                                        onClose();
                                                    }}
                                                    className="block px-4 py-2 text-white font-mono text-xs uppercase hover:bg-[#1a1a1a] transition-colors"
                                                >
                                                    🏷️ NAMING
                                                </Link>
                                                
                                                {/* Verification Link */}
                                                <Link
                                                    href="/verification"
                                                    onClick={() => {
                                                        setInfoMenuOpen(false);
                                                        onClose();
                                                    }}
                                                    className="block px-4 py-2 text-white font-mono text-xs uppercase hover:bg-[#1a1a1a] transition-colors"
                                                >
                                                    ✅ VERIFICATION
                                                </Link>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* QR Modal */}
            {qrModalOpen && (
                <QRModal
                    isOpen={qrModalOpen}
                    onClose={() => setQrModalOpen(false)}
                    zkAddress={zkAddress}
                />
            )}
        </>,
        document.body
    );
}

