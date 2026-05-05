import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, ScrollView, RefreshControl, ActivityIndicator,
  Alert, Linking, Animated, Easing,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { theme, useThemeColors } from '../lib/theme'
import { getCustomerAccount, loadProject, createTicket } from '../lib/api'
import { MgPressable } from '../components/MgPressable'
import { getCache, setCache } from '../lib/cache'
import type { CustomerAccount, CustomerProject } from '../lib/types'
import type { ThemeColors } from '../lib/theme'

// ── Constants ────────────────────────────────────────────────────────────────

const DURACELL_KWH_PER_UNIT = 13.5
const AVG_HOME_DRAW_KW = 2
const SUPPORT_PHONE = '8005551234' // Replace with real MicroGRID support number

type GridStatus = 'normal' | 'outage'
type BatteryMode = 'standby' | 'powering' | 'charging'
type LoadPriority = 'essential' | 'priority' | 'deferrable'

interface LoadItem {
  name: string
  icon: keyof typeof Feather.glyphMap
  priority: LoadPriority
}

const LOAD_ITEMS: LoadItem[] = [
  { name: 'Refrigerator', icon: 'box', priority: 'essential' },
  { name: 'Lights', icon: 'sun', priority: 'essential' },
  { name: 'WiFi', icon: 'wifi', priority: 'essential' },
  { name: 'HVAC', icon: 'wind', priority: 'priority' },
  { name: 'Electric Vehicle', icon: 'truck', priority: 'deferrable' },
]

const SAFETY_TIPS = [
  'Your battery is automatically powering your home',
  'Avoid opening refrigerator/freezer unnecessarily',
  'Unplug sensitive electronics',
  'Your system will automatically reconnect when grid power returns',
  'Contact us if your system isn\'t powering your home',
]

// ── Battery Gauge Component ─────────────────────────────────────────────────

function BatteryGauge({
  percentage,
  size,
  colors,
}: {
  percentage: number
  size: number
  colors: ThemeColors
}) {
  const animValue = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: percentage / 100,
      duration: 1200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
  }, [percentage])

  const strokeWidth = 12
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  // We build the gauge from styled Views — a circular track + animated fill arc
  // Since React Native doesn't have SVG built-in, we use a ring approach with conic gradient simulation

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Background ring */}
      <View style={{
        position: 'absolute',
        width: size, height: size,
        borderRadius: size / 2,
        borderWidth: strokeWidth,
        borderColor: colors.surfaceAlt,
      }} />

      {/* Animated fill — we approximate with 4 quadrant arcs using borderColor tricks */}
      {/* Top-right quadrant */}
      {[0, 1, 2, 3].map((quadrant) => {
        const quadrantStart = quadrant * 25
        const quadrantEnd = quadrantStart + 25

        return (
          <Animated.View
            key={quadrant}
            style={{
              position: 'absolute',
              width: size / 2,
              height: size / 2,
              overflow: 'hidden',
              top: quadrant < 2 ? 0 : size / 2,
              left: quadrant === 0 || quadrant === 3 ? size / 2 : 0,
              transform: [
                { translateX: quadrant === 0 || quadrant === 3 ? -size / 4 : size / 4 },
                { translateY: quadrant < 2 ? size / 4 : -size / 4 },
                {
                  rotate: animValue.interpolate({
                    inputRange: [
                      Math.max(0, quadrantStart / 100),
                      Math.min(1, quadrantEnd / 100),
                    ],
                    outputRange: ['0deg', '90deg'],
                    extrapolate: 'clamp',
                  }),
                },
                { translateX: quadrant === 0 || quadrant === 3 ? size / 4 : -size / 4 },
                { translateY: quadrant < 2 ? -size / 4 : size / 4 },
              ],
              opacity: animValue.interpolate({
                inputRange: [Math.max(0, (quadrantStart - 1) / 100), quadrantStart / 100],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            }}
          >
            <View style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: strokeWidth,
              borderColor: colors.accent,
              position: 'absolute',
              top: quadrant < 2 ? 0 : -size / 2,
              left: quadrant === 0 || quadrant === 3 ? -size / 2 : 0,
            }} />
          </Animated.View>
        )
      })}

      {/* Simpler approach: use a solid green ring that reveals based on percentage */}
      {/* We overlay the full green ring and mask it with background-colored segments */}
      <View style={{
        position: 'absolute',
        width: size - strokeWidth * 2 + 2,
        height: size - strokeWidth * 2 + 2,
        borderRadius: (size - strokeWidth * 2 + 2) / 2,
        backgroundColor: colors.surface,
      }} />

      {/* Center content */}
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{
          fontSize: size * 0.22,
          fontWeight: '700',
          color: colors.text,
          fontFamily: 'Inter_700Bold',
        }}>
          {percentage}%
        </Text>
        <Text style={{
          fontSize: size * 0.07,
          color: colors.textMuted,
          fontFamily: 'Inter_400Regular',
          marginTop: 2,
        }}>
          Battery Level
        </Text>
      </View>
    </View>
  )
}

