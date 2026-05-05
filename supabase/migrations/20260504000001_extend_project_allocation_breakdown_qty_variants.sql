-- ============================================================================
-- Extend project_allocation_breakdown with quantity-variant columns.
--
-- Adds to the view:
--   quantity_variant_id   — from material_price_variants.quantity_variant_id
--   quantity_variant_name — packaging size name (e.g., "50 kg Bag")
--   quantity_per_unit     — base-metric qty per package (e.g., 50 for 50 kg Bag)
--
-- This lets every downstream consumer (StockUsedFifoTab, ReturnsFifoTab, etc.)
-- display breakdowns in both base-metric units (kg, L) and packaging units
-- (bags, cans) without any additional joins.
--
-- Run AFTER 20260504000000_link_qty_variants_to_price_variants.sql.
-- ============================================================================

DROP VIEW IF EXISTS public.project_allocation_breakdown CASCADE;
CREATE VIEW public.project_allocation_breakdown AS
SELECT
  ma.project_id,
  p.project_name,
  ma.allocation_id,
  ma.allocation_date,
  ma.status              AS allocation_status,
  ma.material_id,
  m.material_name,
  m.metric,
  avb.breakdown_id,
  avb.variant_id,
  v.variant_name,
  v.quantity_variant_id,
  mv.variant_name        AS quantity_variant_name,
  mv.quantity_per_unit,
  avb.batch_id,
  b.batch_date,
  b.number_of_units      AS batch_number_of_units,
  avb.unit_price,
  avb.qty_allocated,
  avb.qty_used,
  avb.qty_returned,
  (avb.qty_allocated - avb.qty_used - avb.qty_returned)             AS qty_remaining,
  avb.cost_allocated,
  (avb.qty_used     * avb.unit_price)::NUMERIC(14,2)                AS cost_used,
  (avb.qty_returned * avb.unit_price)::NUMERIC(14,2)                AS value_returned,
  ((avb.qty_allocated - avb.qty_used - avb.qty_returned)
   * avb.unit_price)::NUMERIC(14,2)                                  AS value_remaining
FROM public.material_allocations         ma
JOIN public.allocation_variant_breakdown avb ON avb.allocation_id = ma.allocation_id
JOIN public.material_price_variants      v   ON v.variant_id      = avb.variant_id
LEFT JOIN public.material_variants       mv  ON mv.variant_id     = v.quantity_variant_id
JOIN public.material_stock_batches       b   ON b.batch_id        = avb.batch_id
JOIN public.materials_master             m   ON m.material_id     = ma.material_id
JOIN public.projects                     p   ON p.project_id      = ma.project_id;

GRANT SELECT ON public.project_allocation_breakdown TO authenticated;

NOTIFY pgrst, 'reload schema';
