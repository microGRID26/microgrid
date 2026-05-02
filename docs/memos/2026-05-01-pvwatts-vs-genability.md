# PVWatts vs Genability — feasibility memo

**Author:** Atlas (research delegated by Greg)
**Date:** 2026-05-01
**Recipients:** Mark, Zach
**Decision needed:** Replace Genability with NREL PVWatts for production estimates? (Y/N + budget)

---

## TL;DR

**Recommend yes — PVWatts replaces Genability for production estimates with zero ongoing cost and stronger court defensibility.** Effort to integrate: ~3 days of dev. We keep Google Sunroof for the visual roof + shading layer; PVWatts plugs in alongside it as the production model. The one gap PVWatts does NOT close is **consumption** estimation (load profile from utility data) — that's a separate decision and Genability is still the only mainstream option there.

---

## What PVWatts is

NREL's PVWatts is the federally-funded solar production model that every state's interconnection program, every PE stamp, and every NREL System Advisor Model (SAM) run is calibrated against. V8 dropped 2024-ish; current TMY data goes through 2020.

**API:** `GET https://developer.nrel.gov/api/pvwatts/v8.json` (note: NREL is rebranding to NLR — domain moves to `developer.nlr.gov` by 2026-05-29; we should use the new domain in our integration from day 1).

**Required inputs we already have:**
- `system_capacity` (kW DC) — comes from our BOM
- `module_type` (Standard/Premium/Thin film) — from product database
- `losses` (%, default ~14% for system + soiling + wiring) — fixed value
- `array_type` (Fixed Roof / Fixed Open Rack / 1-axis / 2-axis) — from project type
- `tilt` (deg, 0–90) — from roof slope
- `azimuth` (deg, 0–360) — from roof orientation
- `lat`, `lon` — from project address (geocoded)

**Optional inputs that affect accuracy:**
- `dc_ac_ratio` (default 1.2)
- `gcr` (ground coverage ratio, default 0.4)
- `inv_eff` (inverter efficiency, default 96)
- `bifaciality` (0–1, for bifacial modules)
- `albedo` (ground reflectance — single value or 12 monthly)
- `losses` array of 12 monthly irradiance loss values (e.g. snow loading)

**Output:**
- Monthly OR hourly production (kWh)
- Annual total
- Solar resource (kWh/m²/day)

## Cost

**Free.** Requires a `DEMO_KEY`-style API key from https://developer.nrel.gov/signup/ (instant).

**Rate limit:** 1,000 requests/hour, 10,000/day under standard tier. Can request higher with email to NREL. We do nowhere near 10K/day today; this is irrelevant to us.

**No SLA.** Government API, occasional planned downtime. Accept it; cache results in `projects.production_estimate_kwh_yr` so a single API outage doesn't break planset PDFs.

## Court defensibility

