import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildTaskMap,
  applyTaskInsertOrUpdate,
  applyTaskDelete,
} from '@/lib/queue-task-map'
import type { TaskMap, TaskStateRow } from '@/lib/queue-task-map'

// ─── Task Map: Full Rebuild ─────────────────────────────────────────────────

describe('buildTaskMap — full rebuild', () => {
  it('creates correct nested map structure from task state rows', () => {
    const rows: TaskStateRow[] = [
      { project_id: 'PROJ-001', task_id: 'city_permit', status: 'In Progress', reason: null },
      { project_id: 'PROJ-001', task_id: 'util_permit', status: 'Complete', reason: null },
      { project_id: 'PROJ-002', task_id: 'city_permit', status: 'Pending Resolution', reason: 'Missing docs' },
    ]

    const map = buildTaskMap(rows)

    expect(map).toEqual({
      'PROJ-001': {
        city_permit: { status: 'In Progress', reason: undefined },
        util_permit: { status: 'Complete', reason: undefined },
      },
      'PROJ-002': {
        city_permit: { status: 'Pending Resolution', reason: 'Missing docs' },
      },
    })
  })

  it('returns empty map for empty input', () => {
    expect(buildTaskMap([])).toEqual({})
  })

  it('converts null reason to undefined', () => {
    const rows: TaskStateRow[] = [
      { project_id: 'PROJ-001', task_id: 'ntp', status: 'Ready To Start', reason: null },
    ]
    const map = buildTaskMap(rows)
    expect(map['PROJ-001']['ntp'].reason).toBeUndefined()
  })

  it('preserves string reason values', () => {
    const rows: TaskStateRow[] = [
      { project_id: 'PROJ-001', task_id: 'city_permit', status: 'Revision Required', reason: 'Plan corrections' },
    ]
    const map = buildTaskMap(rows)
    expect(map['PROJ-001']['city_permit'].reason).toBe('Plan corrections')
  })

  it('last row wins when duplicates exist for same project+task', () => {
    const rows: TaskStateRow[] = [
      { project_id: 'PROJ-001', task_id: 'city_permit', status: 'In Progress', reason: null },
      { project_id: 'PROJ-001', task_id: 'city_permit', status: 'Complete', reason: null },
    ]
    const map = buildTaskMap(rows)
    expect(map['PROJ-001']['city_permit'].status).toBe('Complete')
  })
})

// ─── Task Map: Incremental INSERT/UPDATE ────────────────────────────────────

describe('applyTaskInsertOrUpdate — incremental INSERT/UPDATE', () => {
  const QUEUE_TASK_IDS = new Set(['city_permit', 'util_permit', 'util_insp', 'ntp'])

  it('INSERT: adds new entry for a new project', () => {
    const map: TaskMap = {}
    const row: TaskStateRow = {
      project_id: 'PROJ-001',
      task_id: 'city_permit',
      status: 'In Progress',
      reason: null,
    }

    const applied = applyTaskInsertOrUpdate(map, row, QUEUE_TASK_IDS)

    expect(applied).toBe(true)
    expect(map['PROJ-001']).toEqual({
      city_permit: { status: 'In Progress', reason: undefined },
    })
  })

  it('INSERT: adds new task to existing project', () => {
    const map: TaskMap = {
      'PROJ-001': {
        city_permit: { status: 'Complete' },
      },
    }
    const row: TaskStateRow = {
      project_id: 'PROJ-001',
      task_id: 'util_permit',
      status: 'Ready To Start',
      reason: null,
    }

    applyTaskInsertOrUpdate(map, row, QUEUE_TASK_IDS)

    expect(map['PROJ-001']).toEqual({
      city_permit: { status: 'Complete' },
      util_permit: { status: 'Ready To Start', reason: undefined },
    })
  })

  it('UPDATE: modifies existing entry', () => {
    const map: TaskMap = {
      'PROJ-001': {
        city_permit: { status: 'In Progress', reason: undefined },
      },
    }
    const row: TaskStateRow = {
      project_id: 'PROJ-001',
      task_id: 'city_permit',
      status: 'Pending Resolution',
      reason: 'Permit Drop Off/Pickup',
    }

    applyTaskInsertOrUpdate(map, row, QUEUE_TASK_IDS)

    expect(map['PROJ-001']['city_permit']).toEqual({
      status: 'Pending Resolution',
      reason: 'Permit Drop Off/Pickup',
    })
  })

  it('ignores non-queue task IDs and returns false', () => {
    const map: TaskMap = {}
    const row: TaskStateRow = {
      project_id: 'PROJ-001',
      task_id: 'site_survey',
      status: 'Complete',
      reason: null,
    }

    const applied = applyTaskInsertOrUpdate(map, row, QUEUE_TASK_IDS)

    expect(applied).toBe(false)
    expect(map['PROJ-001']).toBeUndefined()
  })
})

// ─── Task Map: Incremental DELETE ───────────────────────────────────────────

