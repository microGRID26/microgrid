// lib/invoices/pdf.tsx — Server-rendered invoice PDF template
//
// Renders a MicroGRID-branded invoice PDF given an Invoice row, its line items,
// and the from/to Organization rows. Called from POST /api/invoices/[id]/send
// which pipes the rendered buffer to Resend as an email attachment.
//
// Intentionally stateless: no DB access, no network. All data comes in via props.

import React from 'react'
import {
  Document,
  Image,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'

import type { Invoice, InvoiceLineItem, Organization } from '@/types/database'
import { MILESTONE_LABELS } from '@/lib/api/invoices'

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Per-org branding chrome resolved from organizations.settings.brand at render
 * time. Each tenant in the multi-org platform (MicroGRID, Direct Supply Equity
 * Corp, NewCo Distribution, Rush Engineering, EDGE) gets its own header strip
 * + accent color + tagline so invoices look like they came from the actual
 * billing entity, not generically MicroGRID-branded.
 */
export interface BrandTheme {
  primary_color: string
  secondary_color: string
  font: string
  tagline: string
  /** Optional inline footer line; defaults to MicroGRID billing contact. */
  footer_contact?: string
}

/** MicroGRID default theme — used as fallback when a from_org has no brand override. */
export const DEFAULT_BRAND_THEME: BrandTheme = {
  primary_color: '#1D9E75',
  secondary_color: '#0f5040',
  font: 'Helvetica',
  tagline: 'Solar energy, engineered right.',
  footer_contact: 'billing@gomicrogridenergy.com',
}

/** Resolve a BrandTheme from an Organization's settings JSONB. */
export function resolveBrandTheme(org: Pick<Organization, 'settings'>): BrandTheme {
  const brand = (org.settings as Record<string, unknown> | null)?.brand as Record<string, unknown> | undefined
  if (!brand) return DEFAULT_BRAND_THEME
  return {
    primary_color: typeof brand.primary_color === 'string' ? brand.primary_color : DEFAULT_BRAND_THEME.primary_color,
    secondary_color: typeof brand.secondary_color === 'string' ? brand.secondary_color : DEFAULT_BRAND_THEME.secondary_color,
    font: typeof brand.font === 'string' ? brand.font : DEFAULT_BRAND_THEME.font,
    tagline: typeof brand.tagline === 'string' ? brand.tagline : DEFAULT_BRAND_THEME.tagline,
    footer_contact: typeof brand.footer_contact === 'string'
      ? brand.footer_contact
      : DEFAULT_BRAND_THEME.footer_contact,
  }
}

/** EPC attestation language for EPC → EDGE invoices, per Mark Bench 2026-04-13. */
export const EPC_ATTESTATION_TEXT =
  'EPC certifies that the internal allocations shown for this project are derived from its project cost records and reasonably reflect costs incurred in originating, engineering, procuring, constructing, commissioning, and delivering the completed project invoice to EDGE.'

export interface InvoicePDFProps {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  fromOrg: Pick<Organization, 'id' | 'name' | 'org_type' | 'settings' | 'billing_email' | 'billing_address' | 'logo_url'>
  toOrg: Pick<Organization, 'id' | 'name' | 'org_type' | 'settings' | 'billing_email' | 'billing_address'>
}

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Styles ──────────────────────────────────────────────────────────────────
//
// Static per-render styles (colors etc) are still derived per-org via
// buildStyles(theme) below. The shared INK/MUTED/DIVIDER neutrals stay constant
// across all tenants — only the accent + font come from the theme.

const INK = '#111827'
const MUTED = '#6b7280'
const DIVIDER = '#e5e7eb'

function buildStyles(theme: BrandTheme) {
  return StyleSheet.create({
    page: {
      padding: 48,
      fontSize: 10,
      fontFamily: theme.font,
      color: INK,
      lineHeight: 1.4,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 32,
      paddingBottom: 16,
      borderBottomWidth: 2,
      borderBottomColor: theme.primary_color,
    },
    brand: {
      fontSize: 22,
      fontFamily: `${theme.font}-Bold`,
      color: theme.primary_color,
    },
    brandLogo: {
      height: 48,
      maxWidth: 240,
      marginBottom: 4,
    },
    brandTag: {
      fontSize: 9,
      color: MUTED,
      marginTop: 2,
    },
    invoiceBlock: {
      alignItems: 'flex-end',
    },
    invoiceLabel: {
      fontSize: 18,
      fontFamily: `${theme.font}-Bold`,
      color: INK,
    },
    invoiceNumber: {
      fontSize: 11,
      color: MUTED,
      marginTop: 4,
    },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 24,
    },
    metaBlock: {
      flex: 1,
      marginRight: 16,
    },
    metaLabel: {
      fontSize: 8,
      color: MUTED,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 4,
    },
    metaValue: {
      fontSize: 10,
      color: INK,
    },
    metaValueBold: {
      fontSize: 11,
      fontFamily: `${theme.font}-Bold`,
      color: INK,
    },
    table: {
      marginTop: 8,
      marginBottom: 24,
    },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: '#f3f4f6',
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: DIVIDER,
    },
    tableHeaderCell: {
      fontSize: 8,
      color: MUTED,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      fontFamily: `${theme.font}-Bold`,
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: DIVIDER,
    },
    cellDescription: { flex: 4 },
    cellQuantity: { flex: 1, textAlign: 'right' as const },
    cellUnitPrice: { flex: 1.2, textAlign: 'right' as const },
    cellTotal: { flex: 1.2, textAlign: 'right' as const },
    totalsBlock: {
      marginLeft: 'auto' as const,
      width: '45%' as const,
      marginTop: 8,
    },
    totalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    totalsLabel: {
      fontSize: 10,
      color: MUTED,
    },
    totalsValue: {
      fontSize: 10,
      color: INK,
    },
    grandTotalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
      marginTop: 4,
      borderTopWidth: 2,
      borderTopColor: theme.primary_color,
    },
    grandTotalLabel: {
      fontSize: 12,
      fontFamily: `${theme.font}-Bold`,
      color: INK,
    },
    grandTotalValue: {
      fontSize: 14,
      fontFamily: `${theme.font}-Bold`,
      color: theme.primary_color,
    },
    attestationBlock: {
      marginTop: 32,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.secondary_color,
      backgroundColor: '#fafafa',
    },
    attestationLabel: {
      fontSize: 8,
      fontFamily: `${theme.font}-Bold`,
      color: theme.secondary_color,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 4,
    },
    attestationText: {
      fontSize: 9,
      color: INK,
      lineHeight: 1.5,
      marginBottom: 12,
    },
    signatureRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    signatureCell: {
      flex: 1,
      marginRight: 12,
    },
    signatureLine: {
      borderBottomWidth: 1,
      borderBottomColor: INK,
      height: 18,
    },
    signatureLabel: {
      fontSize: 7,
      color: MUTED,
      marginTop: 2,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    footer: {
      position: 'absolute',
      bottom: 32,
      left: 48,
      right: 48,
      fontSize: 8,
      color: MUTED,
      borderTopWidth: 1,
      borderTopColor: DIVIDER,
      paddingTop: 8,
      textAlign: 'center',
      lineHeight: 1.5,
    },
  })
}

