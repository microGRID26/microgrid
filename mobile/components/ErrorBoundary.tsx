import React from 'react'
import { View, Text } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { MgPressable } from './MgPressable'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
}

// Dark theme colors (app default)
const COLORS = {
  bg: '#0A0F0D',
  text: '#F0EDE6',
  textMuted: '#6B675E',
  accent: '#2AAA7F',
  accentText: '#FFFFFF',
  surface: '#141A17',
  border: '#1E2723',
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught error:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{
          flex: 1,
          backgroundColor: COLORS.bg,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 32,
        }}>
          <View style={{
            width: 64, height: 64, borderRadius: 32,
            backgroundColor: COLORS.surface,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 20,
            borderWidth: 1, borderColor: COLORS.border,
          }}>
            <Feather name="alert-triangle" size={28} color={COLORS.accent} />
          </View>
          <Text style={{
            fontSize: 20, fontWeight: '600', color: COLORS.text,
            fontFamily: 'Inter_600SemiBold', textAlign: 'center',
          }}>
            Something went wrong
          </Text>
          <Text style={{
            fontSize: 14, color: COLORS.textMuted,
            fontFamily: 'Inter_400Regular', textAlign: 'center',
            marginTop: 8, lineHeight: 20,
          }}>
            An unexpected error occurred. Please try again.
          </Text>
          <MgPressable
            accessibilityLabel="Try again"
            onPress={this.handleReset}
            activeOpacity={0.7}
            style={{
              backgroundColor: COLORS.accent,
              borderRadius: 20,
              paddingHorizontal: 32,
              paddingVertical: 14,
              marginTop: 24,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Feather name="refresh-cw" size={16} color={COLORS.accentText} />
            <Text style={{
              fontSize: 16, fontWeight: '600', color: COLORS.accentText,
              fontFamily: 'Inter_600SemiBold',
            }}>
              Try Again
            </Text>
          </MgPressable>
        </View>
      )
    }

    return this.props.children
  }
}
