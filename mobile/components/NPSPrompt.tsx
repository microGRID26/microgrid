/**
 * NPSPrompt — periodic 0-10 "would you recommend" prompt.
 *
 * Triggered automatically once per milestone (PTO complete, 30 days post-billing,
 * project complete). State tracked in customer_accounts.nps_prompts_shown so we
 * never re-prompt for the same milestone.
 *
 * The prompt is intentionally lightweight: 0-10 score buttons + an optional
 * comment textarea + submit. Can be dismissed without scoring (still marks
 * the milestone as shown).
 */

import { useState } from 'react'
import {
  View, Text, TextInput, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { X } from 'lucide-react-native'
import { useThemeColors, theme } from '../lib/theme'
import { submitNpsRating, dismissNpsPrompt, type NpsMilestone } from '../lib/feedback'
import { MgPressable } from './MgPressable'

interface Props {
  visible: boolean
  milestone: NpsMilestone
  onClose: () => void
}

const MILESTONE_PROMPTS: Record<NpsMilestone, { title: string; subtitle: string }> = {
  pto_complete: {
    title: 'Your system is live!',
    subtitle: 'How likely are you to recommend MicroGRID to a friend or colleague?',
  },
  first_billing_30d: {
    title: 'A month in — how\'s it going?',
    subtitle: 'How likely are you to recommend MicroGRID to a friend or colleague?',
  },
  onboarding_complete: {
    title: 'Welcome to the MicroGRID family',
    subtitle: 'How likely are you to recommend us to a friend or colleague?',
  },
}

export function NPSPrompt({ visible, milestone, onClose }: Props) {
  const colors = useThemeColors()
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const prompt = MILESTONE_PROMPTS[milestone]

  const reset = () => {
    setScore(null)
    setComment('')
    setSubmitting(false)
  }

  const handleDismiss = async () => {
    if (submitting) return
    // Mark as shown so we don't keep prompting
    await dismissNpsPrompt(milestone)
    reset()
    onClose()
  }

  const handleSubmit = async () => {
    if (score === null || submitting) return
    setSubmitting(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const ok = await submitNpsRating(score, milestone, comment)
    setSubmitting(false)

    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Thank you!', 'Your feedback helps us improve MicroGRID for everyone.', [
        { text: 'OK', onPress: () => { reset(); onClose() } },
      ])
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Couldn\'t send', 'Something went wrong. Please try again.')
    }
  }

  // Color the score buttons by NPS bucket: 0-6 detractor (red), 7-8 passive (amber), 9-10 promoter (green)
  const scoreColor = (n: number): string => {
    if (n <= 6) return colors.error
    if (n <= 8) return colors.warm
    return colors.accent
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleDismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: colors.bg }}
      >
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
          paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
        }}>
          <MgPressable
            accessibilityLabel="Dismiss feedback prompt"
            onPress={handleDismiss}
            hitSlop={12}
            disabled={submitting}
          >
            <X size={24} color={colors.textMuted} />
          </MgPressable>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 24 }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold', marginBottom: 8 }}>
            {prompt.title}
          </Text>
          <Text style={{ fontSize: 15, color: colors.textSecondary, fontFamily: 'Inter_400Regular', lineHeight: 22, marginBottom: 32 }}>
            {prompt.subtitle}
          </Text>

          {/* 0-10 score grid */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {Array.from({ length: 11 }, (_, i) => i).map(n => {
              const selected = score === n
              return (
                <MgPressable
                  key={n}
                  accessibilityLabel={`Rate ${n} out of 10 — ${n <= 6 ? 'not likely' : n <= 8 ? 'somewhat likely' : 'very likely'} to recommend`}
                  accessibilityState={{ selected }}
                  onPress={() => { setScore(n); Haptics.selectionAsync() }}
                  style={{
                    width: 48, height: 48, borderRadius: 24,
                    backgroundColor: selected ? scoreColor(n) : colors.surface,
                    borderWidth: 1,
                    borderColor: selected ? scoreColor(n) : colors.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{
                    fontSize: 16, fontWeight: '700',
                    color: selected ? '#FFFFFF' : colors.text,
                    fontFamily: 'Inter_700Bold',
                  }}>
                    {n}
                  </Text>
                </MgPressable>
              )
            })}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 }}>
            <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>
              Not at all likely
            </Text>
            <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>
              Extremely likely
            </Text>
          </View>

          {/* Optional comment */}
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
            Anything you'd like to add? (optional)
          </Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="What stood out, good or bad?"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1, borderColor: colors.border,
              borderRadius: theme.radius.lg,
              padding: 14, fontSize: 15,
              color: colors.text, fontFamily: 'Inter_400Regular',
              minHeight: 100,
              marginBottom: 24,
            }}
          />

          {/* Submit */}
          <MgPressable
            accessibilityLabel={score !== null ? 'Submit rating' : 'Select a score before submitting'}
            accessibilityState={{ disabled: score === null || submitting, busy: submitting }}
            onPress={handleSubmit}
            disabled={score === null || submitting}
            activeOpacity={0.8}
            style={{
              backgroundColor: score !== null ? colors.accent : colors.surfaceAlt,
              borderRadius: theme.radius.xl,
              paddingVertical: 16, alignItems: 'center',
            }}
          >
            {submitting ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={{
                fontSize: 16, fontWeight: '600',
                color: score !== null ? colors.accentText : colors.textMuted,
                fontFamily: 'Inter_600SemiBold',
              }}>
                Submit
              </Text>
            )}
          </MgPressable>

          <MgPressable
            accessibilityLabel="Skip for now — dismiss feedback prompt"
            accessibilityState={{ disabled: submitting }}
            onPress={handleDismiss}
            disabled={submitting}
            style={{ alignItems: 'center', marginTop: 16 }}
          >
            <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>
              Maybe later
            </Text>
          </MgPressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