This is the load-bearing reason. Per Zach: a defendant solar contractor who said "we used PVWatts" carries weight in front of a judge that "we used Genability" does not. PVWatts is:
- Federally funded (NREL = Department of Energy)
- Open-source (`pvwattsv8` compute module is in NREL's SAM)
- Cited in IEEE / ASES / SEIA white papers as the reference model
- Used by every state-level incentive program for capacity estimation

Genability is a private SaaS that uses proprietary models. Defensible enough for marketing collateral, less so for a deposition.

## Integration plan (3 days)

**Day 1 — backend.**
- Add `getPvWattsEstimate(projectId)` in `~/repos/MicroGRID/lib/external/pvwatts.ts`. Inputs: pull system_capacity, lat, lon, tilt, azimuth, array_type from `projects` row. Output: write `production_estimate_kwh_yr` (annual) + `production_estimate_monthly_json` (12 values) back to the same row.
- Add `pvwatts_estimates` shadow table for raw API response history (audit trail; one row per call).
- Migration: ALTER projects ADD production_estimate_source text DEFAULT 'pvwatts' (so we can tell PVWatts vs Genability vs manual).
- Cron: nightly re-estimate when project.tilt, azimuth, system_capacity, or address changes.

**Day 2 — UI.**
- Planset designer (`components/planset/SheetPV*.tsx`): show "Annual production: 14,210 kWh (PVWatts v8, NREL TMY 2020)" footer.
- Project panel (`components/project/InfoTab.tsx`): show monthly bar chart of estimated production.
- New "Array & Mounting Plane" inspector: per-array tilt/azimuth/area inputs that re-run PVWatts on edit. Today these are global per project; this is the spec from Zach's "UI for array and mounting plane output."

**Day 3 — cutover + Genability deprecation.**
- Add feature flag `PRODUCTION_ESTIMATE_SOURCE=pvwatts|genability` (default genability for backwards compat).
- Backfill all existing projects with PVWatts estimates (one-time job). Compare side-by-side with Genability's stored estimate; flag rows >10% delta for human review.
- Once delta-review settles, flip flag to pvwatts and cancel Genability subscription at next renewal.

## Where Google Sunroof fits

PVWatts does NOT do shading or roof obstacle detection. Google Sunroof does that beautifully but only for the ~80% of US homes Google has photogrammetry on.

**Recommended split:**
- **Google Sunroof:** roof geometry, shading mask, maxArrayKw bound (Solar API). Already integrated.
- **PVWatts:** annual production + monthly production from the array geometry Sunroof gave us.

Sunroof's `solarPotential.maxArrayPanelsCount` and `panelConfig` outputs feed directly into PVWatts as `system_capacity` (panels × wattage / 1000) and `tilt`/`azimuth` (from `roofSegmentSummaries`). The two APIs are complementary, not redundant.

## What this DOESN'T solve — consumption estimates

PVWatts is solar-side only. Genability also provides:
- Tariff / utility rate matching (15K+ US utility rate plans)
- Hourly load profiles (LSEPro / commercial customers)
- Bill estimates pre/post-solar

If we kill Genability outright, we lose all of that. Two options:
1. **Keep a stripped-down Genability subscription** for tariff + rate data only. Cheaper than full plan. ~$X/month (need quote).
2. **Replace tariff data with OpenEI URDB** (https://openei.org/wiki/Utility_Rate_Database) — DOE-funded, free, less complete (~80% utility coverage vs Genability's 95%), no SLA. Defensibility same as PVWatts.

**Recommendation:** Switch production to PVWatts immediately (today's memo). Defer the consumption / tariff decision to a separate evaluation — that's a different risk profile (customer-facing bill estimate accuracy vs production estimate defensibility).

## Risks

- **NREL domain transition** (developer.nrel.gov → developer.nlr.gov by 2026-05-29). Use new domain from day 1; update docs reference.
- **PVWatts has no per-panel granularity.** Single tilt/azimuth/capacity per call. For multi-orientation roofs, we'd loop over arrays (one call per array, sum). 4 arrays = 4 API calls = ~4 sec. Cache.
- **TMY data is a 30-yr average, not actual weather.** Customers occasionally compare PVWatts estimate to "last year's actual sun" — annual variance ±15% is expected. Disclose in customer-facing UI.
- **Default losses = 14%** is conservative-aggressive depending on install quality. We can override with a per-installer factor once we have actuals.

## Action items if Mark says go

1. [Greg] Sign up for NREL API key + add `NREL_API_KEY` to `~/.claude/secrets/.env` and Vercel envs (MG + EDGE)
2. [Atlas] Write `lib/external/pvwatts.ts` + migration for new columns + shadow table
3. [Atlas] Wire planset PDF footer + InfoTab chart
4. [Atlas] Backfill + delta-review job
5. [Greg + Zach] Spot-check 10 known-actuals projects against PVWatts output before flipping the flag
6. [Greg] Cancel Genability production-estimate seat at renewal (keep tariff seat if going Option 1 above)