// ── Simpler Gauge: concentric circles with fill indicator ────────────────

function SimpleGauge({
  percentage,
  size,
  colors,
  mode,
}: {
  percentage: number
  size: number
  colors: ThemeColors
  mode: BatteryMode
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current
  const fillAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: percentage,
      duration: 1500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
  }, [percentage])

  // Subtle pulse for "powering" mode
  useEffect(() => {
    if (mode === 'powering') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.04, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start()
    } else {
      pulseAnim.setValue(1)
    }
  }, [mode])

  const modeColor = mode === 'powering' ? '#D69E2E' : mode === 'charging' ? colors.accent : colors.accent
  const modeLabel = mode === 'standby' ? 'Standby' : mode === 'powering' ? 'Powering Home' : 'Charging'

  const innerSize = size - 24

  return (
    <Animated.View style={{
      width: size, height: size,
      alignItems: 'center', justifyContent: 'center',
      transform: [{ scale: pulseAnim }],
    }}>
      {/* Outer track ring */}
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: 10, borderColor: colors.surfaceAlt,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Green fill ring — partial fill simulated by overlaying an arc */}
        <View style={{
          position: 'absolute',
          width: size, height: size, borderRadius: size / 2,
          borderWidth: 10,
          borderColor: modeColor + '40',
        }} />

        {/* Colored arc segments based on percentage */}
        {/* Bottom half mask when > 50% */}
        <View style={{
          position: 'absolute',
          width: size, height: size / 2,
          top: size / 2,
          overflow: 'hidden',
        }}>
          <View style={{
            width: size, height: size,
            borderRadius: size / 2,
            borderWidth: 10,
            borderColor: modeColor,
            position: 'absolute',
            top: -size / 2,
            transform: [{
              rotate: `${Math.min(percentage, 50) * 3.6}deg`,
            }],
          }} />
        </View>

        {percentage > 50 && (
          <View style={{
            position: 'absolute',
            width: size, height: size / 2,
            top: 0,
            overflow: 'hidden',
          }}>
            <View style={{
              width: size, height: size,
              borderRadius: size / 2,
              borderWidth: 10,
              borderColor: modeColor,
              position: 'absolute',
              top: 0,
              transform: [{
                rotate: `${(percentage - 50) * 3.6}deg`,
              }],
            }} />
          </View>
        )}

        {/* Inner circle — clean background */}
        <View style={{
          width: innerSize, height: innerSize,
          borderRadius: innerSize / 2,
          backgroundColor: colors.surface,
          alignItems: 'center', justifyContent: 'center',
          zIndex: 10,
        }}>
          <Text style={{
            fontSize: size * 0.24,
            fontWeight: '700',
            color: colors.text,
            fontFamily: 'Inter_700Bold',
          }}>
            {percentage}%
          </Text>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
          }}>
            <View style={{
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: modeColor,
            }} />
            <Text style={{
              fontSize: 12,
              color: colors.textSecondary,
              fontFamily: 'Inter_500Medium',
            }}>
              {modeLabel}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  )
}

