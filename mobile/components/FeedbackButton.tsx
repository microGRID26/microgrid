/**
 * FeedbackButton — floating action button shown on every authenticated screen.
 *
 * Mounted globally in app/_layout.tsx so it appears everywhere except (auth)
 * screens. Tap → opens FeedbackModal. Auto-captures the current screen path
 * via expo-router usePathname().
 */

import { useState } from 'react'
import { TouchableOpacity, View } from 'react-native'
import { usePathname } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { MessageSquarePlus } from 'lucide-react-native'
import { useThemeColors } from '../lib/theme'
import { FeedbackModal } from './FeedbackModal'

// Tab bar is 84pt high (see app/(tabs)/_layout.tsx) — FAB sits above with breathing room
const FAB_BOTTOM_OFFSET = 100
// OfflineBanner uses zIndex 999 — FAB sits above it
const FAB_Z_INDEX = 1000

export function FeedbackButton() {
  const colors = useThemeColors()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setOpen(true)
  }

  return (
    <>
      {/* The FAB sits above the tab bar with a comfortable margin */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          right: 16,
          bottom: FAB_BOTTOM_OFFSET,
          zIndex: FAB_Z_INDEX,
        }}
      >
        <TouchableOpacity
          onPress={handlePress}
          activeOpacity={0.85}
          accessibilityLabel="Send feedback"
          accessibilityRole="button"
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18,
            shadowRadius: 6,
            elevation: 6,
          }}
        >
          <MessageSquarePlus size={24} color={colors.accentText} />
        </TouchableOpacity>
      </View>

      <FeedbackModal
        visible={open}
        onClose={() => setOpen(false)}
        screenPath={pathname}
      />
    </>
  )
}
