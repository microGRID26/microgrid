import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../lib/theme'
import { getCustomerAccount, loadSchedule, createTicket } from '../lib/api'
import { MgPressable } from '../components/MgPressable'
import { JOB_TYPE_LABELS } from '../lib/constants'
import type { CustomerAccount, CustomerScheduleEntry } from '../lib/types'

const ISSUE_TYPES = [
  { value: 'routine_maintenance', label: 'Routine Maintenance', icon: 'tool' as const },
  { value: 'not_producing', label: 'System Not Producing', icon: 'alert-circle' as const },
  { value: 'storm_damage', label: 'Storm Damage', icon: 'cloud-lightning' as const },
  { value: 'panel_cleaning', label: 'Panel Cleaning', icon: 'droplet' as const },
  { value: 'inverter_issue', label: 'Inverter Issue', icon: 'zap-off' as const },
  { value: 'battery_issue', label: 'Battery Issue', icon: 'battery' as const },
  { value: 'other', label: 'Other', icon: 'help-circle' as const },
]

const TIME_PREFERENCES = [
  { value: 'morning', label: 'Morning (8 AM - 12 PM)' },
  { value: 'afternoon', label: 'Afternoon (12 - 5 PM)' },
  { value: 'no_preference', label: 'No Preference' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function formatDate(d: string | null) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ScheduleServiceScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [upcoming, setUpcoming] = useState<CustomerScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Form state
  const [issueType, setIssueType] = useState('')
  const [notes, setNotes] = useState('')
  const [timePreference, setTimePreference] = useState('no_preference')
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // Date picker state
  const today = new Date()
  const minDate = new Date(today)
  minDate.setDate(minDate.getDate() + 2) // At least 2 days out
  const [selectedMonth, setSelectedMonth] = useState(minDate.getMonth())
  const [selectedDay, setSelectedDay] = useState(minDate.getDate())
  const [selectedYear, setSelectedYear] = useState(minDate.getFullYear())

  const load = useCallback(async () => {
    const acct = await getCustomerAccount()
    if (!acct) { setLoading(false); return }
    setAccount(acct)
    const sched = await loadSchedule(acct.project_id)
    const todayStr = new Date().toISOString().slice(0, 10)
    setUpcoming(sched.filter(s => s.date >= todayStr && s.status !== 'cancelled'))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const handleReschedule = (entry: CustomerScheduleEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Alert.alert(
      'Reschedule Appointment',
      'To reschedule this appointment, please contact our support team.\n\nCall: (888) 555-GRID\nOr message us through the Support tab.',
      [
        { text: 'Go to Support', onPress: () => router.push('/(tabs)/tickets') },
        { text: 'OK', style: 'cancel' },
      ]
    )
  }

  const handleSubmit = async () => {
    if (!account || !issueType) return
    setSubmitting(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const issueLabel = ISSUE_TYPES.find(t => t.value === issueType)?.label ?? issueType
    const timeLabel = TIME_PREFERENCES.find(t => t.value === timePreference)?.label ?? timePreference
    const preferredDate = `${MONTHS[selectedMonth]} ${selectedDay}, ${selectedYear}`

    const title = `Service Request: ${issueLabel}`
    const description = [
      `Issue Type: ${issueLabel}`,
      `Preferred Date: ${preferredDate}`,
      `Preferred Time: ${timeLabel}`,
      notes.trim() ? `\nCustomer Notes: ${notes.trim()}` : '',
    ].filter(Boolean).join('\n')

    const ticket = await createTicket(
      account.project_id,
      title,
      description,
      'service',
      account.name,
    )

    setSubmitting(false)
    if (ticket) {
      setSubmitSuccess(true)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setTimeout(() => {
        setSubmitSuccess(false)
        setIssueType('')
        setNotes('')
        setTimePreference('no_preference')
        router.back()
      }, 2000)
    } else {
      Alert.alert('Error', 'Could not submit service request. Please try again.')
    }
  }

  // Generate valid years for picker
  const years = [today.getFullYear(), today.getFullYear() + 1]
  const daysInMonth = getDaysInMonth(selectedYear, selectedMonth)

  // Clamp day if month changes
  useEffect(() => {
    if (selectedDay > daysInMonth) setSelectedDay(daysInMonth)
  }, [selectedMonth, selectedYear, daysInMonth])

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    )
  }

  if (submitSuccess) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 32 }}>
        <View style={{
          width: 72, height: 72, borderRadius: 36,
          backgroundColor: colors.accentLight,
          alignItems: 'center', justifyContent: 'center', marginBottom: 20,
        }}>
          <Feather name="check-circle" size={36} color={colors.accent} />
        </View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', textAlign: 'center' }}>
          Service Request Submitted!
        </Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
          Our team will confirm your appointment and reach out with final details.
        </Text>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <MgPressable accessibilityLabel="Go back" onPress={() => router.back()} activeOpacity={0.7}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </MgPressable>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
            Schedule Service
          </Text>
        </View>

        {/* Upcoming Appointments */}
        {upcoming.length > 0 && (
          <View style={{
            backgroundColor: colors.surface, borderRadius: theme.radius.xl,
            padding: 20, marginBottom: 16,
            borderWidth: 1, borderColor: colors.borderLight,
            ...theme.shadow.card,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Feather name="calendar" size={16} color={colors.accent} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                Upcoming Appointments
              </Text>
            </View>
            {upcoming.map((entry) => (
              <View key={entry.id} style={{
                paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: colors.borderLight,
              }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                      {JOB_TYPE_LABELS[entry.job_type] ?? entry.job_type}
                    </Text>
                    <Text style={{ fontSize: 13, color: colors.accent, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                      {formatDate(entry.date)}
                    </Text>
                    {entry.arrival_window && (
                      <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                        {entry.arrival_window}
                      </Text>
                    )}
                    {entry.time && (
                      <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                        {entry.time}
                      </Text>
                    )}
                  </View>
                  <MgPressable
                    accessibilityLabel={`Reschedule ${JOB_TYPE_LABELS[entry.job_type] ?? entry.job_type}`}
                    onPress={() => handleReschedule(entry)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.pill,
                      paddingHorizontal: 10, paddingVertical: 6,
                    }}
                  >
                    <Feather name="repeat" size={12} color={colors.textSecondary} />
                    <Text style={{ fontSize: 11, color: colors.textSecondary, fontFamily: 'Inter_500Medium' }}>
                      Reschedule
                    </Text>
                  </MgPressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Request a Visit */}
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 20,
          borderWidth: 1, borderColor: colors.borderLight,
          ...theme.shadow.card,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Feather name="plus-circle" size={16} color={colors.accent} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Request a Visit
            </Text>
          </View>

          {/* Issue type selector */}
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
            What do you need? *
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {ISSUE_TYPES.map((type) => {
              const selected = issueType === type.value
              return (
                <MgPressable
                  key={type.value}
                  accessibilityLabel={type.label}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setIssueType(type.value)
                  }}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: selected ? colors.accentLight : colors.surfaceAlt,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: 12, paddingVertical: 8,
                    borderWidth: 1.5,
                    borderColor: selected ? colors.accent : colors.borderLight,
                  }}
                >
                  <Feather name={type.icon} size={14} color={selected ? colors.accent : colors.textMuted} />
                  <Text style={{
                    fontSize: 12, fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_400Regular',
                    color: selected ? colors.accent : colors.textSecondary,
                  }}>
                    {type.label}
                  </Text>
                </MgPressable>
              )
            })}
          </View>

          {/* Preferred date */}
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
            Preferred Date
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {/* Month */}
            <View style={{ flex: 1 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {MONTHS.map((m, idx) => {
                    const isSelectable = idx >= today.getMonth() || selectedYear > today.getFullYear()
                    const selected = idx === selectedMonth
                    return (
                      <MgPressable
                        key={m}
                        accessibilityLabel={m}
                        accessibilityState={{ selected, disabled: !isSelectable }}
                        onPress={() => {
                          if (!isSelectable) return
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                          setSelectedMonth(idx)
                        }}
                        activeOpacity={isSelectable ? 0.7 : 1}
                        style={{
                          backgroundColor: selected ? colors.accent : colors.surfaceAlt,
                          paddingHorizontal: 12, paddingVertical: 8,
                          borderRadius: theme.radius.pill,
                          opacity: isSelectable ? 1 : 0.3,
                        }}
                      >
                        <Text style={{
                          fontSize: 12, fontFamily: 'Inter_500Medium',
                          color: selected ? '#FFFFFF' : colors.textSecondary,
                        }}>
                          {m}
                        </Text>
                      </MgPressable>
                    )
                  })}
                </View>
              </ScrollView>
            </View>
          </View>

          {/* Day + Year row */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            <View style={{
              flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.md,
              borderWidth: 1, borderColor: colors.borderLight, padding: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <MgPressable
                accessibilityLabel="Decrease day"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setSelectedDay(d => Math.max(1, d - 1))
                }}
              >
                <Feather name="minus" size={16} color={colors.textMuted} />
              </MgPressable>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                {selectedDay}
              </Text>
              <MgPressable
                accessibilityLabel="Increase day"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setSelectedDay(d => Math.min(daysInMonth, d + 1))
                }}
              >
                <Feather name="plus" size={16} color={colors.textMuted} />
              </MgPressable>
            </View>
            <View style={{
              flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.md,
              borderWidth: 1, borderColor: colors.borderLight, padding: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            }}>
              {years.map(y => (
                <MgPressable
                  key={y}
                  accessibilityLabel={String(y)}
                  accessibilityState={{ selected: y === selectedYear }}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setSelectedYear(y)
                  }}
                  style={{
                    flex: 1, alignItems: 'center',
                    backgroundColor: y === selectedYear ? colors.accent : 'transparent',
                    borderRadius: theme.radius.pill, paddingVertical: 4,
                  }}
                >
                  <Text style={{
                    fontSize: 14, fontFamily: 'Inter_600SemiBold',
                    color: y === selectedYear ? '#FFFFFF' : colors.textMuted,
                  }}>
                    {y}
                  </Text>
                </MgPressable>
              ))}
            </View>
          </View>

          <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 16, marginTop: -12 }}>
            Selected: {MONTHS[selectedMonth]} {selectedDay}, {selectedYear}
          </Text>

          {/* Time preference */}
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
            Preferred Time
          </Text>
          <View style={{ gap: 6, marginBottom: 20 }}>
            {TIME_PREFERENCES.map((tp) => {
              const selected = timePreference === tp.value
              return (
                <MgPressable
                  key={tp.value}
                  accessibilityLabel={tp.label}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setTimePreference(tp.value)
                  }}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    backgroundColor: selected ? colors.accentLight : colors.surfaceAlt,
                    borderRadius: theme.radius.md,
                    paddingHorizontal: 14, paddingVertical: 12,
                    borderWidth: 1.5,
                    borderColor: selected ? colors.accent : colors.borderLight,
                  }}
                >
                  <View style={{
                    width: 20, height: 20, borderRadius: 10,
                    borderWidth: 2,
                    borderColor: selected ? colors.accent : colors.textMuted,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selected && (
                      <View style={{
                        width: 10, height: 10, borderRadius: 5,
                        backgroundColor: colors.accent,
                      }} />
                    )}
                  </View>
                  <Text style={{
                    fontSize: 14, fontFamily: selected ? 'Inter_500Medium' : 'Inter_400Regular',
                    color: selected ? colors.text : colors.textSecondary,
                  }}>
                    {tp.label}
                  </Text>
                </MgPressable>
              )
            })}
          </View>

          {/* Notes */}
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontFamily: 'Inter_600SemiBold' }}>
            Notes (optional)
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Any additional details about your service needs..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            style={{
              backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.md,
              borderWidth: 1, borderColor: colors.borderLight,
              padding: 14, fontSize: 14, color: colors.text, fontFamily: 'Inter_400Regular',
              minHeight: 80, marginBottom: 24,
            }}
          />

          {/* Submit */}
          <MgPressable
            accessibilityLabel={issueType ? 'Submit service request' : 'Select an issue type before submitting'}
            accessibilityState={{ disabled: submitting || !issueType, busy: submitting }}
            onPress={handleSubmit}
            disabled={submitting || !issueType}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: !issueType ? colors.stageUpcoming : colors.accent,
              borderRadius: theme.radius.lg, paddingVertical: 16,
            }}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Feather name="send" size={16} color="#FFFFFF" />
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>
                  Submit Service Request
                </Text>
              </>
            )}
          </MgPressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
