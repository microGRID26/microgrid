'use client'

import { useState, useEffect } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { ExternalLink, Eye, EyeOff, Phone, Clock, Globe, Shield } from 'lucide-react'

// ── AHJ permit info shape ───────────────────────────────────────────────────
interface AhjPermitInfo {
  name?: string
  permit_website?: string | null
  permit_phone?: string | null
  permit_notes?: string | null
  username?: string | null
  password?: string | null
  max_duration?: number | null
  how_to_request?: string | null
  inspection_portal?: string | null
  inspection_login?: string | null
  inspection_password?: string | null
  inspection_email?: string | null
  inspection_notes?: string | null
  electric_code?: string | null
}

interface PermitPortalCardProps {
  ahjName: string
  compact?: boolean // true = inline minimal, false = full card
}

export function PermitPortalCard({ ahjName, compact = false }: PermitPortalCardProps) {
  const [info, setInfo] = useState<AhjPermitInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreds, setShowCreds] = useState(false)
  const [showInspCreds, setShowInspCreds] = useState(false)

  useEffect(() => {
    if (!ahjName) { setLoading(false); return }
    const supabase = db()
    supabase.from('ahjs').select('*')
      .ilike('name', `%${escapeIlike(ahjName)}%`)
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: AhjPermitInfo | null }) => {
        setInfo(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [ahjName])

  if (loading) return null
  if (!info) return null

  const hasPermitPortal = !!info.permit_website
  const hasInspectionPortal = !!info.inspection_portal
  const hasAnyCreds = !!(info.username || info.password)
  const hasInspCreds = !!(info.inspection_login || info.inspection_password)
  const hasAnyInfo = hasPermitPortal || hasInspectionPortal || info.permit_phone || info.how_to_request || info.max_duration

  if (!hasAnyInfo && !hasAnyCreds) return null

  // Method badge color
  const methodColor = (method: string | null | undefined) => {
    if (!method) return 'bg-gray-800 text-gray-500'
    const m = method.toLowerCase()
    if (m.includes('online')) return 'bg-green-900/60 text-green-400'
    if (m.includes('email')) return 'bg-blue-900/60 text-blue-400'
    if (m.includes('phone')) return 'bg-amber-900/60 text-amber-400'
    return 'bg-gray-800 text-gray-400'
  }

  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2.5 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Shield size={13} className="text-green-400 flex-shrink-0" />
        <span className="text-xs font-medium text-green-400">Permit Portal</span>
        <span className="text-[10px] text-gray-500 truncate">{ahjName}</span>
      </div>

      <div className="space-y-1.5">
        {/* Portal links row */}
        <div className="flex flex-wrap items-center gap-2">
          {hasPermitPortal && (
            <a
              href={info.permit_website!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] bg-blue-900/40 text-blue-400 hover:bg-blue-800/50 px-2 py-1 rounded transition-colors"
            >
              <Globe size={11} />
              Permit Portal
              <ExternalLink size={9} />
            </a>
          )}
          {hasInspectionPortal && (
            <a
              href={info.inspection_portal!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] bg-purple-900/40 text-purple-400 hover:bg-purple-800/50 px-2 py-1 rounded transition-colors"
            >
              <Globe size={11} />
              Inspection Portal
              <ExternalLink size={9} />
            </a>
          )}
          {info.permit_phone && (
            <a
              href={`tel:${info.permit_phone}`}
              className="inline-flex items-center gap-1 text-[11px] bg-gray-700/60 text-gray-300 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
            >
              <Phone size={11} />
              {info.permit_phone}
            </a>
          )}
        </div>

        {/* Info row: method + max days */}
        <div className="flex flex-wrap items-center gap-2">
          {info.how_to_request && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${methodColor(info.how_to_request)}`}>
              {info.how_to_request}
            </span>
          )}
          {info.max_duration && (
            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
              <Clock size={10} />
              Up to {info.max_duration}d processing
            </span>
          )}
          {info.electric_code && (
            <span className="text-[10px] text-gray-500">Code: {info.electric_code}</span>
          )}
        </div>

        {/* Permit credentials */}
        {hasAnyCreds && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreds(!showCreds)}
              aria-label={showCreds ? 'Hide permit credentials' : 'Reveal permit credentials'}
              className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showCreds ? <EyeOff size={10} /> : <Eye size={10} />}
              Permit Login
            </button>
            {showCreds && (
              <div className="flex items-center gap-3 text-[10px]">
                {info.username && (
                  <span className="text-gray-400">
                    <span className="text-gray-600">User:</span> {info.username}
                  </span>
                )}
                {info.password && (
                  <span className="text-gray-400">
                    <span className="text-gray-600">Pass:</span> {info.password}
                  </span>
                )}
              </div>
            )}
            {!showCreds && (
              <span className="text-[10px] text-gray-600">••••••••</span>
            )}
          </div>
        )}

        {/* Inspection credentials */}
        {hasInspCreds && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInspCreds(!showInspCreds)}
              aria-label={showInspCreds ? 'Hide inspection credentials' : 'Reveal inspection credentials'}
              className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showInspCreds ? <EyeOff size={10} /> : <Eye size={10} />}
              Inspection Login
            </button>
            {showInspCreds && (
              <div className="flex items-center gap-3 text-[10px]">
                {info.inspection_login && (
                  <span className="text-gray-400">
                    <span className="text-gray-600">User:</span> {info.inspection_login}
                  </span>
                )}
                {info.inspection_password && (
                  <span className="text-gray-400">
                    <span className="text-gray-600">Pass:</span> {info.inspection_password}
                  </span>
                )}
                {info.inspection_email && (
                  <span className="text-gray-400">
                    <span className="text-gray-600">Email:</span> {info.inspection_email}
                  </span>
                )}
              </div>
            )}
            {!showInspCreds && (
              <span className="text-[10px] text-gray-600">••••••••</span>
            )}
          </div>
        )}

        {/* Notes */}
        {!compact && info.permit_notes && (
          <div className="text-[10px] text-gray-500 mt-1 border-t border-gray-700/50 pt-1">
            {info.permit_notes}
          </div>
        )}
      </div>
    </div>
  )
}

/** Inline "Open Portal" button for permit tasks */
export function OpenPortalButton({ ahjName }: { ahjName: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!ahjName) return
    const supabase = db()
    supabase.from('ahjs').select('permit_website')
      .ilike('name', `%${escapeIlike(ahjName)}%`)
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: { permit_website: string | null } | null }) => {
        if (data?.permit_website) setUrl(data.permit_website)
      })
      .catch(() => {})
  }, [ahjName])

  if (!url) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[10px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded font-medium flex-shrink-0 hover:bg-blue-800/50 transition-colors inline-flex items-center gap-0.5"
      title="Open AHJ permit portal"
    >
      <Globe size={9} />
      Portal
    </a>
  )
}
