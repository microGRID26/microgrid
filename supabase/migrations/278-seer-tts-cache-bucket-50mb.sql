-- Migration 278: track tts-cache storage bucket settings in code
--
-- Context: Phase 4 Sprint 0.4 created the tts-cache bucket via the Supabase
-- dashboard during the late-evening 2026-05-10 TTS sprint. It was never
-- tracked in a migration, and the dashboard set file_size_limit to 10 MB.
--
-- During the 36-concept pre-warm (2026-05-11), 18 of 20 generated MP3s
-- exceeded 10 MB — the actual range is 9-17 MB for an 8-14K char concept
-- read at TTS-HD with parallel chunks concatenated. The 10 MB cap blocked
-- 18 of 20 uploads with "storage_upload_failed: object exceeded maximum
-- allowed size."
--
-- Resolution: bump cap to 50 MB. This covers the longest current concept
-- (16.8 MB observed) with ~3x headroom for future concepts that may run
-- 16-20K chars.
--
-- Idempotent on bucket existence (INSERT ON CONFLICT). Safe to re-apply.

-- public flag is set on INSERT only (initial creation). The UPDATE branch
-- deliberately omits `public` so a manual private-flip during a security
-- response can't be silently undone by a re-apply on a fresh env.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tts-cache', 'tts-cache', true, 52428800, ARRAY['audio/mpeg','audio/mp3'])
ON CONFLICT (id) DO UPDATE
SET file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
