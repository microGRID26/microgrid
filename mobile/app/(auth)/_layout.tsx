import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FAFAF7' } }}>
      <Stack.Screen name="login" />
    </Stack>
  )
}
