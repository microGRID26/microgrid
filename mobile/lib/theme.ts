// MicroGRID Customer App Theme
// Brand: earth tones, Pixar meets Tesla — premium, warm, reliable
// Supports light and dark mode

import { createContext, useContext } from 'react'
import { useColorScheme } from 'react-native'

const light = {
  bg: '#FAFAF7',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F3EE',
  surfaceHover: '#EDEAE3',
  border: '#E2DFD6',
  borderLight: '#F0EDE6',
  text: '#1A1A18',
  textSecondary: '#5C5A52',
  textMuted: '#707068', // ~4.85:1 vs bg — passes WCAG AA for body text. Was #8A877D (~3.69:1, AA-large only).
  accent: '#1D7A5F',
  accentLight: '#E8F5EE',
  accentDark: '#145C47',
  accentText: '#FFFFFF',
  warm: '#C4922A',
  warmLight: '#FFF8E7',
  error: '#C53030',
  errorLight: '#FFF5F5',
  info: '#2563EB',
  infoLight: '#EFF6FF',
  stageComplete: '#1D7A5F',
  stageActive: '#2563EB',
  stageUpcoming: '#D1CFC8',
  tabBar: '#FFFFFF',
  tabBarBorder: '#F0EDE6',
  statusBar: 'dark' as const,
} as const

const dark = {
  bg: '#0A0F0D',
  surface: '#141A17',
  surfaceAlt: '#1A211E',
  surfaceHover: '#222A26',
  border: '#2A332E',
  borderLight: '#1E2723',
  text: '#F0EDE6',
  textSecondary: '#A8A49A',
  textMuted: '#807C72', // ~4.51:1 vs bg — passes WCAG AA for body text. Was #6B675E (~3.44:1).
  accent: '#2AAA7F',
  accentLight: '#142A22',
  accentDark: '#1D7A5F',
  accentText: '#FFFFFF',
  warm: '#D4A23A',
  warmLight: '#2A2210',
  error: '#E85454',
  errorLight: '#2A1414',
  info: '#5B8DEF',
  infoLight: '#141E2E',
  stageComplete: '#2AAA7F',
  stageActive: '#5B8DEF',
  stageUpcoming: '#2A332E',
  tabBar: '#141A17',
  tabBarBorder: '#1E2723',
  statusBar: 'light' as const,
} as const

export type ThemeColors = {
  [K in keyof typeof light]: string
} & { statusBar: 'dark' | 'light' }

export const theme = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  radius: { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 },
  shadow: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 3,
      elevation: 2,
    },
  },
} as const

export type Theme = typeof theme & { colors: ThemeColors }

// Context for theme colors
const ThemeContext = createContext<ThemeColors>(light)

export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext)
}

export function getThemeColors(mode: 'light' | 'dark'): ThemeColors {
  return mode === 'dark' ? dark : light
}

export function useAppTheme(): Theme & { mode: 'light' | 'dark' } {
  const scheme = useColorScheme()
  const mode = scheme === 'dark' ? 'dark' : 'light'
  return { ...theme, colors: mode === 'dark' ? dark : light, mode }
}

export { ThemeContext, light, dark }
