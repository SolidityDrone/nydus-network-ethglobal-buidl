import { NextRequest, NextResponse } from 'next/server';
import { JustaName } from '@justaname.id/sdk';
import type { ChainId } from '@justaname.id/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import crypto from 'crypto';

const ENS_DOMAIN = process.env.ENS_DOMAIN || 'nydusns.eth';
const CHAIN_ID = 11155111; // Sepolia
const PROVIDER_URL = process.env.PROVIDER_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const JUSTANAME_API_KEY = process.env.JUSTANAME_API_KEY || '';
const ORIGIN = process.env.ORIGIN || 'http://localhost:3000';

let justanameInstance: JustaName | null = null;

async function getJustaNameInstance(): Promise<JustaName> {
  if (justanameInstance) {
    return justanameInstance;
  }

  const chainId = CHAIN_ID as ChainId;

  justanameInstance = JustaName.init({
    networks: [
      {
        chainId: chainId,
        providerUrl: PROVIDER_URL,
      },
    ],
    ensDomains: [
      {
        chainId: chainId,
        domain: ENS_DOMAIN,
      },
    ] as any,
    config: {},
  });

  return justanameInstance;
}

function deriveKeyFromParameter(parameter: string): { address: string; privateKey: string } {
  // Create a deterministic private key from the parameter
  const hash = crypto.createHash('sha256').update(parameter).digest('hex');
  const privateKey = `0x${hash}`;
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return { address: account.address, privateKey };
}

export async function POST(request: NextRequest) {
  try {
    const { subname, description, resolutionAddress, userSignature, userAddress, challengeMessage } = await request.json();

    if (!subname) {
      return NextResponse.json(
        { success: false, error: 'Subname is required' },
        { status: 400 }
      );
    }

    if (!JUSTANAME_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error: Missing API key' },
        { status: 500 }
      );
    }

    const justaname = await getJustaNameInstance();
    const chainId = CHAIN_ID as ChainId;

    if (!userAddress || !userSignature || !challengeMessage) {
      return NextResponse.json(
        { success: false, error: 'User signature and address required' },
        { status: 400 }
      );
    }

    console.log('User Address:', userAddress);
    console.log('Resolution Address:', resolutionAddress);

    // Prepare update parameters
    const updateParams: any = {
      username: subname,
      ensDomain: ENS_DOMAIN,
      chainId: chainId,
      text: {
        description: description || '',
        'com.twitter': 'nydus',
        'com.github': 'nydus',
        url: 'https://nydus.app',
      },
    };

    // If resolution address is provided, update it
    if (resolutionAddress) {
      const ETH_COIN_TYPE = 60;
      updateParams.addresses = {
        [ETH_COIN_TYPE]: resolutionAddress,
      };
    }

    // Update the subname using the user's signature
    const result = await justaname.subnames.updateSubname(
      updateParams,
      {
        xMessage: challengeMessage,
        xAddress: userAddress,
        xSignature: userSignature,
      }
    );

    return NextResponse.json({
      success: true,
      data: {
        message: 'Update completed successfully!',
        subname: `${subname}.${ENS_DOMAIN}`,
        result,
      },
    });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

