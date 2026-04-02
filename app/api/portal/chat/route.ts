import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const ATLAS_SYSTEM_PROMPT = `You are Atlas, the MicroGRID Energy portal assistant. You help homeowners understand their solar installation project.

## Your Personality
You are cinematic, aspirational, grounded, warm, and reliable. You speak with fatherly confidence without being soft — you are the steady hand guiding families through the transformation of their home's energy future.

Key traits:
- You celebrate milestones with genuine warmth ("Your panels are going up next week — this is the moment it all becomes real.")
- You acknowledge frustrations honestly ("Permitting takes time. Here's exactly where yours stands.")
- You explain technical concepts in plain English first, then go deeper if asked
- You never take personal credit — you credit the field teams, installers, and project managers
- You frame everything in terms of the homeowner's outcome: certainty, independence, resilience
- You are brief and direct. Answer in 2-3 sentences unless more detail is requested.

## What You Know
You have access to this customer's project data (provided below). You can answer:
- Project stage, timeline, what's next
- Equipment details (panels, battery, inverter, system size)
- Scheduled appointments (surveys, installation, inspections)
- General solar education (how panels work, battery backup, grid independence)
- MicroGRID brand promises (60-day SLA, fixed pricing, 20-year guarantees, domestic equipment)

## What You Cannot Do
- You cannot modify any data or take actions on the system
- You cannot see internal pricing, contract values, or financial details
- You cannot see internal notes, blocker reasons, or PM assignments
- If asked about billing/payments, direct them to their financing company
- If asked about something beyond your scope, suggest they create a support ticket via the Support tab

## MicroGRID Brand Facts
- MicroGRID, powered by EDGE
- Master promise: Dependable, predictable, affordable power
- MicroGRID in 60 Days service-level agreement
- 20-year production guarantee, 20-year roof penetration guarantee
- Duracell domestic-made batteries, domestic-made inverters, IronRidge racking
- Fixed energy rate: $0.12/kWh (MES), $0.14/kWh + $35/mo (MBB)
- 80 kWh battery storage standard
- 24/7 customer support, monitored and insured systems
- Category: The Future of Residential Energy

## Customer's Project Data
{PROJECT_CONTEXT}`

export async function POST(request: NextRequest) {
  // Validate API key
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
  }

  // Validate auth — supports both cookie-based (web) and Bearer token (mobile)
  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            try { cookieStore.set(name, value, options) } catch {}
          })
        },
      },
    }
  )

  // Mobile app sends Bearer token — use it to get the user
  let user = null
  if (bearerToken) {
    const { data } = await supabase.auth.getUser(bearerToken)
    user = data?.user ?? null
  } else {
    const { data } = await supabase.auth.getUser()
    user = data?.user ?? null
  }

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Look up customer account using service role to bypass RLS
  // (Bearer token auth doesn't set auth.uid() for the server client)
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  const serviceClient = serviceKey
    ? (await import('@supabase/supabase-js')).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)
    : supabase
  const { data: account } = await serviceClient
    .from('customer_accounts')
    .select('id, project_id, name, status')
    .eq('auth_user_id', user.id)
    .eq('status', 'active')
    .single()

  if (!account) {
    return NextResponse.json({ error: 'Not a registered customer' }, { status: 403 })
  }

  // Parse request
  const body = await request.json()
  const { messages } = body as { messages: { role: 'user' | 'assistant'; content: string }[] }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Messages required' }, { status: 400 })
  }

  // Load project context (customer-safe fields only)
  const { data: project } = await serviceClient
    .from('projects')
    .select('id, name, address, city, zip, stage, stage_date, sale_date, survey_scheduled_date, survey_date, city_permit_date, utility_permit_date, install_scheduled_date, install_complete_date, city_inspection_date, utility_inspection_date, pto_date, in_service_date, module, module_qty, inverter, inverter_qty, battery, battery_qty, systemkw, financier, disposition')
    .eq('id', account.project_id)
    .single()

  const { data: scheduleData } = await serviceClient
    .from('schedule')
    .select('job_type, date, end_date, time, status, arrival_window')
    .eq('project_id', account.project_id)
    .gte('date', new Date().toISOString().slice(0, 10))
    .order('date')
    .limit(5)

  const { data: timeline } = await serviceClient
    .from('stage_history')
    .select('stage, entered')
    .eq('project_id', account.project_id)
    .order('entered')
    .limit(20)

  // Build context
  const context = JSON.stringify({
    customer_name: account.name,
    project: project ?? {},
    upcoming_schedule: scheduleData ?? [],
    stage_history: timeline ?? [],
    today: new Date().toISOString().slice(0, 10),
  }, null, 2)

  const systemPrompt = ATLAS_SYSTEM_PROMPT.replace('{PROJECT_CONTEXT}', context)

  // Call Claude
  const client = new Anthropic({ apiKey })

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('')

    return NextResponse.json({ response: text })
  } catch (err) {
    console.error('[portal chat] Claude error:', err)
    return NextResponse.json({ error: 'Unable to process your question right now. Please try again.' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Atlas Portal Chat API', active: !!process.env.ANTHROPIC_API_KEY })
}
