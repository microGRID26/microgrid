'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { lookupByBarcode, checkoutFromWarehouse, checkinToWarehouse } from '@/lib/api/inventory'
import type { WarehouseStock } from '@/lib/api/inventory'
import { cn, escapeIlike } from '@/lib/utils'
import { Camera, Search, Package, ArrowUpFromLine, ArrowDownToLine, X, Check, ChevronLeft } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface ProjectOption {
  id: string
  name: string
}

// ── BarcodeDetector type declaration ─────────────────────────────────────────

interface BarcodeDetectorResult {
  rawValue: string
  format: string
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts?: { formats: string[] }): {
        detect: (source: ImageBitmapSource) => Promise<BarcodeDetectorResult[]>
      }
      getSupportedFormats?: () => Promise<string[]>
    }
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onDone }: { message: string; type?: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className={cn(
      'fixed bottom-24 left-1/2 -translate-x-1/2 z-50 text-sm px-5 py-3 rounded-xl shadow-xl max-w-[90vw] text-center',
      type === 'success' ? 'bg-green-800 text-green-100' : 'bg-red-800 text-red-100'
    )}>
      {message}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function MobileScanPage() {
  const { user, loading: authLoading } = useCurrentUser()
  const supabase = createClient()

  // Scanner state
  const [scannerActive, setScannerActive] = useState(false)
  const [hasBarcodeAPI, setHasBarcodeAPI] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [scanning, setScanning] = useState(false)

  // Found item
  const [foundItem, setFoundItem] = useState<WarehouseStock | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Action state
  const [action, setAction] = useState<'checkout' | 'checkin' | null>(null)
  const [projectSearch, setProjectSearch] = useState('')
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null)
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [processing, setProcessing] = useState(false)

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check BarcodeDetector availability
  useEffect(() => {
    setHasBarcodeAPI(typeof window !== 'undefined' && 'BarcodeDetector' in window)
  }, [])

  // ── Camera / Barcode scanning ──────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
    setScannerActive(false)
  }, [])

  const startCamera = useCallback(async () => {
    if (!hasBarcodeAPI) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setScannerActive(true)

      // Start scanning loop
      const detector = new window.BarcodeDetector!({ formats: ['ean_13', 'ean_8', 'qr_code', 'code_128', 'code_39', 'upc_a', 'upc_e'] })

      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return
        try {
          const barcodes = await detector.detect(videoRef.current)
          if (barcodes.length > 0) {
            const value = barcodes[0].rawValue
            if (value) {
              stopCamera()
              handleLookup(value)
            }
          }
        } catch {
          // Ignore detection errors
        }
      }, 500)
    } catch (err) {
      console.error('[startCamera]', err)
      setToast({ message: 'Could not access camera. Check permissions.', type: 'error' })
    }
  }, [hasBarcodeAPI, stopCamera]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  // ── Barcode lookup ─────────────────────────────────────────────────────────

  async function handleLookup(barcode: string) {
    if (!barcode.trim()) return
    setScanning(true)
    setLookupError(null)
    setFoundItem(null)
    setAction(null)

    const item = await lookupByBarcode(barcode.trim())
    if (item) {
      setFoundItem(item)
      setManualInput(barcode.trim())
    } else {
      setLookupError(`No item found for barcode "${barcode.trim()}"`)
    }
    setScanning(false)
  }

  // ── Project search ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!projectSearch.trim() || projectSearch.length < 2) {
      setProjectOptions([])
      return
    }

    const timeout = setTimeout(async () => {
      const escaped = escapeIlike(projectSearch.trim())
      const { data } = await supabase
        .from('projects')
        .select('id, name')
        .or(`id.ilike.%${escaped}%,name.ilike.%${escaped}%`)
        .limit(10)

      if (data) {
        setProjectOptions(data.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
      }
    }, 300)

    return () => clearTimeout(timeout)
  }, [projectSearch, supabase])

  // ── Checkout / Checkin ─────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!foundItem || !action || !user?.name) return
    if (action === 'checkout' && !selectedProject) return
    if (quantity <= 0) return
    if (action === 'checkin' && quantity > 10000) {
      setToast({ message: 'Maximum check-in quantity is 10,000', type: 'error' })
      return
    }

    setProcessing(true)
    let ok = false

    if (action === 'checkout' && selectedProject) {
      ok = await checkoutFromWarehouse(
        foundItem.id,
        quantity,
        selectedProject.id,
        user.name,
        notes.trim() || undefined
      )
    } else if (action === 'checkin') {
      ok = await checkinToWarehouse(
        foundItem.id,
        quantity,
        user.name,
        notes.trim() || undefined
      )
    }

    if (ok) {
      // Re-fetch from database to get true current quantity instead of optimistic update
      const refreshed = await lookupByBarcode(foundItem.barcode || '')
      if (refreshed) {
        setFoundItem(refreshed)
      } else {
        // Fallback to optimistic if re-fetch fails (item still exists)
        const newQty = action === 'checkout'
          ? foundItem.quantity_on_hand - quantity
          : foundItem.quantity_on_hand + quantity
        setFoundItem({ ...foundItem, quantity_on_hand: newQty })
      }
      setToast({
        message: action === 'checkout'
          ? `Checked out ${quantity} ${foundItem.unit}(s) to ${selectedProject!.id}`
          : `Checked in ${quantity} ${foundItem.unit}(s)`,
        type: 'success'
      })
      // Reset action
      setAction(null)
      setQuantity(1)
      setNotes('')
      setSelectedProject(null)
      setProjectSearch('')
    } else {
      setToast({
        message: action === 'checkout'
          ? 'Checkout failed - item may have been modified'
          : 'Check-in failed',
        type: 'error'
      })
    }
    setProcessing(false)
  }

  function resetScan() {
    setFoundItem(null)
    setLookupError(null)
    setManualInput('')
    setAction(null)
    setQuantity(1)
    setNotes('')
    setSelectedProject(null)
    setProjectSearch('')
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-dvh bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        <a href="/mobile/field" className="p-1 -ml-1 text-gray-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </a>
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-green-400" />
          <span className="font-semibold text-sm">Scan Item</span>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-lg mx-auto">

        {/* Camera viewfinder */}
        {hasBarcodeAPI && !foundItem && (
          <div className="relative bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
            {scannerActive ? (
              <div className="relative">
                <video
                  ref={videoRef}
                  className="w-full h-48 object-cover"
                  playsInline
                  muted
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-24 border-2 border-green-400/50 rounded-lg" />
                </div>
                <button
                  onClick={stopCamera}
                  className="absolute top-2 right-2 min-h-[36px] min-w-[36px] bg-gray-900/80 rounded-full flex items-center justify-center"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-green-400 bg-gray-900/80 px-3 py-1 rounded-full">
                  Point at barcode...
                </div>
              </div>
            ) : (
              <button
                onClick={startCamera}
                className="w-full py-8 flex flex-col items-center gap-2 text-gray-400 hover:text-green-400 transition-colors"
              >
                <Camera className="w-8 h-8" />
                <span className="text-sm">Tap to open camera scanner</span>
              </button>
            )}
          </div>
        )}

        {!hasBarcodeAPI && !foundItem && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
            <Camera className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-500">Camera scanning not supported in this browser.</p>
            <p className="text-xs text-gray-500">Use manual entry below.</p>
          </div>
        )}

        {/* Manual entry */}
        {!foundItem && (
          <div className="space-y-2">
            <label className="text-xs text-gray-400 block">
              {hasBarcodeAPI ? 'Or enter barcode manually:' : 'Enter barcode / item number:'}
            </label>
            <div className="flex gap-2">
              <input
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup(manualInput)}
                placeholder="Scan or type barcode..."
                maxLength={255}
                className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 font-mono min-h-[44px]"
                autoFocus={!hasBarcodeAPI}
              />
              <button
                onClick={() => handleLookup(manualInput)}
                disabled={!manualInput.trim() || scanning}
                className="min-h-[44px] min-w-[44px] bg-green-700 rounded-xl flex items-center justify-center disabled:opacity-50"
              >
                <Search className="w-5 h-5 text-white" />
              </button>
            </div>
            {scanning && <p className="text-xs text-gray-500">Looking up...</p>}
            {lookupError && <p className="text-xs text-red-400">{lookupError}</p>}
          </div>
        )}

        {/* Found item display */}
        {foundItem && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">{foundItem.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{foundItem.category}</p>
              </div>
              <button
                onClick={resetScan}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-gray-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-800 rounded-lg p-2 text-center">
                <div className="text-xs text-gray-400">On Hand</div>
                <div className="text-lg font-bold font-mono text-white">{foundItem.quantity_on_hand}</div>
                <div className="text-xs text-gray-500">{foundItem.unit}</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-2 text-center">
                <div className="text-xs text-gray-400">Location</div>
                <div className="text-sm font-medium text-white mt-1">{foundItem.location || '\u2014'}</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-2 text-center">
                <div className="text-xs text-gray-400">Barcode</div>
                <div className="text-xs font-mono text-gray-300 mt-1 break-all">{foundItem.barcode || '\u2014'}</div>
              </div>
            </div>

            {/* Action buttons */}
            {!action && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => { setAction('checkout'); setQuantity(1) }}
                  disabled={foundItem.quantity_on_hand <= 0}
                  className="min-h-[48px] bg-red-900/40 border border-red-700/50 rounded-xl flex items-center justify-center gap-2 text-red-300 hover:bg-red-900/60 transition-colors disabled:opacity-40"
                >
                  <ArrowUpFromLine className="w-4 h-4" />
                  <span className="text-sm font-medium">Checkout</span>
                </button>
                <button
                  onClick={() => { setAction('checkin'); setQuantity(1) }}
                  className="min-h-[48px] bg-green-900/40 border border-green-700/50 rounded-xl flex items-center justify-center gap-2 text-green-300 hover:bg-green-900/60 transition-colors"
                >
                  <ArrowDownToLine className="w-4 h-4" />
                  <span className="text-sm font-medium">Check In</span>
                </button>
              </div>
            )}

            {/* Checkout form */}
            {action === 'checkout' && (
              <div className="space-y-3 pt-2 border-t border-gray-800">
                <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                  <ArrowUpFromLine className="w-4 h-4" /> Checkout for Project
                </h3>

                {/* Project search */}
                <div className="relative">
                  <label className="text-xs text-gray-400 block mb-1">Project *</label>
                  <input
                    value={selectedProject ? `${selectedProject.id} - ${selectedProject.name}` : projectSearch}
                    onChange={e => {
                      setSelectedProject(null)
                      setProjectSearch(e.target.value)
                      setDropdownOpen(true)
                    }}
                    onFocus={() => setDropdownOpen(true)}
                    placeholder="Search project ID or name..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 min-h-[44px]"
                  />
                  {dropdownOpen && projectOptions.length > 0 && !selectedProject && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                      {projectOptions.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedProject(p); setProjectSearch(''); setDropdownOpen(false) }}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-gray-700 transition-colors min-h-[44px]"
                        >
                          <span className="text-green-400 font-mono">{p.id}</span>
                          <span className="text-gray-400 ml-2">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    max={foundItem.quantity_on_hand}
                    value={quantity}
                    onChange={e => setQuantity(Math.max(1, Math.min(foundItem.quantity_on_hand, parseInt(e.target.value) || 1)))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Notes</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Optional..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white resize-none placeholder-gray-600"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setAction(null)}
                    className="flex-1 min-h-[48px] bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!selectedProject || quantity <= 0 || processing}
                    className="flex-1 min-h-[48px] bg-red-700 rounded-xl text-sm text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {processing ? 'Processing...' : (
                      <>
                        <Check className="w-4 h-4" /> Confirm Checkout
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Checkin form */}
            {action === 'checkin' && (
              <div className="space-y-3 pt-2 border-t border-gray-800">
                <h3 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                  <ArrowDownToLine className="w-4 h-4" /> Check In / Return
                </h3>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={quantity}
                    onChange={e => setQuantity(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white min-h-[44px]"
                  />
                  {quantity > 10000 && (
                    <p className="text-xs text-red-400 mt-1">Maximum check-in quantity is 10,000</p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Notes</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="e.g., Returned from PROJ-12345..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white resize-none placeholder-gray-600"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setAction(null)}
                    className="flex-1 min-h-[48px] bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={quantity <= 0 || processing}
                    className="flex-1 min-h-[48px] bg-green-700 rounded-xl text-sm text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {processing ? 'Processing...' : (
                      <>
                        <Check className="w-4 h-4" /> Confirm Check In
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scan another */}
        {foundItem && !action && (
          <button
            onClick={resetScan}
            className="w-full min-h-[48px] bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-300 flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4" /> Scan Another Item
          </button>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  )
}
