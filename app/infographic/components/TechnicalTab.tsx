'use client'

import { CascadeSection } from './CascadeSection'
import { CODEBASE_STATS } from '@/lib/infographic/codebase-stats'

interface TechnicalTabProps {
  stats: {
    totalProjects: number
    noteCount: number
    ahjCount: number
    equipmentCount: number
    legacyRecordsCount: number
  }
}

const fmtN = (n: number): string => n.toLocaleString('en-US')
const fmtGenerated = (iso: string): string => {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function TechnicalTab({ stats }: TechnicalTabProps) {
  return (
    <div className="space-y-8 md:space-y-14">

      {/* HERO — The Scale (auto-refreshed at build time from scripts/generate-codebase-stats.mjs) */}
      <div className="text-center py-6 md:py-10 relative">
        <div className="absolute inset-0 rounded-3xl" style={{ background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-3 font-semibold">What Powers MicroGRID</div>
        <div className="animate-count text-4xl md:text-6xl font-black bg-gradient-to-r from-blue-400 via-green-400 to-purple-400 bg-clip-text text-transparent tracking-tight">
          {fmtN(CODEBASE_STATS.loc_total)}
        </div>
        <div className="animate-count text-base md:text-lg text-gray-400 mt-2" style={{ animationDelay: '0.2s' }}>
          Lines of Code
        </div>
        <div className="flex justify-center gap-4 md:gap-8 mt-6 flex-wrap">
          {[
            { n: fmtN(CODEBASE_STATS.app_source_files), label: 'Source Files' },
            { n: fmtN(CODEBASE_STATS.pages), label: 'Pages' },
            { n: fmtN(CODEBASE_STATS.components), label: 'Components' },
            { n: fmtN(CODEBASE_STATS.api_modules), label: 'API Modules' },
            { n: fmtN(CODEBASE_STATS.test_count), label: 'Automated Tests' },
            { n: fmtN(CODEBASE_STATS.max_migration_number), label: 'DB Migrations' },
          ].map(s => (
            <div key={s.label} className="text-center animate-count" style={{ animationDelay: '0.4s' }}>
              <div className="text-lg md:text-2xl font-black text-white">{s.n}</div>
              <div className="text-[10px] text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="text-[9px] text-gray-600 mt-4 italic">
          Auto-generated {fmtGenerated(CODEBASE_STATS.generated_at)} from the live codebase.
        </div>
      </div>

      {/* THE BUILDING — Architecture as a building */}
      <div>
        <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">Think of it Like a Building</h2>
        <p className="text-sm text-gray-400 mb-5">Every software system has layers, like a building. Here&apos;s how MicroGRID is constructed from the ground up.</p>
        <div className="space-y-0">
          {/* Roof — Security */}
          <div className="rounded-t-2xl px-5 py-5 border border-b-0 border-purple-500/30 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(139,92,246,0.02))' }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-600 via-purple-400 to-purple-600" />
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ backgroundColor: '#8b5cf620' }}>
                <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-purple-400 mb-1">The Roof — Security & Protection</div>
                <p className="text-xs text-gray-400 mb-3">Like a building&apos;s roof keeps out the elements, our security layer keeps out unauthorized access and protects data.</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {['Google login only — no passwords to steal', 'Every table has row-level locks per organization', '6-tier role system (admin down to sales)', 'All external connections verified with digital signatures'].map(item => (
                    <div key={item} className="text-[10px] text-purple-300/80 bg-purple-500/10 rounded-lg px-3 py-2">{item}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Floor 3 — What Users See */}
          <div className="px-5 py-5 border border-b-0 border-blue-500/30" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.06), rgba(59,130,246,0.01))' }}>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ backgroundColor: '#3b82f620' }}>
                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-blue-400 mb-1">The Rooms — {CODEBASE_STATS.pages} Pages You Use Every Day</div>
                <p className="text-xs text-gray-400 mb-3">Each page is a room designed for a specific job. They all share the same building structure, but each is furnished for its purpose.</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { name: 'Command', color: '#1D9E75' }, { name: 'Queue', color: '#3b82f6' }, { name: 'Pipeline', color: '#f59e0b' },
                    { name: 'Analytics', color: '#8b5cf6' }, { name: 'Schedule', color: '#ec4899' }, { name: 'Funding', color: '#22c55e' },
                    { name: 'Tickets', color: '#ef4444' }, { name: 'Commissions', color: '#06b6d4' }, { name: 'Ramp-Up', color: '#f97316' },
                    { name: 'Inventory', color: '#a855f7' }, { name: 'Planset', color: '#14b8a6' }, { name: 'EDGE Portal', color: '#6366f1' },
                    { name: 'Customer App', color: '#84cc16' }, { name: `+ ${Math.max(0, CODEBASE_STATS.pages - 13)} more`, color: '#6b7280' },
                  ].map(p => (
                    <span key={p.name} className="text-[10px] px-2 py-1 rounded-md font-medium" style={{ backgroundColor: `${p.color}15`, color: p.color, border: `1px solid ${p.color}30` }}>{p.name}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Floor 2 — The Engine */}
          <div className="px-5 py-5 border border-b-0 border-green-500/30" style={{ background: 'linear-gradient(135deg, rgba(29,158,117,0.06), rgba(29,158,117,0.01))' }}>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ backgroundColor: '#1D9E7520' }}>
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-green-400 mb-1">The Engine Room — {CODEBASE_STATS.api_modules} API Modules, {CODEBASE_STATS.api_exports.toLocaleString()}+ Functions</div>
                <p className="text-xs text-gray-400 mb-3">This is the brain. When you click &quot;Complete&quot; on a task, the engine decides what happens next: advance the stage, trigger funding, notify the crew, update the schedule — all automatically.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/20">
                    <div className="text-[10px] font-bold text-green-400 mb-1">Automation Chain</div>
                    <div className="text-[10px] text-gray-400">Task complete → auto-advance stage → trigger funding milestone → notify EDGE portal → update schedule — zero manual steps</div>
                  </div>
                  <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/20">
                    <div className="text-[10px] font-bold text-green-400 mb-1">Real-Time Sync</div>
                    <div className="text-[10px] text-gray-400">When one person makes a change, everyone sees it instantly. No refresh needed. Like a shared Google Doc but for your entire operation.</div>
                  </div>
                  <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/20">
                    <div className="text-[10px] font-bold text-green-400 mb-1">AI Assistant (Atlas)</div>
                    <div className="text-[10px] text-gray-400">Ask questions in plain English. Atlas reads your live data and answers instantly. No SQL, no reports to build, no waiting.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Foundation — Database */}
          <div className="rounded-b-2xl px-5 py-5 border border-amber-500/30 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))' }}>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600" />
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ backgroundColor: '#f59e0b20' }}>
                <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-amber-400 mb-1">The Foundation — 165+ Database Tables</div>
                <p className="text-xs text-gray-400 mb-3">The foundation holds everything. Every project, every task, every note, every dollar — stored in a PostgreSQL database with {CODEBASE_STATS.max_migration_number} migrations applied over time, like blueprints for the foundation.</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    { n: stats.totalProjects.toLocaleString(), l: 'Active Projects' },
                    { n: stats.legacyRecordsCount.toLocaleString(), l: 'Legacy Records' },
                    { n: stats.noteCount.toLocaleString(), l: 'Notes & Updates' },
                    { n: stats.ahjCount.toLocaleString(), l: 'Permit Authorities' },
                    { n: stats.equipmentCount.toLocaleString(), l: 'Equipment Items' },
                  ].map(s => (
                    <div key={s.l} className="text-center bg-amber-500/5 rounded-lg py-2 border border-amber-500/20">
                      <div className="text-sm font-bold text-amber-400">{s.n}</div>
                      <div className="text-[9px] text-gray-500">{s.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* WHAT HAPPENS WHEN — The click story (scroll-triggered cascade) */}
      <CascadeSection />

      {/* CONNECTED SYSTEMS — The neighborhood */}
      <div>
        <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">Connected Systems</h2>
        <p className="text-sm text-gray-400 mb-5">MicroGRID doesn&apos;t work alone. It&apos;s connected to external services — like a building connected to power, water, and roads.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { name: 'EDGE Portal', desc: 'Financier portal for funding milestones. Bidirectional — sends and receives updates.', color: '#6366f1', icon: '🏦' },
            { name: 'Spark Sales', desc: 'Proposal builder with roof designer, pricing, and e-signature. Feeds contracts into MicroGRID.', color: '#ec4899', icon: '⚡' },
            { name: 'Google Calendar', desc: 'Crew schedules sync to Google Calendar. Webhook notifications when events change.', color: '#3b82f6', icon: '📅' },
            { name: 'SubHub', desc: 'Contract submission platform. New deals arrive via secure webhook and auto-create projects.', color: '#f59e0b', icon: '📝' },
            { name: 'Resend Email', desc: '30-day onboarding drip, daily PM digest, announcement broadcasts.', color: '#22c55e', icon: '📧' },
            { name: 'Sentry', desc: 'Error monitoring. If something breaks in production, we know within seconds.', color: '#ef4444', icon: '🔔' },
            { name: 'Vercel', desc: 'Auto-deploys on every code push. Global CDN. Zero-downtime updates.', color: '#f8f8f8', icon: '🚀' },
            { name: 'Customer App', desc: 'Native iOS/Android app. Push notifications. AI chat. Real-time project status.', color: '#84cc16', icon: '📱' },
          ].map(s => (
            <div key={s.name} className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className="text-xs font-bold text-white mb-1">{s.name}</div>
              <div className="text-[10px] text-gray-500">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* QUALITY — How we keep it reliable */}
      <div>
        <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">How We Keep It Reliable</h2>
        <p className="text-sm text-gray-400 mb-5">Before any change goes live, it goes through a rigorous process — like a building inspector checking every weld.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { step: 'Build', icon: '🔨', desc: 'New feature or fix is written. Every change touches specific files — nothing breaks something unrelated.', color: '#3b82f6' },
            { step: 'Test', icon: '🧪', desc: `${CODEBASE_STATS.test_count.toLocaleString()} automated tests run. Every business rule, every calculation, every API endpoint verified in seconds.`, color: '#1D9E75' },
            { step: 'Audit', icon: '🔍', desc: 'Two-round code audit. Check for security issues, performance problems, edge cases. Fix anything found.', color: '#f59e0b' },
            { step: 'Ship', icon: '🚀', desc: 'Code pushed to production. Vercel auto-deploys. Zero downtime. Error monitoring active. Users see changes instantly.', color: '#22c55e' },
          ].map((s, i) => (
            <div key={s.step} className="relative">
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 text-center h-full">
                <div className="text-3xl mb-2">{s.icon}</div>
                <div className="text-sm font-bold" style={{ color: s.color }}>{s.step}</div>
                <p className="text-[10px] text-gray-400 mt-2">{s.desc}</p>
              </div>
              {i < 3 && <div className="hidden md:block absolute top-1/2 -right-2 text-gray-600 text-lg z-10">&rarr;</div>}
            </div>
          ))}
        </div>
        <div className="bg-gradient-to-r from-green-900/20 to-green-900/5 border border-green-800/30 rounded-xl p-4 text-center mt-4">
          <div className="text-sm text-gray-300">Every feature follows this protocol. <span className="text-green-400 font-bold">No exceptions.</span></div>
          <div className="text-[10px] text-gray-500 mt-1">Build → Test → Audit Round 1 → Fix → Audit Round 2 → Fix → Document → Ship</div>
        </div>
      </div>

      {/* AUDIT SCORECARD */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Current Health — Audit Scorecard</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { grade: 'A', label: 'Security', desc: '0 critical issues. HMAC webhooks. Rate limiting. CSP headers.', color: '#22c55e' },
            { grade: 'A', label: 'Reliability', desc: `${CODEBASE_STATS.test_count.toLocaleString()} automated tests. ${CODEBASE_STATS.test_files} test files. ${CODEBASE_STATS.error_boundaries} error boundaries.`, color: '#22c55e' },
            { grade: 'A', label: 'Data Integrity', desc: 'M1/M2/M3 validation. Audit trail. Milestone triggers.', color: '#22c55e' },
            { grade: 'B', label: 'Scale Readiness', desc: 'Indexed foreign keys. Postgres aggregation. Ready for 5K projects.', color: '#3b82f6' },
          ].map(s => (
            <div key={s.label}>
              <div className="text-4xl font-black" style={{ color: s.color }}>{s.grade}</div>
              <div className="text-xs font-bold text-white mt-1">{s.label}</div>
              <div className="text-[10px] text-gray-500 mt-1">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
