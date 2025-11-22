'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseZkAddress } from '@/lib/zk-address';

interface QRModalProps {
    isOpen: boolean;
    onClose: () => void;
    zkAddress: string;
}

// Simple QR code generator using canvas (no external dependencies)
function generateQRCode(data: string, size: number = 200): string {
    // For now, we'll use a simple text-based representation
    // In production, you'd want to use a proper QR library like qrcode.react
    // But for now, we'll create a simple data URL that can be displayed
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return '';
    
    // White background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(2, 2, size - 4, size - 4);
    
    // Simple pattern (in production, use proper QR encoding)
    // For now, just display the data as text
    ctx.fillStyle = '#000000';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = data.match(/.{1,20}/g) || [];
    lines.forEach((line, i) => {
        ctx.fillText(line, size / 2, size / 2 - (lines.length * 10) / 2 + i * 10);
    });
    
    return canvas.toDataURL();
}

export default function QRModal({ isOpen, onClose, zkAddress }: QRModalProps) {
    const [mounted, setMounted] = useState(false);
    const [qrImageUrl, setQrImageUrl] = useState<string>('');

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen && zkAddress) {
            try {
                // Parse zkAddress to get x and y coordinates
                const { x, y } = parseZkAddress(zkAddress);
                
                // Format as JSON: {"x":"...","y":"..."}
                const qrDataString = JSON.stringify({
                    x: x.toString(),
                    y: y.toString()
                });
                
                // Generate QR code using a proper library if available, otherwise use canvas
                generateQRCodeWithLibrary(qrDataString);
            } catch (error) {
                console.error('Error parsing zkAddress for QR:', error);
            }
        }
    }, [isOpen, zkAddress]);

    const generateQRCodeWithLibrary = async (data: string) => {
        try {
            // Try to use qrcode library if available
            const QRCode = await import('qrcode');
            const url = await QRCode.toDataURL(data, {
                width: 300,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            });
            setQrImageUrl(url);
        } catch (error) {
            // Fallback to canvas-based generation
            console.warn('QRCode library not available, using fallback:', error);
            const url = generateQRCode(data, 300);
            setQrImageUrl(url);
        }
    };

    if (!isOpen || !mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black opacity-95"
                onClick={onClose}
            />
            
            {/* Modal */}
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-black border-2 border-white max-w-sm w-full terminal-border">
                    <div className="p-6 space-y-4">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-mono font-bold text-white uppercase">ZK ADDRESS QR CODE</h2>
                            <button
                                onClick={onClose}
                                className="text-white hover:text-[#888888] font-mono text-xl"
                            >
                                [X]
                            </button>
                        </div>
                        
                        {qrImageUrl ? (
                            <div className="flex flex-col items-center space-y-4">
                                <div className="bg-white p-4 rounded">
                                    <img src={qrImageUrl} alt="QR Code" className="w-full h-auto" />
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center py-8">
                                <span className="text-white font-mono">GENERATING QR CODE...</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

