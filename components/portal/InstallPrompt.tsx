'use client'

import { useState, useEffect } from 'react'
import { Download, X, Share } from 'lucide-react'

export function InstallPrompt() {
  const [show, setShow] = useState(false)
  // BeforeInstallPromptEvent is non-standard (Chrome/Edge only), not in lib.dom.d.ts
  interface BeforeInstallPromptEvent extends Event { prompt: () => void; userChoice: Promise<{ outcome: string }> }
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Check if already installed as PWA
    // Non-standard Safari property for detecting standalone mode
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true
    setIsStandalone(standalone)
    if (standalone) return

    // Check if dismissed recently (don't show for 7 days after dismiss)
    const dismissed = localStorage.getItem('mg_install_dismissed')
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 86400000) return

    // Detect iOS — MSStream is a non-standard IE/Edge property used to exclude non-iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream
    setIsIOS(ios)

    // Android/Chrome: listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS: show manual instructions after a short delay
    if (ios) {
      setTimeout(() => setShow(true), 2000)
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const result = await deferredPrompt.userChoice
      if (result.outcome === 'accepted') {
        setShow(false)
      }
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    setShow(false)
    localStorage.setItem('mg_install_dismissed', String(Date.now()))
  }

  if (!show || isStandalone) return null

  return (
    <div className="mx-4 mb-4 rounded-2xl p-4 border relative"
      style={{ backgroundColor: 'var(--portal-accent-light)', borderColor: 'var(--portal-accent)' }}>
      <button onClick={handleDismiss} className="absolute top-3 right-3 p-1"
        style={{ color: 'var(--portal-text-muted)' }}>
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'var(--portal-accent)', color: 'var(--portal-accent-text)' }}>
          {isIOS ? <Share className="w-5 h-5" /> : <Download className="w-5 h-5" />}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--portal-text)' }}>
            Install MicroGRID
          </h3>
          {isIOS ? (
            <p className="text-xs mt-0.5" style={{ color: 'var(--portal-text-secondary)' }}>
              Tap <Share className="w-3 h-3 inline" /> then &quot;Add to Home Screen&quot; for the full app experience.
            </p>
          ) : deferredPrompt ? (
            <>
              <p className="text-xs mt-0.5" style={{ color: 'var(--portal-text-secondary)' }}>
                Add to your home screen for instant access.
              </p>
              <button onClick={handleInstall}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold"
                style={{ backgroundColor: 'var(--portal-accent)', color: 'var(--portal-accent-text)' }}>
                Install App
              </button>
            </>
          ) : (
            <p className="text-xs mt-0.5" style={{ color: 'var(--portal-text-secondary)' }}>
              Use your browser menu to &quot;Add to Home Screen&quot; for the full app experience.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
