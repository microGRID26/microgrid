import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { theme, useThemeColors } from '../lib/theme'
import { getCustomerAccount, loadProject, loadWarranties, loadTickets, fileWarrantyClaim, uploadTicketPhoto, createTicket } from '../lib/api'
import { MgPressable } from '../components/MgPressable'
import type { CustomerAccount, CustomerProject, CustomerWarranty, CustomerTicket } from '../lib/types'

const EQUIPMENT_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  panel: 'sun',
  inverter: 'zap',
  battery: 'battery-charging',
  optimizer: 'cpu',
}

function getWarrantyStatus(endDate: string | null): { label: string; color: string; key: 'active' | 'expiring' | 'expired' } {
  if (!endDate) return { label: 'Unknown', color: '#8A877D', key: 'active' }
  const now = new Date()
  const end = new Date(endDate + 'T00:00:00')
  const sixMonths = new Date()
  sixMonths.setMonth(sixMonths.getMonth() + 6)

  if (end < now) return { label: 'Expired', color: '#C53030', key: 'expired' }
  if (end < sixMonths) return { label: 'Expiring Soon', color: '#C4922A', key: 'expiring' }
  return { label: 'Active', color: '#1D7A5F', key: 'active' }
}

function getCoverageProgress(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 0
  const start = new Date(startDate + 'T00:00:00').getTime()
  const end = new Date(endDate + 'T00:00:00').getTime()
  const now = Date.now()
  if (now >= end) return 1
  if (now <= start) return 0
  return (now - start) / (end - start)
}

