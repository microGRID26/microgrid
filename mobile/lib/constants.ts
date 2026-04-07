// Customer-facing labels — no internal jargon

export const STAGE_ORDER = ['evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete']

export const STAGE_LABELS: Record<string, string> = {
  evaluation: 'Getting Started',
  survey: 'Site Survey',
  design: 'System Design',
  permit: 'Permitting',
  install: 'Installation',
  inspection: 'Final Inspection',
  complete: 'System Active',
}

export const STAGE_DESCRIPTIONS: Record<string, string> = {
  evaluation: 'We\'re reviewing your home and preparing for your site survey.',
  survey: 'Our team is surveying your property to design the optimal system.',
  design: 'Engineers are designing your custom solar and storage system.',
  permit: 'Your permits are being processed with the city and utility.',
  install: 'Your solar panels and battery system are being installed.',
  inspection: 'City and utility inspectors are verifying your installation.',
  complete: 'Your system is live and generating clean energy.',
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  survey: 'Site Survey',
  install: 'Installation',
  inspection: 'Inspection',
  service: 'Service Visit',
}

export const TICKET_CATEGORIES = [
  { value: 'service', label: 'Service Issue' },
  { value: 'billing', label: 'Billing Question' },
  { value: 'installation', label: 'Installation Question' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'other', label: 'Other' },
]

// Tasks that belong to each stage — mapped from task_state.task_id
export const STAGE_TASKS: Record<string, { id: string; label: string }[]> = {
  evaluation: [
    { id: 'welcome_call', label: 'Welcome Call Completed' },
    { id: 'credit_check', label: 'Credit Check Approved' },
    { id: 'contract_signed', label: 'Contract Signed' },
    { id: 'ntp_submitted', label: 'NTP Submitted' },
  ],
  survey: [
    { id: 'survey_scheduled', label: 'Survey Scheduled' },
    { id: 'survey_complete', label: 'Site Survey Complete' },
    { id: 'photos_uploaded', label: 'Photos Uploaded' },
  ],
  design: [
    { id: 'design_started', label: 'Design Started' },
    { id: 'design_review', label: 'Engineering Review' },
    { id: 'design_approved', label: 'Design Approved' },
    { id: 'planset_complete', label: 'Planset Finalized' },
  ],
  permit: [
    { id: 'city_permit_submitted', label: 'City Permit Submitted' },
    { id: 'city_permit_approved', label: 'City Permit Approved' },
    { id: 'utility_permit_submitted', label: 'Utility Permit Submitted' },
    { id: 'utility_permit_approved', label: 'Utility Permit Approved' },
    { id: 'hoa_approved', label: 'HOA Approval' },
  ],
  install: [
    { id: 'equipment_ordered', label: 'Equipment Ordered' },
    { id: 'equipment_delivered', label: 'Equipment Delivered' },
    { id: 'install_scheduled', label: 'Installation Scheduled' },
    { id: 'install_complete', label: 'Installation Complete' },
  ],
  inspection: [
    { id: 'city_inspection_scheduled', label: 'City Inspection Scheduled' },
    { id: 'city_inspection_passed', label: 'City Inspection Passed' },
    { id: 'utility_inspection_scheduled', label: 'Utility Inspection Scheduled' },
    { id: 'utility_inspection_passed', label: 'Utility Inspection Passed' },
    { id: 'pto_submitted', label: 'PTO Submitted' },
    { id: 'pto_granted', label: 'Permission to Operate' },
  ],
  complete: [
    { id: 'system_activated', label: 'System Activated' },
    { id: 'monitoring_live', label: 'Monitoring Live' },
  ],
}

// SLA thresholds per stage (estimated business days)
export const STAGE_SLA_DAYS: Record<string, number> = {
  evaluation: 5,
  survey: 7,
  design: 10,
  permit: 15,
  install: 5,
  inspection: 10,
  complete: 0,
}

export const DOCUMENT_CATEGORIES = ['Design', 'Permit', 'Contract', 'Inspection', 'Other'] as const

// ── Onboarding Journey Milestones (Ellie — Director of Education) ──────────

export interface OnboardingMilestone {
  day: number
  title: string
  body: string
  icon: string // Feather icon name
}

