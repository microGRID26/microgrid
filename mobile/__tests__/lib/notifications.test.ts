// Push registration regression tests.
//
// Regressions caught by these:
// - Permission flow regresses to always-prompt (annoying for users)
// - registerForPushNotifications writes a token even when permission denied
// - Non-device path returns garbage instead of null

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'

// Mock the modules we don't actually want to call
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  AndroidImportance: { MAX: 5 },
}))

jest.mock('expo-device', () => ({
  isDevice: true,
}))

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}))

jest.mock('../../lib/api', () => ({
  getCustomerAccount: jest.fn(),
}))

import { registerForPushNotifications } from '../../lib/notifications'
import { getCustomerAccount } from '../../lib/api'

const mockedGetPerms = Notifications.getPermissionsAsync as jest.Mock
const mockedRequestPerms = Notifications.requestPermissionsAsync as jest.Mock
const mockedGetToken = Notifications.getExpoPushTokenAsync as jest.Mock
const mockedGetAccount = getCustomerAccount as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('registerForPushNotifications', () => {
  it('returns null and skips token fetch when not a physical device', async () => {
    // Override the Device mock for this case
    const origIsDevice = (Device as any).isDevice
    ;(Device as any).isDevice = false
    try {
      const token = await registerForPushNotifications()
      expect(token).toBeNull()
      expect(mockedGetPerms).not.toHaveBeenCalled()
      expect(mockedGetToken).not.toHaveBeenCalled()
    } finally {
      ;(Device as any).isDevice = origIsDevice
    }
  })

  it('returns null when permission denied (permission-denied path)', async () => {
    mockedGetPerms.mockResolvedValueOnce({ status: 'undetermined' })
    mockedRequestPerms.mockResolvedValueOnce({ status: 'denied' })
    const token = await registerForPushNotifications()
    expect(token).toBeNull()
    expect(mockedRequestPerms).toHaveBeenCalledTimes(1)
    // Critical: do not fetch a token if permission denied
    expect(mockedGetToken).not.toHaveBeenCalled()
  })

  it('does not re-prompt when permission already granted', async () => {
    mockedGetPerms.mockResolvedValueOnce({ status: 'granted' })
    mockedGetToken.mockResolvedValueOnce({ data: 'ExponentPushToken[abc]' })
    mockedGetAccount.mockResolvedValueOnce(null)
    const token = await registerForPushNotifications()
    expect(token).toBe('ExponentPushToken[abc]')
    expect(mockedRequestPerms).not.toHaveBeenCalled()
  })

  it('returns the token on happy path', async () => {
    mockedGetPerms.mockResolvedValueOnce({ status: 'granted' })
    mockedGetToken.mockResolvedValueOnce({ data: 'ExponentPushToken[xyz]' })
    mockedGetAccount.mockResolvedValueOnce({ id: 'a1' })
    const token = await registerForPushNotifications()
    expect(token).toBe('ExponentPushToken[xyz]')
  })
})
