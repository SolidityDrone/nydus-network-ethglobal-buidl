import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    // Create response
    const response = NextResponse.next();

    // Add COEP header for SharedArrayBuffer support
    // Note: COOP is set to 'unsafe-none' to allow Base Account SDK and WalletConnect to work
    // Base Account SDK requires COOP to NOT be 'same-origin'
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    response.headers.set('Cross-Origin-Opener-Policy', 'unsafe-none');
    response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
