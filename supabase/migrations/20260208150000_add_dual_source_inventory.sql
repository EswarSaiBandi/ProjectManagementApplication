-- Dual-Source Inventory Tracking: In-Store vs Market Purchase
-- Real-time global quantity sync across all projects

-- Add source tracking to material_master
alter table public.material_master
add column if not exists in_store_quantity numeric(12,3) default 0,
add column if not exists market_purchase_quantity numeric(12,3) default 0,
add column if not exists total_quantity_computed numeric(12,3) generated always as (in_store_quantity + market_purchase_quantity) stored;

-- Update existing quantities to in_store by default (migration)
update public.material_master
set in_store_quantity = coalesce(quantity, 0)
where in_store_quantity = 0;

-- Add source tracking to material_movements
alter table public.material_movements
add column if not exists source_type text check (source_type in ('In-Store', 'Market Purchase')) default 'In-Store';

-- Add source tracking to material_allocations
alter table public.material_allocations
add column if not exists source_type text check (source_type in ('In-Store', 'Market Purchase')) default 'In-Store';

-- Function: Update stock with source tracking
create or replace function public.update_stock_by_source(
  p_material_id bigint,
  p_quantity numeric,
  p_source_type text,
  p_operation text -- 'add' or 'subtract'
)
returns void
language plpgsql
as $$
begin
  if p_source_type = 'In-Store' then
    if p_operation = 'add' then
      update public.material_master
      set in_store_quantity = in_store_quantity + p_quantity
      where material_id = p_material_id;
    else
      update public.material_master
      set in_store_quantity = greatest(0, in_store_quantity - p_quantity)
      where material_id = p_material_id;
    end if;
  elsif p_source_type = 'Market Purchase' then
    if p_operation = 'add' then
      update public.material_master
      set market_purchase_quantity = market_purchase_quantity + p_quantity
      where material_id = p_material_id;
    else
      update public.material_master
      set market_purchase_quantity = greatest(0, market_purchase_quantity - p_quantity)
      where material_id = p_material_id;
    end if;
  end if;
end;
$$;

-- Function: Check available stock by source (real-time across all projects)
create or replace function public.check_available_stock_by_source(
  p_material_id bigint,
  p_source_type text
)
returns numeric
language plpgsql
as $$
declare
  v_current_stock numeric;
  v_allocated numeric;
  v_available numeric;
begin
  -- Get current stock by source
  if p_source_type = 'In-Store' then
    select coalesce(in_store_quantity, 0) into v_current_stock
    from public.material_master
    where material_id = p_material_id;
  else
    select coalesce(market_purchase_quantity, 0) into v_current_stock
    from public.material_master
    where material_id = p_material_id;
  end if;
  
  -- Get total allocated quantity across ALL projects for this source
  select coalesce(sum(allocated_quantity - coalesce(returned_quantity, 0)), 0)
  into v_allocated
  from public.material_allocations
  where material_id = p_material_id
    and source_type = p_source_type
    and status not in ('Cancelled', 'Returned');
  
  -- Calculate available (current - allocated)
  v_available := v_current_stock - v_allocated;
  
  return greatest(0, v_available);
end;
$$;

-- Function: Auto-update stock on allocation with source tracking
create or replace function public.update_stock_on_allocation_with_source()
returns trigger
language plpgsql
as $$
declare
  v_issued_delta numeric;
  v_returned_delta numeric;
begin
  -- Handle issued quantity changes
  if new.issued_quantity is not null and new.issued_quantity != coalesce(old.issued_quantity, 0) then
    v_issued_delta := new.issued_quantity - coalesce(old.issued_quantity, 0);
    
    -- Subtract from stock when issued
    perform public.update_stock_by_source(
      new.material_id,
      v_issued_delta,
      new.source_type,
      'subtract'
    );
  end if;
  
  -- Handle returned quantity changes
  if new.returned_quantity is not null and new.returned_quantity != coalesce(old.returned_quantity, 0) then
    v_returned_delta := new.returned_quantity - coalesce(old.returned_quantity, 0);
    
    -- Add back to stock when returned
    perform public.update_stock_by_source(
      new.material_id,
      v_returned_delta,
      new.source_type,
      'add'
    );
  end if;
  
  return new;
end;
$$;

-- Replace old trigger with source-aware version
drop trigger if exists trg_update_stock_on_allocation on public.material_allocations;
create trigger trg_update_stock_on_allocation
after update on public.material_allocations
for each row execute function public.update_stock_on_allocation_with_source();

