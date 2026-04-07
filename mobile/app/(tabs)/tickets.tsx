import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { View, Text, FlatList, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, AppState } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { theme, useThemeColors } from '../../lib/theme'
import { supabase } from '../../lib/supabase'
import { getCustomerAccount, loadTickets, createTicket } from '../../lib/api'
import type { CustomerAccount, CustomerTicket } from '../../lib/types'
import { SkeletonLoader } from '../../components/SkeletonLoader'

// Quick issue templates — one tap to create
const QUICK_ISSUES: { icon: React.ComponentProps<typeof Feather>['name']; title: string; category: string; color: string }[] = [
  { icon: 'alert-circle', title: 'My system isn\'t producing power', category: 'service', color: '#C53030' },
  { icon: 'dollar-sign', title: 'Billing question', category: 'billing', color: '#C4922A' },
  { icon: 'calendar', title: 'Schedule a service visit', category: 'service', color: '#2563EB' },
  { icon: 'tool', title: 'Report damage or issue', category: 'installation', color: '#C4922A' },
  { icon: 'shield', title: 'Warranty question', category: 'warranty', color: '#1D7A5F' },
]

function getStatusConfig(colors: any): Record<string, { label: string; color: string }> {
  return {
    open: { label: 'Open', color: colors.info },
    assigned: { label: 'Assigned', color: colors.info },
    in_progress: { label: 'In Progress', color: colors.warm },
    waiting_on_customer: { label: 'Waiting on You', color: colors.warm },
    waiting_on_vendor: { label: 'In Progress', color: colors.warm },
    escalated: { label: 'Escalated', color: colors.error },
    resolved: { label: 'Resolved', color: colors.accent },
    closed: { label: 'Closed', color: colors.textMuted },
  }
}

