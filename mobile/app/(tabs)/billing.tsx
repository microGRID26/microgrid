import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, ScrollView, RefreshControl, Switch, Alert, AppState } from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../../lib/theme'
import { getCustomerAccount, loadBillingStatements, loadPaymentMethods, loadPaymentHistory } from '../../lib/api'
import { getCache, setCache } from '../../lib/cache'
import type { CustomerAccount, BillingStatement, PaymentMethod, PaymentRecord } from '../../lib/types'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { ErrorState } from '../../components/ErrorState'
import { MgPressable } from '../../components/MgPressable'

type FeatherIconName = React.ComponentProps<typeof Feather>['name']

const formatCurrency = (amount: number) =>
  `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const formatMonth = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const CARD_ICONS: Record<string, FeatherIconName> = {
  visa: 'credit-card',
  mastercard: 'credit-card',
  amex: 'credit-card',
  discover: 'credit-card',
}

export default function BillingScreen() {
  const colors = useThemeColors()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [statements, setStatements] = useState<BillingStatement[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedStatement, setExpandedStatement] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(false)
      const acct = await getCustomerAccount()
      if (!acct) { setError(true); setLoading(false); return }
      setAccount(acct)

      const [stmts, methods, hist] = await Promise.all([
        loadBillingStatements(acct.id),
        loadPaymentMethods(acct.id),
        loadPaymentHistory(acct.id),
      ])

      setStatements(stmts)
      setPaymentMethods(methods)
      setPayments(hist)
      setCache('billingStatements', stmts)
      setCache('paymentMethods', methods)
      setCache('paymentHistory', hist)
      setLoading(false)
    } catch (err) {
      console.error('[BillingScreen]', err)
      setError(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh when foregrounded
  const appActive = useRef(true)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActive.current = state === 'active'
      if (state === 'active') load()
    })
    return () => sub.remove()
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const handlePayNow = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    Alert.alert(
      'Payment Coming Soon',
      'Stripe integration is in progress. You will be able to pay directly from the app soon.',
      [{ text: 'OK' }]
    )
  }

  const handleAddCard = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Alert.alert(
      'Add Payment Method',
      'Secure card entry via Stripe is coming soon. You will receive an email when this feature is ready.',
      [{ text: 'OK' }]
    )
  }

  const handleAutopayToggle = (method: PaymentMethod, val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Alert.alert(
      val ? 'Enable Autopay?' : 'Disable Autopay?',
      val
        ? 'Payments will be automatically charged to your default card on the due date.'
        : 'You will need to make payments manually before the due date.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'OK' }]
    )
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 56 }}>
        <SkeletonLoader showImage lines={2} />
        <SkeletonLoader lines={4} />
        <SkeletonLoader lines={3} />
      </View>
    )
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ErrorState message="Unable to load billing data" onRetry={load} />
      </View>
    )
  }

  const hasData = statements.length > 0
  const currentBalance = statements.find(s => s.status === 'pending' || s.status === 'overdue')
  const defaultCard = paymentMethods.find(m => m.is_default) ?? paymentMethods[0]
  const autopayEnabled = defaultCard?.autopay_enabled ?? false

  // Status badge colors
  const statusColor = (status: string) => {
    switch (status) {
      case 'paid': case 'succeeded': return { bg: colors.accentLight, text: colors.accent }
      case 'pending': case 'processing': return { bg: colors.warmLight, text: colors.warm }
      case 'overdue': case 'failed': return { bg: colors.errorLight, text: colors.error }
      case 'refunded': case 'waived': return { bg: colors.infoLight, text: colors.info }
      default: return { bg: colors.surfaceAlt, text: colors.textMuted }
    }
  }

  // Empty state
  if (!hasData) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', marginTop: 48 }}>
          Billing
        </Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 2, fontFamily: 'Inter_400Regular' }}>
          Payments & Statements
        </Text>

        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 32, marginTop: 24, alignItems: 'center',
          borderWidth: 1, borderColor: colors.borderLight,
          ...theme.shadow.card,
        }}>
          <View style={{
            width: 80, height: 80, borderRadius: 40,
            backgroundColor: colors.accentLight,
            alignItems: 'center', justifyContent: 'center', marginBottom: 20,
          }}>
            <Feather name="credit-card" size={36} color={colors.accent} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginBottom: 8 }}>
            No Statements Yet
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 }}>
            Your first statement will appear here after your system is activated. MicroGRID charges a simple $0.12/kWh — no surprises.
          </Text>
          <View style={{
            backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
            padding: 16, marginTop: 20, width: '100%',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Feather name="info" size={14} color={colors.info} />
              <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_500Medium', flex: 1 }}>
                No contracts, no escalators, no hidden fees. Just clean energy at a fair rate.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
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
        Billing
      </Text>
      <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 2, fontFamily: 'Inter_400Regular' }}>
        Payments & Statements
      </Text>

      {/* Current Balance Card */}
      {currentBalance && (
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 20, marginTop: 20,
          borderWidth: 1, borderColor: currentBalance.status === 'overdue' ? colors.error + '40' : colors.borderLight,
          ...theme.shadow.card,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Amount Due
              </Text>
              <Text style={{ fontSize: 32, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', marginTop: 4 }}>
                {formatCurrency(currentBalance.amount_due)}
              </Text>
              {currentBalance.due_date && (
                <Text style={{ fontSize: 13, color: currentBalance.status === 'overdue' ? colors.error : colors.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                  {currentBalance.status === 'overdue' ? 'Overdue' : 'Due'} {formatDate(currentBalance.due_date)}
                </Text>
              )}
            </View>
            {currentBalance.status === 'overdue' && (
              <View style={{
                backgroundColor: colors.errorLight, borderRadius: theme.radius.sm,
                paddingHorizontal: 10, paddingVertical: 4,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.error, fontFamily: 'Inter_600SemiBold' }}>
                  OVERDUE
                </Text>
              </View>
            )}
          </View>
          <MgPressable
            accessibilityLabel="Pay now"
            onPress={handlePayNow}
            activeOpacity={0.8}
            style={{
              backgroundColor: colors.accent, borderRadius: theme.radius.lg,
              paddingVertical: 14, marginTop: 16, alignItems: 'center',
              flexDirection: 'row', justifyContent: 'center', gap: 8,
            }}
          >
            <Feather name="credit-card" size={16} color={colors.accentText} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>
              Pay Now
            </Text>
          </MgPressable>
        </View>
      )}

      {/* Autopay Toggle */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 16, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: autopayEnabled ? colors.accentLight : colors.surfaceAlt,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="repeat" size={16} color={autopayEnabled ? colors.accent : colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Autopay
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
              {autopayEnabled ? 'Charges your default card on due date' : 'Set up automatic payments'}
            </Text>
          </View>
        </View>
        <Switch
          value={autopayEnabled}
          onValueChange={(val) => defaultCard && handleAutopayToggle(defaultCard, val)}
          trackColor={{ false: colors.border, true: colors.accent + '60' }}
          thumbColor={autopayEnabled ? colors.accent : colors.surfaceAlt}
        />
      </View>

      {/* Payment Methods */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Feather name="lock" size={14} color={colors.accent} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Payment Methods
            </Text>
          </View>
          <MgPressable accessibilityLabel="Add payment method" onPress={handleAddCard} activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Feather name="plus" size={14} color={colors.accent} />
            <Text style={{ fontSize: 13, color: colors.accent, fontFamily: 'Inter_500Medium' }}>Add</Text>
          </MgPressable>
        </View>

        {paymentMethods.length === 0 ? (
          <MgPressable accessibilityLabel="Add a payment method" onPress={handleAddCard} activeOpacity={0.7}
            style={{
              backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
              padding: 16, alignItems: 'center',
              borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
            }}>
            <Feather name="plus-circle" size={24} color={colors.textMuted} />
            <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: 'Inter_500Medium', marginTop: 8 }}>
              Add a payment method
            </Text>
          </MgPressable>
        ) : (
          paymentMethods.map((method) => {
            const brand = method.card_brand ?? 'card'
            const last4 = method.card_last4 ?? '----'
            return (
              <View key={method.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingVertical: 10,
                borderBottomWidth: method.id !== paymentMethods[paymentMethods.length - 1].id ? 1 : 0,
                borderBottomColor: colors.borderLight,
              }}>
                <View style={{
                  width: 40, height: 28, borderRadius: 6,
                  backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: colors.border,
                }}>
                  <Feather name={CARD_ICONS[brand.toLowerCase()] ?? 'credit-card'} size={16} color={colors.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                    {brand.charAt(0).toUpperCase() + brand.slice(1)} ending in {last4}
                  </Text>
                  {method.card_exp_month != null && method.card_exp_year != null && (
                    <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                      Expires {String(method.card_exp_month).padStart(2, '0')}/{method.card_exp_year}
                    </Text>
                  )}
                </View>
                {method.is_default && (
                  <View style={{
                    backgroundColor: colors.accentLight, borderRadius: theme.radius.sm,
                    paddingHorizontal: 8, paddingVertical: 2,
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: colors.accent, fontFamily: 'Inter_600SemiBold' }}>
                      DEFAULT
                    </Text>
                  </View>
                )}
              </View>
            )
          })
        )}
      </View>

      {/* Recent Statements */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight,
        ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Feather name="file-text" size={14} color={colors.accent} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Statements
          </Text>
        </View>

        {statements.map((stmt) => {
          const expanded = expandedStatement === stmt.id
          const sc = statusColor(stmt.status)
          const savings = stmt.utility_comparison != null
            ? stmt.utility_comparison - stmt.amount_due
            : null

          return (
            <View key={stmt.id}>
              <MgPressable
                accessibilityLabel={`${formatMonth(stmt.period_start)} statement — ${formatCurrency(stmt.amount_due)}`}
                accessibilityState={{ expanded }}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setExpandedStatement(expanded ? null : stmt.id)
                }}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingVertical: 12,
                  borderBottomWidth: expanded ? 0 : 1,
                  borderBottomColor: colors.borderLight,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                    {formatMonth(stmt.period_start)}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                    {stmt.kwh_consumed.toLocaleString()} kWh
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                    {formatCurrency(stmt.amount_due)}
                  </Text>
                  <View style={{
                    backgroundColor: sc.bg, borderRadius: theme.radius.sm,
                    paddingHorizontal: 8, paddingVertical: 2,
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: sc.text, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' }}>
                      {stmt.status}
                    </Text>
                  </View>
                  <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                </View>
              </MgPressable>

              {/* Expanded Details */}
              {expanded && (
                <View style={{
                  backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
                  padding: 14, marginBottom: 8,
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>Rate</Text>
                    <Text style={{ fontSize: 12, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                      ${stmt.rate_per_kwh.toFixed(2)}/kWh
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>Period</Text>
                    <Text style={{ fontSize: 12, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                      {formatDate(stmt.period_start)} - {formatDate(stmt.period_end)}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>Consumption</Text>
                    <Text style={{ fontSize: 12, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                      {stmt.kwh_consumed.toLocaleString()} kWh x ${stmt.rate_per_kwh.toFixed(2)}
                    </Text>
                  </View>
                  {stmt.paid_at && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>Paid</Text>
                      <Text style={{ fontSize: 12, fontWeight: '500', color: colors.accent, fontFamily: 'Inter_500Medium' }}>
                        {formatDate(stmt.paid_at)}
                      </Text>
                    </View>
                  )}

                  {/* Utility Comparison */}
                  {savings != null && savings > 0 && (
                    <View style={{
                      backgroundColor: colors.accentLight, borderRadius: theme.radius.md,
                      padding: 10, marginTop: 4,
                      flexDirection: 'row', alignItems: 'center', gap: 8,
                    }}>
                      <Feather name="trending-down" size={14} color={colors.accent} />
                      <Text style={{ fontSize: 12, fontWeight: '500', color: colors.accent, fontFamily: 'Inter_500Medium', flex: 1 }}>
                        You saved {formatCurrency(savings)} vs your utility ({formatCurrency(stmt.utility_comparison!)})
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )
        })}
      </View>

      {/* Payment History */}
      {payments.length > 0 && (
        <View style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 20, marginTop: 12,
          borderWidth: 1, borderColor: colors.borderLight,
          ...theme.shadow.card,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Feather name="list" size={14} color={colors.accent} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Payment History
            </Text>
          </View>

          {payments.slice(0, 10).map((payment, idx) => {
            const pc = statusColor(payment.status)
            return (
              <View key={payment.id} style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 10,
                borderBottomWidth: idx < Math.min(payments.length, 10) - 1 ? 1 : 0,
                borderBottomColor: colors.borderLight,
              }}>
                <View>
                  <Text style={{ fontSize: 13, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                    {formatCurrency(payment.amount)}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                    {formatDate(payment.created_at)}
                  </Text>
                </View>
                <View style={{
                  backgroundColor: pc.bg, borderRadius: theme.radius.sm,
                  paddingHorizontal: 8, paddingVertical: 2,
                }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: pc.text, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' }}>
                    {payment.status}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>
      )}

      {/* Footer note */}
      <View style={{ alignItems: 'center', marginTop: 20, paddingHorizontal: 16 }}>
        <Feather name="shield" size={14} color={colors.textMuted} />
        <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 }}>
          All payments are securely processed. No escalators, no hidden fees.
        </Text>
      </View>
    </ScrollView>
  )
}