function formatDate(d: string | null) {
  if (!d) return 'N/A'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function WarrantyScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [project, setProject] = useState<CustomerProject | null>(null)
  const [warranties, setWarranties] = useState<CustomerWarranty[]>([])
  const [warrantyTickets, setWarrantyTickets] = useState<CustomerTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Claim form state
  const [claimModalVisible, setClaimModalVisible] = useState(false)
  const [claimEquipmentType, setClaimEquipmentType] = useState('')
  const [claimEquipmentLabel, setClaimEquipmentLabel] = useState('')
  const [claimDescription, setClaimDescription] = useState('')
  const [claimPhotoUri, setClaimPhotoUri] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const load = useCallback(async () => {
    const acct = await getCustomerAccount()
    if (!acct) { setLoading(false); return }
    setAccount(acct)
    const [proj, warrs, tix] = await Promise.all([
      loadProject(acct.project_id),
      loadWarranties(acct.project_id),
      loadTickets(acct.project_id),
    ])
    setProject(proj)
    setWarranties(warrs)
    setWarrantyTickets(tix.filter(t => t.category === 'warranty'))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const openClaimForm = (equipType: string, manufacturer: string | null, model: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setClaimEquipmentType(equipType)
    setClaimEquipmentLabel(`${manufacturer ?? equipType}${model ? ` ${model}` : ''}`)
    setClaimDescription('')
    setClaimPhotoUri(null)
    setSubmitSuccess(false)
    setClaimModalVisible(true)
  }

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to attach images.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
    })
    if (!result.canceled && result.assets?.[0]) {
      setClaimPhotoUri(result.assets[0].uri)
    }
  }

  const handleSubmitClaim = async () => {
    if (!account || !claimDescription.trim()) return
    setSubmitting(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const ok = await fileWarrantyClaim(
      account.project_id,
      claimEquipmentType,
      claimDescription.trim(),
      account.name,
    )

    if (ok) {
      // If photo was attached, upload it to the latest warranty ticket
      if (claimPhotoUri) {
        const tix = await loadTickets(account.project_id)
        const latestWarrantyTicket = tix.find(t => t.category === 'warranty')
        if (latestWarrantyTicket) {
          await uploadTicketPhoto(claimPhotoUri, latestWarrantyTicket.id)
        }
      }

      setSubmitSuccess(true)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      // Refresh tickets
      const tix = await loadTickets(account.project_id)
      setWarrantyTickets(tix.filter(t => t.category === 'warranty'))
      setTimeout(() => {
        setClaimModalVisible(false)
        setSubmitSuccess(false)
      }, 1800)
    } else {
      Alert.alert('Error', 'Could not submit warranty claim. Please try again.')
    }
    setSubmitting(false)
  }

  // Calculate total coverage years
  const maxYears = warranties.reduce((max, w) => Math.max(max, w.warranty_years ?? 0), 0)
  const activeWarranties = warranties.filter(w => getWarrantyStatus(w.warranty_end_date).key === 'active')
  const openClaims = warrantyTickets.filter(t => !['resolved', 'closed'].includes(t.status))

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
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
            Warranty
          </Text>
        </View>

        {/* Coverage Summary Card */}
        <View style={{
          borderRadius: theme.radius.xl, padding: 20,
          borderWidth: 1, borderColor: colors.accent,
          backgroundColor: colors.accentLight,
          ...theme.shadow.card,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{
              width: 52, height: 52, borderRadius: 26,
              backgroundColor: colors.accent,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name="shield" size={26} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                {activeWarranties.length > 0 ? 'Your system is protected' : 'No active warranties'}
              </Text>
              {maxYears > 0 && (
                <Text style={{ fontSize: 13, color: colors.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                  Up to {maxYears} years of coverage
                </Text>
              )}
              <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                {activeWarranties.length} of {warranties.length} warranties active
              </Text>
            </View>
          </View>
        </View>

        {/* Equipment Warranty Cards */}
        {warranties.length === 0 ? (
          <View style={{
            backgroundColor: colors.surface, borderRadius: theme.radius.xl,
            padding: 24, marginTop: 16, alignItems: 'center',
            borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
          }}>
            <Feather name="shield-off" size={32} color={colors.textMuted} />
            <Text style={{ fontSize: 14, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 12 }}>
              No warranty records found for your system. Contact support if you believe this is an error.
            </Text>
          </View>
        ) : warranties.map((w) => {
          const status = getWarrantyStatus(w.warranty_end_date)
          const progress = getCoverageProgress(w.warranty_start_date, w.warranty_end_date)
          const icon = EQUIPMENT_ICONS[w.equipment_type] ?? 'box'

          return (
            <View key={w.id} style={{
              backgroundColor: colors.surface, borderRadius: theme.radius.xl,
              padding: 20, marginTop: 12,
              borderWidth: 1, borderColor: colors.borderLight,
              ...theme.shadow.card,
            }}>
              {/* Equipment header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <View style={{
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: status.color + '15',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Feather name={icon} size={20} color={status.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                    {w.manufacturer ?? w.equipment_type.charAt(0).toUpperCase() + w.equipment_type.slice(1)}
                  </Text>
                  {w.model && (
                    <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                      {w.model}
                    </Text>
                  )}
                </View>
                {/* Status badge */}
                <View style={{
                  backgroundColor: status.color + '20',
                  paddingHorizontal: 10, paddingVertical: 4,
                  borderRadius: theme.radius.pill,
                }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: status.color, fontFamily: 'Inter_600SemiBold' }}>
                    {status.label}
                  </Text>
                </View>
              </View>

              {/* Coverage period */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                <View>
                  <Text style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>Coverage Start</Text>
                  <Text style={{ fontSize: 13, color: colors.text, fontFamily: 'Inter_500Medium' }}>
                    {formatDate(w.warranty_start_date)}
                  </Text>
                </View>
                <Feather name="arrow-right" size={14} color={colors.textMuted} style={{ alignSelf: 'center' }} />
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>Coverage End</Text>
                  <Text style={{ fontSize: 13, color: colors.text, fontFamily: 'Inter_500Medium' }}>
                    {formatDate(w.warranty_end_date)}
                  </Text>
                </View>
              </View>

              {/* Progress bar */}
              <View style={{
                height: 6, borderRadius: 3,
                backgroundColor: colors.surfaceAlt,
                marginBottom: 4,
              }}>
                <View style={{
                  height: 6, borderRadius: 3,
                  backgroundColor: status.color,
                  width: `${Math.min(100, Math.round(progress * 100))}%`,
                }} />
              </View>
              <Text style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'right' }}>
                {Math.round(progress * 100)}% elapsed
                {w.warranty_years ? ` of ${w.warranty_years} year${w.warranty_years > 1 ? 's' : ''}` : ''}
              </Text>

              {/* Serial number if present */}
              {w.serial_number && (
                <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 8 }}>
                  S/N: {w.serial_number}
                </Text>
              )}

              {/* File a Claim button */}
              <MgPressable
                accessibilityLabel={`File a warranty claim for ${w.manufacturer ?? w.equipment_type}`}
                onPress={() => openClaimForm(w.equipment_type, w.manufacturer, w.model)}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
                  paddingVertical: 12, marginTop: 14,
                  borderWidth: 1, borderColor: colors.borderLight,
                }}
              >
                <Feather name="file-text" size={15} color={colors.accent} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.accent, fontFamily: 'Inter_600SemiBold' }}>
                  File a Claim
                </Text>
              </MgPressable>
            </View>
          )
        })}

        {/* Active Claims Section */}
        {openClaims.length > 0 && (
          <View style={{
            backgroundColor: colors.surface, borderRadius: theme.radius.xl,
            padding: 20, marginTop: 16,
            borderWidth: 1, borderColor: colors.borderLight,
            ...theme.shadow.card,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Feather name="alert-circle" size={16} color={colors.warm} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                Active Claims ({openClaims.length})
              </Text>
            </View>
            {openClaims.map((ticket) => {
              const statusColor = ticket.status === 'open' ? colors.info
                : ticket.status === 'in_progress' ? colors.warm
                : colors.accent
              const statusLabel = ticket.status === 'open' ? 'Open'
                : ticket.status === 'in_progress' ? 'In Progress'
                : ticket.status === 'assigned' ? 'Assigned'
                : ticket.status.replace(/_/g, ' ')

              return (
                <MgPressable
                  key={ticket.id}
                  accessibilityLabel={`${ticket.title} — ${ticket.status.replace(/_/g, ' ')}`}
                  activeOpacity={0.7}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    router.push({
                      pathname: '/ticket/[id]',
                      params: {
                        id: ticket.id,
                        title: ticket.title,
                        status: ticket.status,
                        description: ticket.description ?? '',
                        created_at: ticket.created_at,
                      },
                    })
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, color: colors.text, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                      {ticket.title}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <View style={{
                        backgroundColor: statusColor + '20',
                        paddingHorizontal: 8, paddingVertical: 2,
                        borderRadius: theme.radius.pill,
                      }}>
                        <Text style={{ fontSize: 10, fontWeight: '500', color: statusColor, fontFamily: 'Inter_500Medium' }}>
                          {statusLabel}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 10, color: colors.textMuted }}>
                        {new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textMuted} />
                </MgPressable>
              )
            })}
          </View>
        )}
      </ScrollView>

      {/* File Claim Modal */}
      <Modal
        visible={claimModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setClaimModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: colors.bg }}
        >
          {/* Modal Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            padding: 16, paddingTop: 20, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
          }}>
            <MgPressable
              accessibilityLabel="Close warranty claim form"
              onPress={() => { setClaimModalVisible(false); setSubmitSuccess(false) }}
            >
              <Feather name="x" size={22} color={colors.textMuted} />
            </MgPressable>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              File Warranty Claim
            </Text>
            <View style={{ width: 22 }} />
          </View>

          {submitSuccess ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <View style={{
                width: 72, height: 72, borderRadius: 36,
                backgroundColor: colors.accentLight,
                alignItems: 'center', justifyContent: 'center', marginBottom: 20,
              }}>
                <Feather name="check-circle" size={36} color={colors.accent} />
              </View>
              <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', textAlign: 'center' }}>
                Claim Submitted!
              </Text>
              <Text style={{ fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                Our team will review your warranty claim and get back to you shortly.
              </Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
              {/* Equipment info */}
              <View style={{
                backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
                padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24,
              }}>
                <Feather name={EQUIPMENT_ICONS[claimEquipmentType] ?? 'box'} size={20} color={colors.accent} />
                <View>
                  <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>Equipment</Text>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
                    {claimEquipmentLabel}
                  </Text>
                </View>
              </View>

              {/* Issue description */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontFamily: 'Inter_600SemiBold' }}>
                Describe the Issue *
              </Text>
              <TextInput
                value={claimDescription}
                onChangeText={setClaimDescription}
                placeholder="What's happening with this equipment?"
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                style={{
                  backgroundColor: colors.surface, borderRadius: theme.radius.md,
                  borderWidth: 1, borderColor: colors.borderLight,
                  padding: 14, fontSize: 15, color: colors.text, fontFamily: 'Inter_400Regular',
                  minHeight: 120, marginBottom: 16,
                }}
              />

              {/* Photo upload */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontFamily: 'Inter_600SemiBold' }}>
                Photo (optional)
              </Text>
              <MgPressable
                accessibilityLabel={claimPhotoUri ? 'Photo attached — tap to change' : 'Add a photo of the issue'}
                onPress={pickPhoto}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: colors.surface, borderRadius: theme.radius.md,
                  borderWidth: 1, borderColor: colors.borderLight, borderStyle: 'dashed',
                  paddingVertical: 16, marginBottom: 28,
                }}
              >
                <Feather name={claimPhotoUri ? 'check-circle' : 'camera'} size={18} color={claimPhotoUri ? colors.accent : colors.textMuted} />
                <Text style={{ fontSize: 14, color: claimPhotoUri ? colors.accent : colors.textMuted, fontFamily: 'Inter_500Medium' }}>
                  {claimPhotoUri ? 'Photo attached' : 'Tap to add a photo'}
                </Text>
              </MgPressable>

              {/* Submit */}
              <MgPressable
                accessibilityLabel={claimDescription.trim() ? 'Submit warranty claim' : 'Describe the issue before submitting'}
                accessibilityState={{ disabled: submitting || !claimDescription.trim(), busy: submitting }}
                onPress={handleSubmitClaim}
                disabled={submitting || !claimDescription.trim()}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: !claimDescription.trim() ? colors.stageUpcoming : colors.accent,
                  borderRadius: theme.radius.lg, paddingVertical: 16,
                }}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="send" size={16} color="#FFFFFF" />
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>
                      Submit Claim
                    </Text>
                  </>
                )}
              </MgPressable>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
