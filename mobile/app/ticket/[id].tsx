import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import * as SecureStore from 'expo-secure-store'
import { theme, useThemeColors } from '../../lib/theme'
import { supabase } from '../../lib/supabase'
import { loadComments, addComment, getCustomerAccount } from '../../lib/api'
import type { TicketComment } from '../../lib/types'

const STATUS_LABELS: Record<string, string> = {
  open: 'Opened',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  waiting_on_customer: 'Waiting on You',
  waiting_on_vendor: 'In Progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed',
}

const STATUS_COLORS: Record<string, string> = {
  open: '#2563EB',
  assigned: '#2563EB',
  in_progress: '#C4922A',
  waiting_on_customer: '#C4922A',
  escalated: '#C53030',
  resolved: '#1D7A5F',
  closed: '#8A877D',
}

export default function TicketDetailScreen() {
  const colors = useThemeColors()
  const { id, title, status, description, created_at } = useLocalSearchParams<{
    id: string; title: string; status: string; description: string; created_at: string
  }>()
  const router = useRouter()
  const scrollRef = useRef<ScrollView>(null)

  const [comments, setComments] = useState<TicketComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [customerName, setCustomerName] = useState('Customer')
  const [currentStatus, setCurrentStatus] = useState(status ?? 'open')
  const [feedbackGiven, setFeedbackGiven] = useState(false)

  const loadAll = useCallback(async () => {
    if (!id) { setLoading(false); return }
    try {
      const [c, acct] = await Promise.all([
        loadComments(id).catch(() => []),
        getCustomerAccount().catch(() => null),
      ])
      setComments(c as any[])
      if (acct) setCustomerName(acct.name)
      // Mark as read — clears the Support tab badge
      await SecureStore.setItemAsync('mg_support_seen', new Date().toISOString())
    } catch (err) {
      console.error('[ticket detail] load failed:', err)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  // Realtime subscription for new comments
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`ticket-comments-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'ticket_comments',
        filter: `ticket_id=eq.${id}`,
      }, () => {
        loadComments(id).then(setComments)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id])

  // Realtime subscription for ticket status changes
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`ticket-status-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tickets',
        filter: `id=eq.${id}`,
      }, (payload) => {
        if (payload.new && (payload.new as any).status) {
          setCurrentStatus((payload.new as any).status)
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id])

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }, [])

  const handleSend = async () => {
    if (!newComment.trim() || !id || sending) return
    setSending(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await addComment(id, newComment.trim(), customerName)
    setNewComment('')
    const c = await loadComments(id)
    setComments(c)
    setSending(false)
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const handleFeedback = async (positive: boolean) => {
    if (!id) return
    Haptics.notificationAsync(positive ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)
    await addComment(id, positive ? '👍 Issue resolved — thank you!' : '👎 Issue not resolved — need more help', customerName)
    setFeedbackGiven(true)
    const c = await loadComments(id)
    setComments(c)
  }

  const isResolved = currentStatus === 'resolved' || currentStatus === 'closed'
  const createdDate = created_at ? new Date(created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
  const statusColor = STATUS_COLORS[currentStatus] ?? colors.textMuted

  return (
    <>
      <Stack.Screen options={{
        headerShown: true,
        headerTitle: '',
        headerBackTitle: 'Support',
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.accent,
        headerShadowVisible: false,
      }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: colors.bg }}
        keyboardVerticalOffset={90}
      >
        {/* Ticket header */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.bg }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            {title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <View style={{ backgroundColor: statusColor + '20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill }}>
              <Text style={{ fontSize: 10, fontWeight: '500', color: statusColor, fontFamily: 'Inter_500Medium' }}>
                {STATUS_LABELS[currentStatus] ?? currentStatus}
              </Text>
            </View>
            <Text style={{ fontSize: 10, color: colors.textMuted }}>{createdDate}</Text>
          </View>
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          onContentSizeChange={scrollToBottom}
        >
          {/* Description as first message */}
          {description ? (
            <View style={{ alignSelf: 'flex-end', maxWidth: '85%', marginBottom: 12 }}>
              <View style={{
                backgroundColor: colors.accent, borderRadius: theme.radius.xl,
                borderBottomRightRadius: 4, paddingHorizontal: 16, paddingVertical: 12,
              }}>
                <Text style={{ fontSize: 14, color: colors.accentText, fontFamily: 'Inter_400Regular', lineHeight: 20 }}>
                  {description}
                </Text>
              </View>
              <Text style={{ fontSize: 9, color: colors.textMuted, textAlign: 'right', marginTop: 4 }}>
                {createdDate}
              </Text>
            </View>
          ) : null}

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
          ) : (
            <>
              {/* Status timeline */}
              <View style={{
                backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.lg,
                padding: 12, marginBottom: 12, alignItems: 'center',
              }}>
                <Text style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
                  {STATUS_LABELS[currentStatus] ?? currentStatus} · {createdDate}
                </Text>
              </View>

              {/* Comments as conversation bubbles */}
              {comments.map(c => {
                const isCustomer = c.author === customerName
                return (
                  <View key={c.id} style={{ alignSelf: isCustomer ? 'flex-end' : 'flex-start', maxWidth: '85%', marginBottom: 8 }}>
                    <View style={{
                      backgroundColor: isCustomer ? colors.accent : colors.surface,
                      borderRadius: theme.radius.xl,
                      borderBottomRightRadius: isCustomer ? 4 : theme.radius.xl,
                      borderBottomLeftRadius: isCustomer ? theme.radius.xl : 4,
                      paddingHorizontal: 16, paddingVertical: 12,
                      borderWidth: isCustomer ? 0 : 1, borderColor: colors.borderLight,
                      ...theme.shadow.card,
                    }}>
                      {!isCustomer && (
                        <Text style={{ fontSize: 10, fontWeight: '600', color: colors.accent, fontFamily: 'Inter_600SemiBold', marginBottom: 2 }}>
                          MicroGRID Support
                        </Text>
                      )}
                      <Text style={{
                        fontSize: 14, lineHeight: 20,
                        color: isCustomer ? colors.accentText : colors.text,
                        fontFamily: 'Inter_400Regular',
                      }}>
                        {c.message}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 9, color: colors.textMuted, textAlign: isCustomer ? 'right' : 'left', marginTop: 2, marginHorizontal: 4 }}>
                      {new Date(c.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                )
              })}

              {/* Resolution feedback */}
              {isResolved && !feedbackGiven && (
                <View style={{
                  backgroundColor: colors.accentLight, borderRadius: theme.radius.xl,
                  padding: 20, marginTop: 8, alignItems: 'center',
                }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
                    Was your issue resolved?
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
                    <TouchableOpacity onPress={() => handleFeedback(true)} activeOpacity={0.7}
                      style={{ backgroundColor: colors.accent, borderRadius: theme.radius.xl, paddingHorizontal: 24, paddingVertical: 10 }}>
                      <Text style={{ fontSize: 20 }}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleFeedback(false)} activeOpacity={0.7}
                      style={{ backgroundColor: colors.surface, borderRadius: theme.radius.xl, paddingHorizontal: 24, paddingVertical: 10, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ fontSize: 20 }}>👎</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {feedbackGiven && (
                <View style={{
                  backgroundColor: colors.accentLight, borderRadius: theme.radius.xl,
                  padding: 16, marginTop: 8, alignItems: 'center',
                }}>
                  <Text style={{ fontSize: 13, color: colors.accentDark, fontFamily: 'Inter_500Medium' }}>
                    Thank you for your feedback
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* Reply input — hidden if resolved */}
        {!isResolved && (
          <View style={{
            flexDirection: 'row', gap: 8,
            paddingHorizontal: 16, paddingVertical: 12,
            backgroundColor: colors.surface,
            borderTopWidth: 1, borderTopColor: colors.borderLight,
          }}>
            <TextInput
              value={newComment}
              onChangeText={setNewComment}
              placeholder="Type a message..."
              placeholderTextColor={colors.textMuted}
              style={{
                flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
                borderRadius: theme.radius.xl, paddingHorizontal: 16, paddingVertical: 12,
                fontSize: 16, color: colors.text, fontFamily: 'Inter_400Regular',
              }}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              editable={!sending}
            />
            <TouchableOpacity onPress={handleSend} disabled={sending || !newComment.trim()} activeOpacity={0.7}
              style={{
                backgroundColor: colors.accent, borderRadius: theme.radius.xl,
                width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
                opacity: sending || !newComment.trim() ? 0.3 : 1,
              }}>
              <Feather name="send" size={20} color={colors.accentText} />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  )
}
