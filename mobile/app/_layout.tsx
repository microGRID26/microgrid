import { useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter'
import { supabase } from '../lib/supabase'
import { ThemeContext, getThemeColors } from '../lib/theme'
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
  }, [session, segments, initializing])

  if (!fontsLoaded || initializing) return null

  return (
    <ThemeContext.Provider value={colors}>
      <StatusBar style={colors.statusBar} backgroundColor={colors.bg} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="ticket/[id]" options={{ presentation: 'card', headerShown: false, animation: 'slide_from_right' }} />
      </Stack>
    </ThemeContext.Provider>
  )
}
