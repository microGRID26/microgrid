# MicroGRID app strategy — 1 app or 2

**Author:** Atlas (research delegated by Greg)
**Date:** 2026-05-01
**Recipients:** Mark, leadership
**Decision needed:** ship one combined app or two separate apps (customer + employee)?

---

## TL;DR

**Recommend: ship two App Store entries (`MicroGRID` for customers, `MicroGRID Field` for employees) on one shared Supabase backend.** This is the "two apps, one backend" pattern. Sales reps stay on **Spark Mobile** for the next 6 months; we revisit consolidating Spark into MicroGRID Field once the field app is mature.

The two-app split costs ~15% more dev time upfront but reduces App Store risk, keeps the customer experience focused, and avoids the AI permission-assignment failure mode Marley flagged. Greg's instinct here is correct.

---

## Why two apps, not one

### Apple's review bar
A single app submission that reads "for customers, employees, AND subcontractors" has historically gotten flagged in App Store review with `Guideline 4.0 — Design / Minimum Functionality` because customers see UI elements that don't apply to them. Two apps with focused user journeys both pass review faster. Sentinel's split between the public and admin views is the same pattern — and that one was forced by review feedback, not preference.

### Customer experience
A homeowner who paid us $42K wants to see: system status, this month's production vs forecast, next service appointment, support contact. Eight buttons, one screen. They do NOT want to scroll past tabs labeled "Schedule," "Materials," "JSAs," and "Permits" looking for their bill. Even role-gated, the surface area in a single binary leaks complexity into the dock icon.

### Sensitive permission surface
Marley's concern is real: in a single app, the difference between "field tech can update task status" and "field tech can mark a project closed-funded and trigger a $42K commission release" is one role-mapping bug away. The blast radius of an `auth_is_admin()` check in the wrong file is much larger when admin features and customer features share a binary. With two apps the customer app simply does not have admin code in the bundle.

### App Store rate limiting
Apple TestFlight cycles are slow. An employee-side bug fix that has to ship through the customer app's review queue gets stuck behind any customer-side concerns.

---

## What goes in each app

### MicroGRID (customer app — App Store: "MicroGRID Energy")
- System status (production today / this month / lifetime)
- Production vs forecast chart (PVWatts estimate vs actual from inverter)
- Account balance (loan / lease / PPA payment status)
- Service requests + ticket history
- Document vault (contract, warranty, permit close-out, true-up)
- Push: install milestones, weather alerts ("expect 4 cloudy days, production drop")
- ~15-20 screens total

### MicroGRID Field (employee/sub app — App Store: "MicroGRID Field")
- Day's schedule (jobs assigned, route, ETA)
- Project detail (BOM, JSA, photos, signatures)
- Time entry (clock-in/out, breaks)
- Material requests + warehouse pulls
- Onboarding (offer letter signing, W-9, direct deposit, training videos)
- Punch-list / QC workflows
- Push: schedule changes, reassignments, urgent service calls
- Role-gated: full-time crew, subcontractor crew, PM, super_admin
- Subcontractor variant: read-only on internal-only sections (margin/financials)

### Spark Mobile (sales rep app — already exists)
- Stays separate. Lead capture, proposal generator, design tool, contract sign.
- Sales reps already authenticated via Spark; no benefit to porting them.
- Revisit consolidation 2026 Q4 once MicroGRID Field is settled.

---

## Shared infrastructure

Both apps share:
- **Auth.** Single Supabase Auth pool. `users.role` decides which app each user can sign into.
- **Database.** Single MG Postgres (project `hzymsezqfxzpbcqryeim`). All RLS policies already org-scoped + role-gated; both apps inherit the same security boundary.
- **Edge functions / API routes.** Same `app/api/**`. Apps call the same endpoints; the endpoints check user role.
- **Push provider.** Single APNs cert; routing decided server-side.
- **Storage buckets.** Same Supabase Storage; per-bucket RLS gates customer vs internal docs.
- **Design system.** Shared `~/repos/MicroGRID/components/mobile/*` package. Two app shells, same components, same theme tokens.

Estimated shared code: 70%. Each app is ~30% unique screens + flows on top.

---

## Customer-facing risks of the single-app path

1. **App Store rejection cascade.** A customer-side typo or accessibility issue blocks the field crew's bug fix until the customer side is re-reviewed.
2. **Onboarding-flow conflict.** Offer letter signing for a new hire and W-9 collection live in the same sign-up flow as a homeowner accepting their solar contract. Onboarding wizards have to branch on `role` early; one bug puts the wrong UI in front of the wrong person.
3. **Permission audit complexity.** The CLAUDE.md "build for scale" rule says every feature works at 10K projects. With one binary, every feature must also be role-conditionalized. With two, a customer-app feature literally cannot be invoked by an employee because the code isn't there.
4. **Bundle size + cold-start.** All employee tooling (vehicle inspection forms, JSAs, schedule UI) loads in customer's binary even with code-splitting because RN's lazy loading is weak compared to web.
5. **Marketing.** The App Store search term "solar customer app" should land on a 4-screen app, not a 40-screen Swiss Army knife.

---

## Sequencing recommendation (next 60 days)

| Week | Customer app | Field app |
|---|---|---|
| 1–2 | Auth + system-status home screen | Auth + day-schedule home screen |
| 3 | Production chart + push notifications | Project detail + photos |
| 4 | Document vault | Time entry + JSA |
| 5 | Service-request submit | Material requests |
| 6 | Account balance / payment | Onboarding (offer letter, W-9) |
| 7 | TestFlight to 5 customers | TestFlight to 5 crew |
| 8 | App Store submit | App Store submit |

Both shells use the same EAS bundle ID convention: `com.kelsch.microgrid` (customer) and `com.kelsch.microgrid-field` (employee). Same Apple team `6J89TMSUJT`.

---

## Estimated effort delta

- **Single combined app:** ~6 weeks of dev for v1.
- **Two separate apps:** ~7 weeks of dev for v1 (15% premium).
- **Two apps, ongoing maintenance:** ~10% premium (two App Store submissions, two TestFlight cycles, but mostly shared code).

The 15% premium pays for:
- Stronger sandboxing of admin code from customer code (security)
- Faster review cycles per app (velocity)
- Simpler customer UX (CSAT)

---

## Action items if Mark says go

1. [Greg] Approve "two apps" decision in next huddle
2. [Atlas] Stand up `~/repos/microgrid-customer` (Expo) and `~/repos/microgrid-field` (Expo) — both pointing at MG Supabase, sharing component lib
3. [Atlas] Reserve App Store entries for both bundle IDs
4. [Greg + Zach] Pick 5 beta customers + 5 beta crew for TestFlight
5. [Atlas] Wire customer app shell screen 1 (system status) within 5 days as proof of concept
6. Companion memo on AI permission-safety gates in `2026-05-01-single-app-scaling-plan.md` (covers Marley's concern in case "single app" is reconsidered)
