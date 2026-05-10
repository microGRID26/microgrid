-- ─────────────────────────────────────────────────────────────────────────
-- mig 268 · Seer · Phase 2 Feed Sprint 2 — source realignment
-- ─────────────────────────────────────────────────────────────────────────
-- Mig 267 seeded Anthropic + Lilian Weng as Sprint 2 multi-source proof.
-- Both broke at ingest (Anthropic /news/rss.xml = 404; Lilian Weng's
-- /index.xml is Atom but parsed 0 entries — spec mismatch deferred to
-- a future audit). Replaced live via execute_sql with three known-good
-- feeds; this migration codifies the new state so a rebuild matches prod.
--
-- Karpathy was tried + dropped because his Jekyll RSS publishes
-- `<link>http://...` and the edge fn correctly enforces https-only.
-- Re-enable later with a host-allowlist exception or skip the source.
-- ─────────────────────────────────────────────────────────────────────────

DELETE FROM public.seer_feed_sources
 WHERE url IN (
   'https://www.anthropic.com/news/rss.xml',
   'https://lilianweng.github.io/index.xml',
   'https://karpathy.github.io/feed.xml'
 );

INSERT INTO public.seer_feed_sources (name, kind, url, category) VALUES
  ('Latent Space',        'atom', 'https://www.latent.space/feed',                  'frontier'),
  ('Pragmatic Engineer',  'rss',  'https://newsletter.pragmaticengineer.com/feed',  'workflow')
ON CONFLICT (url) DO NOTHING;
