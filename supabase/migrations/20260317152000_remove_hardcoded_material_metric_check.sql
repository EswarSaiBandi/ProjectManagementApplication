-- Allow dynamic metrics managed via dynamic_field_options (material_category).
-- Existing NOT NULL constraint on materials_master.metric remains in place.

alter table public.materials_master
drop constraint if exists materials_master_metric_check;
