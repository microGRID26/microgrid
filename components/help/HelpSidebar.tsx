'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { WHATS_NEW } from './topics/index'

interface HelpSidebarProps {
  categories: string[]
  activeCategory: string | null
  onSelect: (cat: string) => void
  topicCounts: Record<string, number>
  onTopicClick?: (topicId: string) => void
}

export function HelpSidebar({ categories, activeCategory, onSelect, topicCounts, onTopicClick }: HelpSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)

  const sidebar = (
    <div className="space-y-1">
      {/* What's New */}
      <button
        onClick={() => setWhatsNewOpen(!whatsNewOpen)}
        aria-expanded={whatsNewOpen}
        aria-controls="whats-new-menu"
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-amber-400 hover:bg-gray-800 transition-colors"
      >
        <Sparkles className="w-4 h-4" />
        <span>{"What's New"}</span>
        {whatsNewOpen ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {whatsNewOpen && (
        <div id="whats-new-menu" className="ml-4 pl-3 border-l border-amber-900/50 space-y-1 pb-2">
          {WHATS_NEW.map(item => (
            <button
              key={item.topicId}
              onClick={() => onTopicClick?.(item.topicId)}
              className="w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:text-amber-400 transition-colors rounded"
            >
              <span className="text-gray-600">{item.date}</span> {item.title}
            </button>
          ))}
        </div>
      )}

      <div className="h-px bg-gray-800 my-2" />

      {/* Categories */}
      {categories.map(cat => {
        const isActive = activeCategory === cat
        const count = topicCounts[cat] || 0
        return (
          <button
            key={cat}
            onClick={() => { onSelect(cat); setMobileOpen(false) }}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-gray-800 text-green-400 border-l-2 border-green-400 pl-[10px]'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <span>{cat}</span>
            <span className={`text-xs ${isActive ? 'text-green-500' : 'text-gray-600'}`}>{count}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      {/* Mobile toggle */}
      <div className="lg:hidden mb-4">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle categories menu"
          aria-expanded={mobileOpen}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 w-full"
        >
          <span>{activeCategory || 'Browse Categories'}</span>
          <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${mobileOpen ? 'rotate-180' : ''}`} />
        </button>
        {mobileOpen && (
          <div className="mt-2 bg-gray-900 border border-gray-800 rounded-lg p-3">
            {sidebar}
          </div>
        )}
      </div>

      {/* Desktop sticky sidebar */}
      <div className="hidden lg:block sticky top-24 w-64 shrink-0 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2">
        {sidebar}
      </div>
    </>
  )
}
