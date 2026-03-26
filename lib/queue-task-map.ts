/**
 * Extracted task-map helpers for the Queue page.
 *
 * The task map is a nested structure:
 *   { [projectId]: { [taskId]: { status, reason? } } }
 *
 * These pure functions are used by the Queue page for:
 *   1. Full rebuild from query data
 *   2. Incremental updates via realtime payloads
 */

export interface TaskEntry {
  status: string
  reason?: string
}

export interface TaskStateRow {
  project_id: string
  task_id: string
  status: string
  reason?: string | null
  follow_up_date?: string | null
}

export type TaskMap = Record<string, Record<string, TaskEntry>>

/**
 * Build a complete task map from an array of task state rows.
 */
export function buildTaskMap(taskStates: TaskStateRow[]): TaskMap {
  const map: TaskMap = {}
  for (const t of taskStates) {
    if (!map[t.project_id]) map[t.project_id] = {}
    map[t.project_id][t.task_id] = {
      status: t.status,
      reason: t.reason ?? undefined,
    }
  }
  return map
}

/**
 * Apply an incremental INSERT or UPDATE to the task map (mutates in place).
 * Returns true if the update was applied (task_id is in relevantTaskIds).
 */
export function applyTaskInsertOrUpdate(
  map: TaskMap,
  row: TaskStateRow,
  relevantTaskIds: Set<string>
): boolean {
  if (!relevantTaskIds.has(row.task_id)) return false
  if (!map[row.project_id]) map[row.project_id] = {}
  map[row.project_id][row.task_id] = {
    status: row.status,
    reason: row.reason ?? undefined,
  }
  return true
}

/**
 * Apply an incremental DELETE to the task map (mutates in place).
 * Returns true if the deletion was applied (task_id is in relevantTaskIds).
 */
export function applyTaskDelete(
  map: TaskMap,
  row: Pick<TaskStateRow, 'project_id' | 'task_id'>,
  relevantTaskIds: Set<string>
): boolean {
  if (!relevantTaskIds.has(row.task_id)) return false
  if (map[row.project_id]) {
    delete map[row.project_id][row.task_id]
    if (Object.keys(map[row.project_id]).length === 0) {
      delete map[row.project_id]
    }
  }
  return true
}
