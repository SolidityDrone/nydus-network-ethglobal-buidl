'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';

interface TransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    isPending?: boolean;
    isConfirming?: boolean;
    isConfirmed?: boolean;
    isProving?: boolean;
    txHash: string | null;
    error: string | null;
    transactionType?: string;
    onConfirmed?: () => void;
}

// DOS-style bouncing dots animation component
function BouncingDots() {
    return (
        <div className="flex items-center justify-center space-x-1 py-4">
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    className="text-[rgba(182,255,62,1)] font-mono text-2xl font-bold animate-bounce-dot"
                    style={{
                        animationDelay: `${i * 0.16}s`,
                    }}
                >
                    █
                </span>
            ))}
        </div>
    );
}

// Typing animation component
function TypingText({ text, delay = 0 }: { text: string; delay?: number }) {
    const [displayedText, setDisplayedText] = useState('');
    const [showCursor, setShowCursor] = useState(true);

    useEffect(() => {
        setDisplayedText('');
        let currentIndex = 0;
        const timeout = setTimeout(() => {
            const interval = setInterval(() => {
                if (currentIndex < text.length) {
                    setDisplayedText(text.slice(0, currentIndex + 1));
                    currentIndex++;
                } else {
                    clearInterval(interval);
                }
            }, 30);
            return () => clearInterval(interval);
        }, delay);

        return () => clearTimeout(timeout);
    }, [text, delay]);

    useEffect(() => {
        const cursorInterval = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 530);
        return () => clearInterval(cursorInterval);
    }, []);

    return (
        <span className="font-mono inline-flex items-center">
            <span className="inline-block">{displayedText}</span>
            <span className="inline-block w-3 text-center">
                {showCursor ? '█' : ' '}
            </span>
        </span>
    );
}

