import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, ScrollView, Animated, RefreshControl } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../lib/theme'
import { getCustomerAccount, loadProject } from '../lib/api'
import { MgPressable } from '../components/MgPressable'
import { ONBOARDING_MILESTONES } from '../lib/constants'
import { getCache } from '../lib/cache'
import type { CustomerProject } from '../lib/types'

function getDaysSinceSale(saleDate: string | null): number {
  if (!saleDate) return 0
  const sale = new Date(saleDate + 'T00:00:00')
  const now = new Date()
  return Math.max(0, Math.floor((now.getTime() - sale.getTime()) / 86400000))
}

// Pulsing animation for the current milestone
function PulsingDot({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  return (
    <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        position: 'absolute',
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: color + '20',
        transform: [{ scale: pulse }],
      }} />
      <View style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: color,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF', fontFamily: 'Inter_700Bold' }}>E</Text>
      </View>
    </View>
  )
}

type MilestoneStatus = 'completed' | 'current' | 'locked'

export default function OnboardingScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [project, setProject] = useState<CustomerProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedCard, setExpandedCard] = useState<number | null>(null)

  const load = useCallback(async () => {
    // Try cache first
    const cached = getCache<CustomerProject>('project')
    if (cached) {
      setProject(cached)
      setLoading(false)
    }

    const acct = await getCustomerAccount()
    if (!acct) { setLoading(false); return }
    const proj = await loadProject(acct.project_id)
    if (proj) setProject(proj)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const dayNumber = project ? getDaysSinceSale(project.sale_date) : 0
  const progressPct = Math.min(100, Math.round((dayNumber / 60) * 100))

  function getStatus(milestoneDay: number): MilestoneStatus {
    if (dayNumber >= milestoneDay + 5) return 'completed' // mark completed ~5 days after unlock
    if (dayNumber >= milestoneDay) return 'current'
    return 'locked'
  }

  // Find current milestone (last one that's unlocked)
  const currentMilestoneIdx = ONBOARDING_MILESTONES.reduce((acc, m, i) => {
    return dayNumber >= m.day ? i : acc
  }, 0)

  // Auto-expand current milestone on first load
  useEffect(() => {
    if (!loading && project) {
      const current = ONBOARDING_MILESTONES.findIndex((m, i) => getStatus(m.day) === 'current')
      if (current >= 0) setExpandedCard(current)
    }
  }, [loading, project])

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>Loading your journey...</Text>
      </View>
    )
  }

  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
          Unable to load your project.
        </Text>
        <MgPressable
          accessibilityLabel="Retry loading project"
          onPress={load}
          activeOpacity={0.7}
          style={{ marginTop: 16, backgroundColor: colors.accent, borderRadius: theme.radius.xl, paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>Retry</Text>
        </MgPressable>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
          <MgPressable
            accessibilityLabel="Go back"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.7}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="arrow-left" size={20} color={colors.text} />
          </MgPressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
              Your Journey
            </Text>
            <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
              Guided by Ellie, Director of Education
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.lg,
          padding: 16, borderWidth: 1, borderColor: colors.borderLight,
          ...theme.shadow.card,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Day {Math.min(dayNumber, 60)} of 60
            </Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.accent, fontFamily: 'Inter_700Bold' }}>
              {progressPct}%
            </Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
            <View style={{
              height: 8, borderRadius: 4,
              backgroundColor: colors.accent,
              width: `${progressPct}%`,
            }} />
          </View>
          {dayNumber <= 60 && (
            <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 6 }}>
              {dayNumber >= 60
                ? 'Your 60-day journey is complete!'
                : `${60 - dayNumber} days remaining`}
            </Text>
          )}
        </View>
      </View>

      {/* Journey Cards */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {ONBOARDING_MILESTONES.map((milestone, idx) => {
          const status = getStatus(milestone.day)
          const isExpanded = expandedCard === idx
          const isLocked = status === 'locked'
          const isCompleted = status === 'completed'
          const isCurrent = status === 'current'

          return (
            <View key={milestone.day} style={{ marginBottom: 12 }}>
              {/* Connector line */}
              {idx > 0 && (
                <View style={{
                  width: 2, height: 12, marginLeft: 37,
                  backgroundColor: isLocked ? colors.border : colors.accent,
                  marginBottom: -2,
                }} />
              )}

              <MgPressable
                accessibilityLabel={`${milestone.title} — Day ${milestone.day}${isLocked ? ', locked' : isCompleted ? ', completed' : isCurrent ? ', current milestone' : ''}`}
                accessibilityState={{ selected: isExpanded, disabled: isLocked }}
                activeOpacity={isLocked ? 1 : 0.7}
                onPress={() => {
                  if (isLocked) return
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setExpandedCard(isExpanded ? null : idx)
                }}
                style={{
                  backgroundColor: isLocked ? colors.surfaceAlt : colors.surface,
                  borderRadius: theme.radius.xl,
                  padding: 16,
                  borderWidth: isCurrent ? 2 : 1,
                  borderColor: isCurrent ? colors.accent : isCompleted ? colors.accentLight : colors.borderLight,
                  opacity: isLocked ? 0.5 : 1,
                  ...(!isLocked ? theme.shadow.card : {}),
                }}
              >
                {/* Card header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  {/* Avatar / Status indicator */}
                  {isCurrent ? (
                    <PulsingDot color={colors.accent} />
                  ) : isCompleted ? (
                    <View style={{
                      width: 36, height: 36, borderRadius: 18,
                      backgroundColor: colors.stageComplete,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Feather name="check" size={18} color="#FFFFFF" />
                    </View>
                  ) : (
                    <View style={{
                      width: 36, height: 36, borderRadius: 18,
                      backgroundColor: colors.border,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Feather name="lock" size={14} color={colors.textMuted} />
                    </View>
                  )}

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                        Day {milestone.day}
                      </Text>
                      {isCurrent && (
                        <View style={{
                          backgroundColor: colors.accentLight,
                          borderRadius: theme.radius.pill,
                          paddingHorizontal: 8, paddingVertical: 2,
                        }}>
                          <Text style={{ fontSize: 10, fontWeight: '600', color: colors.accent, fontFamily: 'Inter_600SemiBold' }}>
                            NOW
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={{
                      fontSize: 15, fontWeight: '600',
                      color: isLocked ? colors.textMuted : colors.text,
                      fontFamily: 'Inter_600SemiBold', marginTop: 2,
                    }}>
                      {milestone.title}
                    </Text>
                  </View>

                  {!isLocked && (
                    <Feather
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.textMuted}
                    />
                  )}
                </View>

                {/* Expanded content */}
                {isExpanded && !isLocked && (
                  <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.borderLight }}>
                    {/* Ellie says */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <View style={{
                        width: 24, height: 24, borderRadius: 12,
                        backgroundColor: colors.accent,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFFFFF', fontFamily: 'Inter_700Bold' }}>E</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.accent, fontFamily: 'Inter_600SemiBold' }}>
                        Ellie says:
                      </Text>
                    </View>

                    <Text style={{
                      fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular',
                      lineHeight: 22,
                    }}>
                      {milestone.body}
                    </Text>

                    {/* Icon decoration */}
                    <View style={{
                      marginTop: 16, paddingTop: 12,
                      flexDirection: 'row', alignItems: 'center', gap: 8,
                    }}>
                      <Feather name={milestone.icon as any} size={16} color={colors.warm} />
                      <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                        {isCompleted ? 'You completed this milestone' : 'Current milestone'}
                      </Text>
                    </View>
                  </View>
                )}
              </MgPressable>
            </View>
          )
        })}

        {/* End of journey message */}
        {dayNumber >= 60 && (
          <View style={{
            backgroundColor: colors.accentLight, borderRadius: theme.radius.xl,
            padding: 20, marginTop: 8, alignItems: 'center',
          }}>
            <Feather name="award" size={32} color={colors.accent} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', marginTop: 12 }}>
              Journey Complete!
            </Text>
            <Text style={{
              fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular',
              textAlign: 'center', marginTop: 6, lineHeight: 20,
            }}>
              Your system is live and you're part of the MicroGRID family. Check your energy production and refer friends from the home screen.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
