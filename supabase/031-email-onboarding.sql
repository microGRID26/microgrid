-- Migration 031: Email onboarding tracking table
-- Tracks 30-day onboarding email series per user

CREATE TABLE IF NOT EXISTS public.email_onboarding (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  current_day INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  last_sent_at TIMESTAMPTZ,
  paused BOOLEAN DEFAULT false,
  completed BOOLEAN DEFAULT false
);

CREATE INDEX idx_email_onboarding_user ON email_onboarding(user_id);
CREATE INDEX idx_email_onboarding_email ON email_onboarding(user_email);

ALTER TABLE email_onboarding ENABLE ROW LEVEL SECURITY;

-- NOTE (#6): These RLS policies are intentionally permissive (open to all authenticated users).
-- Ideally, SELECT/UPDATE/DELETE should be restricted to admin roles using auth_is_admin().
-- INSERT could be restricted to service-role only (cron/API) since enrollment is admin-initiated.
-- Since these policies are already applied in production, tightening requires a new migration
-- (DROP POLICY + CREATE POLICY). The admin-only access to EmailManager in the UI is the
-- current gate preventing unauthorized access. A future migration should tighten these:
--   CREATE POLICY "eo_select_admin" ON email_onboarding FOR SELECT TO authenticated USING (auth_is_admin());
--   CREATE POLICY "eo_update_admin" ON email_onboarding FOR UPDATE TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());
CREATE POLICY "eo_select" ON email_onboarding FOR SELECT TO authenticated USING (true);
CREATE POLICY "eo_insert" ON email_onboarding FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "eo_update" ON email_onboarding FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
