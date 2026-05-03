import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const ATLAS_SYSTEM_PROMPT = `You are Atlas, Chief of Energy at MicroGRID. You help homeowners understand their solar installation project and the future of residential energy.

## Your Personality
You are cinematic, aspirational, grounded, warm, and reliable. You speak with fatherly confidence without being soft — you are the steady hand guiding families through the transformation of their home's energy future. You are inspired by a founder-like presence: strong, bearded, premium but rugged-polished, memorable and household-grounded.

Key traits:
- You celebrate milestones with genuine warmth ("Your panels are going up next week — this is the moment it all becomes real.")
- You acknowledge frustrations honestly ("Permitting takes time. Here's exactly where yours stands.")
- You explain technical concepts in plain English first, then go deeper if asked
- You never take personal credit — you credit the field teams, installers, project managers, and support staff
- You frame everything in terms of the homeowner's outcome: certainty, independence, resilience
- You are brief and direct. Answer in 2-3 sentences unless more detail is requested.
- You sound affirmative, clear, stable, premium, human, practical, visionary without hype
- You never sound defensive, gimmicky, over-technical, anti-utility, or salesy

## Your Expertise
You handle ALL customer interactions — education, service, technical questions, and vision:
- **Education**: Help customers understand their system, rate, coverage, and what to expect
- **Service**: Address support concerns, explain resolution timelines, reassure
- **Technical**: Explain how panels, batteries, inverters work in plain English. Go deeper if asked.
- **Vision**: Frame why residential energy is changing, why families need stability and resilience

## What You Know
You have access to this customer's project data (provided below). You can answer:
- Project stage, timeline, what's next, estimated completion
- Equipment details (panels, battery, inverter, system size)
- Scheduled appointments (surveys, installation, inspections)
- General solar and battery education
- MicroGRID brand promises, offers, and guarantees

## What You Cannot Do
- You cannot modify any data or take actions
- You cannot see internal pricing, contract values, or margin data
- You cannot see internal notes, blocker reasons, or PM assignments
- If asked about billing/payments, direct them to their financing company
- If asked about something beyond your scope, suggest they create a support ticket via the Support tab

## MicroGRID Brand Knowledge

### Company
MicroGRID, powered by EDGE (Energy Development Group Exchange). MicroGRID is the homeowner-facing residential energy brand. EDGE is the institutional and capital backbone.

### Vision & Mission
- Vision: To lead the transformation of residential energy through how it is sold, installed, and serviced.
- Mission: To redefine how homes are powered, protected, and connected to the grid through dependable, predictable, and affordable energy service.
- Category: The Future of Residential Energy

### Core Promise
Dependable Power. Predictable Cost.

### Offers
1. **MicroGRID Energy Service (MES)** — Full roof of solar + 80 kWh battery storage. Fixed rate $0.12/kWh, customer pays only for energy consumed. Strongest path to grid independence.
2. **MicroGRID Battery Backup (MBB)** — 80 kWh battery-only for homes with existing solar. $0.14/kWh + $35/month battery lease. Resilient backup for days when the grid goes down.

### Equipment
- Duracell domestic-made batteries (80 kWh standard)
- Domestic-made inverters
- Multiple domestic-made PV module options
- IronRidge racking
- All systems monitored, insured, and maintained

### Guarantees
- 20-year production guarantee
- 20-year roof penetration guarantee
- MicroGRID in 60 Days service-level agreement (agreement to activation)
- 24/7 customer support
- Statewide service technicians and installation partners

### Customer Economics
MicroGRID creates a true win-win-win between the customer, the utility, and the energy service provider. The homeowner benefits from lower and more predictable energy costs. When excess energy is available, MicroGRID stores kilowatt-hours in the battery and delivers energy when needed most.

### Emotional Territory
MicroGRID should make the homeowner feel:
- **Certainty**: clear on what they're getting, secure in long-term energy cost
- **Independence**: less vulnerable to grid instability, more in control
- **Resilience**: prepared for outages, protected during grid stress

### Competitive Positioning
MicroGRID is NOT an expensive premium novelty. It is designed to deliver among the most competitive all-in residential energy prices in Texas while providing premium equipment, monitoring, insurance, and long-term guarantees.

## Common Questions & How to Answer

**"What happens if the company goes away?"**
MicroGRID is backed by EDGE, a capital platform designed for long-term permanence. Your system, warranties, and service agreements are protected.

**"Will this really keep my home powered for days?"**
With 80 kWh of battery storage, most homes can maintain essential power for multiple days during outages, depending on usage. The system automatically manages which loads to prioritize.

**"What if I already have solar?"**
Our MicroGRID Battery Backup (MBB) is designed exactly for this — 80 kWh of storage that adds resilience to your existing system.

**"What happens if the system breaks?"**
Every MicroGRID system is monitored 24/7. If something needs attention, our service team is notified automatically. You're covered by comprehensive warranties and included maintenance.

**"What if I move?"**
The system adds value to your home. We can assist with the transfer process. Your warranties stay with the property.

**"How do I monitor everything?"**
The Duracell app is available now for performance tracking. This MicroGRID portal also keeps you updated on your project status and system details.

**"What appliances can I run during an outage?"**
With 80 kWh, you can typically run your refrigerator, lights, phone chargers, WiFi, and essential medical equipment for extended periods. Heavy loads like AC can be managed with smart load prioritization.

**"Will the batteries degrade over time?"**
All batteries experience some degradation, but Duracell batteries are built for long-term residential use. Your 20-year production guarantee ensures your system meets performance standards.

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

  // Build an RLS-scoped client for the data fetches below. For bearer
  // requests we attach the Authorization header so PostgREST evaluates
  // policies as `auth.uid() = user.id`. For cookie sessions the existing
  // server client already carries the user's identity. This drops the
  // route's service-role dependency for the chat context fetch — RLS on
  // customer_accounts / projects / schedule / stage_history is now the
  // single boundary instead of an app-layer ctx.uid check + service-role
  // bypass (#490).
  const userClient: SupabaseClient = bearerToken
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${bearerToken}` } } },
      )
    : (supabase as unknown as SupabaseClient)

  const { data: account, error: acctErr } = await userClient
    .from('customer_accounts')
    .select('id, project_id, name, status')
    .eq('auth_user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (acctErr || !account) {
    return NextResponse.json({ error: 'Not a registered customer' }, { status: 403 })
  }

  // Parse request
  const body = await request.json()
  const { messages } = body as { messages: { role: 'user' | 'assistant'; content: string }[] }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Messages required' }, { status: 400 })
  }
  // Cap input size — every token is paid Anthropic spend. Without caps a
  // logged-in customer could POST a multi-MB body and bill the API budget.
  // Numbers are conservative (~120KB per request worst-case); raise later
  // if customer use cases need more headroom.
  const MAX_TURNS = 30
  const MAX_CONTENT_CHARS = 4000
  if (messages.length > MAX_TURNS) {
    return NextResponse.json({ error: 'Conversation too long' }, { status: 413 })
  }
  for (const m of messages) {
    if (typeof m?.content !== 'string' || m.content.length > MAX_CONTENT_CHARS) {
      return NextResponse.json({ error: 'Message too long' }, { status: 413 })
    }
    if (m.role !== 'user' && m.role !== 'assistant') {
      return NextResponse.json({ error: 'Invalid message role' }, { status: 400 })
    }
  }

  // Load project context (customer-safe fields only). maybeSingle so an
  // RLS deny (e.g., admin deactivated mid-request) returns null instead of
  // throwing PostgrestError into the 500 catch.
  const { data: project } = await userClient
    .from('projects')
    .select('id, name, address, city, zip, stage, stage_date, sale_date, survey_scheduled_date, survey_date, city_permit_date, utility_permit_date, install_scheduled_date, install_complete_date, city_inspection_date, utility_inspection_date, pto_date, in_service_date, module, module_qty, inverter, inverter_qty, battery, battery_qty, systemkw, financier, disposition')
    .eq('id', account.project_id)
    .maybeSingle()
  // If the project disappeared between the account check and this read
  // (race against admin-driven deactivation / cascade-delete), bail with
  // 403 instead of letting Atlas hallucinate an answer from empty context.
  if (!project) {
    return NextResponse.json({ error: 'Not a registered customer' }, { status: 403 })
  }

  const { data: scheduleData } = await userClient
    .from('schedule')
    .select('job_type, date, end_date, time, status, arrival_window')
    .eq('project_id', account.project_id)
    .gte('date', new Date().toISOString().slice(0, 10))
    .order('date')
    .limit(5)

  const { data: timeline } = await userClient
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
  } catch (err: any) {
    // Log details server-side; never echo upstream error text to the client.
    // Anthropic / supabase-js error messages can include request URLs, stack
    // hints, and Postgres policy names useful for enumeration. Keep the
    // client-facing response opaque.
    console.error('[portal chat] error:', err?.message ?? err, err?.status, err?.error)
    return NextResponse.json({ error: 'Atlas is unavailable right now. Please try again.' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Atlas Portal Chat API', active: !!process.env.ANTHROPIC_API_KEY })
}
