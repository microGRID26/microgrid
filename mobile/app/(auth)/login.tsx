import { useState, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native'
import { supabase } from '../../lib/supabase'
import { theme, useThemeColors } from '../../lib/theme'
import * as Haptics from 'expo-haptics'

export default function LoginScreen() {
  const colors = useThemeColors()
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const codeRef = useRef<TextInput>(null)

  const handleSendCode = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
    })

    setLoading(false)
    if (authError) {
      setError('Unable to send code. Please try again.')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    } else {
      setStep('code')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setTimeout(() => codeRef.current?.focus(), 300)
    }
  }

  const handleVerifyCode = async () => {
    if (code.length < 6) return // Supabase sends 6 or 8 digit codes
    setLoading(true)
    setError('')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    })

    setLoading(false)
    if (verifyError) {
      setError('Invalid code. Please check and try again.')
      setCode('')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      // Session is now set — root layout auth guard will redirect to (tabs)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 48 }}>
          <View style={{
            width: 64, height: 64, borderRadius: 16,
            backgroundColor: colors.accent,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.accentText }}>M</Text>
          </View>
          <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
            MicroGRID
          </Text>
          <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, fontFamily: 'Inter_400Regular' }}>
            powered by EDGE
          </Text>
        </View>

        {step === 'email' ? (
          /* Step 1: Email entry */
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', color: colors.textSecondary, marginBottom: 8, fontFamily: 'Inter_500Medium' }}>
              Email address
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              autoFocus
              returnKeyType="go"
              onSubmitEditing={handleSendCode}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1, borderColor: colors.border,
                borderRadius: theme.radius.xl,
                paddingHorizontal: 16, paddingVertical: 14,
                fontSize: 16, color: colors.text, fontFamily: 'Inter_400Regular',
              }}
            />

            {error ? (
              <Text style={{ color: colors.error, fontSize: 13, marginTop: 8, fontFamily: 'Inter_400Regular' }}>
                {error}
              </Text>
            ) : null}

            <TouchableOpacity
              onPress={handleSendCode}
              disabled={loading || !email.trim()}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Continue — send a 6-digit code to your email"
              accessibilityState={{ disabled: loading || !email.trim(), busy: loading }}
              style={{
                backgroundColor: colors.accent, borderRadius: theme.radius.xl,
                paddingVertical: 14, marginTop: 16, alignItems: 'center',
                opacity: loading || !email.trim() ? 0.5 : 1,
              }}
            >
              {loading ? (
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>
                  Continue
                </Text>
              )}
            </TouchableOpacity>

            <Text style={{
              textAlign: 'center', fontSize: 12, color: colors.textMuted,
              marginTop: 16, paddingHorizontal: 24, fontFamily: 'Inter_400Regular', lineHeight: 18,
            }}>
              We'll send a 6-digit code to your email.
            </Text>
          </View>
        ) : (
          /* Step 2: Code entry */
          <View>
            <View style={{
              backgroundColor: colors.accentLight, borderRadius: theme.radius.xl,
              padding: 16, marginBottom: 20, alignItems: 'center',
            }}>
              <Text style={{ fontSize: 13, color: colors.accentDark, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                Code sent to <Text style={{ fontWeight: '600' }}>{email}</Text>
              </Text>
            </View>

            <Text style={{ fontSize: 14, fontWeight: '500', color: colors.textSecondary, marginBottom: 8, fontFamily: 'Inter_500Medium' }}>
              Enter 6-digit code
            </Text>
            <TextInput
              ref={codeRef}
              value={code}
              onChangeText={t => { setCode(t.replace(/[^0-9]/g, '').slice(0, 8)); setError('') }}
              placeholder="00000000"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={8}
              autoFocus
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1, borderColor: colors.border,
                borderRadius: theme.radius.xl,
                paddingHorizontal: 16, paddingVertical: 14,
                fontSize: 24, color: colors.text, fontFamily: 'Inter_700Bold',
                textAlign: 'center', letterSpacing: 6,
              }}
            />

            {error ? (
              <Text style={{ color: colors.error, fontSize: 13, marginTop: 8, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                {error}
              </Text>
            ) : null}

            <TouchableOpacity
              onPress={handleVerifyCode}
              disabled={loading || code.length < 6} // enables at 6, works with 6 or 8
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Verify the code and sign in"
              accessibilityState={{ disabled: loading || code.length < 6, busy: loading }}
              style={{
                backgroundColor: colors.accent, borderRadius: theme.radius.xl,
                paddingVertical: 14, marginTop: 16, alignItems: 'center',
                opacity: loading || code.length < 6 ? 0.5 : 1, // enables at 6+
              }}
            >
              {loading ? (
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>
                  Verify & Sign In
                </Text>
              )}
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => { setStep('email'); setCode(''); setError('') }}
                accessibilityRole="button"
                accessibilityLabel="Change email address"
              >
                <Text style={{ fontSize: 13, fontWeight: '500', color: colors.accent, fontFamily: 'Inter_500Medium' }}>
                  Change email
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSendCode}
                accessibilityRole="button"
                accessibilityLabel="Resend the verification code"
              >
                <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>
                  Resend code
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={{ alignItems: 'center', marginTop: 48 }}>
          <Text style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
            The Future of Residential Energy
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
