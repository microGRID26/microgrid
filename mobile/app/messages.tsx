import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, FlatList, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../lib/theme'
import { getCustomerAccount, loadProject, loadMessages, sendMessage, markMessagesRead } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { CustomerAccount, CustomerProject, CustomerMessage } from '../lib/types'
import { SkeletonLoader } from '../components/SkeletonLoader'
import { ErrorState } from '../components/ErrorState'
import { MgPressable } from '../components/MgPressable'

const formatMessageTime = (d: string) =>
  new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

const formatDateHeader = (d: string) => {
  const date = new Date(d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (msgDate.getTime() === today.getTime()) return 'Today'
  if (msgDate.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

const isSameDay = (a: string, b: string) => {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

interface MessageGroup {
  type: 'date'
  date: string
  id: string
}

interface MessageItem {
  type: 'message'
  data: CustomerMessage
  id: string
}

type ListItem = MessageGroup | MessageItem

export default function MessagesScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [project, setProject] = useState<CustomerProject | null>(null)
  const [messages, setMessages] = useState<CustomerMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const flatListRef = useRef<FlatList>(null)

  const load = useCallback(async () => {
    try {
      setError(false)
      const acct = await getCustomerAccount()
      if (!acct) { setError(true); setLoading(false); return }
      setAccount(acct)

      const proj = await loadProject(acct.project_id)
      setProject(proj)

      const msgs = await loadMessages(acct.project_id)
      setMessages(msgs)
      setLoading(false)

      // Mark as read
      await markMessagesRead(acct.project_id)
    } catch (err) {
      console.error('[MessagesScreen]', err)
      setError(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Real-time subscription
  useEffect(() => {
    if (!account?.project_id) return

    const channel = supabase
      .channel(`messages:${account.project_id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'customer_messages',
          filter: `project_id=eq.${account.project_id}`,
        },
        (payload) => {
          const raw = payload.new
          if (!raw || typeof raw !== 'object' || !('id' in raw) || !('message' in raw)) return
          const newMsg = raw as CustomerMessage
          setMessages(prev => [...prev, newMsg])
          // Mark read if from PM
          if (newMsg.author_type !== 'customer') {
            markMessagesRead(account.project_id).catch(() => {})
          }
        }
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') console.warn('[messages] subscription:', status)
      })

    return () => { supabase.removeChannel(channel) }
  }, [account?.project_id])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [messages.length])

  const handleSend = async () => {
    if (!inputText.trim() || !account || sending) return

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const text = inputText.trim()
    setInputText('')
    setSending(true)

    // Optimistic update
    const optimisticMsg: CustomerMessage = {
      id: `temp-${Date.now()}`,
      project_id: account.project_id,
      author_type: 'customer',
      author_name: account.name,
      message: text,
      read_at: null,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimisticMsg])

    const success = await sendMessage(account.project_id, text, account.name)
    if (!success) {
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
    setSending(false)
  }

  // Build list items with date separators
  const listItems: ListItem[] = []
  messages.forEach((msg, i) => {
    if (i === 0 || !isSameDay(messages[i - 1].created_at, msg.created_at)) {
      listItems.push({ type: 'date', date: msg.created_at, id: `date-${msg.created_at}` })
    }
    listItems.push({ type: 'message', data: msg, id: msg.id })
  })

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 56 }}>
        <SkeletonLoader showAvatar lines={2} />
        <SkeletonLoader lines={3} />
        <SkeletonLoader showAvatar lines={2} />
      </View>
    )
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ErrorState message="Unable to load messages" onRetry={load} />
      </View>
    )
  }

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'date') {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <View style={{
            backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.pill,
            paddingHorizontal: 12, paddingVertical: 4,
          }}>
            <Text style={{ fontSize: 11, fontWeight: '500', color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>
              {formatDateHeader(item.date)}
            </Text>
          </View>
        </View>
      )
    }

    const msg = item.data
    const isCustomer = msg.author_type === 'customer'
    const isSystem = msg.author_type === 'system'

    if (isSystem) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 8, paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center', fontStyle: 'italic' }}>
            {msg.message}
          </Text>
        </View>
      )
    }

    return (
      <View style={{
        flexDirection: 'row',
        justifyContent: isCustomer ? 'flex-end' : 'flex-start',
        paddingHorizontal: 16, paddingVertical: 3,
      }}>
        {/* PM avatar */}
        {!isCustomer && (
          <View style={{
            width: 32, height: 32, borderRadius: 16,
            backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
            marginRight: 8, marginTop: 4,
            borderWidth: 1, borderColor: colors.border,
          }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary, fontFamily: 'Inter_700Bold' }}>
              {msg.author_name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <View style={{ maxWidth: '75%' }}>
          {/* PM name */}
          {!isCustomer && (
            <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: 'Inter_500Medium', marginBottom: 2, marginLeft: 4 }}>
              {msg.author_name}
            </Text>
          )}

          <View style={{
            backgroundColor: isCustomer ? colors.accent : colors.surface,
            borderRadius: theme.radius.lg,
            borderTopRightRadius: isCustomer ? 4 : theme.radius.lg,
            borderTopLeftRadius: isCustomer ? theme.radius.lg : 4,
            paddingHorizontal: 14, paddingVertical: 10,
            borderWidth: isCustomer ? 0 : 1,
            borderColor: colors.borderLight,
            ...(!isCustomer ? theme.shadow.card : {}),
          }}>
            <Text style={{
              fontSize: 15, color: isCustomer ? colors.accentText : colors.text,
              fontFamily: 'Inter_400Regular', lineHeight: 21,
            }}>
              {msg.message}
            </Text>
          </View>

          <Text style={{
            fontSize: 10, color: colors.textMuted, fontFamily: 'Inter_400Regular',
            marginTop: 2, textAlign: isCustomer ? 'right' : 'left',
            marginHorizontal: 4,
          }}>
            {formatMessageTime(msg.created_at)}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={{
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
        paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16,
        flexDirection: 'row', alignItems: 'center', gap: 12,
      }}>
        <MgPressable
          accessibilityLabel="Go back"
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.7}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="arrow-left" size={20} color={colors.text} />
        </MgPressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold' }}>
            Messages
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
            Your project manager
          </Text>
        </View>
        <Feather name="phone" size={18} color={colors.accent} />
      </View>

      {/* Messages List */}
      {messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <Feather name="message-circle" size={32} color={colors.textMuted} />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginBottom: 8 }}>
            Start a Conversation
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 }}>
            Send a message to your project manager. They typically respond within a few hours during business days.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={listItems}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 8 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Input Bar */}
      <View style={{
        backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.borderLight,
        paddingHorizontal: 16, paddingVertical: 10, paddingBottom: Platform.OS === 'ios' ? 34 : 10,
        flexDirection: 'row', alignItems: 'flex-end', gap: 10,
      }}>
        <View style={{
          flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: theme.radius.xl,
          borderWidth: 1, borderColor: colors.border,
          paddingHorizontal: 16, paddingVertical: Platform.OS === 'ios' ? 10 : 6,
          maxHeight: 120,
        }}>
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor={colors.textMuted}
            multiline
            style={{
              fontSize: 15, color: colors.text, fontFamily: 'Inter_400Regular',
              maxHeight: 100, lineHeight: 20,
            }}
          />
        </View>
        <MgPressable
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !inputText.trim() || sending, busy: sending }}
          onPress={handleSend}
          activeOpacity={0.7}
          disabled={!inputText.trim() || sending}
          style={{
            width: 42, height: 42, borderRadius: 21,
            backgroundColor: inputText.trim() ? colors.accent : colors.surfaceAlt,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 1,
          }}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.accentText} />
          ) : (
            <Feather name="send" size={18} color={inputText.trim() ? colors.accentText : colors.textMuted} />
          )}
        </MgPressable>
      </View>
    </KeyboardAvoidingView>
  )
}
