/**
 * MgPressable — TouchableOpacity wrapper that enforces accessibilityLabel.
 *
 * Use this instead of bare <TouchableOpacity> for all new pressable elements
 * in the MicroGRID mobile app. The `accessibilityLabel` prop is required at
 * compile time so VoiceOver and TalkBack users always hear a meaningful
 * description instead of "button, double tap to activate".
 *
 * Usage:
 *   <MgPressable
 *     accessibilityLabel="Open support ticket #123"
 *     onPress={handlePress}
 *   >
 *     <Text>Open ticket</Text>
 *   </MgPressable>
 *
 * Defaults:
 *   - accessibilityRole: 'button' (override for links: 'link', toggles: 'checkbox')
 *   - All other TouchableOpacity props are forwarded unchanged.
 *
 * Migration (#498): progressively replace unlabeled <TouchableOpacity>
 * instances in existing screens with <MgPressable>. Remaining count tracked
 * in greg_actions #498.
 */
import { TouchableOpacity, type TouchableOpacityProps } from 'react-native'

interface MgPressableProps extends Omit<TouchableOpacityProps, 'accessibilityLabel'> {
  /** Required. Announce to VoiceOver / TalkBack: verb + object, e.g. "Open ticket #123". */
  accessibilityLabel: string
}

export function MgPressable({
  accessibilityRole = 'button',
  accessibilityLabel,
  ...rest
}: MgPressableProps) {
  return (
    <TouchableOpacity
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      {...rest}
    />
  )
}
