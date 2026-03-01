-- Auto-generate quote numbers with 3-digit format (027, 101, 102, etc.)

-- Function to generate 3-digit quote numbers
create or replace function public.generate_quote_number()
returns trigger
language plpgsql
as $$
declare
  v_sequence int;
  v_quote_number text;
begin
  -- Get the highest existing quote number (extract numeric part)
  select coalesce(max(
    case 
      when quote_number ~ '^[0-9]{3}$' 
      then quote_number::int
      else 0
    end
  ), 26) + 1 -- Start from 27 (next will be 027)
  into v_sequence
  from public.project_quotes;
  
  -- Format as 3-digit with leading zeros
  v_quote_number := lpad(v_sequence::text, 3, '0');
  new.quote_number := v_quote_number;
  
  return new;
end;
$$;

-- Create trigger for auto-generating quote numbers
drop trigger if exists trg_generate_quote_number on public.project_quotes;
create trigger trg_generate_quote_number
before insert on public.project_quotes
for each row 
when (new.quote_number is null or new.quote_number = '')
execute function public.generate_quote_number();

notify pgrst, 'reload schema';
