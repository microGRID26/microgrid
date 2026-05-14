# Integration tests

PostgREST-path E2E tests against the real MicroGRID Supabase project. Distinct from:

- **Unit tests** under `__tests__/**/*.test.ts` (excluding `__tests__/integration/`) — fast, mocked `@/lib/supabase/*` via `vitest.setup.ts`. Run via `npm test`.
- **Static-inspection migration tests** under `__tests__/migrations/*.test.ts` — read the `.sql` files and assert structural invariants. Also under `npm test`.
- **AI behavior evals** under `evals/**/*.eval.ts` — different harness (`npm run eval`), different ownership, similar provisioning pattern.

## What this suite is for

Real-client coverage of trigger guards, RLS policies, RPC contracts, and other DB-level behaviors that the static-inspection tests cover only structurally. The fixture creates ONE non-admin authenticated user and ONE test project, runs PostgREST UPDATEs against the user JWT, and asserts the server rejects them with the expected SQLSTATE.

## Required env vars

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)

Loaded from `.env.local` automatically by `setup.ts`. CI must inject these as secrets.

## Running

```bash
npm run test:integration
```

Sequential (not parallel), `pool: 'forks'`, `hookTimeout: 60_000` to allow the auth.admin operations + provisioning + teardown to complete.

## Fixture convention

Every fixture identifier starts with `e2e_test_`. Single grep-able marker. After a clean run:

```sql
-- Should return 0:
SELECT COUNT(*) FROM auth.users WHERE email LIKE 'e2e\_test\_%' ESCAPE '\\';
SELECT COUNT(*) FROM public.users WHERE email LIKE 'e2e\_test\_%' ESCAPE '\\';
SELECT COUNT(*) FROM public.organizations WHERE slug LIKE 'e2e\_test\_%' ESCAPE '\\';
SELECT COUNT(*) FROM public.projects WHERE id LIKE 'e2e\_test\_%' ESCAPE '\\';
SELECT COUNT(*) FROM public.org_memberships WHERE org_id IN (SELECT id FROM public.organizations WHERE slug LIKE 'e2e\_test\_%' ESCAPE '\\');
```

If any of those return > 0, a prior run's `afterAll` teardown failed. Sweep manually:

```sql
DELETE FROM public.projects WHERE id LIKE 'e2e\_test\_%' ESCAPE '\\';
DELETE FROM public.org_memberships WHERE org_id IN (SELECT id FROM public.organizations WHERE slug LIKE 'e2e\_test\_%' ESCAPE '\\');
DELETE FROM public.users WHERE email LIKE 'e2e\_test\_%' ESCAPE '\\';
DELETE FROM public.organizations WHERE slug LIKE 'e2e\_test\_%' ESCAPE '\\';
-- auth.users via auth.admin API or Supabase dashboard:
--   SELECT id FROM auth.users WHERE email LIKE 'e2e\_test\_%' ESCAPE '\\';
--   then auth.admin.deleteUser(id) per row, OR DELETE FROM auth.users WHERE email LIKE 'e2e\_test\_%' ESCAPE '\\';
```

## Adding a new test

1. Pick a fixture identifier with the `e2e_test_` prefix and add it to `fixtures.ts` if reusable.
2. Create `__tests__/integration/<feature>.test.ts`. Import clients + fixtures + the integration context.
3. Use `serviceClient()` for setup-side mutations (bypasses RLS) and `userClient(...)` for the user-side request that exercises the policy / trigger you're testing.
4. Assert on `error.code` (PostgREST forwards Postgres SQLSTATE) AND re-read state via service_role to confirm server-side authority.

If the new test needs a different user shape (admin, super_admin, partner-key holder), extend `setup.ts` rather than copy-pasting provisioning.

## Why a separate config

`vitest.integration.config.ts` does not load `vitest.setup.ts` — the unit setup unconditionally mocks `@/lib/supabase/client` + `/server`. Integration tests import `@supabase/supabase-js` directly via `clients.ts`, but a future global-mock expansion could still leak. The config separation makes that surface visible (one grep on `vitest.setup.ts`).
