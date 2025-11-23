'use client';

import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Key, Zap, Shield } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="mb-6 flex justify-center">
            <Image
              src="/nydus_logo.png"
              alt="Nydus Logo"
              width={300}
              height={80}
              className="h-20 w-auto"
              priority
            />
          </div>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-mono font-bold mb-4 text-white uppercase tracking-wider">
            NYDUS
          </h1>
          <p className="text-lg sm:text-xl font-mono text-[#888888] mb-2">
            PRIVACY-FIRST PAYMENT PROTOCOL
          </p>
          <p className="text-sm sm:text-base font-mono text-[#888888] max-w-2xl mx-auto mb-4">
            ZERO-KNOWLEDGE CONFIDENTIALITY FOR YOUR TRANSACTIONS. SEND, RECEIVE, AND MANAGE FUNDS WITH COMPLETE CONFIDENTIALITY.
          </p>
          <p className="text-xs sm:text-sm font-mono text-[#666666] max-w-2xl mx-auto mb-2">
            YOUR VIEWKEY CAN BE SHARED WITH AUTHORITIES FOR COMPLIANCE OR AUDIT PURPOSES, ALLOWING SELECTIVE TRANSPARENCY WHILE MAINTAINING DEFAULT CONFIDENTIALITY.
          </p>
          <p className="text-xs sm:text-sm font-mono text-[#ff6b6b] max-w-2xl mx-auto">
            ⚠️ TESTNET & ALPHA - FOR TESTING PURPOSES ONLY
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono flex items-center gap-2">
                <Key className="w-5 h-5" />
                CONFIDENTIALITY
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-mono text-[#888888]">
                TRANSACTIONS ARE COMPLETELY CONFIDENTIAL BY DEFAULT. NO ONE CAN SEE YOUR BALANCE OR TRANSACTION HISTORY UNLESS YOU SHARE YOUR VIEWKEY.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-mono flex items-center gap-2">
                <Zap className="w-5 h-5" />
                PERFORMANCE
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-mono text-[#888888]">
                BUILT ON CUTTING-EDGE ZERO-KNOWLEDGE PROOFS FOR FAST, VERIFIABLE TRANSACTIONS.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-mono flex items-center gap-2">
                <Shield className="w-5 h-5" />
                SECURITY
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-mono text-[#888888]">
                CRYPTOGRAPHIC GUARANTEES ENSURE YOUR FUNDS ARE SAFE AND YOUR PRIVACY IS PROTECTED.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Technical Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-sm">TECHNICAL ARCHITECTURE</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-mono text-[#888888]">
                NO MERKLE TREE. NOIR/SOLIDITY INTERSECTION USING PEDERSEN VECTOR COMMITMENTS & INNER PRODUCTS.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-sm">FAST DISCOVERY & PWA</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-mono text-[#888888]">
                DESIGNED FOR FAST DISCOVERY AND CAN BE SERVED AS A PROGRESSIVE WEB APP.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
