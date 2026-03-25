// ── Centralized API Layer ────────────────────────────────────────────────────
// All data access functions in one place.
// Pages should import from here instead of using Supabase directly.
//
// Usage:
//   import { loadProjects, loadTaskStates } from '@/lib/api'

export { loadProjects, loadTaskStates, loadProjectFunding, updateProject, loadUsers, loadProjectById, loadProjectsByIds, searchProjects } from './projects'
export type { ProjectQuery } from './projects'
export { loadProjectNotes, loadTaskNotes, addNote, deleteNote, createMentionNotification } from './notes'
export { upsertTaskState, loadTaskHistory, insertTaskHistory, loadProjectAdders, addProjectAdder, deleteProjectAdder } from './tasks'
export { loadScheduleByDateRange } from './schedules'
export { loadChangeOrders } from './change-orders'
export { loadCrewsByIds, loadActiveCrews } from './crews'
