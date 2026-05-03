// Login screen regression tests.
//
// Phase 2 plan asks for happy + invalid-email tests on the auth flow. The
// component sends an email OTP via supabase.auth.signInWithOtp and transitions
// from step='email' to step='code' on success. Failure surfaces an error
// message inline.

import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react-native'

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}))

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
    },
  },
}))

import LoginScreen from '../../app/(auth)/login'
import { supabase } from '../../lib/supabase'

const mockedSignInWithOtp = supabase.auth.signInWithOtp as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('LoginScreen', () => {
  it('sends OTP and advances to code step on happy path', async () => {
    mockedSignInWithOtp.mockResolvedValueOnce({ error: null })

    const screen = render(<LoginScreen />)
    const emailInput = screen.getByPlaceholderText('you@example.com')
    fireEvent.changeText(emailInput, 'greg@gomicrogridenergy.com')

    const continueBtn = screen.getByText('Continue')
    fireEvent.press(continueBtn)

    await waitFor(() => {
      expect(mockedSignInWithOtp).toHaveBeenCalledWith({
        email: 'greg@gomicrogridenergy.com',
      })
    })

    // Step transition: code-entry copy appears
    await waitFor(() => {
      expect(screen.getByText(/Code sent to/)).toBeTruthy()
    })
  })

  it('surfaces an error message on invalid email / supabase error', async () => {
    mockedSignInWithOtp.mockResolvedValueOnce({
      error: { message: 'Invalid email format' },
    })

    const screen = render(<LoginScreen />)
    const emailInput = screen.getByPlaceholderText('you@example.com')
    fireEvent.changeText(emailInput, 'not-an-email')

    fireEvent.press(screen.getByText('Continue'))

    await waitFor(() => {
      expect(mockedSignInWithOtp).toHaveBeenCalledTimes(1)
    })

    // Inline error text from the component (verbatim)
    await waitFor(() => {
      expect(screen.getByText('Unable to send code. Please try again.')).toBeTruthy()
    })
  })

  it('lower-cases and trims the email before sending', async () => {
    mockedSignInWithOtp.mockResolvedValueOnce({ error: null })

    const screen = render(<LoginScreen />)
    fireEvent.changeText(
      screen.getByPlaceholderText('you@example.com'),
      '  GREG@GoMicroGridEnergy.COM  ',
    )
    fireEvent.press(screen.getByText('Continue'))

    await waitFor(() => {
      expect(mockedSignInWithOtp).toHaveBeenCalledWith({
        email: 'greg@gomicrogridenergy.com',
      })
    })
  })
})
