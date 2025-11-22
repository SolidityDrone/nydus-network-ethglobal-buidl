'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from './ui/card';

interface SyncingModalProps {
    isOpen: boolean;
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

export default function SyncingModal({ isOpen }: SyncingModalProps) {
    const [mounted, setMounted] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [progress, setProgress] = useState(0);
    const startTimeRef = useRef<number | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Show/hide modal with animation
    useEffect(() => {
        if (isOpen) {
            setShowModal(true);
        } else {
            setShowModal(false);
        }
    }, [isOpen]);

    // Reset and start timer when syncing starts
    useEffect(() => {
        if (isOpen) {
            startTimeRef.current = performance.now();
            setElapsedMs(0);
            setProgress(0);

            // Update elapsed time every 50ms
            intervalRef.current = setInterval(() => {
                if (startTimeRef.current) {
                    const elapsed = Math.round(performance.now() - startTimeRef.current);
                    setElapsedMs(elapsed);
                }
            }, 50);

            // Simulate progress (syncing typically takes 2-5 seconds)
            // Use a slower progress rate to simulate blockchain queries
            const averageTime = 3000; // 3 seconds average
            progressIntervalRef.current = setInterval(() => {
                if (startTimeRef.current) {
                    const elapsed = performance.now() - startTimeRef.current;
                    // Progress from 0 to 90% over averageTime, then slowly to 95%
                    const baseProgress = Math.min((elapsed / averageTime) * 90, 90);
                    // Add some randomness and slow down near the end
                    const slowProgress = baseProgress + Math.min((elapsed - averageTime) / (averageTime * 2) * 5, 5);
                    setProgress(Math.min(slowProgress, 95));
                }
            }, 100);
        } else {
            // Reset when syncing stops
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
            startTimeRef.current = null;
            setElapsedMs(0);
            setProgress(0);
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, [isOpen]);

    if (!mounted || !showModal) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={(e) => {
                // Prevent closing on background click during sync
                e.stopPropagation();
            }}
        >
            <Card className="w-full max-w-md mx-4 bg-[#0a0a0a] border-2 border-[rgba(182,255,62,1)] terminal-border">
                <CardContent className="p-4 sm:p-6">
                    <div className="space-y-3">
                        {/* Syncing Message */}
                        <div className="text-center">
                            <div className="font-mono text-[rgba(182,255,62,1)] text-sm sm:text-base mb-2 uppercase font-bold">
                                SYNCING ACCOUNT DATA
                            </div>
                            <BouncingDots />
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1">
                            <div className="flex justify-between items-center">
                                <span className="font-mono text-xs text-[rgba(182,255,62,0.8)] uppercase">
                                    PROGRESS
                                </span>
                                <span className="font-mono text-xs text-[rgba(182,255,62,1)]">
                                    {elapsedMs}MS
                                </span>
                            </div>
                            <div className="w-full h-4 bg-[#1a1a1a] border border-[#333333] overflow-hidden relative">
                                <div
                                    className="h-full relative"
                                    style={{
                                        width: `${progress}%`,
                                        transition: 'width 0.1s ease-out',
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
                        </div>

                        {/* Status Text */}
                        <div className="text-center font-mono text-xs text-[rgba(182,255,62,0.8)] uppercase">
                            FETCHING BALANCE ENTRIES...
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>,
        document.body
    );
}

