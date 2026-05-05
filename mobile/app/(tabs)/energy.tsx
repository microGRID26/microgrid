import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, Alert } from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { theme, useThemeColors } from '../../lib/theme'
import { getCustomerAccount, loadProject, loadEnergyStats } from '../../lib/api'
import { getCache, setCache } from '../../lib/cache'
import type { CustomerAccount, CustomerProject, EnergyStats } from '../../lib/types'
import { MgPressable } from '../../components/MgPressable'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const formatNumber = (n: number, decimals = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

export default function EnergyScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [project, setProject] = useState<CustomerProject | null>(null)
  const [stats, setStats] = useState<EnergyStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const now = new Date()
  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`

  const load = useCallback(async () => {
    // Try cache first
    const cachedAccount = getCache<CustomerAccount>('account')
    const cachedProject = getCache<CustomerProject>('project')
    if (cachedAccount && cachedProject) {
      setAccount(cachedAccount)
      setProject(cachedProject)
      if (cachedProject.systemkw) {
        const s = await loadEnergyStats(cachedProject.id, cachedProject.systemkw)
        setStats(s)
      }
      setLoading(false)
    }

    // Fresh data
    const acct = await getCustomerAccount()
    if (!acct) { setLoading(false); return }
    setAccount(acct)
    setCache('account', acct)

    const proj = await loadProject(acct.project_id)
    if (!proj) { setLoading(false); return }
    setProject(proj)
    setCache('project', proj)

    if (proj.systemkw) {
      const s = await loadEnergyStats(proj.id, proj.systemkw)
      setStats(s)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    )
  }

  if (!project || !account) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, padding: 24 }}>
        <Text style={{ color: colors.textMuted, textAlign: 'center', fontFamily: 'Inter_400Regular' }}>
          Unable to load your project.
        </Text>
        <MgPressable accessibilityLabel="Retry loading energy data" onPress={load} activeOpacity={0.7}
          style={{ marginTop: 16, backgroundColor: colors.accent, borderRadius: theme.radius.xl, paddingHorizontal: 24, paddingVertical: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>Tap to retry</Text>
        </MgPressable>
      </View>
    )
  }

  // Days since installation
  const installDate = project.install_complete_date
    ? new Date(project.install_complete_date + 'T00:00:00')
    : null
  const daysSinceInstall = installDate
    ? Math.floor((Date.now() - installDate.getTime()) / 86400000)
    : null

  // Placeholder bar chart heights (relative, for visual effect)
  const barHeights = [0.4, 0.55, 0.7, 0.6, 0.85, 0.75, 0.9, 0.8, 0.65, 0.5, 0.45, 0.35]
  const barLabels = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Header */}
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', marginTop: 48 }}>
        Energy
      </Text>
      <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 2, fontFamily: 'Inter_400Regular' }}>
        {monthLabel}
      </Text>

      {/* System Overview Card */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 20,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Feather name="sun" size={16} color={colors.warm} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            System Overview
          </Text>
        </View>

        {!project.systemkw && !project.module && !project.battery && !project.inverter ? (
          <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 12 }}>
            Equipment details will appear once your system is designed.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {project.systemkw != null && (
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
                <Feather name="grid" size={18} color={colors.accent} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                  {project.module_qty ?? '—'} Panels
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

      {/* Monthly Production Card (Placeholder) */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Feather name="bar-chart-2" size={16} color={colors.accent} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Monthly Production
            </Text>
          </View>
          <View style={{
            backgroundColor: colors.warmLight, borderRadius: theme.radius.sm,
            paddingHorizontal: 8, paddingVertical: 3,
          }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: colors.warm, fontFamily: 'Inter_600SemiBold' }}>
              PENDING
            </Text>
          </View>
        </View>

        {/* Placeholder bar chart */}
        <View style={{
          height: 120, flexDirection: 'row', alignItems: 'flex-end',
          justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 8,
          opacity: 0.4,
        }}>
          {barHeights.map((h, i) => (
            <View key={i} style={{ alignItems: 'center', flex: 1, marginHorizontal: 2 }}>
              <View style={{
                width: '100%', maxWidth: 20,
                height: h * 90,
                backgroundColor: i === now.getMonth() ? colors.accent : colors.border,
                borderRadius: 4,
              }} />
              <Text style={{ fontSize: 8, color: colors.textMuted, marginTop: 4 }}>{barLabels[i]}</Text>
            </View>
          ))}
        </View>

        {/* Awaiting message */}
        <View style={{
          backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
          padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10,
        }}>
          <Feather name="radio" size={16} color={colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textSecondary, fontFamily: 'Inter_500Medium' }}>
              Awaiting monitoring connection
            </Text>
            <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
              Real production data will appear once your monitoring system is connected.
            </Text>
          </View>
        </View>
      </View>

      {/* Environmental Impact Card */}
      {stats && (
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 20, marginTop: 12,
          borderWidth: 1, borderColor: colors.borderLight,
          ...theme.shadow.card,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Feather name="globe" size={16} color={colors.accent} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Estimated Environmental Impact
            </Text>
          </View>
          <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 12 }}>
            Based on your {project.systemkw} kW system at average production rates
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {/* Monthly kWh */}
            <View style={{ width: '48%', backgroundColor: colors.accentLight, borderRadius: theme.radius.lg, padding: 12 }}>
              <Feather name="zap" size={18} color={colors.accent} />
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                {formatNumber(stats.estimated_monthly_kwh)}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>kWh / month (est.)</Text>
            </View>

            {/* Annual kWh */}
            <View style={{ width: '48%', backgroundColor: colors.accentLight, borderRadius: theme.radius.lg, padding: 12 }}>
              <Feather name="trending-up" size={18} color={colors.accent} />
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                {formatNumber(stats.estimated_annual_kwh)}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>kWh / year (est.)</Text>
            </View>

            {/* CO2 Offset */}
            <View style={{ width: '48%', backgroundColor: colors.accentLight, borderRadius: theme.radius.lg, padding: 12 }}>
              <Feather name="wind" size={18} color={colors.accent} />
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                {formatNumber(stats.co2_offset_tons, 1)}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>metric tons CO2 / yr</Text>
            </View>

            {/* Trees */}
            <View style={{ width: '48%', backgroundColor: colors.accentLight, borderRadius: theme.radius.lg, padding: 12 }}>
              <Feather name="feather" size={18} color={colors.accent} />
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 4, fontFamily: 'Inter_700Bold' }}>
                {formatNumber(stats.trees_equivalent)}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>trees equivalent / yr</Text>
            </View>
          </View>

          {/* Cost savings */}
          <View style={{
            backgroundColor: colors.warmLight, borderRadius: theme.radius.lg,
            padding: 14, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <Feather name="dollar-sign" size={18} color={colors.warm} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                ~${formatNumber(stats.cost_savings_monthly)}/mo
              </Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                Estimated savings at $0.12/kWh
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* System Status Card */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Feather name="activity" size={16} color={colors.accent} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            System Status
          </Text>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Status indicator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: installDate ? colors.accent : colors.textMuted,
            }} />
            <View>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                {installDate ? 'Installed' : 'Pending Installation'}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                {installDate
                  ? `Monitoring: awaiting connection`
                  : 'System status will update after install'}
              </Text>
            </View>
          </View>
        </View>

        {daysSinceInstall !== null && daysSinceInstall >= 0 && (
          <View style={{
            backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
            padding: 14, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <Feather name="calendar" size={16} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                {daysSinceInstall === 0
                  ? 'Installed today'
                  : daysSinceInstall === 1
                    ? '1 day since installation'
                    : `${formatNumber(daysSinceInstall)} days since installation`}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                Installed {new Date(project.install_complete_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Connection CTA Card */}
      <View style={{
        backgroundColor: colors.accentLight, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.accent + '30',
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <View style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: colors.accent + '20',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="wifi" size={20} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Connect Your Monitoring
            </Text>
            <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
              Link your inverter monitoring to see real-time production data, alerts, and performance insights.
            </Text>
          </View>
        </View>

        <MgPressable
          accessibilityLabel="Learn how to connect monitoring"
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            Alert.alert(
              'Monitoring Setup',
              'Your MicroGRID team will connect your monitoring system during the commissioning process. Once connected, real-time energy data will appear here automatically.\n\nQuestions? Reach out through the Support tab.',
              [{ text: 'Got it', style: 'default' }],
            )
          }}
          style={{
            backgroundColor: colors.accent, borderRadius: theme.radius.xl,
            paddingVertical: 14, alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>
            Learn How to Connect
          </Text>
        </MgPressable>
      </View>

      {/* Outage Mode Card */}
      <MgPressable
        accessibilityLabel="Go to outage mode"
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          router.push('/outage-mode')
        }}
        style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 20, marginTop: 12,
          borderWidth: 1, borderColor: colors.borderLight,
          flexDirection: 'row', alignItems: 'center', gap: 14,
          ...theme.shadow.card,
        }}
      >
        <View style={{
          width: 44, height: 44, borderRadius: 22,
          backgroundColor: colors.warmLight,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="shield" size={22} color={colors.warm} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Outage Mode
          </Text>
          <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
            Battery backup status, emergency contacts, and outage preparedness
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.textMuted} />
      </MgPressable>

      {/* Footer note */}
      <Text style={{
        fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular',
        textAlign: 'center', marginTop: 20, paddingHorizontal: 16,
      }}>
        Energy estimates are based on average solar production factors and may vary by location, weather, and system orientation.
      </Text>
    </ScrollView>
  )
}