describe('applyTaskDelete — incremental DELETE', () => {
  const QUEUE_TASK_IDS = new Set(['city_permit', 'util_permit', 'util_insp', 'ntp'])

  it('removes entry from project', () => {
    const map: TaskMap = {
      'PROJ-001': {
        city_permit: { status: 'In Progress' },
        util_permit: { status: 'Complete' },
      },
    }

    const applied = applyTaskDelete(
      map,
      { project_id: 'PROJ-001', task_id: 'city_permit' },
      QUEUE_TASK_IDS
    )

    expect(applied).toBe(true)
    expect(map['PROJ-001']).toEqual({
      util_permit: { status: 'Complete' },
    })
  })

  it('removes project key when last task is deleted', () => {
    const map: TaskMap = {
      'PROJ-001': {
        city_permit: { status: 'In Progress' },
      },
    }

    applyTaskDelete(
      map,
      { project_id: 'PROJ-001', task_id: 'city_permit' },
      QUEUE_TASK_IDS
    )

    expect(map['PROJ-001']).toBeUndefined()
  })

  it('ignores non-queue task IDs and returns false', () => {
    const map: TaskMap = {
      'PROJ-001': {
        city_permit: { status: 'In Progress' },
      },
    }

    const applied = applyTaskDelete(
      map,
      { project_id: 'PROJ-001', task_id: 'site_survey' },
      QUEUE_TASK_IDS
    )

    expect(applied).toBe(false)
    expect(map['PROJ-001']['city_permit']).toBeDefined()
  })

  it('handles delete for non-existent project gracefully', () => {
    const map: TaskMap = {}

    const applied = applyTaskDelete(
      map,
      { project_id: 'PROJ-999', task_id: 'city_permit' },
      QUEUE_TASK_IDS
    )

    expect(applied).toBe(true) // task_id is relevant, just no-op
    expect(Object.keys(map)).toHaveLength(0)
  })
})

// ─── useRealtimeSubscription: realtimeFilter option ─────────────────────────

describe('useRealtimeSubscription — realtimeFilter', () => {
  // We test the subscription behavior by checking how the Supabase channel
  // is configured. The hook is a thin wrapper around supabase.channel().on().
  // We import the mock from the global setup.

  let mockChannel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }
  let mockSupabase: { channel: ReturnType<typeof vi.fn>; removeChannel: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    }
    mockSupabase = {
      channel: vi.fn(() => mockChannel),
      removeChannel: vi.fn(),
    }

    // Re-mock the client for each test
    vi.doMock('@/lib/supabase/client', () => ({
      createClient: () => mockSupabase,
    }))
  })

  it('subscribes without filter when realtimeFilter is undefined (backward compat)', async () => {
    // Dynamically import after mock setup
    const { renderHook } = await import('@testing-library/react')
    const { useRealtimeSubscription } = await import('@/lib/hooks/useRealtimeSubscription')

    renderHook(() =>
      useRealtimeSubscription('projects', {
        onChange: vi.fn(),
        enabled: true,
        filter: undefined,
      })
    )

    expect(mockSupabase.channel).toHaveBeenCalled()
    const onCall = mockChannel.on.mock.calls[0]
    // The channel config object is the second argument to .on()
    const channelConfig = onCall[1]
    expect(channelConfig.table).toBe('projects')
    expect(channelConfig.filter).toBeUndefined()
  })

  it('passes filter to subscription when realtimeFilter is set', async () => {
    const { renderHook } = await import('@testing-library/react')
    const { useRealtimeSubscription } = await import('@/lib/hooks/useRealtimeSubscription')

    renderHook(() =>
      useRealtimeSubscription('projects', {
        onChange: vi.fn(),
        enabled: true,
        filter: 'pm_id=eq.abc123',
      })
    )

    expect(mockSupabase.channel).toHaveBeenCalled()
    const onCall = mockChannel.on.mock.calls[0]
    const channelConfig = onCall[1]
    expect(channelConfig.table).toBe('projects')
    expect(channelConfig.filter).toBe('pm_id=eq.abc123')
  })

  it('updates subscription when realtimeFilter changes', async () => {
    const { renderHook } = await import('@testing-library/react')
    const { useRealtimeSubscription } = await import('@/lib/hooks/useRealtimeSubscription')

    const { rerender } = renderHook(
      ({ filter }: { filter?: string }) =>
        useRealtimeSubscription('projects', {
          onChange: vi.fn(),
          enabled: true,
          filter,
        }),
      { initialProps: { filter: 'pm_id=eq.abc123' } }
    )

    // First subscription
    const firstChannelName = mockSupabase.channel.mock.calls[0][0]
    expect(firstChannelName).toContain('pm_id=eq.abc123')

    // Change filter
    rerender({ filter: 'pm_id=eq.xyz789' })

    // Should have removed old channel and created new one
    expect(mockSupabase.removeChannel).toHaveBeenCalled()
    const lastChannelName = mockSupabase.channel.mock.calls[mockSupabase.channel.mock.calls.length - 1][0]
    expect(lastChannelName).toContain('pm_id=eq.xyz789')
  })
})
