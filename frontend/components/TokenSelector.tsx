'use client';

import React, { useState, useRef, useEffect } from 'react';
import { PublicClient } from 'viem';
import { fetchTokenInfoBatch, TokenInfo } from '@/lib/token-lookup';

interface BalanceEntry {
    tokenAddress: bigint;
    amount: bigint;
    nonce: bigint;
}

interface TokenSelectorProps {
    label: string;
    value: number | null;
    onChange: (value: number | null) => void;
    balanceEntries: BalanceEntry[];
    originalIndices: number[];
    disabled?: boolean;
    placeholder?: string;
    publicClient?: PublicClient;
}

export default function TokenSelector({
    label,
    value,
    onChange,
    balanceEntries,
    originalIndices,
    disabled = false,
    placeholder = '-- SELECT A BALANCE ENTRY --',
    publicClient
}: TokenSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [tokenNames, setTokenNames] = useState<Map<string, string>>(new Map());

    // Fetch token names when balanceEntries change
    useEffect(() => {
        if (!publicClient || balanceEntries.length === 0) return;

        const fetchNames = async () => {
            const tokenAddresses = balanceEntries.map(entry => {
                const hex = entry.tokenAddress.toString(16);
                return hex.startsWith('0x') ? hex : `0x${hex}`;
            });

            try {
                const tokenInfoMap = await fetchTokenInfoBatch(publicClient, tokenAddresses);
                const namesMap = new Map<string, string>();

                tokenInfoMap.forEach((info, address) => {
                    // Use symbol if available, otherwise name, otherwise TEST_TOKEN
                    const displayName = info.symbol && info.symbol !== '$NoName'
                        ? info.symbol
                        : (info.name && info.name !== '$NoName'
                            ? info.name
                            : 'TEST_TOKEN');
                    namesMap.set(address.toLowerCase(), displayName);
                });

                // For addresses not found, set TEST_TOKEN
                tokenAddresses.forEach(addr => {
                    const normalized = addr.toLowerCase();
                    if (!namesMap.has(normalized)) {
                        namesMap.set(normalized, 'TEST_TOKEN');
                    }
                });

                setTokenNames(namesMap);
            } catch (error: unknown) {
                console.error('Error fetching token names:', error);
                // Set all to TEST_TOKEN on error
                const namesMap = new Map<string, string>();
                balanceEntries.forEach(entry => {
                    const hex = entry.tokenAddress.toString(16);
                    const addr = hex.startsWith('0x') ? hex : `0x${hex}`;
                    namesMap.set(addr.toLowerCase(), 'TEST_TOKEN');
                });
                setTokenNames(namesMap);
            }
        };

        fetchNames();
    }, [balanceEntries, publicClient]);

    // Helper function to get token name
    const getTokenName = (tokenAddress: bigint): string => {
        const hex = tokenAddress.toString(16);
        const addr = (hex.startsWith('0x') ? hex : `0x${hex}`).toLowerCase();
        return tokenNames.get(addr) || 'TEST_TOKEN';
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside: EventListener = (event) => {
            const target = event.target;
            if (dropdownRef.current && target && !dropdownRef.current.contains(target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen]);

    const selectedEntry = value !== null && originalIndices[value] !== undefined
        ? balanceEntries[originalIndices[value]]
        : null;

    const selectedTokenName = selectedEntry ? getTokenName(selectedEntry.tokenAddress) : '';

    return (
        <div className="relative" ref={dropdownRef}>
            <label className="block text-xs sm:text-sm font-mono font-bold text-white mb-1 sm:mb-2 uppercase">
                {label}
            </label>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`
                    w-full px-2 sm:px-3 py-2 text-xs sm:text-sm 
                    bg-[#0a0a0a] border border-[#333333] text-white font-mono 
                    focus:outline-none focus:ring-2 focus:ring-white focus:border-white 
                    terminal-border
                    flex items-center justify-between
                    ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[#1a1a1a]'}
                    transition-colors
                `}
            >
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                    {/* Circle logo placeholder */}
                    <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#333333] border border-[#555555] flex items-center justify-center">
                        <span className="text-[8px] sm:text-[10px] text-[#888888] font-mono">
                            {selectedEntry ? (selectedEntry.tokenAddress.toString(16).slice(0, 2).toUpperCase()) : '??'}
                        </span>
                    </div>
                    <span className="truncate">
                        {selectedEntry
                            ? `${selectedTokenName} - ${selectedEntry.amount.toString()}`
                            : placeholder}
                    </span>
                </div>
                <span className="ml-2 text-[#888888] flex-shrink-0">
                    {isOpen ? '▲' : '▼'}
                </span>
            </button>

            {isOpen && !disabled && (
                <div className="absolute z-50 w-full mt-1 bg-[#0a0a0a] border border-[#333333] terminal-border max-h-60 overflow-y-auto">
                    <div
                        className="px-2 py-1 text-xs font-mono text-[#888888] border-b border-[#333333] cursor-pointer hover:bg-[#1a1a1a]"
                        onClick={() => {
                            onChange(null);
                            setIsOpen(false);
                        }}
                    >
                        {placeholder}
                    </div>
                    {balanceEntries.map((entry, index) => {
                        const tokenHex = entry.tokenAddress.toString(16);
                        const tokenName = getTokenName(entry.tokenAddress);
                        const originalIndex = originalIndices[index];

                        return (
                            <div
                                key={originalIndex}
                                className={`
                                    px-2 py-2 text-xs sm:text-sm font-mono text-white
                                    border-b border-[#333333] last:border-b-0
                                    cursor-pointer hover:bg-[#1a1a1a] hover:border-white
                                    flex items-center space-x-2
                                    ${value === originalIndex ? 'bg-[#1a1a1a] border-l-2 border-l-white' : ''}
                                    transition-colors
                                `}
                                onClick={() => {
                                    onChange(originalIndex);
                                    setIsOpen(false);
                                }}
                            >
                                {/* Circle logo placeholder */}
                                <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#333333] border border-[#555555] flex items-center justify-center">
                                    <span className="text-[8px] sm:text-[10px] text-[#888888] font-mono">
                                        {tokenHex.slice(0, 2).toUpperCase()}
                                    </span>
                                </div>
                                <span className="truncate">
                                    {tokenName} - {entry.amount.toString()}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

