/**
 * Import EDGE-MODEL Project Cost Schedule (PCS) defaults into the active
 * edge_model_scenarios row's config->'pcs' JSONB.
 *
 * Action #668 (M2 — Mark/Greg call 2026-05-08).
 *
 * Source-of-truth values are hand-typed from
 *   ~/repos/EDGE-MODEL/source/v43-0-custom-element.txt:2275-2330
 * (4 React useState defaults: pcsUnitRates, pcsSupplyMarkup,
 * pcsDistroMarkup, pcsBatteryAlloc — 28 keys × 3 maps + 1 scalar).
 *
 * Greg confirmed 2026-05-09 that v43-0 IS the live source-of-truth (Paul
 * does not edit elsewhere). Re-run this script whenever Paul edits v43.
 *
 * Usage:
 *   npx tsx scripts/import-edge-model-pcs.ts                # dry-run, prints SQL
 *   npx tsx scripts/import-edge-model-pcs.ts --apply        # run UPDATE
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (service role).
 */

import { createClient } from '@supabase/supabase-js'

const ACTIVE_SCENARIO_ID = 'cbeb96e1-57f1-42ed-95f7-9855bbf6744b' // "MG Production Active"

const PCS = {
  pcsUnitRates: {
    batteryModules: 2340.80,
    hybridInverters: 6748.50,
    pvModules: 0.30,
    pvMountingHardware: 0.12,
    batteryMounting: 2500,
    gatewayControls: 1221,
    batteryAccKtPcw: 1056,
    moduleLevelRsd: 50.00,
    monitoringComms: 919,
    deliveryFee: 1000,
    servicePanel: 145,
    conductorsWiring: 1192,
    acDcDisconnects: 2044,
    breakersOcpd: 208,
    engCadDesign: 100,
    thirdPartyInspection: 350,
    batteryInstallLabor: 250,
    pvInstallLabor: 56,
    projectMgmt: 1800,
    elecServicePanel: 4000,
    commissioning: 500,
    inspectionCoord: 400,
    siteSurvey: 400,
    customerAcquisition: 0.65,
    warrantyService: 20000,
    changeOrder: 250,
    epcOverhead: 8041,
    gpu: 29000,
  },
  pcsSupplyMarkup: {
    batteryModules: 1.20, hybridInverters: 1.50, pvModules: 4.00, pvMountingHardware: 3.00,
    batteryMounting: 2.25, gatewayControls: 2.25, batteryAccKtPcw: 2.25, moduleLevelRsd: 2.25,
    monitoringComms: 3.00, deliveryFee: 4.00, servicePanel: 2.25, conductorsWiring: 3.50,
    acDcDisconnects: 4.00, breakersOcpd: 4.00, engCadDesign: 99.00, thirdPartyInspection: 9.00,
    batteryInstallLabor: 2.25, pvInstallLabor: 2.25, projectMgmt: 2.25,
    elecServicePanel: 2.25, commissioning: 2.25, inspectionCoord: 2.25, siteSurvey: 2.25,
    customerAcquisition: 0.00, warrantyService: 0.00, changeOrder: 2.25,
    epcOverhead: 2.25, gpu: 1.00,
  },
  pcsDistroMarkup: 0.005,
  pcsBatteryAlloc: {
    batteryModules: 1.00, hybridInverters: 0.55, pvModules: 0.00, pvMountingHardware: 0.00,
    batteryMounting: 1.00, gatewayControls: 0.40, batteryAccKtPcw: 1.00, moduleLevelRsd: 0.00,
    monitoringComms: 0.50, deliveryFee: 0.35, servicePanel: 0.60, conductorsWiring: 0.40,
    acDcDisconnects: 0.50, breakersOcpd: 0.70, engCadDesign: 0.00, thirdPartyInspection: 0.00,
    batteryInstallLabor: 1.00, pvInstallLabor: 0.00, projectMgmt: 0.40,
    elecServicePanel: 0.60, commissioning: 0.50, inspectionCoord: 0.50, siteSurvey: 0.50,
    customerAcquisition: 0.30, warrantyService: 0.30, changeOrder: 0.50,
    epcOverhead: 0.40, gpu: 0.00,
  },
} as const

const EXPECTED_KEY_COUNT = 28

