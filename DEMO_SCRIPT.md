# Mark + Zach Demo — Customer Mobile App

**Date:** 2026-04-08
**Build:** TestFlight Internal 1.0.0 (15) — install via TestFlight invite (Internal Testing track, no Apple review)

## Login credentials (each demoer logs in on their own phone)

| Person | Email | Project |
|---|---|---|
| **Greg** | `greg@gomicrogridenergy.com` | PROJ-DEMO-GREG (14.4 kW, $52,800) |
| **Mark** | `iambench@gmail.com` | PROJ-DEMO-MARK (21.6 kW, $78,400 — biggest system) |
| **Zach** | `hll.zch@gmail.com` | PROJ-DEMO-ZACH (12.8 kW, $46,800) |
| **Heidi** | `heidiguev213@yahoo.com` | PROJ-DEMO-HEIDI (17.6 kW, $64,200) |

**Note:** These emails are what they type into the in-app OTP login (Supabase sends a 6-digit code there). They're independent from each person's Apple ID for TestFlight install.

**Login flow:** Open the app → enter email → tap Continue → check inbox for 6-digit code from Supabase → enter code → land on Home tab.

The auth trigger automatically links each customer_account row to their Supabase auth user on first OTP login — no manual claim required.

## What's pre-seeded for each demoer

- **Project:** in `inspection` stage, install complete in March, awaiting utility PTO
- **Messages:** 7 PM↔customer messages, last one **unread** (drives the badge)
- **Billing:** 3 monthly statements ($0.12/kWh), 2 paid + 1 due, 1 saved card with autopay
- **Payments:** 2 historical payments succeeded
- **Referrals:** Greg=2, Mark=3, Zach=1 — varied statuses (paid, signed, contacted)
- **Tickets:** 2 portal tickets each (Greg, Mark) and 1 (Zach)
- **Warranty:** 3 equipment warranties each (panels, inverter, battery)
- **Documents:** 4 project files each (contract, design, permit, photo)
- **Tasks:** 17 task states each (15 complete, 1 in progress, 1 not ready) — drives stage drill-down
- **Timeline:** 6 stage history entries — drives the journey timeline

## 10-minute walkthrough

### 1. Login (60 sec)
- "Enter your email" → email → 6-digit code → in
- **Talking point:** "Passwordless OTP login. No password to forget. Customers love this — it's how Square, Cash App, Robinhood all work."

### 2. Home tab (90 sec)
- Land on Home → see project name + stage card + system size + install date
- Tap the stage card → drill-down to sub-tasks with checkboxes and SLA estimates
- **Talking point:** "Every customer can see exactly where they are in the pipeline. No more 'I haven't heard anything in 2 weeks' calls. The transparency cuts support volume by ~60% based on industry benchmarks."

### 3. Messages (2 min) ⭐ THE SHOWPIECE
- Tap **Messages** tab → see PM↔customer thread → unread badge already lit
- Show 7 messages, mix of PM, system, customer
- **Live mic-drop option:** Have a second device with the CRM open at `/tickets` or `/queue` for PROJ-DEMO-MARK. Send a message from CRM side. Watch it appear on Mark's phone within 1-2 seconds via Supabase Realtime.
- **Talking point:** "Real-time bidirectional. PM types in CRM, customer sees it instantly. No SMS, no email lag. Same channel they live in for everything else."

### 4. Energy tab (60 sec)
- Tap **Energy** → system overview (21.6 kW for Mark), environmental impact (CO2 offset, trees equivalent), monthly production chart placeholder
- **Talking point for Mark:** "Calculated estimates today — 'awaiting monitoring connection' badge — but the second we wire up Duracell's API, this lights up with real production data. The customer sees their solar working in real time."

### 5. Billing tab (90 sec)
- Tap **Billing** → 3 monthly statements at $0.12/kWh → tap one to expand → see kWh consumed, due date, paid status
- Tap **Payment Methods** → saved Visa, autopay enabled
- **Talking point for Mark:** "Stripe-ready. The buttons say 'coming soon' today but the data layer is fully wired — flip a key, payments are live. Recurring autopay, save-the-card, transaction history. Same plumbing as any modern subscription app."

### 6. Refer-a-Friend (90 sec) ⭐ ZACH'S MOMENT
- Tap **Account → Refer a Friend** (or wherever it lives in nav)
- Show existing referrals at varied statuses (Paid $500, Signed, Contacted)
- Tap "Refer Someone" → native iOS share sheet
- **Talking point for Zach:** "$500 per referral, tracked end-to-end from contact through PTO. Customers sell for us. Native iOS share sheet means they can text it, AirDrop it, post it — no friction. Mark already has $500 in his account from Jeff Williams' install."

