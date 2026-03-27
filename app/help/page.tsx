'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { HelpSearch } from '@/components/help/HelpSearch'
import { HelpSidebar } from '@/components/help/HelpSidebar'
import { HelpCategory } from '@/components/help/HelpCategory'
import { CATEGORIES } from '@/components/help/topics/index'
// NOTE: At scale, ALL_TOPICS could be lazy-loaded per category via dynamic import
// to reduce initial bundle size. Currently premature — topic count is small.
import { ALL_TOPICS } from '@/components/help/topics/all-topics'

export default function HelpPage() {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set())

  // Group topics by category
  const topicsByCategory = useMemo(() => {
    const map: Record<string, typeof ALL_TOPICS> = {}
    for (const cat of CATEGORIES) map[cat] = []
    for (const t of ALL_TOPICS) {
      if (map[t.category]) map[t.category].push(t)
    }
    return map
  }, [])

  // Topic counts per category
  const topicCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const cat of CATEGORIES) counts[cat] = topicsByCategory[cat]?.length || 0
    return counts
  }, [topicsByCategory])

  // Filter topics by search query
  const filteredByCategory = useMemo(() => {
    if (!query.trim()) return topicsByCategory
    const q = query.toLowerCase()
    const map: Record<string, typeof ALL_TOPICS> = {}
    for (const cat of CATEGORIES) {
      map[cat] = (topicsByCategory[cat] || []).filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.keywords.some(k => k.includes(q))
      )
    }
    return map
  }, [query, topicsByCategory])

  // Toggle topic open/closed
  const toggleTopic = useCallback((id: string) => {
    setOpenTopics(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Scroll to and open a topic by id
  const scrollToTopic = useCallback((id: string) => {
    setOpenTopics(prev => new Set(prev).add(id))
    setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }, [])

  // Handle category click -- scroll to section
  const handleCategorySelect = useCallback((cat: string) => {
    setActiveCategory(cat)
    const slug = `cat-${cat.toLowerCase().replace(/\s+/g, '-')}`
    setTimeout(() => {
      const el = document.getElementById(slug)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [])

  // Hash-based deep linking on mount
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash) {
      const topic = ALL_TOPICS.find(t => t.id === hash)
      if (topic) {
        setActiveCategory(topic.category)
        scrollToTopic(hash)
      }
    }
  }, [scrollToTopic])

  // Count total filtered results
  const totalFiltered = useMemo(() =>
    CATEGORIES.reduce((sum, cat) => sum + (filteredByCategory[cat]?.length || 0), 0),
  [filteredByCategory])

  return (
    <div className="min-h-screen bg-gray-950">
      <Nav active="Help" />

      {/* Hero */}
      <div className="bg-green-700 px-8 py-8">
        <h1 className="text-2xl font-bold text-white">MicroGRID Help Center</h1>
        <p className="text-green-100 text-sm mt-1 mb-4">Search topics or browse by category</p>
        <HelpSearch query={query} onChange={setQuery} />
      </div>

      {/* Search results indicator */}
      {query.trim() && (
        <div className="bg-gray-900 border-b border-gray-800 px-8 py-2 text-xs text-gray-500">
          {totalFiltered} topic{totalFiltered !== 1 ? 's' : ''} matching &quot;{query}&quot;
        </div>
      )}

      {/* Main layout: sidebar + content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 pb-16 flex gap-8">
        <HelpSidebar
          categories={CATEGORIES}
          activeCategory={activeCategory}
          onSelect={handleCategorySelect}
          topicCounts={topicCounts}
          onTopicClick={scrollToTopic}
        />

        <div className="flex-1 min-w-0 space-y-8">
          {CATEGORIES.map(cat => {
            const topics = filteredByCategory[cat]
            if (!topics || topics.length === 0) return null
            return (
              <HelpCategory
                key={cat}
                category={cat}
                topics={topics}
                openTopics={openTopics}
                onToggle={toggleTopic}
                onRelatedClick={scrollToTopic}
                allTopics={ALL_TOPICS}
              />
            )
          })}

          {totalFiltered === 0 && query.trim() && (
            <div className="text-center py-16">
              <div className="text-gray-500 text-sm">No topics match your search.</div>
              <button onClick={() => setQuery('')} className="text-green-400 text-sm mt-2 hover:underline">
                Clear search
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
