import { describe, it, expect } from 'vitest'
import { isLocked, canEditTaskStatus } from '@/components/project/TasksTab'

const task = { pre: ['welcome', 'adders'] }

describe('isLocked', () => {
  it('is locked when any prereq is not Complete', () => {
    expect(isLocked(task, { welcome: 'Complete', adders: 'In Progress' })).toBe(true)
  })

  it('is unlocked when every prereq is Complete', () => {
    expect(isLocked(task, { welcome: 'Complete', adders: 'Complete' })).toBe(false)
  })

  it('is locked when a prereq is missing entirely (undefined)', () => {
    expect(isLocked(task, { welcome: 'Complete' })).toBe(true)
  })

  it('is unlocked when task has no prereqs', () => {
    expect(isLocked({ pre: [] }, {})).toBe(false)
  })
})

describe('canEditTaskStatus', () => {
  it('non-manager cannot edit a locked task', () => {
    const states = { welcome: 'Complete', adders: 'Not Ready' }
    expect(canEditTaskStatus(task, states, false)).toBe(false)
  })

  it('non-manager can edit an unlocked task', () => {
    const states = { welcome: 'Complete', adders: 'Complete' }
    expect(canEditTaskStatus(task, states, false)).toBe(true)
  })

  it('manager can edit a locked task (override)', () => {
    const states = { welcome: 'Complete', adders: 'Not Ready' }
    expect(canEditTaskStatus(task, states, true)).toBe(true)
  })

  it('manager can edit an unlocked task', () => {
    const states = { welcome: 'Complete', adders: 'Complete' }
    expect(canEditTaskStatus(task, states, true)).toBe(true)
  })

  it('manager can edit a Complete task even when a prereq has been moved back', () => {
    // Realistic scenario: the task is Complete but a prereq was moved back — the
    // lock predicate reports locked (because a prereq is no longer Complete),
    // but the manager still needs to be able to reopen the Complete task.
    const completedTask = { pre: ['design', 'permit'] }
    const states = { design: 'Complete', permit: 'Revision Required' }
    expect(isLocked(completedTask, states)).toBe(true)
    expect(canEditTaskStatus(completedTask, states, true)).toBe(true)
    expect(canEditTaskStatus(completedTask, states, false)).toBe(false)
  })

  it('manager override still works with empty taskStates (legacy-import case)', () => {
    // PROJ-27362 repro: zero rows in task_state means every task shows as
    // locked behind "Not Ready" prereqs; a manager must still be able to
    // mark them Complete retroactively.
    expect(canEditTaskStatus(task, {}, true)).toBe(true)
    expect(canEditTaskStatus(task, {}, false)).toBe(false)
  })
})

describe('batch-mark-complete visibility', () => {
  // Mirrors the JSX predicate at TasksTab.tsx:402 — batch checkbox visibility
  // must follow the same manager-override rule as the individual status picker.
  function canBatchSelect(
    batchMode: boolean,
    task: { pre: string[] },
    taskStates: Record<string, string>,
    status: string,
    isManager: boolean,
  ): boolean {
    const locked = isLocked(task, taskStates)
    return batchMode && (!locked || isManager) && status !== 'Complete'
  }

  it('non-manager cannot batch-select a locked task', () => {
    expect(canBatchSelect(true, task, {}, 'Not Ready', false)).toBe(false)
  })

  it('manager can batch-select a locked task (for legacy backfill)', () => {
    expect(canBatchSelect(true, task, {}, 'Not Ready', true)).toBe(true)
  })

  it('no one can batch-select an already-Complete task', () => {
    const done = { welcome: 'Complete', adders: 'Complete' }
    expect(canBatchSelect(true, task, done, 'Complete', true)).toBe(false)
    expect(canBatchSelect(true, task, done, 'Complete', false)).toBe(false)
  })

  it('batch checkbox is hidden entirely when batchMode is off', () => {
    expect(canBatchSelect(false, task, {}, 'Not Ready', true)).toBe(false)
  })
})
