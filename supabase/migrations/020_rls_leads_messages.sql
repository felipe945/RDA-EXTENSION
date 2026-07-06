-- 020: data-C1 — close the anon-key read path for good.
--
-- The app authenticates with NextAuth (not Supabase Auth), so auth.uid() is
-- always null and policy-based RLS can't scope anything. All scoping lives in
-- the API routes (lib/scope.ts), which use the service-role key (BYPASSRLS) —
-- so enabling RLS with NO policies + revoking anon turns the browser anon key
-- into a dead end without touching any server path.
--
-- This replaces the earlier hand-toggled dashboard setting with a real,
-- reproducible migration. Verify after applying:
--   anon REST GET /rest/v1/leads    → error/empty
--   anon REST GET /rest/v1/messages → error/empty
--   service-role                    → full access (unchanged)
BEGIN;
ALTER TABLE public.leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads    FROM anon;
REVOKE ALL ON public.messages FROM anon;
COMMIT;
