'use client'

// ── CONSTRUCTION BANNER ───────────────────────────────────────────────────────
// Drop <ConstructionBanner /> anywhere in a nav bar
// To turn off: set SHOW_BANNER = false and redeploy
const SHOW_BANNER = true

export function ConstructionBanner() {
  if (!SHOW_BANNER) return null
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 50%, #b91c1c 100%)',
      backgroundSize: '6px 6px',
      color: 'white',
      fontSize: '10px',
      fontWeight: 800,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      padding: '4px 10px',
      borderRadius: '3px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.15)',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: '#fca5a5',
        boxShadow: '0 0 4px #fca5a5',
        display: 'inline-block',
        flexShrink: 0,
      }} />
      Under Construction
    </div>
  )
}
