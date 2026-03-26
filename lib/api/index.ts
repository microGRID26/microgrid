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
export { loadProjectFiles, searchProjectFiles, searchAllProjectFiles, loadAllProjectFiles, loadDocumentRequirements, loadProjectDocuments, updateDocumentStatus } from './documents'
export type { ProjectFile, DocumentRequirement, ProjectDocument } from './documents'
export { loadEquipment, searchEquipment, loadAllEquipment } from './equipment'
export type { Equipment, EquipmentCategory } from './equipment'
export { EQUIPMENT_CATEGORIES } from './equipment'
export { loadProjectMaterials, addProjectMaterial, updateProjectMaterial, deleteProjectMaterial, autoGenerateMaterials, loadWarehouseStock, loadAllProjectMaterials, MATERIAL_STATUSES, MATERIAL_SOURCES, MATERIAL_CATEGORIES } from './inventory'
export type { ProjectMaterial, WarehouseStock, MaterialStatus, MaterialSource, MaterialCategory } from './inventory'
export { sendToEdge, syncProjectToEdge, syncFundingToEdge, isEdgeConfigured, getEdgeWebhookUrl } from './edge-sync'
export type { EdgeEventType, EdgeWebhookPayload } from './edge-sync'
export { loadVendors, searchVendors, loadVendor, addVendor, updateVendor, deleteVendor, VENDOR_CATEGORIES, EQUIPMENT_TYPE_OPTIONS } from './vendors'
export type { Vendor, VendorCategory } from './vendors'
export { loadWorkOrders, loadWorkOrder, createWorkOrder, updateWorkOrder, updateWorkOrderStatus, addChecklistItem, toggleChecklistItem, deleteChecklistItem, createWorkOrderFromProject, loadProjectWorkOrders, generateWONumber, getValidTransitions, WO_CHECKLIST_TEMPLATES } from './work-orders'
export type { WorkOrder, WOChecklistItem, WorkOrderFilters } from './work-orders'