### 7. Onboarding journey / Ellie (60 sec) ⭐ MARK'S MOMENT (BRAND)
- Find "Onboarding journey" on Home (or wherever the entry point is)
- Show Ellie character + 9 milestone cards over 60 days
- **Talking point for Mark:** "This is where the brand lives. Ellie's the customer's guide through their first 60 days — what's happening, what to expect, when to expect it. Reduces buyer's remorse and inbound questions during the quiet weeks between contract and install."

### 8. Outage Mode (45 sec)
- Tap **Outage Mode**
- Show battery gauge, load priority, emergency contacts, safety tips
- **Talking point:** "Hurricane season tool. When the grid goes down, this is the screen they open. Shows what's running on battery, what's not, who to call. The differentiator vs Tesla Powerwall app — we built this for our market specifically."

### 9. Tickets (45 sec)
- Tap **Support** or **Tickets**
- Show existing 2 tickets — open + assigned
- Tap "+" → new ticket form
- **Talking point:** "Support tickets created in the app land directly in the CRM ticket queue. PMs see them instantly with full project context. No 800 number, no escalations to call center."

### 10. Documents (30 sec)
- Tap **Documents**
- Show 4 files: contract, design, permit, install photo
- **Talking point:** "Every document the customer should ever need, in one place. No more 'can you email me my contract again?'"

## Total: ~10 minutes

## CRM-side moves to amplify the demo

While they're playing with the app, demonstrate the round-trip:

1. **Live message** — open `/tickets` → click into one of their portal tickets → reply from CRM. Watch the badge appear on their phone.
2. **Open `/command`** — show their project pinned on the morning briefing
3. **Open `/job-costing`** — show how the same install becomes a P&L line item
4. **Open `/analytics`** — show that customer experience and operational P&L are the same dataset

## Reset SQL (run after demo if you want a clean slate)

Save this as `scripts/reset-demo-data.sql` or just paste in Supabase:

```sql
-- Reset all demo data created for the Apr 8 Mark/Zach/Heidi demo
DELETE FROM customer_messages WHERE project_id LIKE 'PROJ-DEMO-%';
DELETE FROM customer_payments WHERE customer_account_id IN (
  SELECT id FROM customer_accounts WHERE email IN ('iambench@gmail.com','hll.zch@gmail.com','heidiguev213@yahoo.com')
);
DELETE FROM customer_billing_statements WHERE project_id LIKE 'PROJ-DEMO-%';
DELETE FROM customer_payment_methods WHERE customer_account_id IN (
  SELECT id FROM customer_accounts WHERE email IN ('iambench@gmail.com','hll.zch@gmail.com','heidiguev213@yahoo.com')
);
DELETE FROM customer_referrals WHERE referrer_project_id LIKE 'PROJ-DEMO-%';
DELETE FROM tickets WHERE project_id LIKE 'PROJ-DEMO-%';
DELETE FROM equipment_warranties WHERE project_id LIKE 'PROJ-DEMO-%';
DELETE FROM project_files WHERE project_id LIKE 'PROJ-DEMO-%';
DELETE FROM task_state WHERE project_id LIKE 'PROJ-DEMO-%';
DELETE FROM stage_history WHERE project_id LIKE 'PROJ-DEMO-%';

-- Remove Mark/Zach/Heidi customer accounts (Greg's stays — restore his project_id)
DELETE FROM customer_accounts WHERE email IN ('iambench@gmail.com','hll.zch@gmail.com','heidiguev213@yahoo.com');
UPDATE customer_accounts SET project_id = 'PROJ-29857' WHERE email = 'greg@gomicrogridenergy.com';

-- Remove demo projects
DELETE FROM projects WHERE id LIKE 'PROJ-DEMO-%';

-- Optionally drop the auth-link trigger (leave it if you want auto-link to keep working)
-- DROP TRIGGER IF EXISTS on_auth_user_created_link_customer ON auth.users;
-- DROP FUNCTION IF EXISTS public.link_customer_account_on_signup();
```

## Known caveats to acknowledge upfront

- **Energy production chart** is a placeholder — pending Duracell monitoring API
- **Stripe payment buttons** show "coming soon" — flip a key when ready
- **3 demo projects show up in CRM at `/pipeline`** as Greg/Mark/Zach customers in inspection stage. Keep them or delete with the reset SQL above.
- **Push notifications** to Mark/Zach won't fire unless they've granted permission and the push token's been saved on first launch — the Greg account has a token already, so push to Greg's phone works as the demo.
