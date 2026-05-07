import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Share, Modal, TextInput, KeyboardAvoidingView, Platform, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import { theme, useThemeColors } from '../../lib/theme'
import { supabase } from '../../lib/supabase'
import { getCustomerAccount, loadProject, loadReferrals, submitReferral, deleteCustomerAccount } from '../../lib/api'
import { clearCache } from '../../lib/cache'
import type { CustomerAccount, CustomerProject, CustomerReferral } from '../../lib/types'

export default function AccountScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [project, setProject] = useState<CustomerProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [referrals, setReferrals] = useState<CustomerReferral[]>([])
  const [referralModalVisible, setReferralModalVisible] = useState(false)
  const [refName, setRefName] = useState('')
  const [refPhone, setRefPhone] = useState('')
  const [refEmail, setRefEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [deleteModalVisible, setDeleteModalVisible] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const fetchReferrals = useCallback(async (accountId: string) => {
    const refs = await loadReferrals(accountId)
    setReferrals(refs)
  }, [])

  useEffect(() => {
    async function load() {
      const acct = await getCustomerAccount()
      if (acct) {
        setAccount(acct)
        const proj = await loadProject(acct.project_id)
        setProject(proj)
        fetchReferrals(acct.id)
      }
      setLoading(false)
    }
    load()
  }, [])

  const handleShareReferral = async () => {
    if (!account) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const link = `https://gomicrogridenergy.com/refer?ref=${account.id}`
    try {
      await Share.share({
        message: `I switched to solar with MicroGRID and it changed everything. Check it out — if you go solar through my link, we both earn $500!\n\n${link}`,
        title: 'Go Solar with MicroGRID',
      })
    } catch { /* user cancelled */ }
  }

  const handleSubmitReferral = async () => {
    if (!account || !refName.trim() || !refPhone.trim()) return
    const digits = refPhone.replace(/\D/g, '')
    if (digits.length < 10) {
      Alert.alert('Invalid Phone', 'Please enter a valid 10-digit phone number.')
      return
    }
    if (refEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(refEmail.trim())) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.')
      return
    }
    setSubmitting(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const ok = await submitReferral(
      account.id,
      account.project_id,
      refName.trim(),
      refPhone.trim(),
      refEmail.trim() || undefined,
    )
    setSubmitting(false)
    if (ok) {
      setSubmitSuccess(true)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      fetchReferrals(account.id)
      setTimeout(() => {
        setReferralModalVisible(false)
        setSubmitSuccess(false)
        setRefName('')
        setRefPhone('')
        setRefEmail('')
      }, 1800)
    } else {
      Alert.alert('Error', 'Could not submit referral. Please try again.')
    }
  }

  const referralStats = {
    total: referrals.length,
    pending: referrals.filter(r => r.status === 'pending' || r.status === 'contacted').length,
    completed: referrals.filter(r => r.status === 'installed' || r.status === 'paid').length,
    earned: referrals.filter(r => r.status === 'paid').reduce((sum, r) => sum + (r.bonus_amount ?? 0), 0),
  }

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          clearCache()
          await SecureStore.deleteItemAsync('atlas_chat_history').catch(() => {})
          await SecureStore.deleteItemAsync('mg_support_seen').catch(() => {})
          await supabase.auth.signOut()
        },
      },
    ])
  }

  // Required by Apple App Store guideline 5.1.1(v) — in-app account deletion.
  // Two-step flow: confirm intent → type DELETE → server-side cascade delete.
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account?',
      'This permanently removes your account, in-app feedback, referrals, and saved payment methods. Your solar installation records remain with MicroGRID for warranty and service purposes. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
            setDeleteConfirmText('')
            setDeleteModalVisible(true)
          },
        },
      ],
    )
  }

  const confirmDelete = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      Alert.alert('Type DELETE to confirm', 'Please type the word DELETE exactly to confirm account deletion.')
      return
    }
    setDeleting(true)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    const result = await deleteCustomerAccount()
    setDeleting(false)
    if (result.ok) {
      setDeleteModalVisible(false)
      Alert.alert(
        'Account Deleted',
        'Your account has been permanently deleted. Thank you for being part of MicroGRID.',
        [{ text: 'OK', onPress: async () => {
        clearCache()
        await SecureStore.deleteItemAsync('atlas_chat_history').catch(() => {})
        await SecureStore.deleteItemAsync('mg_support_seen').catch(() => {})
        await supabase.auth.signOut()
      } }],
      )
    } else {
      Alert.alert('Could not delete account', result.error ?? 'Please try again or contact support.')
    }
  }

  const handleOpenPrivacyPolicy = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Linking.openURL('https://app.gomicrogridenergy.com/privacy').catch(() => {
      Alert.alert('Could not open link', 'Please visit app.gomicrogridenergy.com/privacy in your browser.')
    })
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    )
  }

  if (!account) return null

  const Row = ({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; value: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <Feather name={icon} size={16} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>{label}</Text>
        <Text style={{ fontSize: 14, color: colors.text, fontFamily: 'Inter_500Medium', marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  )

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 32 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>Account</Text>

      {/* Profile */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 16,
        borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
      }}>
        <View style={{
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: colors.accentLight,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.accent }}>
            {account.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>{account.name}</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>{account.email}</Text>
        </View>
      </View>

      {/* Contact */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
      }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, fontFamily: 'Inter_600SemiBold' }}>
          Contact
        </Text>
        <Row icon="mail" label="Email" value={account.email} />
        {account.phone && <Row icon="phone" label="Phone" value={account.phone} />}
        {project?.address && <Row icon="map-pin" label="Address" value={`${project.address}${project.city ? `, ${project.city}` : ''} ${project.zip ?? ''}`} />}
      </View>

      {/* Project */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
      }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, fontFamily: 'Inter_600SemiBold' }}>
          Project
        </Text>
        <Row icon="hash" label="Project ID" value={account.project_id} />
        {project?.financier && <Row icon="credit-card" label="Financing" value={project.financier} />}
        {project?.systemkw && <Row icon="zap" label="System Size" value={`${project.systemkw} kW`} />}
      </View>

      {/* Refer a Friend */}
      <View style={{
        borderRadius: theme.radius.xl, padding: 20, marginTop: 16,
        borderWidth: 1, borderColor: colors.warm,
        backgroundColor: colors.warmLight,
        ...theme.shadow.card,
      }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <View style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: colors.warm,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="gift" size={22} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
              Earn $500 per Referral
            </Text>
            <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 17 }}>
              Know someone who'd benefit from solar? Share your link and earn $500 when they go solar.
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <TouchableOpacity
            onPress={handleShareReferral}
            activeOpacity={0.8}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: colors.warm, borderRadius: theme.radius.lg, paddingVertical: 12,
            }}>
            <Feather name="share" size={15} color="#FFFFFF" />
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>Share Link</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setReferralModalVisible(true) }}
            activeOpacity={0.8}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: colors.surface, borderRadius: theme.radius.lg, paddingVertical: 12,
              borderWidth: 1, borderColor: colors.warm,
            }}>
            <Feather name="user-plus" size={15} color={colors.warm} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.warm, fontFamily: 'Inter_600SemiBold' }}>Refer Someone</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        {referrals.length > 0 && (
          <View style={{
            flexDirection: 'row', marginTop: 16, paddingTop: 14,
            borderTopWidth: 1, borderTopColor: colors.border,
          }}>
            {[
              { label: 'Total', value: referralStats.total },
              { label: 'Pending', value: referralStats.pending },
              { label: 'Completed', value: referralStats.completed },
              { label: 'Earned', value: `$${referralStats.earned.toLocaleString()}` },
            ].map((stat) => (
              <View key={stat.label} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                  {stat.value}
                </Text>
                <Text style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Referral Submission Modal */}
      <Modal
        visible={referralModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setReferralModalVisible(false)}
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
            <TouchableOpacity onPress={() => { setReferralModalVisible(false); setSubmitSuccess(false) }}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Refer a Friend
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
                Referral Submitted!
              </Text>
              <Text style={{ fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                We'll reach out to your friend shortly. You'll earn $500 when they go solar.
              </Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
              {/* Gift prompt */}
              <View style={{ alignItems: 'center', marginBottom: 28 }}>
                <View style={{
                  width: 60, height: 60, borderRadius: 30,
                  backgroundColor: colors.warmLight,
                  alignItems: 'center', justifyContent: 'center', marginBottom: 12,
                  borderWidth: 2, borderColor: colors.warm,
                }}>
                  <Feather name="gift" size={28} color={colors.warm} />
                </View>
                <Text style={{ fontSize: 15, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 }}>
                  Tell us about your friend and we'll take it from there. You'll earn $500 when they complete their installation.
                </Text>
              </View>

              {/* Name */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontFamily: 'Inter_600SemiBold' }}>
                Friend's Name *
              </Text>
              <TextInput
                value={refName}
                onChangeText={setRefName}
                placeholder="First and last name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                style={{
                  backgroundColor: colors.surface, borderRadius: theme.radius.md,
                  borderWidth: 1, borderColor: colors.borderLight,
                  padding: 14, fontSize: 15, color: colors.text, fontFamily: 'Inter_400Regular',
                  marginBottom: 16,
                }}
              />

              {/* Phone */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontFamily: 'Inter_600SemiBold' }}>
                Phone Number *
              </Text>
              <TextInput
                value={refPhone}
                onChangeText={setRefPhone}
                placeholder="(555) 555-5555"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                style={{
                  backgroundColor: colors.surface, borderRadius: theme.radius.md,
                  borderWidth: 1, borderColor: colors.borderLight,
                  padding: 14, fontSize: 15, color: colors.text, fontFamily: 'Inter_400Regular',
                  marginBottom: 16,
                }}
              />

              {/* Email */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontFamily: 'Inter_600SemiBold' }}>
                Email (optional)
              </Text>
              <TextInput
                value={refEmail}
                onChangeText={setRefEmail}
                placeholder="friend@email.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                style={{
                  backgroundColor: colors.surface, borderRadius: theme.radius.md,
                  borderWidth: 1, borderColor: colors.borderLight,
                  padding: 14, fontSize: 15, color: colors.text, fontFamily: 'Inter_400Regular',
                  marginBottom: 28,
                }}
              />

              {/* Submit */}
              <TouchableOpacity
                onPress={handleSubmitReferral}
                disabled={submitting || !refName.trim() || !refPhone.trim()}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: (!refName.trim() || !refPhone.trim()) ? colors.stageUpcoming : colors.accent,
                  borderRadius: theme.radius.lg, paddingVertical: 16,
                }}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="send" size={16} color="#FFFFFF" />
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>
                      Submit Referral
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* Security */}
      <View style={{
        backgroundColor: colors.surface, borderRadius: theme.radius.xl,
        padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Feather name="shield" size={16} color={colors.accent} />
          <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', fontFamily: 'Inter_600SemiBold' }}>Security</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', lineHeight: 18 }}>
          Signed in via secure email link. Your data is encrypted and protected.
        </Text>
        {account.last_login_at && (
          <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 4 }}>
            Last login: {new Date(account.last_login_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </Text>
        )}
      </View>

      {/* Notification Settings */}
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/notifications-settings') }}
        activeOpacity={0.7}
        style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
          borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
        }}
      >
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="bell" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
            Notification Settings
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
            Manage your alerts and updates
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Warranty */}
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/warranty') }}
        activeOpacity={0.7}
        style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
          borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
        }}
      >
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="shield" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
            Warranty
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
            Coverage details and claims
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Privacy Policy */}
      <TouchableOpacity
        onPress={handleOpenPrivacyPolicy}
        activeOpacity={0.7}
        style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
          borderWidth: 1, borderColor: colors.borderLight, ...theme.shadow.card,
        }}
      >
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="lock" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }}>
            Privacy Policy
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
            How we handle your data
          </Text>
        </View>
        <Feather name="external-link" size={14} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Sign Out */}
      <TouchableOpacity onPress={handleSignOut} activeOpacity={0.7}
        style={{
          backgroundColor: colors.surface, borderRadius: theme.radius.xl,
          padding: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          borderWidth: 1, borderColor: colors.borderLight,
        }}>
        <Feather name="log-out" size={16} color={colors.error} />
        <Text style={{ fontSize: 14, fontWeight: '500', color: colors.error, fontFamily: 'Inter_500Medium' }}>Sign Out</Text>
      </TouchableOpacity>

      {/* Delete Account — required by Apple App Store guideline 5.1.1(v) */}
      <TouchableOpacity onPress={handleDeleteAccount} activeOpacity={0.7}
        style={{
          backgroundColor: 'transparent', borderRadius: theme.radius.xl,
          padding: 16, marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          borderWidth: 1, borderColor: colors.error,
        }}>
        <Feather name="trash-2" size={16} color={colors.error} />
        <Text style={{ fontSize: 14, fontWeight: '500', color: colors.error, fontFamily: 'Inter_500Medium' }}>Delete Account</Text>
      </TouchableOpacity>
      <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 8, paddingHorizontal: 24, fontFamily: 'Inter_400Regular', lineHeight: 16 }}>
        Permanently removes your portal account and personal data. Your installation records remain with MicroGRID for warranty and service.
      </Text>

      {/* Delete Account Confirmation Modal */}
      <Modal
        visible={deleteModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !deleting && setDeleteModalVisible(false)}
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
            <TouchableOpacity onPress={() => !deleting && setDeleteModalVisible(false)} disabled={deleting}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
              Confirm Deletion
            </Text>
            <View style={{ width: 22 }} />
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }}>
            <View style={{ alignItems: 'center', marginBottom: 28 }}>
              <View style={{
                width: 72, height: 72, borderRadius: 36,
                backgroundColor: colors.errorLight,
                alignItems: 'center', justifyContent: 'center', marginBottom: 16,
                borderWidth: 2, borderColor: colors.error,
              }}>
                <Feather name="alert-triangle" size={32} color={colors.error} />
              </View>
              <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', textAlign: 'center' }}>
                This is permanent
              </Text>
              <Text style={{ fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 12, lineHeight: 20 }}>
                Deleting your account will permanently remove your portal access, in-app feedback, referrals, and any saved payment methods. Your solar installation, contract, warranty, and service history remain with MicroGRID.
              </Text>
              <Text style={{ fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 12, lineHeight: 20 }}>
                This cannot be undone.
              </Text>
            </View>

            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontFamily: 'Inter_600SemiBold' }}>
              Type DELETE to confirm
            </Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
              style={{
                backgroundColor: colors.surface, borderRadius: theme.radius.md,
                borderWidth: 1, borderColor: colors.borderLight,
                padding: 14, fontSize: 15, color: colors.text, fontFamily: 'Inter_400Regular',
                marginBottom: 24,
              }}
            />

            <TouchableOpacity
              onPress={confirmDelete}
              disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: deleteConfirmText.trim().toUpperCase() === 'DELETE' ? colors.error : colors.stageUpcoming,
                borderRadius: theme.radius.lg, paddingVertical: 16,
              }}>
              {deleting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Feather name="trash-2" size={16} color="#FFFFFF" />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>
                    Delete My Account
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => !deleting && setDeleteModalVisible(false)}
              disabled={deleting}
              activeOpacity={0.7}
              style={{ marginTop: 12, paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Branding */}
      <View style={{ alignItems: 'center', marginTop: 32 }}>
        <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>MicroGRID</Text>
        <Text style={{ fontSize: 10, color: colors.textMuted }}>powered by EDGE</Text>
        <Text style={{ fontSize: 9, color: colors.textMuted, marginTop: 4 }}>Dependable Power. Predictable Cost.</Text>
        <Text style={{ fontSize: 9, color: colors.textMuted, marginTop: 8, fontFamily: 'Inter_400Regular' }}>
          Version {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </View>
    </ScrollView>
  )
}
