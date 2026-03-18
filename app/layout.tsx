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
const SHOW_BANNER = true

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {SHOW_BANNER && (
          <div style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 9999,
            backgroundColor: '#dc2626',
            color: 'white',
            fontWeight: 800,
            fontSize: '11px',
            letterSpacing: '0.08em',
            padding: '6px 12px 6px 10px',
            borderRadius: '4px 4px 4px 0px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            userSelect: 'none',
            clipPath: 'polygon(0 0, 100% 0, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
          }}>
            🚧 UNDER CONSTRUCTION
          </div>
        )}
        {children}
      </body>
    </html>
  )
}
