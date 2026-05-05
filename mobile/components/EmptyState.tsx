import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useThemeColors, theme } from '../lib/theme'
import { MgPressable } from './MgPressable'

type FeatherIconName = React.ComponentProps<typeof Feather>['name']

interface EmptyStateProps {
  icon: FeatherIconName
  title: string
  subtitle?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const colors = useThemeColors()

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: colors.surfaceAlt },
        ]}
      >
        <Feather
          name={icon}
          size={36}
          color={colors.textMuted}
        />
      </View>

      <Text style={[styles.title, { color: colors.text }]}>
        {title}
      </Text>

      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {subtitle}
        </Text>
      )}

      {actionLabel && onAction && (
        <MgPressable
          accessibilityLabel={actionLabel}
          style={[styles.button, { backgroundColor: colors.accent }]}
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text style={[styles.buttonText, { color: colors.accentText }]}>
            {actionLabel}
          </Text>
        </MgPressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xxxl,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
  },
  button: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xxl,
    borderRadius: theme.radius.md,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
})
