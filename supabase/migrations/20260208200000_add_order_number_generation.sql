-- Auto-generate order numbers with format: ORD-001, ORD-002, etc.

-- Function to generate order numbers
create or replace function public.generate_order_number()
returns trigger
language plpgsql
as $$
declare
  v_sequence int;
  v_order_number text;
begin
  -- Get the highest existing order number (extract numeric part after ORD-)
  select coalesce(max(
    case 
      when order_number ~ '^ORD-[0-9]+$' 
      then substring(order_number from '[0-9]+$')::int
      else 0
    end
  ), 0) + 1
  into v_sequence
  from public.project_orders;
  
  -- Format as ORD-XXX with leading zeros (3 digits minimum)
  v_order_number := 'ORD-' || lpad(v_sequence::text, 3, '0');
  new.order_number := v_order_number;
  
  return new;
end;
$$;

-- Create trigger for auto-generating order numbers
drop trigger if exists trg_generate_order_number on public.project_orders;
create trigger trg_generate_order_number
before insert on public.project_orders
for each row 
when (new.order_number is null or new.order_number = '')
execute function public.generate_order_number();

notify pgrst, 'reload schema';
