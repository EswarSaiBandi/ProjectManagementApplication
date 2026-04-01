alter table public.project_stock_used
add column if not exists cost_per_unit numeric(12,2) not null default 0;