export default function TransactionModal({
    isOpen,
    onClose,
    isPending = false,
    isConfirming = false,
    isConfirmed = false,
    isProving = false,
    txHash,
    error,
    transactionType = 'TRANSACTION',
    onConfirmed
}: TransactionModalProps) {
    const [mounted, setMounted] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [progress, setProgress] = useState(0);
    const [proofComplete, setProofComplete] = useState(false);
    const startTimeRef = useRef<number | null>(null);
    const prevIsProvingRef = useRef<boolean>(false);
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasSetFadeOutRef = useRef<boolean>(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Animate modal entrance
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => setShowModal(true), 10);
        } else {
            setShowModal(false);
        }
    }, [isOpen]);

    // Track elapsed time and progress during proof generation
    useEffect(() => {
        // Only reset when isProving transitions from false to true
        const wasProving = prevIsProvingRef.current;
        prevIsProvingRef.current = isProving;

        if (isProving && isOpen) {
            // Reset only when starting a new proof (transition from false to true)
            if (!wasProving) {
                // Clear any existing fade-out timers when starting a new proof
                if (fadeTimerRef.current) {
                    clearTimeout(fadeTimerRef.current);
                    fadeTimerRef.current = null;
                }
                hasSetFadeOutRef.current = false;
                setProofComplete(false);
                setElapsedMs(0);
                setProgress(0);
                startTimeRef.current = performance.now();
            }

            // Always start interval when proving (ensure startTimeRef is set)
            if (!startTimeRef.current) {
                startTimeRef.current = performance.now();
            }

            // Update more frequently for smoother MS display
            const interval = setInterval(() => {
                if (startTimeRef.current) {
                    const elapsed = Math.round(performance.now() - startTimeRef.current);
                    setElapsedMs(elapsed);

                    // Calibrate progress based on transaction type
                    // Deposit and Withdraw: 4-8 seconds (average ~6 seconds)
                    // Absorb and Send: ~10 seconds
                    let averageTime = 15000; // Default fallback
                    if (transactionType === 'DEPOSIT' || transactionType === 'WITHDRAW') {
                        averageTime = 6000; // 6 seconds average
                    } else if (transactionType === 'ABSORB' || transactionType === 'SEND') {
                        averageTime = 10000; // 10 seconds
                    }

                    // Progress should fill gradually, but cap at 90% until proof is done
                    const calculatedProgress = Math.min((elapsed / averageTime) * 90, 90);
                    setProgress(calculatedProgress);
                }
            }, 50); // Update every 50ms for smoother display


            return () => clearInterval(interval);
        } else if (!isProving && wasProving && startTimeRef.current && !proofComplete && isOpen && !hasSetFadeOutRef.current) {
            // Proof just completed - fill to 100% then fade out
            // Continue updating elapsed time until modal closes
            const finalElapsed = Math.round(performance.now() - (startTimeRef.current || 0));
            setElapsedMs(finalElapsed);

            // Mark that we've set up the fade out to prevent duplicate setup
            hasSetFadeOutRef.current = true;

            // Set proofComplete to true first (this enables the 1s transition CSS)
            setProofComplete(true);

            // Use a small delay to ensure the CSS transition picks up the current progress value
            // Then animate to 100% over 1 second
            setTimeout(() => {
                setProgress(100);
            }, 10);

            // Wait 1.5 seconds after showing "PROOF COMPLETE", then close instantly
            fadeTimerRef.current = setTimeout(() => {
                onClose();
            }, 1500); // Wait 1.5s after proof complete, then close instantly
        } else if (proofComplete && startTimeRef.current && isOpen) {
            // Continue showing final elapsed time while waiting to fade out
            const finalElapsed = Math.round(performance.now() - (startTimeRef.current || 0));
            setElapsedMs(finalElapsed);
        }
    }, [isProving, isOpen, proofComplete, onClose]);

    // Reset when modal closes
    useEffect(() => {
        if (!isOpen) {
            setElapsedMs(0);
            setProgress(0);
            setProofComplete(false);
            setShowSuccess(false);
            setShowDetails(false);
            startTimeRef.current = null;
            prevIsProvingRef.current = false;
            hasSetFadeOutRef.current = false;
            // Clear any pending timers
            if (fadeTimerRef.current) {
                clearTimeout(fadeTimerRef.current);
                fadeTimerRef.current = null;
            }
        }
    }, [isOpen]);

    // Track if we've already called onConfirmed to avoid duplicate calls
    const hasCalledOnConfirmedRef = useRef(false);

    // Show success transition when transaction is confirmed
    useEffect(() => {
        if (isConfirmed && isOpen && !isProving) {
            setShowSuccess(true);
            // Execute account refresh logic when transaction is confirmed
            // Add a delay to ensure blockchain state has updated
            if (onConfirmed && !hasCalledOnConfirmedRef.current) {
                console.log('🔄 Transaction confirmed, scheduling account data refresh...');
                hasCalledOnConfirmedRef.current = true;
                // Wait 2 seconds after confirmation to allow blockchain state to update
                const timer = setTimeout(() => {
                    console.log('🔄 Calling onConfirmed callback...');
                    try {
                        onConfirmed();
                    } catch (error) {
                        console.error('❌ Error calling onConfirmed:', error);
                    }
                }, 2000);
                return () => clearTimeout(timer);
            }
        } else {
            setShowSuccess(false);
        }
    }, [isConfirmed, isOpen, isProving, onConfirmed]);

    // Reset the flag when modal closes or when starting a new transaction
    useEffect(() => {
        if (!isOpen || isProving) {
            hasCalledOnConfirmedRef.current = false;
        }
    }, [isOpen, isProving]);

    if (!isOpen || !mounted) return null;

    // Don't show loading state if transaction is confirmed
    const isLoading = (isPending || isConfirming || isProving || proofComplete) && !isConfirmed;
    const showError = error && !isLoading && !isConfirmed && !proofComplete;

    // Prevent closing when proof is generating or transaction is pending/confirming
    const canClose = !isProving && !isPending && !isConfirming && !proofComplete;

    const modalContent = (
        <div className="fixed inset-0 z-[9999] overflow-y-auto">
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black transition-opacity duration-300 ${showModal ? 'opacity-95' : 'opacity-0'
                    }`}
                onClick={canClose ? onClose : undefined}
                style={{ cursor: canClose ? 'pointer' : 'default' }}
            />

            {/* Modal */}
            <div className="flex min-h-full items-center justify-center p-2 sm:p-4">
                <div
                    className={`relative bg-black border-2 border-[rgba(182,255,62,1)] max-w-lg w-full terminal-border transition-all duration-300 ${showModal
                        ? 'opacity-100 scale-100 translate-y-0'
                        : 'opacity-0 scale-95 translate-y-4'
                        }`}
                    style={{
                        boxShadow: '0 0 20px rgba(182,255,62,0.2), inset 0 0 20px rgba(182,255,62,0.05)',
                    }}
                >
                    <Card className="border-0 bg-transparent">
                        <CardContent className="p-4 sm:p-5">
                            {isLoading && (
                                <div className="space-y-3 text-center">
                                    {/* Bouncing Dots */}
                                    <BouncingDots />

                                    {/* Status Text */}
                                    <div className="space-y-1">
                                        <p className="text-sm sm:text-base font-mono text-[rgba(182,255,62,1)] uppercase font-bold">
                                            <TypingText
                                                text={
                                                    proofComplete
                                                        ? 'PROOF COMPLETE'
                                                        : isProving
                                                            ? 'GENERATING PROOF'
                                                            : isPending
                                                                ? 'WAITING FOR SIGNATURE'
                                                                : 'CONFIRMING TRANSACTION'
                                                }
                                                delay={200}
                                            />
                                        </p>
                                        <p className="text-[10px] sm:text-xs font-mono text-[rgba(182,255,62,0.8)] uppercase">
                                            {proofComplete
                                                ? 'FINALIZING...'
                                                : isProving
                                                    ? 'COMPUTING ZERO-KNOWLEDGE PROOF'
                                                    : isPending
                                                        ? 'PLEASE CHECK YOUR WALLET'
                                                        : 'WAITING FOR BLOCKCHAIN CONFIRMATION'}
                                        </p>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="space-y-1 mt-2">
                                        <div className="w-full bg-[#1a1a1a] border border-[#333333] h-4 overflow-hidden relative">
                                            <div
                                                className="h-full relative"
                                                style={{
                                                    width: proofComplete
                                                        ? `${progress}%`
                                                        : isProving
                                                            ? `${progress}%`
                                                            : isPending
                                                                ? '40%'
                                                                : '80%',
                                                    transition: proofComplete
                                                        ? 'width 1s ease-out'
                                                        : isProving
                                                            ? 'width 0.3s linear'
                                                            : 'width 0.5s ease-in-out',
                                                }}
                                            >
                                                {/* Diagonal bars pattern - using SVG for perfect parallel bars (inclined to the right) */}
                                                <div
                                                    className="absolute inset-0"
                                                    style={{
                                                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='diagonal' x='0' y='0' width='12' height='12' patternUnits='userSpaceOnUse'%3E%3Cpath d='M0,12 L12,0 M-6,6 L6,18 M6,-6 L18,6' stroke='rgba(182,255,62,1)' stroke-width='5'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23diagonal)'/%3E%3C/svg%3E")`,
                                                        backgroundSize: '12px 12px',
                                                        width: '100%',
                                                        height: '100%',
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        {(isProving || proofComplete) && (
                                            <p className="text-[10px] sm:text-xs font-mono text-[rgba(182,255,62,1)] uppercase">
                                                {elapsedMs.toLocaleString()} MS
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {showSuccess && (
                                <div className="space-y-3 text-center animate-fadeIn">
                                    {/* Success Message */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-center space-x-2">
                                            <span className="text-[rgba(182,255,62,1)] font-mono text-2xl animate-bounce-slow">✓</span>
                                            <span className="text-white font-mono text-base uppercase font-bold">TRANSACTION CONFIRMED</span>
                                        </div>
                                        <p className="text-xs sm:text-sm font-mono text-[#888888] uppercase">
                                            BLOCKCHAIN VERIFIED
                                        </p>
                                    </div>

                                    {/* Collapsible Transaction Details */}
                                    {txHash && (
                                        <div className="mt-4">
                                            <button
                                                onClick={() => setShowDetails(!showDetails)}
                                                className="w-full flex items-center justify-between p-3 bg-[#0a0a0a] border border-[#333333] hover:border-[rgba(182,255,62,1)] transition-colors"
                                            >
                                                <span className="text-xs sm:text-sm font-mono text-white uppercase">
                                                    TRANSACTION DETAILS
                                                </span>
                                                <span className="text-white font-mono text-sm">
                                                    {showDetails ? '▲' : '▼'}
                                                </span>
                                            </button>
                                            {showDetails && (
                                                <div className="mt-2 p-4 bg-[#0a0a0a] border border-[#333333] space-y-2 animate-fadeIn">
                                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-0">
                                                        <span className="text-xs sm:text-sm font-mono text-[#888888] uppercase">TX HASH:</span>
                                                        <a
                                                            href={`https://sepolia.basescan.org/tx/${txHash}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-xs sm:text-sm font-mono text-white hover:text-[#888888] underline break-all transition-colors"
                                                        >
                                                            {txHash.slice(0, 12)}...{txHash.slice(-6)}
                                                        </a>
                                                    </div>
                                                    <p className="text-[10px] font-mono text-[#888888] mt-2">
                                                        CLICK TO VIEW ON BASESCAN
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <Button
                                        onClick={onClose}
                                        className="w-full mt-4 bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold uppercase tracking-wider transition-colors"
                                    >
                                        CLOSE
                                    </Button>
                                </div>
                            )}

                            {showError && (
                                <div className="space-y-3 text-center animate-fadeIn">
                                    {/* Error Message */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-center space-x-2">
                                            <span className="text-red-400 font-mono text-2xl">✗</span>
                                            <span className="text-white font-mono text-base uppercase font-bold">TRANSACTION FAILED</span>
                                        </div>
                                        <div className="p-4 bg-[#1a0a0a] border border-red-900">
                                            <p className="text-xs sm:text-sm font-mono text-red-400 uppercase">
                                                {error?.includes('Simulation') || error?.includes('simulation')
                                                    ? 'SIMULATION ERRORED: CHECK CONSOLE FOR MORE INFORMATIONS'
                                                    : 'TRANSACTION FAILED: CHECK CONSOLE FOR MORE INFORMATIONS'}
                                            </p>
                                        </div>
                                    </div>

                                    <Button
                                        onClick={onClose}
                                        className="w-full mt-6"
                                        variant="outline"
                                    >
                                        CLOSE
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}