export const ONBOARDING_MILESTONES: OnboardingMilestone[] = [
  {
    day: 1,
    title: 'Welcome to MicroGRID',
    icon: 'home',
    body: `Hey there! I'm Ellie, and I'll be your guide over the next 60 days as your solar project comes to life. Here's what you need to know right now:\n\nYour project manager has already been assigned — you can message them anytime from the Messages tab. This app is your command center: you'll see every milestone, every update, and every step of the journey right here.\n\nNo need to chase anyone down. We come to you.`,
  },
  {
    day: 3,
    title: 'Understanding Your System',
    icon: 'sun',
    body: `Let's talk about what's going on your roof. Your system was custom-designed based on your home's energy usage, roof layout, and local sun exposure.\n\nYou'll have solar panels that convert sunlight into electricity, an inverter that makes it usable for your home, and if your plan includes battery storage, a backup system that keeps your lights on when the grid goes down.\n\nCheck the "Your System" section on the home screen to see your exact equipment specs.`,
  },
  {
    day: 7,
    title: 'Your Energy Rate',
    icon: 'dollar-sign',
    body: `Here's the part most people love: your energy rate is $0.12 per kWh. That's it. No escalators — it won't creep up 3% every year like your utility bill does. No hidden fees. No surprises.\n\nWhile your neighbors' rates climb year after year, yours stays locked in. Over 25 years, that difference really adds up. Think of it as a price freeze on your electricity.`,
  },
  {
    day: 14,
    title: 'Site Survey Day',
    icon: 'clipboard',
    body: `Your site survey is coming up! Here's what to expect:\n\nA trained surveyor will visit your home to measure your roof, check your electrical panel, assess shading, and take detailed photos. The visit usually takes about 1-2 hours.\n\nHow to prepare:\n- Make sure someone 18+ is home\n- Clear access to your electrical panel\n- Have your latest utility bill handy (just in case)\n- If you have attic access, leave it accessible\n\nYou'll get a confirmation with your exact date and arrival window in the Schedule tab.`,
  },
  {
    day: 21,
    title: 'Your Design is Being Built',
    icon: 'edit-3',
    body: `Right now, our engineering team is designing your custom system. This isn't a cookie-cutter layout — they're optimizing panel placement for maximum energy production on your specific roof.\n\nThey're factoring in:\n- Roof pitch and orientation\n- Shade analysis throughout the day\n- Local building codes\n- Your energy consumption patterns\n\nOnce the design is finalized, it goes into a professional planset that gets submitted for permits. This is one of the most important steps — getting it right means a smooth installation.`,
  },
  {
    day: 30,
    title: 'Permit Submitted',
    icon: 'file-text',
    body: `Your permit package has been submitted to your local Authority Having Jurisdiction (AHJ) — that's the city or county building department.\n\nPermit timelines vary by jurisdiction. Some cities approve in a few days, others take 2-4 weeks. We handle all the paperwork and follow-ups, so you don't have to sit on hold with the planning department.\n\nWe also submit your utility interconnection application around the same time, which is what allows your system to connect to the grid.\n\nYou'll see updates in your timeline as each permit clears.`,
  },
  {
    day: 45,
    title: 'Installation Week',
    icon: 'tool',
    body: `It's almost here! Your installation is coming up, and here's what to know:\n\nPreparation checklist:\n- Clear any items from around your electrical panel\n- If roof-mounted, ensure driveway access for equipment delivery\n- Expect some noise — we're building your power plant!\n- Someone 18+ should be available at the start\n\nThe crew will typically be on-site for 1-2 days depending on system size. They'll mount the panels, run the wiring, install your inverter and battery, and connect everything to your electrical panel.\n\nYou'll be amazed how fast it comes together.`,
  },
  {
    day: 55,
    title: 'Inspection & Activation',
    icon: 'check-square',
    body: `You're in the home stretch! After installation, two inspections need to happen:\n\n1. City inspection — a building inspector verifies everything meets code\n2. Utility inspection — your utility confirms the interconnection is safe\n\nOnce both pass, we submit for Permission to Operate (PTO). This is the official green light from your utility that says "flip the switch."\n\nPTO timelines vary by utility — some are same-day, others take 1-2 weeks. We'll keep you posted every step of the way.`,
  },
  {
    day: 60,
    title: "You're Solar!",
    icon: 'zap',
    body: `Congratulations — your system is LIVE! You're now generating clean energy from your own roof.\n\nHere's what happens from here:\n- Monitor your production in real-time through this app\n- Your first energy statement will arrive next month\n- Your warranty coverage is active (check the Warranty tab for details)\n\nOne more thing: know someone who'd love to go solar too? Every referral you send earns you a bonus. Head to the Refer tab to share the love.\n\nIt's been a pleasure guiding you through this journey. Welcome to the MicroGRID family!`,
  },
]

export const ATLAS_SUGGESTIONS = [
  'What stage is my project in?',
  'When is my installation?',
  'What equipment is being installed?',
  'How does battery backup work?',
  'What happens after installation?',
  'Tell me about the 60-day guarantee',
]
