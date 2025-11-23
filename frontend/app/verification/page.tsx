'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { getUniversalLink } from "@selfxyz/core";
import {
    SelfQRcodeWrapper,
    SelfAppBuilder,
    countries,
    type SelfApp,
} from "@selfxyz/qrcode";
import { ethers } from "ethers";
import { useAccount as useWagmiAccount } from 'wagmi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/Toast';

export default function VerificationPage() {
    const { toast } = useToast();
    const { address } = useWagmiAccount();
    const [selfApp, setSelfApp] = useState<SelfApp | null>(null);
    const [universalLink, setUniversalLink] = useState("");
    const [isInitializing, setIsInitializing] = useState(true);
    const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
    const [verificationData, setVerificationData] = useState<any>(null);

    // Use wallet address as userId, or ZeroAddress if not connected
    const userId = address || ethers.ZeroAddress;

    useEffect(() => {
        const initializeSelfApp = async () => {
            try {
                setIsInitializing(true);

                // Validate required environment variables
                const endpoint = process.env.NEXT_PUBLIC_SELF_ENDPOINT;
                const scope = process.env.NEXT_PUBLIC_SELF_SCOPE_SEED;
                const appName = process.env.NEXT_PUBLIC_SELF_APP_NAME;

                if (!endpoint) {
                    throw new Error('NEXT_PUBLIC_SELF_ENDPOINT is not configured. Please set it in your .env.local file.');
                }

                if (!scope) {
                    throw new Error('NEXT_PUBLIC_SELF_SCOPE_SEED is not configured. Please set it in your .env.local file.');
                }

                // Frontend configuration (must match backend + disclosure requests)
                const disclosures = {
                    // Verification requirements (must match backend)
                    minimumAge: 18,
                    excludedCountries: [countries.UNITED_STATES], // Use country constants
                    ofac: true, // OFAC compliance checking

                    // Disclosure requests (frontend only)
                    // nationality: true,
                    // Optional disclosures (uncomment to request):
                    // name: true,
                    // issuing_state: true,
                    // date_of_birth: true,
                    // passport_number: true,
                    // gender: true,
                    // expiry_date: true,
                };

                // Determine the appropriate deeplink callback
                // For MetaMask mobile browser, use origin + pathname to stay in-app
                let deeplinkCallback = '';
                if (typeof window !== 'undefined') {
                    // Check if we're in MetaMask mobile browser
                    const isMetaMaskMobile = /MetaMaskMobile/i.test(navigator.userAgent) ||
                        (typeof window !== 'undefined' && (window as any).ethereum && (window as any).ethereum.isMetaMask);

                    if (isMetaMaskMobile) {
                        // Use origin + pathname to stay within MetaMask browser
                        deeplinkCallback = window.location.origin + window.location.pathname;
                    } else {
                        // For other browsers, use full href
                        deeplinkCallback = window.location.href;
                    }
                }

                const app = new SelfAppBuilder({
                    version: 2, // Always use V2
                    appName: appName || "Nydus",
                    scope: scope,
                    endpoint: endpoint.toLowerCase(), // Your contract address (lowercase)
                    logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png", // Logo URL or base64
                    userId: userId, // User's wallet address or identifier
                    endpointType: "staging_celo", // "staging_celo" for testnet, "celo" for mainnet
                    userIdType: "hex", // "hex" for Ethereum addresses, "uuid" for UUIDs
                    userDefinedData: address ? `Wallet: ${address}` : "Hola Buenos Aires!!!", // Optional custom data
                    deeplinkCallback: deeplinkCallback,
                    disclosures: disclosures,
                }).build();

                setSelfApp(app);
                setUniversalLink(getUniversalLink(app));
                setIsInitializing(false);
            } catch (error) {
                console.error("Failed to initialize Self app:", error);
                toast('Failed to initialize Self verification', 'error');
                setIsInitializing(false);
            }
        };

        initializeSelfApp();
    }, [userId, address, toast]);

    const handleSuccessfulVerification = (result: any) => {
        console.log("Verification successful!", result);
        setVerificationStatus('success');
        setVerificationData(result);
        toast('Identity verification successful!', 'success');
    };

    const handleVerificationError = (error: any) => {
        console.error("Verification error:", error);
        setVerificationStatus('error');
        toast('Verification failed. Please try again.', 'error');
    };

    return (
        <div className="min-h-screen bg-black text-white pt-20 pb-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
                <Card className="border-[#333333] bg-[#0a0a0a]">
                    <CardHeader>
                        <div className="flex items-center gap-3 mb-2">
                            <CardTitle className="text-2xl sm:text-3xl font-mono font-bold uppercase text-white">
                                Identity Verification
                            </CardTitle>
                            <Image
                                src="/SelfLogoWhite.png"
                                alt="Self Protocol"
                                width={52}
                                height={52}
                                className="rounded-md"
                            />
                        </div>
                        <CardDescription className="text-[#888888] font-mono text-sm sm:text-base mt-2">
                            Verify your identity using Self Protocol. Scan the QR code with the Self app to complete verification.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        {isInitializing ? (
                            <div className="flex flex-col items-center justify-center py-12">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[rgba(182,255,62,1)] mb-4"></div>
                                <p className="text-[#888888] font-mono text-sm uppercase">Initializing Verification...</p>
                            </div>
                        ) : !address ? (
                            <Card className="border-[#333333] bg-[#0a0a0a]">
                                <CardContent className="pt-6">
                                    <p className="text-center text-[#888888] font-mono text-sm uppercase">
                                        Please connect your wallet to start verification
                                    </p>
                                </CardContent>
                            </Card>
                        ) : selfApp ? (
                            <div className="space-y-6">
                                {/* QR Code */}
                                <div className="flex flex-col items-center">
                                    <div className="p-4 border border-[#333333] bg-white rounded-lg">
                                        <SelfQRcodeWrapper
                                            selfApp={selfApp}
                                            onSuccess={handleSuccessfulVerification as any}
                                            onError={handleVerificationError as any}
                                        />
                                    </div>
                                    <p className="mt-4 text-center text-[#888888] font-mono text-xs sm:text-sm uppercase">
                                        Scan with Self App
                                    </p>
                                </div>

                                {/* Universal Link */}
                                {universalLink && (
                                    <Card className="border-[#333333] bg-[#0a0a0a]">
                                        <CardContent className="pt-4">
                                            <p className="text-xs sm:text-sm font-mono font-bold text-white uppercase mb-2">
                                                Universal Link
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={universalLink}
                                                    readOnly
                                                    className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-[#333333] text-white text-xs sm:text-sm font-mono rounded focus:outline-none focus:border-[rgba(182,255,62,1)]"
                                                />
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(universalLink);
                                                        toast('Universal link copied to clipboard', 'success');
                                                    }}
                                                    className="px-4 py-2 bg-[rgba(182,255,62,1)] hover:bg-[rgba(182,255,62,0.8)] text-black font-mono font-bold text-xs uppercase transition-colors"
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                                {/* Verification Requirements */}
                                <Card className="border-[#333333] bg-[#0a0a0a]">
                                    <CardContent className="pt-4">
                                        <p className="text-xs sm:text-sm font-mono font-bold text-white uppercase mb-3">
                                            Verification Requirements
                                        </p>
                                        <ul className="space-y-2 text-xs sm:text-sm font-mono text-[#888888]">
                                            <li className="flex items-center gap-2">
                                                <span className="text-[rgba(182,255,62,1)]">✓</span>
                                                Minimum age: 18
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <span className="text-[rgba(182,255,62,1)]">✓</span>
                                                Excluded countries: United States
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <span className="text-[rgba(182,255,62,1)]">✓</span>
                                                OFAC compliance check enabled
                                            </li>
                                        </ul>
                                    </CardContent>
                                </Card>

                                {/* Verification Status */}
                                {verificationStatus === 'success' && verificationData && (
                                    <Card className="border-[rgba(182,255,62,1)] bg-[#0a0a0a]">
                                        <CardContent className="pt-4">
                                            <p className="text-xs sm:text-sm font-mono font-bold text-[rgba(182,255,62,1)] uppercase mb-3">
                                                ✓ Verification Successful
                                            </p>
                                            <div className="space-y-2 text-xs sm:text-sm font-mono text-[#888888]">
                                                {verificationData.discloseOutput && (
                                                    <>
                                                        {verificationData.discloseOutput.nationality && (
                                                            <p>Nationality: {verificationData.discloseOutput.nationality}</p>
                                                        )}
                                                        {verificationData.discloseOutput.gender && (
                                                            <p>Gender: {verificationData.discloseOutput.gender}</p>
                                                        )}
                                                        {verificationData.discloseOutput.olderThan && (
                                                            <p>Age verified: {verificationData.discloseOutput.olderThan}+</p>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                                {verificationStatus === 'error' && (
                                    <Card className="border-red-500 bg-[#0a0a0a]">
                                        <CardContent className="pt-4">
                                            <p className="text-xs sm:text-sm font-mono font-bold text-red-500 uppercase">
                                                Verification Failed
                                            </p>
                                            <p className="mt-2 text-xs sm:text-sm font-mono text-[#888888]">
                                                Please try again or contact support if the issue persists.
                                            </p>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        ) : (
                            <Card className="border-[#333333] bg-[#0a0a0a]">
                                <CardContent className="pt-6">
                                    <p className="text-center text-red-500 font-mono text-sm uppercase">
                                        Failed to initialize verification
                                    </p>
                                </CardContent>
                            </Card>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

