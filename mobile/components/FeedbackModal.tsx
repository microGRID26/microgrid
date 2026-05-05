/**
 * Feedback submission modal.
 *
 * Triggered by FeedbackButton (floating FAB on every screen).
 * Captures category, optional rating, message, and optional screenshots.
 * Auto-captures screen path, app version, device info on submit.
 */

import { useEffect, useState } from 'react'
import {
  View, Text, TextInput, Modal, ScrollView, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { X, Star, Camera, Trash2, Send } from 'lucide-react-native'
import { useThemeColors, theme } from '../lib/theme'
import { submitFeedback, type FeedbackCategory } from '../lib/feedback'
import { MgPressable } from './MgPressable'

interface Props {
  visible: boolean
  onClose: () => void
  /** Current screen path, captured by parent via expo-router usePathname() */
  screenPath?: string
  /** Auto-captured screenshot URI from FeedbackButton (react-native-view-shot) */
  initialScreenshotUri?: string | null
}

interface CategoryOption {
  key: FeedbackCategory
  label: string
  emoji: string
}

const CATEGORIES: CategoryOption[] = [
  { key: 'bug',       label: 'Bug',       emoji: '🐛' },
  { key: 'idea',      label: 'Idea',      emoji: '💡' },
  { key: 'praise',    label: 'Praise',    emoji: '😊' },
  { key: 'question',  label: 'Question',  emoji: '❓' },
  { key: 'confusing', label: 'Confusing', emoji: '😖' },
]

interface Attachment {
  uri: string
  fileName: string
  mimeType: string
}

export function FeedbackModal({ visible, onClose, screenPath, initialScreenshotUri }: Props) {
  const colors = useThemeColors()
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Pre-populate the auto-captured screenshot when the modal opens.
  // User can still remove it (Trash2 icon) or add more attachments.
  useEffect(() => {
    if (visible && initialScreenshotUri) {
      setAttachments([{
        uri: initialScreenshotUri,
        fileName: `auto-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
      }])
    }
  }, [visible, initialScreenshotUri])

  const reset = () => {
    setCategory(null)
    setRating(null)
    setMessage('')
    setAttachments([])
    setSubmitting(false)
  }

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const handleAttach = async () => {
    Haptics.selectionAsync()
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Photos access needed', 'Please allow photo access to attach a screenshot.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 5,
      quality: 0.8,
    })
    if (result.canceled) return

    const picked: Attachment[] = result.assets.map((a, idx) => ({
      uri: a.uri,
      fileName: a.fileName ?? `screenshot-${Date.now()}-${idx}.jpg`,
      mimeType: a.mimeType ?? 'image/jpeg',
    }))
    setAttachments(prev => [...prev, ...picked].slice(0, 5))
  }

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = async () => {
    if (!category || !message.trim() || submitting) return
    setSubmitting(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const result = await submitFeedback({
      category,
      message,
      rating,
      screenPath,
      attachments: attachments.map(a => ({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName })),
    })

    setSubmitting(false)

    if (!result.feedbackId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Couldn\'t send', 'Something went wrong. Please try again.')
      return
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const partialMsg = result.attachmentsFailed > 0
      ? `Your feedback was sent, but ${result.attachmentsFailed} of ${result.attachmentsUploaded + result.attachmentsFailed} screenshot${result.attachmentsFailed === 1 ? '' : 's'} failed to upload.`
      : 'Your feedback was sent. We read every message.'

    Alert.alert('Thanks!', partialMsg, [
      { text: 'OK', onPress: handleClose },
    ])
  }

  const canSubmit = !!category && message.trim().length > 0 && !submitting

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: colors.bg }}
      >
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
          borderBottomWidth: 1, borderBottomColor: colors.border,
        }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
            Send Feedback
          </Text>
          <MgPressable
            accessibilityLabel="Close feedback form"
            onPress={handleClose}
            hitSlop={12}
            disabled={submitting}
          >
            <X size={24} color={colors.textMuted} />
          </MgPressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Category */}
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
            What kind of feedback?
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {CATEGORIES.map(c => {
              const selected = category === c.key
              return (
                <MgPressable
                  key={c.key}
                  accessibilityLabel={`${c.label} feedback`}
                  accessibilityState={{ selected }}
                  onPress={() => { setCategory(c.key); Haptics.selectionAsync() }}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 10,
                    borderRadius: theme.radius.pill,
                    backgroundColor: selected ? colors.accent : colors.surface,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.border,
                  }}
                >
                  <Text style={{
                    fontSize: 13, fontWeight: '600',
                    color: selected ? colors.accentText : colors.text,
                    fontFamily: 'Inter_600SemiBold',
                  }}>
                    {c.emoji}  {c.label}
                  </Text>
                </MgPressable>
              )
            })}
          </View>

          {/* Rating */}
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
            Rate your experience (optional)
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
            {[1, 2, 3, 4, 5].map(n => {
              const filled = (rating ?? 0) >= n
              return (
                <MgPressable
                  key={n}
                  accessibilityLabel={`Rate ${n} star${n > 1 ? 's' : ''}`}
                  accessibilityState={{ selected: filled }}
                  onPress={() => { setRating(rating === n ? null : n); Haptics.selectionAsync() }}
                  hitSlop={6}
                >
                  <Star
                    size={32}
                    color={filled ? colors.warm : colors.border}
                    fill={filled ? colors.warm : 'transparent'}
                  />
                </MgPressable>
              )
            })}
          </View>

          {/* Message */}
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
            Tell us more
          </Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={
              category === 'bug' ? 'What broke? What were you trying to do?' :
              category === 'idea' ? 'What would you like to see?' :
              category === 'confusing' ? 'What was unclear?' :
              category === 'praise' ? 'What do you love?' :
              'Tell us anything…'
            }
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1, borderColor: colors.border,
              borderRadius: theme.radius.lg,
              padding: 14, fontSize: 15,
              color: colors.text, fontFamily: 'Inter_400Regular',
              minHeight: 120,
              marginBottom: 20,
            }}
          />

          {/* Attachments */}
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
            Attach screenshots (optional, up to 5)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {attachments.map((a, idx) => (
              <View key={idx} style={{ position: 'relative' }}>
                <Image
                  source={{ uri: a.uri }}
                  style={{ width: 80, height: 80, borderRadius: theme.radius.md, backgroundColor: colors.surface }}
                />
                <MgPressable
                  accessibilityLabel={`Remove screenshot ${idx + 1}`}
                  onPress={() => removeAttachment(idx)}
                  style={{
                    position: 'absolute', top: -6, right: -6,
                    backgroundColor: colors.error, borderRadius: 12,
                    width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Trash2 size={14} color="white" />
                </MgPressable>
              </View>
            ))}
            {attachments.length < 5 && (
              <MgPressable
                accessibilityLabel="Add screenshot"
                onPress={handleAttach}
                style={{
                  width: 80, height: 80, borderRadius: theme.radius.md,
                  backgroundColor: colors.surface,
                  borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Camera size={22} color={colors.textMuted} />
                <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 4, fontFamily: 'Inter_500Medium' }}>
                  Add
                </Text>
              </MgPressable>
            )}
          </View>

          {/* Context note */}
          <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 16, fontFamily: 'Inter_400Regular', lineHeight: 16 }}>
            We'll automatically include the screen you're on, your app version, and device info to help us debug.
          </Text>

          {/* Submit */}
          <MgPressable
            accessibilityLabel={canSubmit ? 'Send feedback' : 'Select a category and add a message before sending'}
            accessibilityState={{ disabled: !canSubmit, busy: submitting }}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.8}
            style={{
              backgroundColor: canSubmit ? colors.accent : colors.surfaceAlt,
              borderRadius: theme.radius.xl,
              paddingVertical: 16, alignItems: 'center',
              flexDirection: 'row', justifyContent: 'center', gap: 8,
            }}
          >
            {submitting ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <>
                <Send size={18} color={canSubmit ? colors.accentText : colors.textMuted} />
                <Text style={{
                  fontSize: 16, fontWeight: '600',
                  color: canSubmit ? colors.accentText : colors.textMuted,
                  fontFamily: 'Inter_600SemiBold',
                }}>
                  Send Feedback
                </Text>
              </>
            )}
          </MgPressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}
