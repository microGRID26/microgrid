import React from 'react'
import { View, TextInput, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useThemeColors, theme } from '../lib/theme'
import { MgPressable } from './MgPressable'

interface SearchBarProps {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search...',
}: SearchBarProps) {
  const colors = useThemeColors()

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
        },
      ]}
    >
      <Feather
        name="search"
        size={18}
        color={colors.textMuted}
        style={styles.searchIcon}
      />

      <TextInput
        style={[styles.input, { color: colors.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoCorrect={false}
      />

      {value.length > 0 && (
        <MgPressable
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.clearButton}
        >
          <View
            style={[
              styles.clearCircle,
              { backgroundColor: colors.border },
            ]}
          >
            <Feather name="x" size={12} color={colors.textSecondary} />
          </View>
        </MgPressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    height: 44,
  },
  searchIcon: {
    marginRight: theme.spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  clearButton: {
    marginLeft: theme.spacing.sm,
  },
  clearCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
