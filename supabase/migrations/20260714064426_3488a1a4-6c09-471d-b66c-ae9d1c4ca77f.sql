DROP POLICY IF EXISTS "Anyone can read plans" ON public.plans;
REVOKE SELECT ON public.plans FROM anon;
CREATE POLICY "Authenticated users can read plans" ON public.plans FOR SELECT TO authenticated USING (true);