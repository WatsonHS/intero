ALTER TABLE public_stand_in_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_stand_in_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public_stand_in_runs
  USING (organization_id = intero_current_organization_id())
  WITH CHECK (organization_id = intero_current_organization_id());
