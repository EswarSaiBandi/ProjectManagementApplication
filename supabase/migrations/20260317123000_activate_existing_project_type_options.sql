-- One-time backfill:
-- Keep all existing project type options active so they appear in project create/edit dropdowns.
update dynamic_field_options
set is_active = true
where field_type = 'project_type'
  and is_active = false;
