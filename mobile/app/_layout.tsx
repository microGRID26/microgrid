import { useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter'
import { supabase } from '../lib/supabase'
import { ThemeContext, getThemeColors } from '../lib/theme'
import ErrorBoundary from '../components/ErrorBoundary'
import { OfflineBanner } from '../components/OfflineBanner'
import { FeedbackButton } from '../components/FeedbackButton'
import { registerForPushNotifications, addNotificationResponseListener } from '../lib/notifications'
import { loadPersistentCache } from '../lib/cache'
import type { Session } from '@supabase/supabase-js'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const router = useRouter()
  const segments = useSegments()
  const scheme = useColorScheme()
  const mode = scheme === 'dark' ? 'dark' : 'light'
  const colors = getThemeColors(mode)

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  // Load cached data for instant render
  useEffect(() => { loadPersistentCache() }, [])

  // Listen for auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setInitializing(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Hide splash when fonts loaded and auth checked
  useEffect(() => {
    if (fontsLoaded && !initializing) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded, initializing])

  // Auth-based navigation guard
  useEffect(() => {
    if (initializing) return

    const inAuthGroup = segments[0] === '(auth)'

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)')
    }

    // Register for push notifications once authenticated
    if (session && !inAuthGroup) {
      registerForPushNotifications().catch(() => {})
    }
  }, [session, segments, initializing])

  // Handle notification taps — route to relevant screen
  useEffect(() => {
    const subscription = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined
      if (!data?.type) return

      switch (data.type) {
        case 'ticket_reply':
          if (data.ticketId) router.push(`/ticket/${data.ticketId}`)
          break
        case 'new_message':
          router.push('/messages')
          break
        case 'stage_advance':
        case 'schedule_created':
          router.push('/(tabs)')
          break
      }
    })

    return () => subscription.remove()
  }, [])

  if (!fontsLoaded || initializing) return null

  // Show feedback FAB only on the main (tabs) group — keeps it out of modals
  // and the auth flow. Users on a modal can dismiss to leave feedback.
  const showFeedback = !!session && segments[0] === '(tabs)'

  return (
    <ErrorBoundary>
      <ThemeContext.Provider value={colors}>
        <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
        <OfflineBanner />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="messages" options={{ presentation: 'card', animation: 'slide_from_right' }} />
          <Stack.Screen name="notifications-settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="warranty" options={{ presentation: 'modal' }} />
          <Stack.Screen name="schedule-service" options={{ presentation: 'modal' }} />
          <Stack.Screen name="onboarding" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="outage-mode" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
        {showFeedback && <FeedbackButton />}
      </ThemeContext.Provider>
    </ErrorBoundary>
  )
}
