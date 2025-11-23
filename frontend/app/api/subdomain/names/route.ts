import { NextRequest, NextResponse } from 'next/server';
import { JustaName } from '@justaname.id/sdk';
import type { ChainId } from '@justaname.id/sdk';

const ENS_DOMAIN = process.env.ENS_DOMAIN || 'nydusns.eth';
const CHAIN_ID = 11155111; // Sepolia
const PROVIDER_URL = process.env.PROVIDER_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

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

export async function GET(request: NextRequest) {
    try {
        // Get the user's address from query params
        const { searchParams } = new URL(request.url);
        const address = searchParams.get('address');

        if (!address) {
            return NextResponse.json(
                { success: false, error: 'Address parameter is required' },
                { status: 400 }
            );
        }

        const justaname = await getJustaNameInstance();
        const chainId = CHAIN_ID as ChainId;

        // Get subdomains by address using JustaName SDK
        const result = await justaname.subnames.getSubnamesByAddress({
            address: address,
            chainId: chainId,
            coinType: 60, // ETH coin type
            isClaimed: true, // Only get claimed subdomains
        });

        console.log('Subdomains for address:', address);
        console.log('Full result:', JSON.stringify(result, null, 2));

        // Transform the response to match our frontend format
        const subnames = result.subnames || [];
        const names = subnames.map((subname: any) => {
            console.log('Processing subname:', subname.ens);
            console.log('Records:', subname.records);

            // Get the description from records.texts array
            const texts = subname.records?.texts || [];
            const descriptionRecord = texts.find((t: any) => t.key === 'description');
            let description = descriptionRecord?.value || '';

            console.log('Texts array:', texts);
            console.log('Raw description:', description);

            // Try to parse as JSON and extract zkAddress for backward compatibility
            try {
                if (description) {
                    const parsed = JSON.parse(description);
                    // If it's a JSON object with zkAddress, keep the full JSON
                    // The frontend will parse it to extract zkAddress
                    if (parsed.zkAddress) {
                        // Keep the full JSON string so frontend can parse it
                        description = description;
                    }
                }
            } catch {
                // If not JSON, keep as-is (backward compatibility with old string format)
                console.log('Description is not JSON, keeping as string');
            }

            console.log('Final description:', description);

            return {
                name: subname.ens?.split('.')[0] || subname.username, // Get the subdomain part
                address: subname.records?.coins?.[0]?.value || address, // Resolution address from coins
                description: description,
            };
        });

        return NextResponse.json({
            success: true,
            data: {
                count: names.length,
                names: names,
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

