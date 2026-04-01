-- Link multiple manpower_payment rows as one logical transfer (split across projects).

alter table public.manpower_payments
  add column if not exists payment_group_id uuid;

create index if not exists idx_manpower_payments_group on public.manpower_payments(payment_group_id);

notify pgrst, 'reload schema';
