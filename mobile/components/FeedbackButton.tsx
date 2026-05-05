/**
 * FeedbackButton — floating action button shown on every authenticated screen.
 *
 * Mounted globally in app/_layout.tsx so it appears everywhere except (auth)
 * screens. Tap → captures the current screen via react-native-view-shot →
 * opens FeedbackModal with the screenshot pre-attached. Also auto-captures
 * the current screen path via expo-router usePathname().
 */

import { useState, type RefObject } from 'react'
import { View } from 'react-native'
import { usePathname } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { captureRef } from 'react-native-view-shot'
import { MessageSquarePlus } from 'lucide-react-native'
import { useThemeColors } from '../lib/theme'
import { FeedbackModal } from './FeedbackModal'
import { MgPressable } from './MgPressable'

// Tab bar is 84pt high (see app/(tabs)/_layout.tsx) — FAB sits above with breathing room
const FAB_BOTTOM_OFFSET = 100
// OfflineBanner uses zIndex 999 — FAB sits above it
const FAB_Z_INDEX = 1000

interface Props {
  /** Ref to the screen container that should be captured when the FAB is tapped */
  screenRef: RefObject<View | null>
}

export function FeedbackButton({ screenRef }: Props) {
  const colors = useThemeColors()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [autoScreenshot, setAutoScreenshot] = useState<string | null>(null)

  const handlePress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    // Capture the current screen BEFORE opening the modal so the modal
    // doesn't appear in the screenshot. Soft-fail if capture errors —
    // user can still attach manually.
    if (screenRef.current) {
      try {
        // Pass .current explicitly for React 19 ref typing compatibility
        const uri = await captureRef(screenRef.current, {
          format: 'jpg',
          quality: 0.7,
          result: 'tmpfile',
        })
        setAutoScreenshot(uri)
      } catch (err) {
        console.warn('[feedback] screen capture failed:', err instanceof Error ? err.message : err)
        setAutoScreenshot(null)
      }
    }
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
    setAutoScreenshot(null)
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
        <MgPressable
          accessibilityLabel="Send feedback"
          onPress={handlePress}
          activeOpacity={0.85}
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
        </MgPressable>
      </View>

      <FeedbackModal
        visible={open}
        onClose={handleClose}
        screenPath={pathname}
        initialScreenshotUri={autoScreenshot}
      />
    </>
  )
}
