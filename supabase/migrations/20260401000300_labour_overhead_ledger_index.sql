-- Speed lookups for labour overhead rows stored on project_cost_ledger
-- (reference_type = 'labour_overhead', reference_id = labour_master.id).

create index if not exists idx_project_cost_ledger_labour_overhead
  on public.project_cost_ledger(reference_type, reference_id)
  where reference_type = 'labour_overhead';

notify pgrst, 'reload schema';
