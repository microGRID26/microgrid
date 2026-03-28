-- 037-calendar-sync.sql — Google Calendar sync tracking
-- Tracks sync state between schedule entries and Google Calendar events

-- Calendar settings per crew
CREATE TABLE IF NOT EXISTS calendar_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id TEXT UNIQUE NOT NULL,
  calendar_id TEXT,
  enabled BOOLEAN DEFAULT false,
  auto_sync BOOLEAN DEFAULT true,
  last_full_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Per-entry sync tracking
CREATE TABLE IF NOT EXISTS calendar_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  crew_id TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  sync_status TEXT DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (schedule_id, calendar_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_sync_schedule_id ON calendar_sync(schedule_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_crew_id ON calendar_sync(crew_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_status ON calendar_sync(sync_status);
CREATE INDEX IF NOT EXISTS idx_calendar_settings_crew_id ON calendar_settings(crew_id);

-- RLS policies
ALTER TABLE calendar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_sync ENABLE ROW LEVEL SECURITY;

-- calendar_settings: SELECT for all authenticated, INSERT/UPDATE/DELETE for admin only
CREATE POLICY "calendar_settings_select" ON calendar_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "calendar_settings_insert" ON calendar_settings FOR INSERT TO authenticated WITH CHECK (auth_is_admin());
CREATE POLICY "calendar_settings_update" ON calendar_settings FOR UPDATE TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());
CREATE POLICY "calendar_settings_delete" ON calendar_settings FOR DELETE TO authenticated USING (auth_is_admin());

-- calendar_sync: SELECT/INSERT/UPDATE/DELETE for all authenticated (managed by sync API)
CREATE POLICY "calendar_sync_select" ON calendar_sync FOR SELECT TO authenticated USING (true);
CREATE POLICY "calendar_sync_insert" ON calendar_sync FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "calendar_sync_update" ON calendar_sync FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "calendar_sync_delete" ON calendar_sync FOR DELETE TO authenticated USING (true);
