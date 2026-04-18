import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { FeedbackButton } from '@/components/FeedbackButton'
import { SessionTracker } from '@/components/SessionTracker'
import { Providers } from '@/components/Providers'
import { AskAtlasWidget } from '@/components/atlas/AskAtlasWidget'

const inter = Inter({ subsets: ['latin'], preload: false })

export const metadata: Metadata = {
  title: 'MicroGRID CRM',
  description: 'MicroGRID CRM',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#030712',
}

// ── CONSTRUCTION BANNER ───────────────────────────────────────────────────────
// Set to false when the CRM is ready for full use
export const SHOW_BANNER = false

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="bg-gray-950">
      <body className={`${inter.className} bg-gray-950`}>
        <Providers>
          {children}
        </Providers>
        <FeedbackButton />
        <AskAtlasWidget />
        <SessionTracker />
      </body>
    </html>
  )
}