// ── React component ────────────────────────────────────────────────────────

/**
 * Determine whether this invoice should render the EPC attestation block.
 * Per Mark Bench in the 2026-04-13 meeting, only the EPC → EDGE invoice
 * carries the certification language (because it includes EPC internal cost
 * lines that have no external proof of payment — labor, project management,
 * overhead). The EPC signs the attestation when sending the invoice.
 */
export function shouldRenderAttestation(
  fromOrg: Pick<Organization, 'org_type'>,
  toOrg: Pick<Organization, 'org_type'>,
): boolean {
  return fromOrg.org_type === 'epc' && toOrg.org_type === 'platform'
}

export function InvoicePDF({ invoice, lineItems, fromOrg, toOrg }: InvoicePDFProps) {
  const milestoneLabel = invoice.milestone ? (MILESTONE_LABELS[invoice.milestone] ?? invoice.milestone) : null
  const theme = resolveBrandTheme(fromOrg)
  const styles = buildStyles(theme)
  const showAttestation = shouldRenderAttestation(fromOrg, toOrg)

  return (
    <Document
      title={`Invoice ${invoice.invoice_number}`}
      author={fromOrg.name}
      subject={`Invoice from ${fromOrg.name} to ${toOrg.name}`}
    >
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            {fromOrg.logo_url ? (
              <Image src={fromOrg.logo_url} style={styles.brandLogo} />
            ) : (
              <Text style={styles.brand}>{fromOrg.name}</Text>
            )}
            <Text style={styles.brandTag}>{theme.tagline}</Text>
          </View>
          <View style={styles.invoiceBlock}>
            <Text style={styles.invoiceLabel}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
          </View>
        </View>

        {/* Bill to / meta */}
        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Bill To</Text>
            <Text style={styles.metaValueBold}>{toOrg.name}</Text>
            {toOrg.billing_address ? (
              <Text style={styles.metaValue}>{toOrg.billing_address}</Text>
            ) : null}
            {toOrg.billing_email ? (
              <Text style={styles.metaValue}>{toOrg.billing_email}</Text>
            ) : null}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>From</Text>
            <Text style={styles.metaValueBold}>{fromOrg.name}</Text>
            {fromOrg.billing_address ? (
              <Text style={styles.metaValue}>{fromOrg.billing_address}</Text>
            ) : null}
            {fromOrg.billing_email ? (
              <Text style={styles.metaValue}>{fromOrg.billing_email}</Text>
            ) : null}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Issued</Text>
            <Text style={styles.metaValue}>{fmtDate(invoice.created_at)}</Text>
            <Text style={[styles.metaLabel, { marginTop: 8 }]}>Due</Text>
            <Text style={styles.metaValue}>{fmtDate(invoice.due_date)}</Text>
            {milestoneLabel ? (
              <>
                <Text style={[styles.metaLabel, { marginTop: 8 }]}>Milestone</Text>
                <Text style={styles.metaValue}>{milestoneLabel}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Line items table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.cellDescription]}>Description</Text>
            <Text style={[styles.tableHeaderCell, styles.cellQuantity]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.cellUnitPrice]}>Unit Price</Text>
            <Text style={[styles.tableHeaderCell, styles.cellTotal]}>Total</Text>
          </View>
          {lineItems.map((item) => (
            <View key={item.id} style={styles.tableRow}>
              <Text style={styles.cellDescription}>{item.description}</Text>
              <Text style={styles.cellQuantity}>{item.quantity}</Text>
              <Text style={styles.cellUnitPrice}>{fmtMoney(item.unit_price)}</Text>
              <Text style={styles.cellTotal}>{fmtMoney(item.total)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{fmtMoney(invoice.subtotal)}</Text>
          </View>
          {invoice.tax > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>TX Sales Tax (8.25%)</Text>
              <Text style={styles.totalsValue}>{fmtMoney(invoice.tax)}</Text>
            </View>
          ) : null}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total Due</Text>
            <Text style={styles.grandTotalValue}>{fmtMoney(invoice.total)}</Text>
          </View>
        </View>

        {/* EPC Attestation block — EPC → EDGE invoices only */}
        {showAttestation ? (
          <View style={styles.attestationBlock}>
            <Text style={styles.attestationLabel}>EPC Certification</Text>
            <Text style={styles.attestationText}>{EPC_ATTESTATION_TEXT}</Text>
            <View style={styles.signatureRow}>
              <View style={styles.signatureCell}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Printed Name</Text>
              </View>
              <View style={styles.signatureCell}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Title</Text>
              </View>
              <View style={styles.signatureCell}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Signature</Text>
              </View>
              <View style={styles.signatureCell}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Date</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Footer */}
        <Text style={styles.footer}>
          Payment due within 30 days of invoice date. Questions: {theme.footer_contact ?? 'billing@gomicrogridenergy.com'}{'\n'}
          {fromOrg.name} · Generated {fmtDate(invoice.created_at)}
        </Text>
      </Page>
    </Document>
  )
}

// ── Render helper ───────────────────────────────────────────────────────────

/**
 * Render the invoice PDF to a Node Buffer suitable for attaching to a Resend
 * email or streaming as an HTTP response body.
 */
export async function renderInvoicePDF(props: InvoicePDFProps): Promise<Buffer> {
  return renderToBuffer(<InvoicePDF {...props} />)
}
