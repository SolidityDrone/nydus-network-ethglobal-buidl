'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface QRScannerProps {
    isOpen: boolean;
    onClose: () => void;
    onScan: (data: { x: string; y: string }) => void;
}

export default function QRScanner({ isOpen, onClose, onScan }: QRScannerProps) {
    const [mounted, setMounted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scanIntervalRef = useRef<number | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen && mounted) {
            startScanning();
        } else {
            stopScanning();
        }

        return () => {
            stopScanning();
        };
    }, [isOpen, mounted]);

    const startScanning = async () => {
        try {
            setError(null);

            // Request camera access
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Use back camera on mobile
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
            }

            // Start QR code scanning
            await scanQRCode();
        } catch (err) {
            console.error('Error accessing camera:', err);
            setError('Failed to access camera. Please allow camera permissions.');
        }
    };

    const stopScanning = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if (scanIntervalRef.current) {
            clearInterval(scanIntervalRef.current);
            scanIntervalRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    };

    const scanQRCode = async () => {
        try {
            // Dynamically import html5-qrcode
            const { Html5Qrcode } = await import('html5-qrcode');
            
            const html5QrCode = new Html5Qrcode('qr-reader');

            await html5QrCode.start(
                { facingMode: 'environment' },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 }
                },
                (decodedText) => {
                    // QR code scanned successfully
                    try {
                        const data = JSON.parse(decodedText);
                        if (data.x && data.y) {
                            html5QrCode.stop().then(() => {
                                onScan({ x: data.x, y: data.y });
                                onClose();
                            }).catch(() => {});
                        } else {
                            setError('Invalid QR code format. Expected x and y coordinates.');
                        }
                    } catch {
                        setError('Invalid QR code format. Expected JSON with x and y coordinates.');
                    }
                },
                () => {
                    // Ignore scanning errors (they're frequent while scanning)
                }
            );
        } catch (err) {
            console.error('Error initializing QR scanner:', err);
            setError('Failed to initialize QR scanner. Please try again.');
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
                <div className="relative bg-black border-2 border-white max-w-md w-full terminal-border">
                    <div className="p-6 space-y-4">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-mono font-bold text-white uppercase">SCAN QR CODE</h2>
                            <button
                                onClick={() => {
                                    stopScanning();
                                    onClose();
                                }}
                                className="text-white hover:text-[#888888] font-mono text-xl"
                            >
                                [X]
                            </button>
                        </div>
                        
                        {error ? (
                            <div className="text-red-500 font-mono text-sm text-center py-4">
                                {error}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div id="qr-reader" className="w-full" style={{ minHeight: '300px' }}></div>
                                <div className="text-xs font-mono text-[#888888] text-center">
                                    Point camera at QR code to scan
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

