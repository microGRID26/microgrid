import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, RefreshControl, ActivityIndicator,
  Linking, AppState, TextInput,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../../lib/theme'
import { getCustomerAccount, loadDocuments } from '../../lib/api'
import { DOCUMENT_CATEGORIES } from '../../lib/constants'
import { getCache, setCache } from '../../lib/cache'
import type { CustomerDocument } from '../../lib/types'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { MgPressable } from '../../components/MgPressable'

const formatDate = (d: string) => {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const FILE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  pdf: 'file-text',
  doc: 'file-text',
  docx: 'file-text',
  xls: 'grid',
  xlsx: 'grid',
  csv: 'grid',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  heic: 'image',
  gif: 'image',
  dwg: 'layers',
  dxf: 'layers',
}

function getFileIcon(fileName: string, fileType: string | null): keyof typeof Feather.glyphMap {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return FILE_ICONS[ext] ?? FILE_ICONS[fileType ?? ''] ?? 'file'
}

const CATEGORY_COLORS: Record<string, string> = {
  Design: '#2563EB',
  Permit: '#C4922A',
  Contract: '#1D7A5F',
  Inspection: '#7C3AED',
  Other: '#6B675E',
}

export default function DocumentsScreen() {
  const colors = useThemeColors()
  const [documents, setDocuments] = useState<CustomerDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Cache first
    const cached = getCache<CustomerDocument[]>('documents')
    if (cached) {
      setDocuments(cached)
      setLoading(false)
    }

    const acct = await getCustomerAccount()
    if (!acct) { setLoading(false); return }

    const docs = await loadDocuments(acct.project_id)
    setDocuments(docs)
    setCache('documents', docs)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh on foreground
  const appActive = useRef(true)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActive.current = state === 'active'
      if (state === 'active') load()
    })
    return () => sub.remove()
  }, [load])

  useEffect(() => {
    const interval = setInterval(() => {
      if (appActive.current) load()
    }, 30000)
    return () => clearInterval(interval)
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const handleOpen = useCallback(async (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      await Linking.openURL(url)
    } catch (err) {
      console.error('[documents] failed to open URL:', err)
    }
  }, [])

  // Filter logic
  const filtered = documents.filter(doc => {
    if (activeCategory && (doc.category ?? 'Other') !== activeCategory) return false
    if (search) {
      const q = search.toLowerCase()
      return doc.file_name.toLowerCase().includes(q) ||
        (doc.category ?? '').toLowerCase().includes(q)
    }
    return true
  })

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 56 }}>
        <SkeletonLoader lines={2} />
        <SkeletonLoader lines={4} />
        <SkeletonLoader lines={4} />
      </View>
    )
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Header */}
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', marginTop: 48 }}>
        Documents
      </Text>
      <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 2, fontFamily: 'Inter_400Regular' }}>
        Your project files and records
      </Text>

      {/* Search */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
        marginTop: 20, borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <Feather name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search documents..."
          placeholderTextColor={colors.textMuted}
          style={{
            flex: 1, paddingVertical: 14, paddingHorizontal: 10,
            fontSize: 14, color: colors.text, fontFamily: 'Inter_400Regular',
          }}
        />
        {search.length > 0 && (
          <MgPressable accessibilityLabel="Clear search" onPress={() => setSearch('')} activeOpacity={0.7}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </MgPressable>
        )}
      </View>

      {/* Category Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: 12 }}
        contentContainerStyle={{ gap: 8 }}
      >
        <MgPressable
          accessibilityLabel="Filter by all categories"
          accessibilityState={{ selected: activeCategory === null }}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveCategory(null) }}
          activeOpacity={0.7}
          style={{
            paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill,
            backgroundColor: activeCategory === null ? colors.accent : colors.surface,
            borderWidth: 1, borderColor: activeCategory === null ? colors.accent : colors.borderLight,
          }}
        >
          <Text style={{
            fontSize: 12, fontFamily: 'Inter_500Medium',
            color: activeCategory === null ? colors.accentText : colors.textSecondary,
          }}>
            All
          </Text>
        </MgPressable>
        {DOCUMENT_CATEGORIES.map(cat => (
          <MgPressable
            key={cat}
            accessibilityLabel={`Filter by ${cat}`}
            accessibilityState={{ selected: activeCategory === cat }}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveCategory(activeCategory === cat ? null : cat) }}
            activeOpacity={0.7}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill,
              backgroundColor: activeCategory === cat ? colors.accent : colors.surface,
              borderWidth: 1, borderColor: activeCategory === cat ? colors.accent : colors.borderLight,
            }}
          >
            <Text style={{
              fontSize: 12, fontFamily: 'Inter_500Medium',
              color: activeCategory === cat ? colors.accentText : colors.textSecondary,
            }}>
              {cat}
            </Text>
          </MgPressable>
        ))}
      </ScrollView>

      {/* Document Count */}
      <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 16, marginBottom: 8, fontFamily: 'Inter_400Regular' }}>
        {filtered.length} document{filtered.length !== 1 ? 's' : ''}
      </Text>

      {/* Document List */}
      {filtered.length === 0 ? (
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 32, alignItems: 'center',
          borderWidth: 1, borderColor: colors.borderLight,
          ...theme.shadow.card,
        }}>
          <Feather name="folder" size={40} color={colors.textMuted} style={{ marginBottom: 12 }} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold', textAlign: 'center' }}>
            {documents.length === 0 ? 'No Documents Yet' : 'No Matching Documents'}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 }}>
            {documents.length === 0
              ? 'Project documents like permits, designs, and contracts will appear here as they are generated.'
              : 'Try adjusting your search or filter.'}
          </Text>
        </View>
      ) : (
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          borderWidth: 1, borderColor: colors.borderLight,
          overflow: 'hidden',
          ...theme.shadow.card,
        }}>
          {filtered.map((doc, i) => {
            const category = doc.category ?? 'Other'
            const catColor = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other
            return (
              <MgPressable
                key={doc.id}
                accessibilityLabel={`Open ${doc.file_name}`}
                onPress={() => handleOpen(doc.file_url)}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingHorizontal: 16, paddingVertical: 14,
                  borderBottomWidth: i < filtered.length - 1 ? 1 : 0,
                  borderBottomColor: colors.borderLight,
                }}
              >
                {/* File Icon */}
                <View style={{
                  width: 40, height: 40, borderRadius: theme.radius.md,
                  backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
                }}>
                  <Feather name={getFileIcon(doc.file_name, doc.file_type)} size={18} color={colors.accent} />
                </View>

                {/* Name + Meta */}
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}
                    numberOfLines={1}
                  >
                    {doc.file_name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
                    {/* Category Badge */}
                    <View style={{
                      backgroundColor: catColor + '18',
                      paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill,
                    }}>
                      <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: catColor }}>
                        {category}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                      {formatDate(doc.created_at)}
                    </Text>
                  </View>
                </View>

                {/* Open indicator */}
                <Feather name="external-link" size={14} color={colors.textMuted} />
              </MgPressable>
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}
