import type { Project } from '@/types/database'
import { STAGE_LABELS } from '@/lib/utils'

export interface ExportField {
  key: string
  label: string
  getValue: (p: Project) => string | number | null | undefined
}

export const ALL_EXPORT_FIELDS: ExportField[] = [
  { key: 'id',                     label: 'ID',                getValue: p => p.id },
  { key: 'name',                   label: 'Name',              getValue: p => p.name },
  { key: 'city',                   label: 'City',              getValue: p => p.city },
  { key: 'address',                label: 'Address',           getValue: p => p.address },
  { key: 'phone',                  label: 'Phone',             getValue: p => p.phone },
  { key: 'email',                  label: 'Email',             getValue: p => p.email },
  { key: 'stage',                  label: 'Stage',             getValue: p => STAGE_LABELS[p.stage] ?? p.stage },
  { key: 'stage_date',             label: 'Stage Date',        getValue: p => p.stage_date },
  { key: 'pm',                     label: 'PM',                getValue: p => p.pm },
  { key: 'sale_date',              label: 'Sale Date',         getValue: p => p.sale_date },
  { key: 'contract',               label: 'Contract',          getValue: p => p.contract },
  { key: 'systemkw',               label: 'System kW',         getValue: p => p.systemkw },
  { key: 'financier',              label: 'Financier',         getValue: p => p.financier },
  { key: 'financing_type',         label: 'Financing Type',    getValue: p => p.financing_type },
  { key: 'ahj',                    label: 'AHJ',               getValue: p => p.ahj },
  { key: 'utility',                label: 'Utility',           getValue: p => p.utility },
  { key: 'advisor',                label: 'Advisor',           getValue: p => p.advisor },
  { key: 'consultant',             label: 'Consultant',        getValue: p => p.consultant },
  { key: 'dealer',                 label: 'Dealer',            getValue: p => p.dealer },
  { key: 'disposition',            label: 'Disposition',       getValue: p => p.disposition },
  { key: 'ntp_date',               label: 'NTP Date',          getValue: p => p.ntp_date },
  { key: 'survey_scheduled_date',  label: 'Survey Scheduled',  getValue: p => p.survey_scheduled_date },
  { key: 'survey_date',            label: 'Survey Complete',   getValue: p => p.survey_date },
  { key: 'install_scheduled_date', label: 'Install Scheduled', getValue: p => p.install_scheduled_date },
  { key: 'install_complete_date',  label: 'Install Complete',  getValue: p => p.install_complete_date },
  { key: 'city_permit_date',       label: 'City Permit Date',  getValue: p => p.city_permit_date },
  { key: 'utility_permit_date',    label: 'Utility Permit Date',getValue: p => p.utility_permit_date },
  { key: 'city_inspection_date',   label: 'City Inspection',   getValue: p => p.city_inspection_date },
  { key: 'utility_inspection_date',label: 'Utility Inspection',getValue: p => p.utility_inspection_date },
  { key: 'pto_date',               label: 'PTO Date',          getValue: p => p.pto_date },
  { key: 'in_service_date',        label: 'In Service Date',   getValue: p => p.in_service_date },
  { key: 'permit_number',          label: 'Permit #',          getValue: p => p.permit_number },
  { key: 'utility_app_number',     label: 'Utility App #',     getValue: p => p.utility_app_number },
  { key: 'module',                 label: 'Module',            getValue: p => p.module },
  { key: 'module_qty',             label: 'Module Qty',        getValue: p => p.module_qty },
  { key: 'inverter',               label: 'Inverter',          getValue: p => p.inverter },
  { key: 'inverter_qty',           label: 'Inverter Qty',      getValue: p => p.inverter_qty },
  { key: 'battery',                label: 'Battery',           getValue: p => p.battery },
  { key: 'battery_qty',            label: 'Battery Qty',       getValue: p => p.battery_qty },
  { key: 'hoa',                    label: 'HOA',               getValue: p => p.hoa },
  { key: 'esid',                   label: 'ESID',              getValue: p => p.esid },
  { key: 'blocker',                label: 'Blocker',           getValue: p => p.blocker },
]

// Default selection — all fields on
export const DEFAULT_EXPORT_KEYS = ALL_EXPORT_FIELDS.map(f => f.key)

function escapeCell(val: string | number | null | undefined): string {
  const s = val == null ? '' : String(val)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

export function exportProjectsCSV(projects: Project[], selectedKeys?: string[]) {
  const fields = selectedKeys && selectedKeys.length > 0
    ? ALL_EXPORT_FIELDS.filter(f => selectedKeys.includes(f.key))
    : ALL_EXPORT_FIELDS

  const headers = fields.map(f => f.label)
  const rows = projects.map(p => fields.map(f => escapeCell(f.getValue(p))))

  const csv = [headers.map(escapeCell), ...rows]
    .map(row => row.join(','))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `microgrid-projects-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
