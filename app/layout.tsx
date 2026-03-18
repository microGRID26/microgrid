import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], preload: false })

export const metadata: Metadata = {
  title: 'MicroGRID CRM',
  description: 'MicroGRID CRM',
}

// ── CONSTRUCTION BANNER ───────────────────────────────────────────────────────
// Set to false when the CRM is ready for full use
export const SHOW_BANNER = true

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
