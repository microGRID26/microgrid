import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useThemeColors, theme } from '../lib/theme'
import { MgPressable } from './MgPressable'

type FeatherIconName = React.ComponentProps<typeof Feather>['name']

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
  icon?: FeatherIconName
}

export function ErrorState({
  message = 'Something went wrong',
  onRetry,
  icon = 'alert-circle',
}: ErrorStateProps) {
  const colors = useThemeColors()

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: colors.errorLight },
        ]}
      >
        <Feather
          name={icon}
          size={32}
          color={colors.error}
        />
      </View>

      <Text style={[styles.message, { color: colors.text }]}>
        {message}
      </Text>

      {onRetry && (
        <MgPressable
          accessibilityLabel="Try again"
          style={[styles.button, { backgroundColor: colors.accent }]}
          onPress={onRetry}
          activeOpacity={0.8}
        >
          <Feather name="refresh-cw" size={16} color={colors.accentText} />
          <Text style={[styles.buttonText, { color: colors.accentText }]}>
            Try Again
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
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  message: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: theme.spacing.xl,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.radius.md,
    gap: theme.spacing.sm,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
})
