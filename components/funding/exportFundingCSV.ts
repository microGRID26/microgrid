import type { FundingRow } from './types'

function escapeCell(val: string | number | null | undefined): string {
  const s = val == null ? '' : String(val)
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

interface FundingExportField {
  key: string
  label: string
  getValue: (r: FundingRow) => string | number | null | undefined
}

const FUNDING_EXPORT_FIELDS: FundingExportField[] = [
  { key: 'id', label: 'Project ID', getValue: r => r.project.id },
  { key: 'name', label: 'Project Name', getValue: r => r.project.name },
  { key: 'city', label: 'City', getValue: r => r.project.city },
  { key: 'address', label: 'Address', getValue: r => r.project.address },
  { key: 'financier', label: 'Financier', getValue: r => r.project.financier },
  { key: 'ahj', label: 'AHJ', getValue: r => r.project.ahj },
  { key: 'stage', label: 'Stage', getValue: r => r.project.stage },
  { key: 'contract', label: 'Contract', getValue: r => r.project.contract },
  { key: 'install_date', label: 'Install Complete', getValue: r => r.project.install_complete_date },
  { key: 'pto_date', label: 'PTO Date', getValue: r => r.project.pto_date },
  // M1
  { key: 'm1_amount', label: 'M1 Amount', getValue: r => r.m1.amount },
  { key: 'm1_funded_date', label: 'M1 Funded Date', getValue: r => r.m1.funded_date },
  { key: 'm1_status', label: 'M1 Status', getValue: r => r.m1.status },
  { key: 'm1_notes', label: 'M1 Notes', getValue: r => r.m1.notes },
  // M2
  { key: 'm2_amount', label: 'M2 Amount', getValue: r => r.m2.amount },
  { key: 'm2_funded_date', label: 'M2 Funded Date', getValue: r => r.m2.funded_date },
  { key: 'm2_status', label: 'M2 Status', getValue: r => r.m2.status },
  { key: 'm2_notes', label: 'M2 Notes', getValue: r => r.m2.notes },
  // M3
  { key: 'm3_amount', label: 'M3 Amount', getValue: r => r.m3.amount },
  { key: 'm3_funded_date', label: 'M3 Funded Date', getValue: r => r.m3.funded_date },
  { key: 'm3_status', label: 'M3 Status', getValue: r => r.m3.status },
  { key: 'm3_notes', label: 'M3 Notes', getValue: r => r.m3.notes },
  // NF
  { key: 'nf1', label: 'NF Code 1', getValue: r => r.nf1 },
  { key: 'nf2', label: 'NF Code 2', getValue: r => r.nf2 },
  { key: 'nf3', label: 'NF Code 3', getValue: r => r.nf3 },
]

export function exportFundingCSV(rows: FundingRow[]) {
  const headers = FUNDING_EXPORT_FIELDS.map(f => f.label)
  const dataRows = rows.map(r => FUNDING_EXPORT_FIELDS.map(f => escapeCell(f.getValue(r))))

  const csv = [headers.map(escapeCell), ...dataRows]
    .map(row => row.join(','))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `microgrid-funding-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