export default function TicketsScreen() {
  const colors = useThemeColors()
  const router = useRouter()
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [tickets, setTickets] = useState<CustomerTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('service')

  const load = useCallback(async () => {
    const acct = await getCustomerAccount()
    if (!acct) return
    setAccount(acct)
    const tix = await loadTickets(acct.project_id)
    setTickets(tix)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Refresh when tab gains focus (returning from conversation, app foregrounded)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && account) loadTickets(account.project_id).then(setTickets)
    })
    return () => sub.remove()
  }, [account])

  // Poll every 30s for status changes — pause when app is backgrounded
  const appActive = useRef(true)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActive.current = state === 'active'
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!account) return
    const interval = setInterval(() => {
      if (appActive.current) loadTickets(account.project_id).then(setTickets)
    }, 30000)
    return () => clearInterval(interval)
  }, [account])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const handleCreate = async (t?: string, cat?: string) => {
    if (!account) return
    const ticketTitle = t ?? title.trim()
    const ticketCat = cat ?? category
    if (!ticketTitle) return
    setCreating(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const ticket = await createTicket(account.project_id, ticketTitle, t ? '' : description.trim(), ticketCat, account.name)
    setCreating(false)
    if (ticket) {
      setTickets(prev => [ticket, ...prev])
      setShowCreate(false)
      setTitle('')
      setDescription('')
      setCategory('service')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      // Navigate to the new ticket
      router.push({ pathname: '/ticket/[id]', params: { id: ticket.id, title: ticket.title, status: ticket.status, description: '', created_at: ticket.created_at } })
    }
  }

  const openTicket = (ticket: CustomerTicket) => {
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
  }

  const statusMap = useMemo(() => getStatusConfig(colors), [colors])

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 56 }}>
        <SkeletonLoader lines={2} />
        <SkeletonLoader lines={3} />
        <SkeletonLoader lines={3} />
      </View>
    )
  }

  const openCount = tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={tickets}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListHeaderComponent={<>
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>Support</Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular' }}>
              {openCount > 0 ? `${openCount} open request${openCount > 1 ? 's' : ''}` : 'All clear'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setShowCreate(true)} activeOpacity={0.8}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: colors.accent, borderRadius: theme.radius.xl,
              paddingHorizontal: 16, paddingVertical: 10,
            }}>
            <Feather name="plus" size={16} color={colors.accentText} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>
              New
            </Text>
          </TouchableOpacity>
        </View>

        {/* Quick issue templates */}
        {tickets.length === 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textSecondary, fontFamily: 'Inter_600SemiBold', marginBottom: 10 }}>
              How can we help?
            </Text>
            <View style={{ gap: 8 }}>
              {QUICK_ISSUES.map(qi => (
                <TouchableOpacity key={qi.title} activeOpacity={0.7}
                  onPress={() => handleCreate(qi.title, qi.category)}
                  disabled={creating}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    backgroundColor: colors.surface, borderRadius: theme.radius.xl,
                    padding: 16, borderWidth: 1, borderColor: colors.borderLight,
                    ...theme.shadow.card,
                  }}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: qi.color + '15', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Feather name={qi.icon} size={18} color={qi.color} />
                  </View>
                  <Text style={{ fontSize: 14, color: colors.text, fontFamily: 'Inter_500Medium', flex: 1 }}>
                    {qi.title}
                  </Text>
                  <Feather name="chevron-right" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Quick issues row when tickets exist */}
        {tickets.length > 0 && (
          <View style={{ marginTop: 16, marginBottom: 8, flexDirection: 'row', gap: 8 }}>
            {QUICK_ISSUES.slice(0, 3).map(qi => (
              <TouchableOpacity key={qi.title} activeOpacity={0.7}
                onPress={() => handleCreate(qi.title, qi.category)}
                disabled={creating}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: colors.surface, borderRadius: theme.radius.pill,
                  paddingHorizontal: 12, paddingVertical: 8,
                  borderWidth: 1, borderColor: colors.borderLight,
                }}>
                <Feather name={qi.icon} size={12} color={qi.color} />
                <Text style={{ fontSize: 11, color: colors.textSecondary, fontFamily: 'Inter_500Medium' }}>
                  {qi.title.length > 20 ? qi.title.slice(0, 20) + '...' : qi.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        </>}
        renderItem={({ item: ticket }) => {
          const status = statusMap[ticket.status] ?? statusMap.open
          const isResolved = ticket.status === 'resolved' || ticket.status === 'closed'
          return (
            <TouchableOpacity activeOpacity={0.7} onPress={() => openTicket(ticket)}
              style={{
                backgroundColor: colors.surface, borderRadius: theme.radius.xl,
                padding: 16, borderWidth: 1, borderColor: colors.borderLight,
                opacity: isResolved ? 0.6 : 1, marginBottom: 8,
                ...theme.shadow.card,
              }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                    {ticket.title}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <View style={{
                      backgroundColor: status.color + '20', paddingHorizontal: 8, paddingVertical: 2,
                      borderRadius: theme.radius.pill,
                    }}>
                      <Text style={{ fontSize: 10, fontWeight: '500', color: status.color, fontFamily: 'Inter_500Medium' }}>
                        {status.label}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 10, color: colors.textMuted }}>
                      {new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                </View>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          )
        }}
      />

      {/* Custom create modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ padding: 16, paddingTop: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, fontFamily: 'Inter_700Bold' }}>
                New Request
              </Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <Feather name="x" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: 6, fontFamily: 'Inter_500Medium' }}>
              What do you need help with?
            </Text>
            <TextInput value={title} onChangeText={setTitle}
              placeholder="Describe your issue briefly"
              placeholderTextColor={colors.textMuted} autoFocus
              style={{
                backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                borderRadius: theme.radius.xl, paddingHorizontal: 16, paddingVertical: 14,
                fontSize: 16, color: colors.text, fontFamily: 'Inter_400Regular',
              }}
            />

            <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginTop: 16, marginBottom: 6, fontFamily: 'Inter_500Medium' }}>
              Details (optional)
            </Text>
            <TextInput value={description} onChangeText={setDescription}
              placeholder="Provide additional details..."
              placeholderTextColor={colors.textMuted} multiline numberOfLines={4} textAlignVertical="top"
              style={{
                backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                borderRadius: theme.radius.xl, paddingHorizontal: 16, paddingVertical: 14,
                fontSize: 14, color: colors.text, fontFamily: 'Inter_400Regular', minHeight: 100,
              }}
            />

            <TouchableOpacity onPress={() => handleCreate()} disabled={creating || !title.trim()} activeOpacity={0.8}
              style={{
                backgroundColor: colors.accent, borderRadius: theme.radius.xl,
                paddingVertical: 14, marginTop: 24, alignItems: 'center',
                opacity: creating || !title.trim() ? 0.5 : 1,
              }}>
              {creating ? (
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.accentText, fontFamily: 'Inter_600SemiBold' }}>
                  Submit Request
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
