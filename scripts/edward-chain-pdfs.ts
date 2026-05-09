// scripts/edward-chain-pdfs.ts
// Renders the 4 chain invoice PDFs for Edward Taylor (PROJ-28619)
// without flipping any status — pure PDF render, save to /tmp, log paths.
//
// run: npx tsx --env-file=.env.local scripts/edward-chain-pdfs.ts

import { createClient } from '@supabase/supabase-js'
import fs from 'fs/promises'
import path from 'path'

import { renderInvoicePDF } from '../lib/invoices/pdf'
import type { Invoice, InvoiceLineItem, Organization } from '../types/database'

const PROJ = 'PROJ-28619'
const OUT_DIR = '/tmp/edward-chain-pdfs'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or service key in .env.local')

  const sb = createClient(url, key, { auth: { persistSession: false } })

  await fs.mkdir(OUT_DIR, { recursive: true })

  const { data: invoices, error: invErr } = await sb
    .from('invoices')
    .select('*')
    .eq('project_id', PROJ)
    .like('invoice_number', 'CHN-20260509-%')
    .order('invoice_number', { ascending: true })

  if (invErr) throw invErr
  if (!invoices?.length) throw new Error(`No invoices found for ${PROJ}`)

  console.log(`Found ${invoices.length} invoices for ${PROJ}`)

  for (const inv of invoices as Invoice[]) {
    const [{ data: lineItems }, { data: orgs }] = await Promise.all([
      sb.from('invoice_line_items')
        .select('*')
        .eq('invoice_id', inv.id)
        .order('sort_order', { ascending: true }),
      sb.from('organizations')
        .select('*')
        .in('id', [inv.from_org, inv.to_org]),
    ])

    const fromOrg = (orgs as Organization[])?.find(o => o.id === inv.from_org)
    const toOrg = (orgs as Organization[])?.find(o => o.id === inv.to_org)
    if (!fromOrg || !toOrg) {
      console.error(`Missing orgs for ${inv.invoice_number}`)
      continue
    }

    const buf = await renderInvoicePDF({
      invoice: inv,
      lineItems: (lineItems ?? []) as InvoiceLineItem[],
      fromOrg,
      toOrg,
    })

    const outPath = path.join(OUT_DIR, `${inv.invoice_number}.pdf`)
    await fs.writeFile(outPath, buf)
    console.log(`  ${inv.invoice_number}  ${fromOrg.name} -> ${toOrg.name}  $${inv.total}  -> ${outPath}`)
  }

  console.log(`\nDone. PDFs in ${OUT_DIR}`)
}

main().catch(e => { console.error(e); process.exit(1) })
