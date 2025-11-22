import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import ContextProvider from '@/context'
import { AccountProvider } from '@/context/AccountProvider'
import { AccountStateProvider } from '@/context/AccountStateProvider'
import { BufferInit } from '@/components/BufferInit'
import Navbar from '@/components/Navbar'
import { AccountModalProvider } from '@/components/AccountModalProvider'
import GlitchBackground from '@/components/GlitchBackground'
import { ToastContainer } from '@/components/Toast'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Nydus',
  description: 'Private and verifiable computing platform',
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const headersObj = await headers()
  const cookies = headersObj.get('cookie')

  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Suppress COOP check errors from @base-org/account
              // The middleware already sets COOP headers correctly
              if (typeof window !== 'undefined') {
                const originalError = console.error;
                console.error = function(...args) {
                  const message = args.join(' ');
                  // Suppress the specific COOP check error
                  if (message.includes('Cross-Origin-Opener-Policy') && message.includes('HTTP error')) {
                    // Silently ignore - headers are set correctly by middleware
                    return;
                  }
                  originalError.apply(console, args);
                };
              }
            `,
          }}
        />
      </head>
      <body className={`${inter.className} text-white`}>
        <GlitchBackground />
        <BufferInit />
        <ContextProvider cookies={cookies}>
          <AccountProvider>
            <AccountStateProvider>
              <AccountModalProvider>
                <Navbar />
                <main className="relative z-10">{children}</main>
                <ToastContainer />
              </AccountModalProvider>
            </AccountStateProvider>
          </AccountProvider>
        </ContextProvider>
      </body>
    </html>
  )
}