'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface ExportPreset {
  name: string
  keys: string[]
}

export interface UserPreferences {
  homepage: string
  default_pm_filter: string | null
  collapsed_sections: Record<string, boolean>
  queue_card_fields: string[]
  export_presets: ExportPreset[]
}

const DEFAULTS: UserPreferences = {
  homepage: '/command',
  default_pm_filter: null,
  collapsed_sections: {},
  queue_card_fields: ['name', 'city', 'financier', 'contract'],
  export_presets: [],
}

const LS_KEY = 'mg_user_prefs'

function loadFromLS(): Partial<UserPreferences> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveToLS(prefs: UserPreferences) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)) } catch {}
}

let cachedPrefs: UserPreferences | null = null
let cachedUserId: string | null = null
let initInProgress = false

export function usePreferences() {
  const [prefs, setPrefs] = useState<UserPreferences>(cachedPrefs ?? { ...DEFAULTS, ...loadFromLS() })
  const [loaded, setLoaded] = useState(!!cachedPrefs)
  const prefsRef = useRef(prefs)
  useEffect(() => { prefsRef.current = prefs }, [prefs])

  useEffect(() => {
    const supabase = createClient()

    // Clear cache on sign out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        cachedPrefs = null
        cachedUserId = null
        initInProgress = false
        setPrefs({ ...DEFAULTS })
      }
    })

    if (cachedPrefs) return () => subscription.unsubscribe()

    // Prevent double initialization from concurrent hook mounts (#24)
    if (initInProgress) return () => subscription.unsubscribe()
    initInProgress = true

    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id
      if (!uid) { setLoaded(true); return }
      cachedUserId = uid

      const { data: row } = await (supabase as any)
        .from('user_preferences')
        .select('*')
        .eq('user_id', uid)
        .single()

      if (row) {
        const merged: UserPreferences = {
          homepage: row.homepage ?? DEFAULTS.homepage,
          default_pm_filter: row.default_pm_filter ?? DEFAULTS.default_pm_filter,
          collapsed_sections: row.collapsed_sections ?? DEFAULTS.collapsed_sections,
          queue_card_fields: row.queue_card_fields ?? DEFAULTS.queue_card_fields,
          export_presets: row.export_presets ?? DEFAULTS.export_presets,
        }
        cachedPrefs = merged
        setPrefs(merged)
        saveToLS(merged)
      } else {
        // No DB row yet — use LS fallback merged with defaults
        const ls = loadFromLS()
        const merged = { ...DEFAULTS, ...ls }
        cachedPrefs = merged
        setPrefs(merged)
      }
      setLoaded(true)
    }).catch(() => {
      setLoaded(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  const updatePref = useCallback(async <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    const next = { ...prefsRef.current, [key]: value }
    cachedPrefs = next
    setPrefs(next)
    saveToLS(next)

    // Persist to DB
    const supabase = createClient()
    if (!cachedUserId) {
      const { data } = await supabase.auth.getUser()
      cachedUserId = data.user?.id ?? null
    }
    if (!cachedUserId) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('user_preferences')
        .upsert({
          user_id: cachedUserId,
          [key]: value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
      if (error) console.error('usePreferences: DB upsert failed:', error)
    } catch (err) {
      console.error('usePreferences: DB upsert error:', err)
    }
  }, [])

  return { prefs, updatePref, loaded }
}