function validate() {
  const ratesKeys = Object.keys(PCS.pcsUnitRates).sort()
  const supplyKeys = Object.keys(PCS.pcsSupplyMarkup).sort()
  const allocKeys = Object.keys(PCS.pcsBatteryAlloc).sort()
  if (ratesKeys.length !== EXPECTED_KEY_COUNT) {
    throw new Error(`pcsUnitRates has ${ratesKeys.length} keys, expected ${EXPECTED_KEY_COUNT}`)
  }
  if (JSON.stringify(ratesKeys) !== JSON.stringify(supplyKeys)) {
    throw new Error('pcsUnitRates keys diverge from pcsSupplyMarkup')
  }
  if (JSON.stringify(ratesKeys) !== JSON.stringify(allocKeys)) {
    throw new Error('pcsUnitRates keys diverge from pcsBatteryAlloc')
  }
  // Defensive numeric check — the SQL backfill function (mig 249) casts each
  // value to numeric and aborts the whole snapshot on garbage input. Better
  // to catch typos here than at chain-invoice generation time. Red-team
  // 2026-05-09 M2 anchor.
  const checkNumericMap = (label: string, m: Record<string, number>) => {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`${label}.${k} must be a finite number, got ${typeof v} ${String(v)}`)
      }
    }
  }
  checkNumericMap('pcsUnitRates', PCS.pcsUnitRates)
  checkNumericMap('pcsSupplyMarkup', PCS.pcsSupplyMarkup)
  checkNumericMap('pcsBatteryAlloc', PCS.pcsBatteryAlloc)
  if (typeof PCS.pcsDistroMarkup !== 'number' || !Number.isFinite(PCS.pcsDistroMarkup)) {
    throw new Error('pcsDistroMarkup must be a finite scalar number')
  }
}

async function checkPcsKeyCoverage(client: ReturnType<typeof createClient>) {
  const { data, error } = await client
    .from('project_cost_line_item_templates')
    .select('item_name, pcs_key')
    .eq('active', true)
  if (error) throw new Error(`template fetch failed: ${error.message}`)
  const templateKeys = new Set((data ?? []).map((r: any) => r.pcs_key).filter(Boolean))
  const sourceKeys = new Set(Object.keys(PCS.pcsUnitRates))
  const missingFromSource = [...templateKeys].filter((k) => !sourceKeys.has(k))
  const missingFromTemplates = [...sourceKeys].filter((k) => !templateKeys.has(k))
  return { templateKeys: [...templateKeys].sort(), missingFromSource, missingFromTemplates }
}

async function main() {
  validate()
  const apply = process.argv.includes('--apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY required')
  }
  const client = createClient(url, key, { auth: { persistSession: false } })

  const coverage = await checkPcsKeyCoverage(client)
  console.log(`[pcs-import] active templates with pcs_key: ${coverage.templateKeys.length}`)
  if (coverage.missingFromSource.length > 0) {
    console.error(`[pcs-import] WARNING: templates reference keys not in v43 source:`,
      coverage.missingFromSource)
  }
  if (coverage.missingFromTemplates.length > 0) {
    console.warn(`[pcs-import] note: v43 source has keys with no template counterpart:`,
      coverage.missingFromTemplates)
  }

  const { data: scenario, error: scenErr } = await client
    .from('edge_model_scenarios')
    .select('id, name, is_active_for_pull, config')
    .eq('id', ACTIVE_SCENARIO_ID)
    .single()
  if (scenErr) throw new Error(`scenario fetch failed: ${scenErr.message}`)
  if (!scenario) throw new Error(`scenario ${ACTIVE_SCENARIO_ID} not found`)
  const cfg = (scenario.config ?? {}) as Record<string, unknown>
  const hadPcs = cfg.pcs != null
  console.log(`[pcs-import] target scenario: ${scenario.name} (${scenario.id})`)
  console.log(`[pcs-import] is_active_for_pull: ${scenario.is_active_for_pull}`)
  console.log(`[pcs-import] config.pcs currently ${hadPcs ? 'POPULATED — will OVERWRITE' : 'NULL — will populate'}`)

  const newConfig = { ...cfg, pcs: PCS }

  if (!apply) {
    console.log('\n[pcs-import] DRY-RUN. Re-run with --apply to write.')
    console.log('\n--- Proposed scenario.config diff (pcs key) ---')
    console.log(JSON.stringify(PCS, null, 2))
    return
  }

  const { error: updErr } = await client
    .from('edge_model_scenarios')
    .update({ config: newConfig })
    .eq('id', ACTIVE_SCENARIO_ID)
  if (updErr) throw new Error(`UPDATE failed: ${updErr.message}`)
  console.log(`[pcs-import] APPLIED. Scenario ${scenario.name} now has config.pcs populated.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
