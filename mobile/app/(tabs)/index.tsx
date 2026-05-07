import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, AppState, TouchableOpacity, Modal, Animated } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../../lib/theme'
import { getCustomerAccount, loadProject, loadTimeline, loadSchedule, loadTaskStates, loadUnreadMessageCount } from '../../lib/api'
import { STAGE_ORDER, STAGE_LABELS, STAGE_DESCRIPTIONS, STAGE_TASKS, STAGE_SLA_DAYS, JOB_TYPE_LABELS, ONBOARDING_MILESTONES } from '../../lib/constants'
import { getCache, setCache } from '../../lib/cache'
import type { CustomerAccount, CustomerProject, StageHistoryEntry, CustomerScheduleEntry, CustomerTaskState } from '../../lib/types'
import { SkeletonLoader } from '../../components/SkeletonLoader'

const formatDate = (d: string | null) => {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DashboardScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [project, setProject] = useState<CustomerProject | null>(null)
  const [timeline, setTimeline] = useState<StageHistoryEntry[]>([])
  const [schedule, setSchedule] = useState<CustomerScheduleEntry[]>([])
  const [taskStates, setTaskStates] = useState<CustomerTaskState[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [drillDownStage, setDrillDownStage] = useState<string | null>(null)
  const [unreadMessages, setUnreadMessages] = useState(0)

  const load = useCallback(async () => {
    // Try cache first for instant render
    const cachedProject = getCache<CustomerProject>('project')
    const cachedTimeline = getCache<StageHistoryEntry[]>('timeline')
    const cachedSchedule = getCache<CustomerScheduleEntry[]>('schedule')
    const cachedAccount = getCache<CustomerAccount>('account')
    const cachedTasks = getCache<CustomerTaskState[]>('taskStates')
    if (cachedProject && cachedAccount) {
      setAccount(cachedAccount)
      setProject(cachedProject)
      setTimeline(cachedTimeline ?? [])
      setSchedule(cachedSchedule ?? [])
      setTaskStates(cachedTasks ?? [])
      setLoading(false)
    }

    // Fetch fresh data
    const acct = await getCustomerAccount()
    if (!acct) return
    setAccount(acct)
    setCache('account', acct)
    const [proj, tl, sched, tasks, msgCount] = await Promise.all([
      loadProject(acct.project_id),
      loadTimeline(acct.project_id),
      loadSchedule(acct.project_id),
      loadTaskStates(acct.project_id),
      loadUnreadMessageCount(acct.project_id),
    ])
    setUnreadMessages(msgCount)
    setProject(proj)
    setTimeline(tl)
    setSchedule(sched)
    setTaskStates(tasks)
    setCache('project', proj)
    setCache('timeline', tl)
    setCache('schedule', sched)
    setCache('taskStates', tasks)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30 seconds — pause when app is backgrounded to save battery
  const appActive = useRef(true)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActive.current = state === 'active'
      if (state === 'active') load() // Refresh when foregrounded
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

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 56 }}>
        <SkeletonLoader showAvatar lines={2} />
        <SkeletonLoader showImage lines={3} />
        <SkeletonLoader lines={4} />
      </View>
    )
  }

  if (!project || !account) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, padding: 24 }}>
        <Text style={{ color: colors.textMuted, textAlign: 'center', fontFamily: 'Inter_400Regular' }}>
          Unable to load your project.
        </Text>
        <TouchableOpacity onPress={load} activeOpacity={0.7}
          style={{ marginTop: 16, backgroundColor: colors.accent, borderRadius: theme.radius.xl, paddingHorizontal: 24, paddingVertical: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>Tap to retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const firstName = account.name.split(' ')[0]
  const currentStageIdx = Math.max(0, STAGE_ORDER.indexOf(project.stage))
  const isComplete = project.stage === 'complete'

  // SLA countdown
  const slaStart = project.sale_date ? new Date(project.sale_date + 'T00:00:00') : null
  const slaDays = slaStart ? Math.floor((Date.now() - slaStart.getTime()) / 86400000) : null
  const slaRemaining = slaDays !== null ? Math.max(0, 60 - slaDays) : null

  // Upcoming schedule
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = schedule.filter(s => s.date >= today && s.status !== 'cancelled')

  // Timeline milestones
  const milestones = [
    { label: 'Contract Signed', date: project.sale_date },
    { label: 'Survey Scheduled', date: project.survey_scheduled_date },
    { label: 'Survey Complete', date: project.survey_date },
    { label: 'City Permit Approved', date: project.city_permit_date },
    { label: 'Utility Permit Approved', date: project.utility_permit_date },
    { label: 'Installation Scheduled', date: project.install_scheduled_date },
    { label: 'Installation Complete', date: project.install_complete_date },
    { label: 'City Inspection Passed', date: project.city_inspection_date },
    { label: 'Utility Inspection Passed', date: project.utility_inspection_date },
    { label: 'Permission to Operate', date: project.pto_date },
    { label: 'System Live', date: project.in_service_date },
  ]

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Header */}
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', marginTop: 48 }}>
        Hi, {firstName}
      </Text>
      <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 2, fontFamily: 'Inter_400Regular' }}>
        Your Solar Project
      </Text>

      {/* Stage Progress Card */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 20,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              {STAGE_LABELS[project.stage] ?? project.stage}
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: 'Inter_400Regular' }}>
              {STAGE_DESCRIPTIONS[project.stage] ?? ''}
            </Text>
          </View>
          {isComplete ? (
            <Feather name="check-circle" size={32} color={colors.stageComplete} />
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: colors.accent, fontFamily: 'Inter_700Bold' }}>
                {currentStageIdx + 1}/{STAGE_ORDER.length}
              </Text>
              <Text style={{ fontSize: 9, color: colors.textMuted }}>stages</Text>
            </View>
          )}
        </View>

        {/* Progress bar — tappable stages */}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {STAGE_ORDER.map((stage, i) => (
            <TouchableOpacity
              key={stage}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setDrillDownStage(stage)
              }}
              style={{ flex: 1 }}
            >
              <View style={{
                height: 6, borderRadius: 3,
                backgroundColor: i < currentStageIdx
                  ? colors.stageComplete
                  : i === currentStageIdx
                    ? colors.stageActive
                    : colors.stageUpcoming,
              }} />
            </TouchableOpacity>
          ))}
        </View>
        <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 8, textAlign: 'center', fontFamily: 'Inter_400Regular' }}>
          Tap any stage for details
        </Text>
      </View>

      {/* SLA Countdown */}
      {!isComplete && slaRemaining !== null && slaRemaining > 0 && (
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 20, marginTop: 12,
          borderWidth: 1, borderColor: colors.borderLight,
          flexDirection: 'row', alignItems: 'center', gap: 16,
          ...theme.shadow.card,
        }}>
          <View style={{
            width: 64, height: 64, borderRadius: 32,
            borderWidth: 3,
            borderColor: slaRemaining > 15 ? colors.accent : slaRemaining > 5 ? colors.warm : colors.error,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
              {slaRemaining}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              MicroGRID in 60 Days
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
              {slaRemaining > 0 ? `${slaRemaining} days remaining` : 'Target reached'}
            </Text>
            <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
              Day {slaDays} of 60
            </Text>
          </View>
        </View>
      )}

      {/* Your Journey — Onboarding card (first 60 days only) */}
      {(() => {
        const saleDateStr = project.sale_date
        if (!saleDateStr) return null
        const saleD = new Date(saleDateStr + 'T00:00:00')
        const journeyDay = Math.floor((Date.now() - saleD.getTime()) / 86400000)
        if (journeyDay < 0 || journeyDay > 60) return null

        const journeyPct = Math.min(100, Math.round((journeyDay / 60) * 100))
        // Find next milestone
        const nextMilestone = ONBOARDING_MILESTONES.find(m => m.day > journeyDay)
          ?? ONBOARDING_MILESTONES[ONBOARDING_MILESTONES.length - 1]

        return (
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/onboarding') }}
            activeOpacity={0.7}
            style={{
              backgroundColor: colors.surface, borderRadius: theme.radius.xl,
              padding: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
              borderWidth: 1, borderColor: colors.accentLight,
              ...theme.shadow.card,
            }}
          >
            <View style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: colors.accent,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF', fontFamily: 'Inter_700Bold' }}>E</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                Your Journey
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                Day {journeyDay} of 60 — {journeyPct}% complete
              </Text>
              <Text style={{ fontSize: 11, color: colors.accent, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                Next: {nextMilestone.title}
              </Text>
              {/* Mini progress bar */}
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, marginTop: 6, overflow: 'hidden' }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.accent, width: `${journeyPct}%` }} />
              </View>
            </View>
            <Feather name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )
      })()}

      {/* Upcoming Schedule */}
      {upcoming.length > 0 && (
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 20, marginTop: 12,
          borderWidth: 1, borderColor: colors.borderLight,
          ...theme.shadow.card,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Feather name="calendar" size={16} color={colors.accent} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Upcoming
            </Text>
          </View>
          {upcoming.slice(0, 3).map(entry => (
            <View key={entry.id} style={{
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: colors.borderLight,
            }}>
              <View>
                <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                  {JOB_TYPE_LABELS[entry.job_type] ?? entry.job_type}
                </Text>
                {entry.arrival_window && (
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>{entry.arrival_window}</Text>
                )}
              </View>
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.accent, fontFamily: 'Inter_500Medium' }}>
                {formatDate(entry.date)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Quick Actions: Schedule Service */}
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/schedule-service') }}
        activeOpacity={0.7}
        style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
          borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
        }}
      >
        <View style={{
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: colors.infoLight, alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="tool" size={20} color={colors.info} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Schedule Service
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
            Request maintenance or a service visit
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Messages Card */}
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/messages') }}
        activeOpacity={0.7}
        style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
          borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
        }}
      >
        <View style={{
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="message-circle" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Messages
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
            {unreadMessages > 0
              ? `${unreadMessages} unread message${unreadMessages !== 1 ? 's' : ''}`
              : 'Chat with your project manager'}
          </Text>
        </View>
        {unreadMessages > 0 && (
          <View style={{
            backgroundColor: colors.accent, borderRadius: 10,
            minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 6,
          }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accentText, fontFamily: 'Inter_700Bold' }}>
              {unreadMessages}
            </Text>
          </View>
        )}
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Timeline */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/activity') }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="View full project activity"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}
        >
          <Feather name="clock" size={16} color={colors.accent} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Timeline
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontSize: 12, color: colors.accent, fontFamily: 'Inter_500Medium' }}>
            View activity
          </Text>
          <Feather name="chevron-right" size={14} color={colors.accent} />
        </TouchableOpacity>
        {milestones.every(m => !m.date) ? (
          <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 12 }}>
            Your project timeline will update as each milestone is reached.
          </Text>
        ) : milestones.map((m, i) => {
          const completed = !!m.date
          const isNext = !completed && i > 0 && !!milestones[i - 1]?.date
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
              {/* Line + dot */}
              <View style={{ alignItems: 'center', width: 20 }}>
                <View style={{
                  width: 16, height: 16, borderRadius: 8,
                  backgroundColor: completed ? colors.stageComplete : isNext ? colors.stageActive : colors.border,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {completed && <Feather name="check" size={10} color="#fff" />}
                  {isNext && <Feather name="arrow-right" size={8} color="#fff" />}
                </View>
                {i < milestones.length - 1 && (
                  <View style={{
                    width: 2, flex: 1, minHeight: 24,
                    backgroundColor: completed ? colors.stageComplete : colors.border,
                  }} />
                )}
              </View>
              {/* Content */}
              <View style={{ flex: 1, paddingBottom: 16 }}>
                <Text style={{
                  fontSize: 14, fontFamily: completed || isNext ? 'Inter_500Medium' : 'Inter_400Regular',
                  color: completed ? colors.text : colors.textMuted,
                }}>
                  {m.label}
                </Text>
                {completed && m.date && (
                  <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                    {formatDate(m.date)}
                  </Text>
                )}
                {isNext && (
                  <Text style={{ fontSize: 12, color: colors.stageActive, fontFamily: 'Inter_500Medium' }}>
                    In progress
                  </Text>
                )}
              </View>
            </View>
          )
        })}
      </View>

      {/* Equipment */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Feather name="zap" size={16} color={colors.accent} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Your System
          </Text>
        </View>
        {!project.systemkw && !project.module && !project.battery && !project.inverter ? (
          <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 12 }}>
            Equipment details will appear once your system is designed.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {project.systemkw && (
              <View style={{ width: '48%', backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg, padding: 12 }}>
                <Feather name="sun" size={18} color={colors.warm} />
                <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                  {project.systemkw} kW
                </Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>System Size</Text>
              </View>
            )}
            {project.module && (
              <View style={{ width: '48%', backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg, padding: 12 }}>
                <Feather name="sun" size={18} color={colors.accent} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                  {project.module_qty ?? ''} Panels
                </Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }} numberOfLines={1}>{project.module}</Text>
              </View>
            )}
            {project.battery && (
              <View style={{ width: '48%', backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg, padding: 12 }}>
                <Feather name="battery-charging" size={18} color={colors.accent} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                  Battery
                </Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }} numberOfLines={1}>{project.battery}</Text>
              </View>
            )}
            {project.inverter && (
              <View style={{ width: '48%', backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg, padding: 12 }}>
                <Feather name="zap" size={18} color={colors.info} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                  Inverter
                </Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }} numberOfLines={1}>{project.inverter}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Address */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 16, marginTop: 12, alignItems: 'center',
        borderWidth: 1, borderColor: colors.borderLight,
      }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>Installation Address</Text>
        <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, marginTop: 2, fontFamily: 'Inter_500Medium', textAlign: 'center' }}>
          {project.address}{project.city ? `, ${project.city}` : ''}{project.zip ? ` ${project.zip}` : ''}
        </Text>
        <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 4 }}>{project.id}</Text>
      </View>

      {/* Stage Drill-Down Modal */}
      <Modal
        visible={drillDownStage !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setDrillDownStage(null)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            padding: 24,
            paddingBottom: 40,
            maxHeight: '75%',
          }}>
            {/* Handle bar */}
            <View style={{
              width: 36, height: 4, borderRadius: 2,
              backgroundColor: colors.border,
              alignSelf: 'center', marginBottom: 20,
            }} />

            {drillDownStage && (() => {
              const stageIdx = STAGE_ORDER.indexOf(drillDownStage)
              const isStageComplete = stageIdx < currentStageIdx
              const isCurrentStage = stageIdx === currentStageIdx
              const tasks = STAGE_TASKS[drillDownStage] ?? []
              const taskMap = new Map(taskStates.map(t => [t.task_id, t]))
              const completedTasks = tasks.filter(t => taskMap.get(t.id)?.status === 'completed' || taskMap.get(t.id)?.status === 'done')
              const slaDays = STAGE_SLA_DAYS[drillDownStage] ?? 0

              // Estimate remaining days for current stage
              const stageEntry = timeline.find(t => t.stage === drillDownStage)
              const daysInStage = stageEntry
                ? Math.floor((Date.now() - new Date(stageEntry.entered).getTime()) / 86400000)
                : 0
              const daysRemaining = Math.max(0, slaDays - daysInStage)

              return (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Stage header */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <View style={{
                      width: 40, height: 40, borderRadius: 20,
                      backgroundColor: isStageComplete ? colors.stageComplete : isCurrentStage ? colors.stageActive : colors.stageUpcoming,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isStageComplete ? (
                        <Feather name="check" size={20} color="#fff" />
                      ) : isCurrentStage ? (
                        <Feather name="arrow-right" size={18} color="#fff" />
                      ) : (
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff', fontFamily: 'Inter_700Bold' }}>
                          {stageIdx + 1}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                        {STAGE_LABELS[drillDownStage] ?? drillDownStage}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                        Stage {stageIdx + 1} of {STAGE_ORDER.length}
                      </Text>
                    </View>
                  </View>

                  {/* Description */}
                  <Text style={{
                    fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular',
                    lineHeight: 20, marginBottom: 20,
                  }}>
                    {STAGE_DESCRIPTIONS[drillDownStage] ?? ''}
                  </Text>

                  {/* SLA estimate for current stage */}
                  {isCurrentStage && slaDays > 0 && (
                    <View style={{
                      backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
                      padding: 14, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 12,
                    }}>
                      <Feather name="clock" size={18} color={daysRemaining > 3 ? colors.accent : daysRemaining > 0 ? colors.warm : colors.error} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                          {daysRemaining > 0
                            ? `~${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`
                            : 'Target timeframe reached'}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                          Typical: {slaDays} business days | Day {daysInStage}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Completed stage info */}
                  {isStageComplete && stageEntry && (
                    <View style={{
                      backgroundColor: colors.accentLight, borderRadius: theme.radius.lg,
                      padding: 14, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 12,
                    }}>
                      <Feather name="check-circle" size={18} color={colors.stageComplete} />
                      <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                        Completed on {formatDate(stageEntry.entered)}
                      </Text>
                    </View>
                  )}

                  {/* Task list */}
                  {tasks.length > 0 && (
                    <View>
                      <Text style={{
                        fontSize: 13, fontWeight: '600', color: colors.textSecondary,
                        fontFamily: 'Inter_600SemiBold', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>
                        Tasks ({completedTasks.length}/{tasks.length})
                      </Text>
                      {tasks.map((task, idx) => {
                        const state = taskMap.get(task.id)
                        const done = state?.status === 'completed' || state?.status === 'done'
                        const inProgress = state?.status === 'in_progress' || state?.status === 'started'
                        return (
                          <View key={task.id} style={{
                            flexDirection: 'row', alignItems: 'center', gap: 12,
                            paddingVertical: 10,
                            borderBottomWidth: idx < tasks.length - 1 ? 1 : 0,
                            borderBottomColor: colors.borderLight,
                          }}>
                            <View style={{
                              width: 24, height: 24, borderRadius: 12,
                              backgroundColor: done ? colors.stageComplete : inProgress ? colors.stageActive + '30' : colors.surfaceAlt,
                              borderWidth: done ? 0 : 1.5,
                              borderColor: done ? 'transparent' : inProgress ? colors.stageActive : colors.border,
                              alignItems: 'center', justifyContent: 'center',
                            }}>
                              {done && <Feather name="check" size={14} color="#fff" />}
                              {inProgress && <Feather name="loader" size={12} color={colors.stageActive} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{
                                fontSize: 14, color: done ? colors.text : colors.textSecondary,
                                fontFamily: done ? 'Inter_500Medium' : 'Inter_400Regular',
                                textDecorationLine: done ? 'none' : 'none',
                              }}>
                                {task.label}
                              </Text>
                              {done && state?.completed_date && (
                                <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                                  {formatDate(state.completed_date)}
                                </Text>
                              )}
                              {inProgress && (
                                <Text style={{ fontSize: 11, color: colors.stageActive, fontFamily: 'Inter_500Medium', marginTop: 1 }}>
                                  In progress
                                </Text>
                              )}
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  )}

                  {/* Close button */}
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      setDrillDownStage(null)
                    }}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.xl,
                      paddingVertical: 14, marginTop: 24, alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                      Close
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              )
            })()}
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}
