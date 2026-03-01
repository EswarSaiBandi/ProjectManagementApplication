-- Enhanced Lead to Project Information Flow
-- Ensure comprehensive data transfer and bidirectional linking

-- Add lead reference fields to projects table
alter table public.projects
add column if not exists source_lead_id bigint references public.leads(lead_id),
add column if not exists client_name text,
add column if not exists client_email text,
add column if not exists client_phone text,
add column if not exists client_address text,
add column if not exists project_description text,
add column if not exists project_requirements text;

-- Add project reference to orders
alter table public.project_orders
add column if not exists estimate_id bigint references public.estimates(estimate_id);

-- Add project tracking to estimates
alter table public.estimates
add column if not exists converted_to_project_id bigint references public.projects(project_id),
add column if not exists converted_to_order_id bigint references public.project_orders(order_id),
add column if not exists converted_to_quote_id bigint references public.quotes(quote_id);

-- Enhanced conversion function with complete information flow
create or replace function public.auto_convert_estimate_to_order_enhanced()
returns trigger
language plpgsql
as $$
declare
  v_lead record;
  v_project_id bigint;
  v_order_id bigint;
  v_quote_id bigint;
begin
  -- Only trigger on approval
  if new.status = 'Approved' and old.status != 'Approved' then
    
    -- Get complete lead details
    select * into v_lead
    from public.leads
    where lead_id = new.lead_id;
    
    -- Create Project with full lead information
    insert into public.projects (
      project_name,
      source_lead_id,
      client_name,
      client_email,
      client_phone,
      client_address,
      project_description,
      project_requirements,
      status,
      start_date,
      estimated_value,
      schedule_start_date,
      schedule_end_date,
      created_at
    )
    values (
      coalesce(v_lead.project_name, v_lead.client_name || ' Project'),
      v_lead.lead_id,
      v_lead.client_name,
      v_lead.email,
      v_lead.phone,
      v_lead.address,
      v_lead.description,
      v_lead.requirements,
      'Planning',
      current_date,
      new.total_amount,
      current_date,
      current_date + coalesce(v_lead.estimated_duration_days, 30),
      now()
    )
    returning project_id into v_project_id;
    
    -- Create Project Order with comprehensive details
    insert into public.project_orders (
      order_number,
      project_id,
      estimate_id,
      client_name,
      client_email,
      client_phone,
      client_address,
      order_date,
      project_type,
      project_duration,
      estimated_value,
      schedule_start_date,
      schedule_end_date,
      boq_notes,
      external_requirements,
      status,
      source,
      notes,
      converted_from_lead_id,
      created_at
    )
    values (
      'ORD-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('project_orders_order_id_seq')::text, 4, '0'),
      v_project_id,
      new.estimate_id,
      v_lead.client_name,
      v_lead.email,
      v_lead.phone,
      v_lead.address,
      current_date,
      v_lead.project_type,
      v_lead.estimated_duration_days,
      new.total_amount,
      current_date,
      current_date + coalesce(v_lead.estimated_duration_days, 30),
      'BOQ to be prepared based on estimate line items',
      v_lead.requirements,
      'Confirmed',
      'Lead Conversion - Estimate Approved',
      'Auto-created from approved estimate: ' || new.estimate_number || '. Lead: ' || v_lead.lead_number,
      v_lead.lead_id,
      now()
    )
    returning order_id into v_order_id;
    
    -- Create Quotation from Estimate
    insert into public.quotes (
      quote_number,
      project_id,
      client_name,
      client_email,
      quote_date,
      valid_until,
      subtotal,
      tax_percentage,
      tax_amount,
      discount_amount,
      total,
      status,
      terms_and_conditions,
      notes,
      created_at
    )
    values (
      'QUO-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('quotes_quote_id_seq')::text, 4, '0'),
      v_project_id,
      v_lead.client_name,
      v_lead.email,
      new.estimate_date,
      new.valid_until,
      new.subtotal,
      new.tax_percentage,
      new.tax_amount,
      new.discount_amount,
      new.total_amount,
      'Accepted',
      new.terms_and_conditions,
      'Auto-created from approved estimate: ' || new.estimate_number || '. Client notes: ' || coalesce(new.client_notes, ''),
      now()
    )
    returning quote_id into v_quote_id;
    
    -- Copy estimate items to quote items
    insert into public.quote_items (
      quote_id,
      item_number,
      description,
      quantity,
      unit,
      unit_price,
      notes
    )
    select
      v_quote_id,
      item_number,
      description,
      quantity,
      unit,
      unit_price,
      notes
    from public.estimate_items
    where estimate_id = new.estimate_id
    order by item_number;
    
    -- Update lead status to Realized/Won
    update public.leads
    set 
      status = 'Realized',
      converted_to_order_id = v_order_id,
      conversion_date = now()
    where lead_id = new.lead_id;
    
    -- Update estimate with conversion references
    new.converted_to_project_id := v_project_id;
    new.converted_to_order_id := v_order_id;
    new.converted_to_quote_id := v_quote_id;
    
    -- Log the conversion
    new.approval_notes := coalesce(new.approval_notes, '') || 
      ' | Auto-converted: Project #' || v_project_id || ', Order #' || v_order_id || ', Quote #' || v_quote_id;
    
  end if;
  
  return new;
end;
$$;

-- Replace old trigger with enhanced version
drop trigger if exists trg_auto_convert_estimate on public.estimates;
create trigger trg_auto_convert_estimate
before update on public.estimates
for each row execute function public.auto_convert_estimate_to_order_enhanced();

-- View: Complete lead to project flow tracking
create or replace view public.lead_project_flow as
select 
  l.lead_id,
  l.lead_number,
  l.client_name,
  l.status as lead_status,
  l.estimated_value as lead_estimated_value,
  l.created_at as lead_created_at,
  l.conversion_date,
  
  e.estimate_id,
  e.estimate_number,
  e.status as estimate_status,
  e.total_amount as estimate_total,
  e.approved_date as estimate_approved_date,
  
  p.project_id,
  p.project_name,
  p.status as project_status,
  p.start_date as project_start_date,
  
  po.order_id,
  po.order_number,
  po.status as order_status,
  
  q.quote_id,
  q.quote_number,
  q.status as quote_status,
  
  -- Calculate conversion metrics
  case 
    when l.conversion_date is not null then extract(epoch from (l.conversion_date - l.created_at)) / 86400
    else null
  end as days_to_conversion

from public.leads l
left join public.estimates e on e.lead_id = l.lead_id and e.is_active = true
left join public.projects p on p.source_lead_id = l.lead_id
left join public.project_orders po on po.converted_from_lead_id = l.lead_id
left join public.quotes q on q.project_id = p.project_id;

grant select on public.lead_project_flow to authenticated;

notify pgrst, 'reload schema';
