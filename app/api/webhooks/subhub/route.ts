import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { TASKS } from '@/lib/tasks'

// ── SubHub Webhook: Project Created ─────────────────────────────────────────
// Receives a POST from SubHub when a contract is signed.
// Creates the project, initial task states, and Google Drive folder in NOVA.
//
// To enable: set SUBHUB_WEBHOOK_SECRET in .env.local
// To test: POST to /api/webhooks/subhub with the payload from docs/subhub-webhook-sample.json
//
// DISABLED by default — set SUBHUB_WEBHOOK_ENABLED=true in .env.local to activate

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || ''
const WEBHOOK_SECRET = process.env.SUBHUB_WEBHOOK_SECRET || ''
const WEBHOOK_ENABLED = process.env.SUBHUB_WEBHOOK_ENABLED === 'true'
const DRIVE_WEBHOOK_URL = process.env.NEXT_PUBLIC_DRIVE_WEBHOOK_URL ?? ''

function supabase() {
  return createClient(SUPABASE_URL, SUPABASE_SECRET)
}

// Generate next PROJ-ID
async function getNextProjectId(): Promise<string> {
  const db = supabase()
  const { data } = await db.from('projects').select('id').order('id', { ascending: false }).limit(1)
  if (!data || data.length === 0) return 'PROJ-30001'
  const lastNum = parseInt(data[0].id.replace('PROJ-', ''), 10)
  return `PROJ-${lastNum + 1}`
}

