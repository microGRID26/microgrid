import { useState, useEffect } from 'react'
import { View, Text, ScrollView, Switch, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../lib/theme'
import { getCustomerAccount, updateNotificationPrefs } from '../lib/api'
import type { CustomerAccount } from '../lib/types'

const DEFAULT_PREFS: CustomerAccount['notification_prefs'] = {
  project_updates: true,
  schedule_alerts: true,
  ticket_updates: true,
  energy_reports: true,
  promotions: false,
}

interface NotifOption {
  key: keyof CustomerAccount['notification_prefs']
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  description: string
}

const NOTIFICATION_OPTIONS: NotifOption[] = [
  {
    key: 'project_updates',
    icon: 'trending-up',
    label: 'Project Updates',
    description: 'Stage transitions, milestone completions',
  },
  {
    key: 'schedule_alerts',
    icon: 'calendar',
    label: 'Schedule Alerts',
    description: 'Upcoming installations, inspections',
  },
  {
    key: 'ticket_updates',
    icon: 'message-circle',
    label: 'Ticket Updates',
    description: 'Responses to support tickets',
  },
  {
    key: 'energy_reports',
    icon: 'bar-chart-2',
    label: 'Energy Reports',
    description: 'Monthly production summaries',
  },
  {
    key: 'promotions',
    icon: 'gift',
    label: 'Promotions',
    description: 'Referral bonuses, special offers',
  },
]

export default function NotificationsSettingsScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [prefs, setPrefs] = useState<CustomerAccount['notification_prefs']>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const acct = await getCustomerAccount()
      if (acct) {
        setAccount(acct)
        // Merge saved prefs with defaults (handles migration from old schema)
        setPrefs({ ...DEFAULT_PREFS, ...acct.notification_prefs })
      }
      setLoading(false)
    }
    load()
  }, [])

  const handleToggle = (key: keyof CustomerAccount['notification_prefs']) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSave = async () => {
    if (!account) return
    setSaving(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const success = await updateNotificationPrefs(account.id, prefs)
    setSaving(false)
    if (success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } else {
      Alert.alert('Error', 'Failed to save preferences. Please try again.')
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    )
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 32 }}
    >
      {/* Header with back button */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.7}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: colors.borderLight,
          }}
        >
          <Feather name="arrow-left" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
          Notification Preferences
        </Text>
      </View>
      <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 20 }}>
        Choose which notifications you want to receive.
      </Text>

      {/* Toggle list */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        borderWidth: 1, borderColor: colors.borderLight,
        overflow: 'hidden',
        ...theme.shadow.card,
      }}>
        {NOTIFICATION_OPTIONS.map((option, i) => (
          <View
            key={option.key}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 14,
              paddingHorizontal: 16, paddingVertical: 16,
              borderBottomWidth: i < NOTIFICATION_OPTIONS.length - 1 ? 1 : 0,
              borderBottomColor: colors.borderLight,
            }}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: prefs[option.key] ? colors.accentLight : colors.surfaceAlt,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather
                name={option.icon}
                size={18}
                color={prefs[option.key] ? colors.accent : colors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                {option.label}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                {option.description}
              </Text>
            </View>
            <Switch
              value={prefs[option.key]}
              onValueChange={() => handleToggle(option.key)}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={colors.border}
            />
          </View>
        ))}
      </View>

      {/* Save button */}
      <TouchableOpacity
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.8}
        style={{
          backgroundColor: colors.accent, borderRadius: theme.radius.xl,
          paddingVertical: 14, marginTop: 24, alignItems: 'center',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? (
          <ActivityIndicator color={colors.accentText} />
        ) : (
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>
            Save Preferences
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  )
}