// ── Priority Badge ──────────────────────────────────────────────────────────

function PriorityBadge({ priority, colors }: { priority: LoadPriority; colors: ThemeColors }) {
  const config = {
    essential: { label: 'Essential', bg: colors.accentLight, text: colors.accent },
    priority: { label: 'Priority', bg: colors.warmLight, text: colors.warm },
    deferrable: { label: 'Deferrable', bg: colors.surfaceAlt, text: colors.textMuted },
  }[priority]

  return (
    <View style={{
      backgroundColor: config.bg,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 3,
    }}>
      <Text style={{
        fontSize: 10,
        fontWeight: '600',
        color: config.text,
        fontFamily: 'Inter_600SemiBold',
      }}>
        {config.label.toUpperCase()}
      </Text>
    </View>
  )
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function OutageModeScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [project, setProject] = useState<CustomerProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submittingReport, setSubmittingReport] = useState(false)

  // Placeholder state — always "normal" until monitoring connects
  const gridStatus: GridStatus = 'normal'
  const batteryMode: BatteryMode = 'standby'

  const load = useCallback(async () => {
    const cachedAccount = getCache<CustomerAccount>('account')
    const cachedProject = getCache<CustomerProject>('project')
    if (cachedAccount && cachedProject) {
      setAccount(cachedAccount)
      setProject(cachedProject)
      setLoading(false)
    }

    const acct = await getCustomerAccount()
    if (!acct) { setLoading(false); return }
    setAccount(acct)
    setCache('account', acct)

    const proj = await loadProject(acct.project_id)
    if (!proj) { setLoading(false); return }
    setProject(proj)
    setCache('project', proj)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  // Battery calculations
  const batteryQty = project?.battery_qty ?? 0
  const totalCapacityKwh = batteryQty * DURACELL_KWH_PER_UNIT
  const estimatedRuntimeHours = totalCapacityKwh > 0
    ? Math.round((totalCapacityKwh / AVG_HOME_DRAW_KW) * 10) / 10
    : 0
  // Placeholder percentage — assume fully charged in standby
  const batteryPercentage = batteryQty > 0 ? 100 : 0

  const handleReportOutage = async () => {
    if (!project || !account) return

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    Alert.alert(
      'Report Power Outage',
      'This will create a service ticket to notify our team that you are experiencing a power outage. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report Outage',
          style: 'destructive',
          onPress: async () => {
            setSubmittingReport(true)
            const ticket = await createTicket(
              project.id,
              'Power Outage Report',
              `Customer ${account.name} is reporting a power outage at ${project.address ?? 'their location'}.\n\nBattery system: ${batteryQty} unit(s), ${totalCapacityKwh} kWh total capacity.\nGrid status at time of report: ${gridStatus}`,
              'service',
              account.name,
            )
            setSubmittingReport(false)

            if (ticket) {
              Alert.alert(
                'Outage Reported',
                `Ticket ${ticket.ticket_number} has been created. Our team has been notified and will follow up shortly.`,
                [{ text: 'OK' }],
              )
            } else {
              Alert.alert('Error', 'Unable to create the report. Please try calling support directly.')
            }
          },
        },
      ],
    )
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    )
  }

  const hasBattery = batteryQty > 0

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Header with back button */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 56, marginBottom: 8 }}>
        <MgPressable
          accessibilityLabel="Go back"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            router.back()
          }}
          activeOpacity={0.7}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center', justifyContent: 'center',
            marginRight: 12,
          }}
        >
          <Feather name="arrow-left" size={18} color={colors.text} />
        </MgPressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
            Outage Mode
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
            Battery backup and outage preparedness
          </Text>
        </View>
      </View>

      {/* ── Grid Status Banner ──────────────────────────────────────────── */}
      <View style={{
        backgroundColor: colors.accentLight,
        borderRadius: theme.radius.xl,
        padding: 16, marginTop: 12,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        borderWidth: 1, borderColor: colors.accent + '30',
      }}>
        <View style={{
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: colors.accent + '20',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="check-circle" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.accent, fontFamily: 'Inter_600SemiBold' }}>
            Grid Status: Normal
          </Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
            Outage detection activates when monitoring connects
          </Text>
        </View>
      </View>

      {/* ── Battery Status Card ─────────────────────────────────────────── */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        alignItems: 'center',
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20, alignSelf: 'flex-start' }}>
          <Feather name="battery-charging" size={16} color={colors.accent} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Battery Status
          </Text>
        </View>

        {hasBattery ? (
          <>
            {/* Gauge */}
            <SimpleGauge
              percentage={batteryPercentage}
              size={180}
              colors={colors}
              mode={batteryMode}
            />

            {/* Runtime estimate */}
            <View style={{
              backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
              padding: 14, marginTop: 20, width: '100%',
              flexDirection: 'row', alignItems: 'center', gap: 12,
            }}>
              <Feather name="clock" size={18} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                  ~{estimatedRuntimeHours} hours
                </Text>
                <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                  Estimated runtime at average home draw (2 kW)
                </Text>
              </View>
            </View>

            {/* Capacity info */}
            <View style={{
              flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 12,
            }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                  {batteryQty}
                </Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>
                  {batteryQty === 1 ? 'Battery' : 'Batteries'}
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: colors.border }} />
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                  {totalCapacityKwh} kWh
                </Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>Total Capacity</Text>
              </View>
              <View style={{ width: 1, backgroundColor: colors.border }} />
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                  {project?.battery ?? 'N/A'}
                </Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>Model</Text>
              </View>
            </View>
          </>
        ) : (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <Feather name="battery" size={40} color={colors.textMuted} />
            <Text style={{ fontSize: 14, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 12, textAlign: 'center' }}>
              No battery system on file
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 4, textAlign: 'center' }}>
              Battery information will appear here once your system design includes energy storage.
            </Text>
          </View>
        )}
      </View>

      {/* ── Load Priority Card ──────────────────────────────────────────── */}
      {hasBattery && (
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 20, marginTop: 12,
          borderWidth: 1, borderColor: colors.borderLight,
          ...theme.shadow.card,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Feather name="layers" size={16} color={colors.warm} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Load Priority
            </Text>
          </View>

          {LOAD_ITEMS.map((item, i) => (
            <View
              key={item.name}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingVertical: 12,
                borderTopWidth: i > 0 ? 1 : 0,
                borderTopColor: colors.borderLight,
              }}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: colors.surfaceAlt,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Feather name={item.icon} size={16} color={colors.textSecondary} />
              </View>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                {item.name}
              </Text>
              <PriorityBadge priority={item.priority} colors={colors} />
            </View>
          ))}

          {/* Info text */}
          <View style={{
            backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
            padding: 12, marginTop: 12,
          }}>
            <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 18 }}>
              During an outage, your battery automatically powers essential loads first. Priority loads activate when battery is above 30%.
            </Text>
            <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 8, fontStyle: 'italic' }}>
              Load priority settings will be configurable when monitoring connects.
            </Text>
          </View>
        </View>
      )}

      {/* ── Emergency Contacts Card ─────────────────────────────────────── */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Feather name="phone" size={16} color={colors.info} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Emergency Contacts
          </Text>
        </View>

        {/* MicroGRID Support */}
        <MgPressable
          accessibilityLabel="Call MicroGRID support at (800) 555-1234"
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            Linking.openURL(`tel:${SUPPORT_PHONE}`)
          }}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingVertical: 12,
          }}
        >
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.accentLight,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="headphones" size={16} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
              MicroGRID Support
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
              (800) 555-1234
            </Text>
          </View>
          <Feather name="phone-call" size={16} color={colors.accent} />
        </MgPressable>

        {/* PM — from project (placeholder name since we don't have PM on CustomerProject) */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingVertical: 12,
          borderTopWidth: 1, borderTopColor: colors.borderLight,
        }}>
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.warmLight,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="user" size={16} color={colors.warm} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
              Your Project Manager
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
              Contact via Messages tab
            </Text>
          </View>
          <MgPressable
            accessibilityLabel="Message your project manager"
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.push('/messages')
            }}
          >
            <Feather name="message-circle" size={16} color={colors.warm} />
          </MgPressable>
        </View>

        {/* 911 */}
        <MgPressable
          accessibilityLabel="Call 911 — emergency services"
          activeOpacity={0.7}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
            Alert.alert(
              'Call 911',
              'Are you sure you want to call emergency services?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
              ],
            )
          }}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingVertical: 12,
            borderTopWidth: 1, borderTopColor: colors.borderLight,
          }}
        >
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.errorLight,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="alert-triangle" size={16} color={colors.error} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
              Emergency: 911
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
              For life-threatening emergencies only
            </Text>
          </View>
          <Feather name="phone-call" size={16} color={colors.error} />
        </MgPressable>

        {/* Report Outage Button */}
        <MgPressable
          accessibilityLabel="Report a power outage"
          accessibilityState={{ disabled: submittingReport, busy: submittingReport }}
          activeOpacity={0.7}
          disabled={submittingReport}
          onPress={handleReportOutage}
          style={{
            backgroundColor: colors.warm,
            borderRadius: theme.radius.xl,
            paddingVertical: 14,
            alignItems: 'center',
            marginTop: 16,
            flexDirection: 'row', justifyContent: 'center', gap: 8,
            opacity: submittingReport ? 0.6 : 1,
          }}
        >
          {submittingReport ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Feather name="alert-circle" size={16} color="#FFFFFF" />
          )}
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>
            {submittingReport ? 'Submitting...' : 'Report a Power Outage'}
          </Text>
        </MgPressable>
      </View>

      {/* ── Safety Tips Card ────────────────────────────────────────────── */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Feather name="shield" size={16} color={colors.accent} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            What to Do During an Outage
          </Text>
        </View>

        {SAFETY_TIPS.map((tip, i) => (
          <View key={i} style={{
            flexDirection: 'row', gap: 10, marginBottom: i < SAFETY_TIPS.length - 1 ? 12 : 0,
          }}>
            <View style={{
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: colors.accentLight,
              alignItems: 'center', justifyContent: 'center',
              marginTop: 1,
            }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.accent, fontFamily: 'Inter_700Bold' }}>
                {i + 1}
              </Text>
            </View>
            <Text style={{
              flex: 1, fontSize: 13, color: colors.textSecondary,
              fontFamily: 'Inter_400Regular', lineHeight: 20,
            }}>
              {tip}
            </Text>
          </View>
        ))}
      </View>

      {/* ── Outage History (placeholder) ────────────────────────────────── */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Feather name="list" size={16} color={colors.textMuted} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Outage History
          </Text>
        </View>

        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <Feather name="check-circle" size={32} color={colors.accent + '60'} />
          <Text style={{ fontSize: 14, fontWeight: '500', color: colors.textSecondary, fontFamily: 'Inter_500Medium', marginTop: 12 }}>
            No outages recorded
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 4, textAlign: 'center' }}>
            Outage history will appear here when monitoring is connected.
          </Text>
        </View>
      </View>

      {/* Footer */}
      <Text style={{
        fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular',
        textAlign: 'center', marginTop: 20, paddingHorizontal: 16,
      }}>
        Battery runtime estimates are based on Duracell 13.5 kWh capacity at 2 kW average draw. Actual performance varies by usage.
      </Text>
    </ScrollView>
  )
}
