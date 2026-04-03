import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Keyboard, Linking } from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import * as SecureStore from 'expo-secure-store'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { theme, useThemeColors } from '../../lib/theme'
import { supabase } from '../../lib/supabase'
import { loadComments, addComment, getCustomerAccount, uploadTicketPhoto } from '../../lib/api'
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
  const [uploading, setUploading] = useState(false)
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

    return () => { channel.unsubscribe(); supabase.removeChannel(channel) }
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

    return () => { channel.unsubscribe(); supabase.removeChannel(channel) }
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
    Keyboard.dismiss()
    const c = await loadComments(id)
    setComments(c)
    setSending(false)
  }

  const handleFeedback = async (positive: boolean) => {
    if (!id) return
    Haptics.notificationAsync(positive ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)
    await addComment(id, positive ? '👍 Issue resolved — thank you!' : '👎 Issue not resolved — need more help', customerName)
    setFeedbackGiven(true)
    const c = await loadComments(id)
    setComments(c)
  }

  const handlePhoto = async () => {
    if (!id) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
    })

    if (result.canceled || !result.assets?.[0]) return
    setUploading(true)

    const imageUrl = await uploadTicketPhoto(result.assets[0].uri, id)
    if (imageUrl) {
      await addComment(id, `📷 Photo`, customerName, imageUrl)
      const c = await loadComments(id)
      setComments(c)
    }
    setUploading(false)
  }

  const handleCamera = async () => {
    if (!id) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) return

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
    })

    if (result.canceled || !result.assets?.[0]) return
    setUploading(true)

    const imageUrl = await uploadTicketPhoto(result.assets[0].uri, id)
    if (imageUrl) {
      await addComment(id, `📷 Photo`, customerName, imageUrl)
      const c = await loadComments(id)
      setComments(c)
    }
    setUploading(false)
  }

  const handleDocument = async () => {
    if (!id) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/*', 'image/*'],
      copyToCacheDirectory: true,
    })

    if (result.canceled || !result.assets?.[0]) return
    setUploading(true)
    const asset = result.assets[0]
    const ext = asset.name.split('.').pop() ?? 'file'
    const isImage = asset.mimeType?.startsWith('image/') ?? false

    const imageUrl = await uploadTicketPhoto(asset.uri, id, asset.mimeType ?? undefined, ext)
    if (imageUrl) {
      const label = isImage ? '📷 Photo' : `📎 ${asset.name}`
      await addComment(id, label, customerName, imageUrl)
      const c = await loadComments(id)
      setComments(c)
    }
    setUploading(false)
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
                const hasImage = !!c.image_url && /\.(jpg|jpeg|png|webp|gif|heic)$/i.test(c.image_url)
                const hasFile = !!c.image_url && !hasImage
                const hasAttachment = hasImage || hasFile
                return (
                  <View key={c.id} style={{ alignSelf: isCustomer ? 'flex-end' : 'flex-start', maxWidth: '85%', marginBottom: 8 }}>
                    <View style={{
                      backgroundColor: hasAttachment ? colors.surface : (isCustomer ? colors.accent : colors.surface),
                      borderRadius: theme.radius.xl,
                      borderBottomRightRadius: isCustomer ? 4 : theme.radius.xl,
                      borderBottomLeftRadius: isCustomer ? theme.radius.xl : 4,
                      paddingHorizontal: hasImage ? 4 : 14, paddingVertical: hasImage ? 4 : 10,
                      borderWidth: 1, borderColor: colors.borderLight,
                      ...theme.shadow.card,
                    }}>
                      {!isCustomer && (
                        <Text style={{ fontSize: 10, fontWeight: '600', color: colors.accent, fontFamily: 'Inter_600SemiBold', marginBottom: 2 }}>
                          MicroGRID Support
                        </Text>
                      )}
                      {hasImage ? (
                        <Image
                          source={{ uri: c.image_url! }}
                          style={{ width: 200, height: 200, borderRadius: 12 }}
                          resizeMode="cover"
                        />
                      ) : hasFile ? (
                        <TouchableOpacity
                          onPress={() => { Linking.openURL(c.image_url!).catch(() => {}) }}
                          activeOpacity={0.7}
                          style={{ width: 220, paddingVertical: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.accent + '20', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                              <Feather name="file-text" size={16} color={colors.accent} />
                            </View>
                            <Feather name="download" size={14} color={colors.accent} />
                          </View>
                          <Text style={{ fontSize: 13, color: colors.text, fontFamily: 'Inter_500Medium' }} numberOfLines={2}>
                            {(() => {
                              const cleaned = c.message.replace(/📎\s*/, '').replace(/📷\s*/, '').trim()
                              if (cleaned && cleaned !== 'Photo' && cleaned !== '[Photo attached]') return cleaned
                              const urlParts = (c.image_url ?? '').split('/')
                              const rawName = urlParts[urlParts.length - 1]?.split('?')[0] ?? 'File'
                              const ext = rawName.split('.').pop() ?? ''
                              return ext ? `Document.${ext}` : 'Attached file'
                            })()}
                          </Text>
                          <Text style={{ fontSize: 10, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                            Tap to open file
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={{
                          fontSize: 14, lineHeight: 20,
                          color: isCustomer ? colors.accentText : colors.text,
                          fontFamily: 'Inter_400Regular',
                        }}>
                          {c.message}
                        </Text>
                      )}
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

        {/* Uploading indicator */}
        {uploading && (
          <View style={{ backgroundColor: colors.accentLight, padding: 8, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: colors.accent, fontFamily: 'Inter_500Medium' }}>Uploading photo...</Text>
          </View>
        )}

        {/* Reply input — hidden if resolved */}
        {!isResolved && (
          <View style={{
            flexDirection: 'row', gap: 6,
            paddingHorizontal: 12, paddingVertical: 12,
            backgroundColor: colors.surface,
            borderTopWidth: 1, borderTopColor: colors.borderLight,
            alignItems: 'center',
          }}>
            {/* Camera button */}
            <TouchableOpacity onPress={handleCamera} activeOpacity={0.6} disabled={uploading}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: uploading ? 0.3 : 1 }}>
              <Feather name="camera" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            {/* Photo library button */}
            <TouchableOpacity onPress={handlePhoto} activeOpacity={0.6} disabled={uploading}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: uploading ? 0.3 : 1 }}>
              <Feather name="image" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            {/* Document/file button */}
            <TouchableOpacity onPress={handleDocument} activeOpacity={0.6} disabled={uploading}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: uploading ? 0.3 : 1 }}>
              <Feather name="paperclip" size={20} color={colors.textMuted} />
            </TouchableOpacity>
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
