-- ============================================================================
-- Restore FKs orphaned when public.material_master (singular) was dropped
-- by migration 20260208210000_global_store_inventory_system.sql.
--
-- Tables whose material_id still has NO FK after the cascade-drop:
--   * material_allocations
--   * excess_materials
--
-- Without these FKs, PostgREST can't resolve embedded selects like:
--   .from('material_allocations').select('materials_master!inner(...)')
-- and throws "Could not find a relationship between X and Y in the schema
-- cache" — which is what the Stock Used tab hit.
--
-- Run AFTER 20260502000009_allow_workflow_movement_types.sql.
-- Idempotent: drops the constraint first if it exists (name may vary).
-- ============================================================================

-- material_allocations.material_id → materials_master(material_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'material_allocations'
      AND constraint_name = 'fk_material_allocations_material'
  ) THEN
    ALTER TABLE public.material_allocations
      DROP CONSTRAINT fk_material_allocations_material;
  END IF;
END $$;

ALTER TABLE public.material_allocations
  ADD CONSTRAINT fk_material_allocations_material
  FOREIGN KEY (material_id)
  REFERENCES public.materials_master(material_id)
  ON DELETE RESTRICT;

-- excess_materials.material_id → materials_master(material_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'excess_materials'
      AND constraint_name = 'fk_excess_materials_material'
  ) THEN
    ALTER TABLE public.excess_materials
      DROP CONSTRAINT fk_excess_materials_material;
  END IF;
END $$;

ALTER TABLE public.excess_materials
  ADD CONSTRAINT fk_excess_materials_material
  FOREIGN KEY (material_id)
  REFERENCES public.materials_master(material_id)
  ON DELETE RESTRICT;

NOTIFY pgrst, 'reload schema';