export async function POST(request: NextRequest) {
  // Check if webhook is enabled
  if (!WEBHOOK_ENABLED) {
    return NextResponse.json({ error: 'Webhook is disabled. Set SUBHUB_WEBHOOK_ENABLED=true to activate.' }, { status: 503 })
  }

  // Verify webhook secret if configured
  if (WEBHOOK_SECRET) {
    const authHeader = request.headers.get('authorization') ?? request.headers.get('x-webhook-secret') ?? ''
    if (authHeader !== WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const payload = await request.json()
    const db = supabase()

    // Idempotency: check for duplicate by matching name + address
    const customerName = payload.name ?? (`${payload.first_name ?? ''} ${payload.last_name ?? ''}`.trim() || 'Unknown')
    const customerAddress = payload.street ?? null
    if (customerName && customerAddress) {
      const { data: existing } = await db.from('projects')
        .select('id')
        .eq('name', customerName)
        .eq('address', customerAddress)
        .limit(1)
      if (existing && existing.length > 0) {
        return NextResponse.json({
          success: true,
          project_id: existing[0].id,
          message: `Project already exists for ${customerName} at ${customerAddress}`,
          duplicate: true,
        }, { status: 200 })
      }
    }

    // Generate project ID
    const projectId = await getNextProjectId()

    // Map SubHub fields to NOVA project
    const project: Record<string, any> = {
      id: projectId,
      name: payload.name ?? (`${payload.first_name ?? ''} ${payload.last_name ?? ''}`.trim() || 'Unknown'),
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      address: payload.street ?? null,
      city: payload.city ?? null,
      zip: payload.postal_code ?? null,
      stage: 'evaluation',
      stage_date: new Date().toISOString().slice(0, 10),
      sale_date: payload.contract_signed_date ?? new Date().toISOString().slice(0, 10),
      contract: payload.contract_amount ?? null,
      systemkw: payload.system_size_kw ?? null,
      financier: payload.finance_partner ?? null,
      financing_type: payload.finance_type ?? null,
      financier_adv_pmt: payload.finance_product_name ?? null,
      module: payload.module_name ?? null,
      module_qty: payload.module_total_panels ?? null,
      inverter: payload.inverter_name ?? null,
      inverter_qty: payload.inverter_quantity ?? null,
      battery: payload.battery_name ?? null,
      battery_qty: payload.battery_quantity ?? null,
      utility: payload.utility_company ?? null,
      hoa: payload.hoa_name ?? null,
      advisor: payload.sales_representative_name ?? payload.sales_rep_first_name ?? null,
      consultant: payload.sales_representative_name ?? (`${payload.sales_rep_first_name ?? ''} ${payload.sales_rep_last_name ?? ''}`.trim() || null),
      consultant_email: payload.sales_representative_email ?? payload.owner_email ?? null,
      disposition: 'Sale',
      down_payment: payload.downpayment ?? null,
      tpo_escalator: payload.finance_escalator_rate ?? null,
      dealer: payload.organization_name ?? null,
    }

    // Insert project
    const { error: projErr } = await db.from('projects').insert(project)
    if (projErr) {
      console.error('SubHub webhook: project insert failed:', projErr)
      return NextResponse.json({ error: 'Failed to create project', detail: projErr.message }, { status: 500 })
    }

    // Create initial task states (all evaluation tasks as Ready To Start, rest as Not Ready)
    const taskRecords: { project_id: string; task_id: string; status: string }[] = []
    for (const [stage, tasks] of Object.entries(TASKS)) {
      for (const task of tasks) {
        taskRecords.push({
          project_id: projectId,
          task_id: task.id,
          status: stage === 'evaluation' && task.pre.length === 0 ? 'Ready To Start' : 'Not Ready',
        })
      }
    }
    const { error: taskErr } = await db.from('task_state').insert(taskRecords)
    if (taskErr) console.error('SubHub webhook: task_state insert failed:', taskErr)

    // Create stage history entry
    await db.from('stage_history').insert({
      project_id: projectId,
      stage: 'evaluation',
      entered: new Date().toISOString(),
    })

    // Create funding record
    await db.from('project_funding').insert({ project_id: projectId })

    // Create Google Drive folder
    if (DRIVE_WEBHOOK_URL) {
      try {
        const driveRes = await fetch(DRIVE_WEBHOOK_URL, {
          method: 'POST',
          body: JSON.stringify({ project_id: projectId, customer_name: project.name }),
          redirect: 'follow',
        })
        const driveText = await driveRes.text()
        try {
          const driveData = JSON.parse(driveText)
          if (driveData.folder_url) {
            await db.from('project_folders').upsert(
              { project_id: projectId, folder_url: driveData.folder_url },
              { onConflict: 'project_id' }
            )
          }
        } catch { /* drive response not JSON */ }
      } catch (driveErr) {
        console.error('SubHub webhook: Drive folder creation error:', driveErr)
      }
    }

    // Import adders if present
    if (payload.adders && Array.isArray(payload.adders) && payload.adders.length > 0) {
      const adderRecords = payload.adders.map((a: any) => ({
        project_id: projectId,
        adder_name: a.name ?? 'Unknown',
        price: a.unit_price ?? a.cost_total ?? null,
        total_amount: a.cost_total ?? null,
        quantity: a.qty ?? 1,
      }))
      const { error: adderErr } = await db.from('project_adders').insert(adderRecords)
      if (adderErr) console.error('SubHub webhook: adders insert failed:', adderErr)
    }

    // Create initial note
    await db.from('notes').insert({
      project_id: projectId,
      text: `[System] Project created from SubHub (ID: ${payload.subhub_id ?? 'unknown'}). Contract signed ${payload.contract_signed_date ?? 'unknown'}.`,
      time: new Date().toISOString(),
      pm: 'System',
    })

    console.log(`SubHub webhook: created ${projectId} for ${project.name}`)

    return NextResponse.json({
      success: true,
      project_id: projectId,
      name: project.name,
      message: `Project ${projectId} created successfully`,
    }, { status: 201 })

  } catch (err: any) {
    console.error('SubHub webhook error:', err)
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 })
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: WEBHOOK_ENABLED ? 'enabled' : 'disabled',
    message: WEBHOOK_ENABLED
      ? 'SubHub webhook is active and accepting project creation events.'
      : 'SubHub webhook is disabled. Set SUBHUB_WEBHOOK_ENABLED=true in environment variables to activate.',
  })
}
