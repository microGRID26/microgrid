import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../lib/theme'
import { getCustomerAccount, loadProjectActivity } from '../lib/api'
import { getCache, setCache } from '../lib/cache'
import type { ActivityItem, ActivityKind } from '../lib/types'
import { ErrorState } from '../components/ErrorState'
import type { ComponentProps } from 'react'

type FeatherName = ComponentProps<typeof Feather>['name']

const formatDateHeader = (d: string) => {
  const date = new Date(d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const evt = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (evt.getTime() === today.getTime()) return 'Today'
  if (evt.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: evt.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

const formatTime = (d: string) =>
  new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

const KIND_META: Record<ActivityKind, { icon: FeatherName; tone: 'accent' | 'info' | 'warm' | 'neutral' }> = {
  stage: { icon: 'flag', tone: 'accent' },
  schedule: { icon: 'calendar', tone: 'info' },
  ticket_opened: { icon: 'alert-circle', tone: 'warm' },
  ticket_resolved: { icon: 'check-circle', tone: 'accent' },
}

interface ListHeader { kind: 'header'; id: string; date: string }
interface ListEntry { kind: 'entry'; id: string; item: ActivityItem }
type ListRow = ListHeader | ListEntry

function groupByDate(items: ActivityItem[]): ListRow[] {
  const rows: ListRow[] = []
  let lastDate = ''
  for (const item of items) {
    const d = new Date(item.ts)
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (dayKey !== lastDate) {
      rows.push({ kind: 'header', id: `h:${dayKey}`, date: item.ts })
      lastDate = dayKey
    }
    rows.push({ kind: 'entry', id: item.id, item })
  }
  return rows
}

export default function ActivityScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setError(false)
      const cached = getCache<ActivityItem[]>('activity')
      if (cached) {
        setItems(cached)
        setLoading(false)
      }
      const acct = await getCustomerAccount()
      if (!acct) { setError(true); setLoading(false); return }
      const activity = await loadProjectActivity(acct.project_id)
      setItems(activity)
      setCache('activity', activity)
      setLoading(false)
    } catch (err) {
      console.error('[ActivityScreen]', err)
      setError(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const onEntryPress = useCallback((item: ActivityItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if ((item.kind === 'ticket_opened' || item.kind === 'ticket_resolved') && item.metadata.ticket_id) {
      // Use param form so expo-router URL-encodes the segment instead of
      // string-interpolating an unsanitized value into a path.
      router.push({ pathname: '/ticket/[id]', params: { id: item.metadata.ticket_id } })
    }
  }, [router])

  const rows = groupByDate(items)

  const toneColor = (tone: 'accent' | 'info' | 'warm' | 'neutral') => {
    switch (tone) {
      case 'accent': return colors.accent
      case 'info': return colors.info
      case 'warm': return colors.warm
      case 'neutral': return colors.textMuted
    }
  }

  const toneBg = (tone: 'accent' | 'info' | 'warm' | 'neutral') => {
    switch (tone) {
      case 'accent': return colors.accentLight
      case 'info': return colors.infoLight
      case 'warm': return colors.warmLight
      case 'neutral': return colors.surfaceAlt
    }
  }

  const renderRow = ({ item: row }: { item: ListRow }) => {
    if (row.kind === 'header') {
      return (
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>
          <Text style={{
            fontSize: 11, fontWeight: '600', color: colors.textMuted,
            fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.6,
          }}>
            {formatDateHeader(row.date)}
          </Text>
        </View>
      )
    }
    const { item } = row
    const meta = KIND_META[item.kind]
    const tappable = item.kind === 'ticket_opened' || item.kind === 'ticket_resolved'
    const Wrapper = tappable ? TouchableOpacity : View
    return (
      <Wrapper
        {...(tappable ? { onPress: () => onEntryPress(item), activeOpacity: 0.7 } : {})}
        style={{
          flexDirection: 'row', gap: 12, alignItems: 'flex-start',
          paddingHorizontal: 16, paddingVertical: 12,
          backgroundColor: colors.surface,
          marginHorizontal: 12, borderRadius: theme.radius.lg,
          borderWidth: 1, borderColor: colors.borderLight,
          marginBottom: 6,
        }}
        accessibilityRole={tappable ? 'button' : undefined}
        accessibilityLabel={`${item.title}, ${formatTime(item.ts)}`}
        accessibilityHint={tappable ? 'Opens ticket details' : undefined}
      >
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: toneBg(meta.tone),
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name={meta.icon} size={18} color={toneColor(meta.tone)} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }} numberOfLines={2}>
            {item.title}
          </Text>
          {item.description && (
            <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 2 }} numberOfLines={2}>
              {item.description}
            </Text>
          )}
          <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 4 }}>
            {formatTime(item.ts)}
          </Text>
        </View>
        {tappable && (
          <Feather name="chevron-right" size={16} color={colors.textMuted} style={{ marginTop: 10 }} />
        )}
      </Wrapper>
    )
  }

  if (loading && items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header onBack={() => router.back()} colors={colors} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </View>
    )
  }

  if (error && items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header onBack={() => router.back()} colors={colors} />
        <ErrorState message="Unable to load activity" onRetry={load} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header onBack={() => router.back()} colors={colors} />
      {error && items.length > 0 && (
        <View style={{
          backgroundColor: colors.warmLight, paddingHorizontal: 16, paddingVertical: 8,
          flexDirection: 'row', alignItems: 'center', gap: 8,
          borderBottomWidth: 1, borderBottomColor: colors.border,
        }}>
          <Feather name="alert-triangle" size={14} color={colors.warm} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.text, fontFamily: 'Inter_500Medium' }}>
            Showing cached activity — couldn't refresh.
          </Text>
        </View>
      )}
      {items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <Feather name="activity" size={32} color={colors.textMuted} />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginBottom: 8 }}>
            No activity yet
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 }}>
            Project milestones, scheduled visits, and support activity will appear here as your project moves forward.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          renderItem={renderRow}
          keyExtractor={(row) => row.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

function Header({ onBack, colors }: { onBack: () => void; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={{
      backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
      paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16,
      flexDirection: 'row', alignItems: 'center', gap: 12,
    }}>
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onBack() }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
      >
        <Feather name="arrow-left" size={20} color={colors.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
          Activity
        </Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
          Everything that's happened on your project
        </Text>
      </View>
    </View>
  )
}