-- Function: Automated return to store for Market Purchase excess
create or replace function public.auto_reclassify_market_purchase_excess()
returns trigger
language plpgsql
as $$
declare
  v_source_type text;
begin
  -- Get the source type from the original allocation
  select source_type into v_source_type
  from public.material_allocations
  where allocation_id = new.reference_id
  limit 1;
  
  -- If it was a Market Purchase, reclassify as In-Store when returned
  if v_source_type = 'Market Purchase' and new.status = 'Available' then
    -- Add to In-Store quantity
    perform public.update_stock_by_source(
      new.material_id,
      new.quantity,
      'In-Store',
      'add'
    );
    
    -- Subtract from Market Purchase quantity (if it was added there)
    perform public.update_stock_by_source(
      new.material_id,
      new.quantity,
      'Market Purchase',
      'subtract'
    );
    
    -- Mark that this was reclassified
    new.notes := coalesce(new.notes, '') || ' [Auto-reclassified from Market Purchase to In-Store]';
  end if;
  
  return new;
end;
$$;

drop trigger if exists trg_auto_reclassify_excess on public.excess_materials;
create trigger trg_auto_reclassify_excess
before insert on public.excess_materials
for each row execute function public.auto_reclassify_market_purchase_excess();

-- View: Real-time inventory status across all projects
create or replace view public.inventory_realtime_status as
select 
  mm.material_id,
  mm.name as material_name,
  mm.unit,
  mm.in_store_quantity,
  mm.market_purchase_quantity,
  mm.total_quantity_computed as total_quantity,
  
  -- In-Store allocations across ALL projects
  coalesce((
    select sum(allocated_quantity - coalesce(returned_quantity, 0))
    from public.material_allocations ma
    where ma.material_id = mm.material_id
      and ma.source_type = 'In-Store'
      and ma.status not in ('Cancelled', 'Returned')
  ), 0) as in_store_allocated,
  
  -- Market Purchase allocations across ALL projects
  coalesce((
    select sum(allocated_quantity - coalesce(returned_quantity, 0))
    from public.material_allocations ma
    where ma.material_id = mm.material_id
      and ma.source_type = 'Market Purchase'
      and ma.status not in ('Cancelled', 'Returned')
  ), 0) as market_allocated,
  
  -- Available quantities
  mm.in_store_quantity - coalesce((
    select sum(allocated_quantity - coalesce(returned_quantity, 0))
    from public.material_allocations ma
    where ma.material_id = mm.material_id
      and ma.source_type = 'In-Store'
      and ma.status not in ('Cancelled', 'Returned')
  ), 0) as in_store_available,
  
  mm.market_purchase_quantity - coalesce((
    select sum(allocated_quantity - coalesce(returned_quantity, 0))
    from public.material_allocations ma
    where ma.material_id = mm.material_id
      and ma.source_type = 'Market Purchase'
      and ma.status not in ('Cancelled', 'Returned')
  ), 0) as market_available,
  
  -- Total available
  (mm.in_store_quantity + mm.market_purchase_quantity) - coalesce((
    select sum(allocated_quantity - coalesce(returned_quantity, 0))
    from public.material_allocations ma
    where ma.material_id = mm.material_id
      and ma.status not in ('Cancelled', 'Returned')
  ), 0) as total_available,
  
  -- Project allocations summary
  coalesce((
    select json_agg(json_build_object(
      'project_id', p.project_id,
      'project_name', p.project_name,
      'allocated', ma.allocated_quantity,
      'source', ma.source_type
    ))
    from public.material_allocations ma
    join public.projects p on p.project_id = ma.project_id
    where ma.material_id = mm.material_id
      and ma.status not in ('Cancelled', 'Returned')
  ), '[]'::json) as project_allocations

from public.material_master mm;

-- Grant access
grant select on public.inventory_realtime_status to authenticated;

-- Update material_movements trigger to handle source-aware stock updates
create or replace function public.update_stock_on_movement()
returns trigger
language plpgsql
as $$
begin
  if new.movement_type = 'Inward' then
    -- Add to stock based on source
    perform public.update_stock_by_source(
      new.material_id,
      new.quantity,
      new.source_type,
      'add'
    );
  elsif new.movement_type = 'Outward' then
    -- Subtract from stock based on source
    perform public.update_stock_by_source(
      new.material_id,
      new.quantity,
      new.source_type,
      'subtract'
    );
  end if;
  
  return new;
end;
$$;

drop trigger if exists trg_update_stock_on_movement on public.material_movements;
create trigger trg_update_stock_on_movement
after insert on public.material_movements
for each row execute function public.update_stock_on_movement();

notify pgrst, 'reload schema';
