// lib/cost/pdf.tsx — Project Cost Reconciliation & Basis PDF renderer
//
// Renders the per-project cost reconciliation as a single-page PDF that can
// be sent to tax equity partners and the IRS. Layout mirrors the proforma's
// Project Cost Reconciliation & Basis sheet:
//
//   • Header strip with brand color + project name + project ID
//   • Project summary block (system size, EPC, distributor, date)
//   • Itemized cost table grouped by section (Major Equipment, BOS, etc.)
//   • Basis breakdown summary block (PV / Battery / GPU + ITC eligible %)
//   • Support legend (Bank Transaction vs EPC-Attestation)
//   • Footer with billing contact + generation timestamp

import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'

import type { CostBasisSummary, ProjectCostLineItem } from '@/lib/cost/calculator'
import type { Project } from '@/types/database'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CostBasisPDFProps {
  project: Project
  lineItems: ProjectCostLineItem[]
  summary: CostBasisSummary
  generatedAt: Date
}

// ── Formatters ──────────────────────────────────────────────────────────────

// Defensive numeric coercion: Postgres NUMERIC columns come back from PostgREST
// as strings, not numbers. Calling .toFixed() / .toLocaleString() on a string
// throws inside @react-pdf's render tree walker and surfaces as the misleading
// "Cannot read properties of null (reading 'props')" error. Always coerce.
function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function fmtMoney(v: number | string | null | undefined): string {
  return `$${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(v: number | string | null | undefined): string {
  return `${(num(v) * 100).toFixed(2)}%`
}

function fmtKw(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  return `${num(v).toFixed(1)} kW DC`
}

function fmtMarkupX(v: number | string | null | undefined): string {
  const n = num(v)
  if (n === 0) return '—'
  return `${n.toFixed(2)}x`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Styles ──────────────────────────────────────────────────────────────────

const BRAND_GREEN = '#1D9E75'
const BRAND_GREEN_DARK = '#0f5040'
const INK = '#111827'
const MUTED = '#6b7280'
const DIVIDER = '#e5e7eb'
const LIGHT_BG = '#f9fafb'
const EPC_INTERNAL_BG = '#fffbeb'
const EPC_INTERNAL_BORDER = '#fbbf24'
const ITC_EXCLUDED_BG = '#fef2f2'
const ITC_EXCLUDED_BORDER = '#ef4444'

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: INK,
    lineHeight: 1.4,
  },
  // ── Header ──────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: BRAND_GREEN,
  },
  headerLeft: {
    flexDirection: 'column',
  },
  brandTitle: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_GREEN,
    lineHeight: 1.05,
    marginBottom: 6,
  },
  brandSubtitle: {
    fontSize: 8,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  docLabel: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    letterSpacing: 0.5,
  },
  docDate: {
    fontSize: 9,
    color: MUTED,
    marginTop: 3,
  },
  // ── Project summary block ──────────────────────────────────────────────
  projectBlock: {
    flexDirection: 'row',
    marginBottom: 18,
    padding: 12,
    backgroundColor: LIGHT_BG,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: BRAND_GREEN,
  },
  projectColWide: {
    flex: 2.2,
    paddingRight: 16,
  },
  projectCol: {
    flex: 1.5,
    paddingRight: 12,
  },
  projectColNarrow: {
    flex: 1,
    paddingRight: 0,
  },
  projectLabel: {
    fontSize: 7,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  projectValue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    lineHeight: 1.3,
  },
  // ── Section headers ────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND_GREEN,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 14,
  },
  sectionHeaderText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // ── Line item table ────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  tableHeaderCell: {
    fontSize: 7,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontFamily: 'Helvetica-Bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: DIVIDER,
    alignItems: 'center',
  },
  tableRowEpcInternal: {
    backgroundColor: EPC_INTERNAL_BG,
  },
  tableRowItcExcluded: {
    backgroundColor: ITC_EXCLUDED_BG,
  },
  cellItem: { flex: 5.5, fontSize: 8, paddingRight: 6 },
  cellBucket: { flex: 0.7, fontSize: 7, color: MUTED, textAlign: 'left' as const, paddingRight: 4 },
  cellRaw: { flex: 1.1, fontSize: 8, textAlign: 'right' as const, color: MUTED, paddingRight: 4 },
  cellMarkup: { flex: 0.6, fontSize: 7, color: MUTED, textAlign: 'right' as const, paddingRight: 4 },
  cellEpc: { flex: 1.4, fontSize: 8, textAlign: 'right' as const, fontFamily: 'Helvetica-Bold', paddingRight: 6 },
  cellBattery: { flex: 1.1, fontSize: 7, textAlign: 'right' as const, color: '#0284c7', paddingRight: 4 },
  cellPv: { flex: 1.1, fontSize: 7, textAlign: 'right' as const, color: '#16a34a', paddingRight: 4 },
  cellEligibility: { flex: 0.6, fontSize: 7, textAlign: 'center' as const, color: MUTED },
  // ── Summary block ──────────────────────────────────────────────────────
  summaryBlock: {
    marginTop: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: BRAND_GREEN,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
  summaryTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  summaryGrid: {
    flexDirection: 'row',
  },
  summaryCol: {
    flex: 1,
    paddingRight: 8,
  },
  summaryLabel: {
    fontSize: 7,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  summaryValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: INK,
    marginBottom: 4,
  },
  summaryPct: {
    fontSize: 8,
    color: MUTED,
  },
  itcBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itcLabel: {
    fontSize: 10,
    color: INK,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  itcValue: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_GREEN,
  },
  // ── Legend ─────────────────────────────────────────────────────────────
  legend: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendItem: {
    flex: 1,
    marginRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendItemLast: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendSwatch: {
    width: 8,
    height: 8,
    marginRight: 5,
    borderWidth: 0.5,
  },
  legendSwatchEpc: {
    backgroundColor: EPC_INTERNAL_BG,
    borderColor: EPC_INTERNAL_BORDER,
  },
  legendSwatchItc: {
    backgroundColor: ITC_EXCLUDED_BG,
    borderColor: ITC_EXCLUDED_BORDER,
  },
  legendText: {
    fontSize: 7,
    color: MUTED,
  },
  legendNote: {
    fontSize: 7,
    color: MUTED,
    fontStyle: 'italic',
  },
  // ── Footer ─────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: MUTED,
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
    paddingTop: 8,
    textAlign: 'center',
    lineHeight: 1.5,
  },
})

// ── React component ────────────────────────────────────────────────────────

export function CostBasisPDF({ project, lineItems, summary, generatedAt }: CostBasisPDFProps) {
  // Group line items by section for a sectioned table render
  const sections = Array.from(new Set(lineItems.map((li) => li.section)))

  return (
    <Document
      title={`Project Cost Reconciliation & Basis — ${project.name}`}
      author="MicroGRID Energy"
      subject={`Cost basis report for project ${project.id}`}
    >
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.brandTitle}>MicroGRID Energy</Text>
            <Text style={styles.brandSubtitle}>Project Cost Reconciliation & Basis</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docLabel}>BASIS REPORT</Text>
            <Text style={styles.docDate}>{fmtDate(generatedAt)}</Text>
          </View>
        </View>

        {/* Project summary */}
        <View style={styles.projectBlock}>
          <View style={styles.projectColWide}>
            <Text style={styles.projectLabel}>Project</Text>
            <Text style={styles.projectValue}>{project.name}</Text>
            <Text style={[styles.projectLabel, { marginTop: 6 }]}>Project ID</Text>
            <Text style={styles.projectValue}>{project.id}</Text>
          </View>
          <View style={styles.projectCol}>
            <Text style={styles.projectLabel}>System Size</Text>
            <Text style={styles.projectValue}>{fmtKw(project.systemkw)}</Text>
            <Text style={[styles.projectLabel, { marginTop: 6 }]}>Battery Units</Text>
            <Text style={styles.projectValue}>
              {project.battery_qty ? `${project.battery_qty} units` : '—'}
            </Text>
          </View>
          <View style={styles.projectColWide}>
            <Text style={styles.projectLabel}>Address</Text>
            <Text style={styles.projectValue}>{project.address ?? '—'}</Text>
            <Text style={[styles.projectLabel, { marginTop: 6 }]}>City / Utility</Text>
            <Text style={styles.projectValue}>
              {[project.city, project.utility].filter(Boolean).join(' · ') || '—'}
            </Text>
          </View>
          <View style={styles.projectColNarrow}>
            <Text style={styles.projectLabel}>AHJ</Text>
            <Text style={styles.projectValue}>{project.ahj ?? '—'}</Text>
            <Text style={[styles.projectLabel, { marginTop: 6 }]}>Sale Date</Text>
            <Text style={styles.projectValue}>
              {project.sale_date ? fmtDate(new Date(project.sale_date)) : '—'}
            </Text>
          </View>
        </View>

        {/* Sectioned line item table.
            Each section's header + table header + FIRST row are wrapped in a
            <View wrap={false}> so a section header can never be orphaned at
            the bottom of a page. The remaining rows wrap normally. */}
        {sections.map((section) => {
          const sectionItems = lineItems.filter((li) => li.section === section)
          if (sectionItems.length === 0) return null
          const [firstItem, ...restItems] = sectionItems

          const renderRow = (li: ProjectCostLineItem) => {
            const rowStyle = {
              ...styles.tableRow,
              ...(li.is_epc_internal ? styles.tableRowEpcInternal : {}),
              ...(li.is_itc_excluded ? styles.tableRowItcExcluded : {}),
            }
            return (
              <View key={li.id ?? li.item_name} style={rowStyle} wrap={false}>
                <Text style={styles.cellItem}>{li.item_name}</Text>
                <Text style={styles.cellBucket}>{li.system_bucket}</Text>
                <Text style={styles.cellEpc}>{fmtMoney(li.epc_price)}</Text>
                <Text style={styles.cellBattery}>{fmtMoney(li.battery_cost)}</Text>
                <Text style={styles.cellPv}>{fmtMoney(li.pv_cost)}</Text>
                <Text style={styles.cellEligibility}>{li.basis_eligibility}</Text>
              </View>
            )
          }

          return (
            <View key={section}>
              {/* Section header + column header + first row stay together */}
              <View wrap={false}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>{section}</Text>
                </View>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.cellItem]}>Item</Text>
                  <Text style={[styles.tableHeaderCell, styles.cellBucket]}>Bucket</Text>
                  <Text style={[styles.tableHeaderCell, styles.cellEpc]}>Fully Loaded Cost</Text>
                  <Text style={[styles.tableHeaderCell, styles.cellBattery]}>Battery</Text>
                  <Text style={[styles.tableHeaderCell, styles.cellPv]}>PV</Text>
                  <Text style={[styles.tableHeaderCell, styles.cellEligibility]}>Basis</Text>
                </View>
                {renderRow(firstItem)}
              </View>
              {/* Remaining rows wrap normally */}
              {restItems.map(renderRow)}
            </View>
          )
        })}

        {/* Summary block — proforma I34:M39 equivalent */}
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryTitle}>Basis Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>PV Basis</Text>
              <Text style={styles.summaryValue}>{fmtMoney(summary.pv_basis)}</Text>
              <Text style={styles.summaryPct}>{fmtPct(summary.pv_basis_pct)} of total</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>Battery Basis</Text>
              <Text style={styles.summaryValue}>{fmtMoney(summary.battery_basis)}</Text>
              <Text style={styles.summaryPct}>{fmtPct(summary.battery_basis_pct)} of total</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>GPU Basis (excluded)</Text>
              <Text style={styles.summaryValue}>{fmtMoney(summary.gpu_basis)}</Text>
              <Text style={styles.summaryPct}>{fmtPct(summary.gpu_basis_pct)} of total</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>Total Basis</Text>
              <Text style={styles.summaryValue}>{fmtMoney(summary.total_basis)}</Text>
              <Text style={styles.summaryPct}>{summary.line_item_count} line items</Text>
            </View>
          </View>
          <View style={styles.itcBlock}>
            <Text style={styles.itcLabel}>ITC-Eligible Basis (excludes GPU)</Text>
            <Text style={styles.itcValue}>
              {fmtMoney(summary.itc_eligible_basis)} · {fmtPct(summary.itc_eligible_pct)}
            </Text>
          </View>
        </View>

        {/* Legend — colored View swatches instead of unicode symbols (Helvetica
            has no ▣ glyph, so the unicode version rendered as £). */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendSwatchEpc]} />
            <Text style={styles.legendText}>EPC internal cost (attestation only)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendSwatchItc]} />
            <Text style={styles.legendText}>ITC excluded (e.g. GPU)</Text>
          </View>
          <View style={styles.legendItemLast}>
            <Text style={styles.legendNote}>
              Markup "K" is the additional factor: distro = raw × (1 + K)
            </Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          MicroGRID Energy · Project Cost Reconciliation & Basis · Confidential — for tax equity / IRS use only{'\n'}
          Generated {fmtDate(generatedAt)} from project cost line item data
        </Text>
      </Page>
    </Document>
  )
}

export async function renderCostBasisPDF(props: CostBasisPDFProps): Promise<Buffer> {
  return renderToBuffer(<CostBasisPDF {...props} />)
}
