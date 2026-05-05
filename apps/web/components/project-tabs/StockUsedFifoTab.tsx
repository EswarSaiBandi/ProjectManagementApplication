'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { QUANTITY_STEP, parseQuarterQty } from '@/lib/quantity';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Box, Play, Undo2, ChevronDown, ChevronRight, Package } from 'lucide-react';

/* ───────────────────────────── Types ───────────────────────────── */

type VariantBreakdown = {
  variant_id: number;
  quantity_variant_id: number | null;   // packaging variant (material_variants)
  variant_name: string;
  quantity_variant_name: string | null;
  quantity_per_unit: number | null;
  unit_price: number;
  qty_allocated: number;
  qty_used: number;
  qty_returned: number;
  qty_remaining: number;  // allocated − used − returned
};

// Packaging-level view (multiple price variants collapsed into one row)
type PkgVariant = {
  qty_variant_id: number | null;
  qty_variant_name: string;
  quantity_per_unit: number | null;
  qty_available: number;   // for record: qty_remaining; for revert: qty_used
};

type MaterialRow = {
  material_id: number;
  material_name: string;
  metric: string | null;
  total_allocated: number;
  total_used: number;
  total_returned: number;
  remaining_unused: number;
  revertible_used: number;
  cost_allocated: number;
  cost_used: number;
  variants: VariantBreakdown[];
};

type Action = 'record' | 'revert';

/* ─────────────────────────── Helpers ───────────────────────────── */

function toUnits(qty: number, qtyPerUnit: number | null): string | null {
  if (!qtyPerUnit || qtyPerUnit <= 0) return null;
  return (qty / qtyPerUnit).toFixed(2) + ' units';
}

function variantLabel(v: VariantBreakdown, metric: string | null): string {
  if (v.quantity_variant_name) {
    return `${v.quantity_variant_name} @ Rs.${Number(v.unit_price).toFixed(2)}/${metric ?? 'unit'} (incl. GST)`;
  }
  return `${v.variant_name} @ Rs.${Number(v.unit_price).toFixed(2)}/${metric ?? 'unit'} (incl. GST)`;
}

/* ─────────────────────────── Component ─────────────────────────── */

export default function StockUsedFifoTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [action, setAction] = useState<Action>('record');
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  const [mvInput, setMvInput] = useState<number | null>(null);   // qty_variant_id (required)
  const [unitsInput, setUnitsInput] = useState('');              // physical units for chosen MV
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('project_allocation_breakdown')
      .select(
        'material_id, material_name, metric, ' +
        'variant_id, quantity_variant_id, variant_name, quantity_variant_name, quantity_per_unit, unit_price, ' +
        'qty_allocated, qty_used, qty_returned, qty_remaining, cost_allocated, cost_used'
      )
      .eq('project_id', numericProjectId);

    if (error) {
      console.error(error);
      toast.error('Failed to load project inventory: ' + error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    // Aggregate per-material summary + per-variant breakdown in one pass.
    const byMat = new Map<number, MaterialRow>();

    for (const r of (data as any[]) || []) {
      const matId = r.material_id as number;
      const varId = r.variant_id as number;

      if (!byMat.has(matId)) {
        byMat.set(matId, {
          material_id: matId,
          material_name: r.material_name,
          metric: r.metric,
          total_allocated: 0,
          total_used: 0,
          total_returned: 0,
          remaining_unused: 0,
          revertible_used: 0,
          cost_allocated: 0,
          cost_used: 0,
          variants: [],
        });
      }

      const m = byMat.get(matId)!;
      const qa = Number(r.qty_allocated || 0);
      const qu = Number(r.qty_used || 0);
      const qr = Number(r.qty_returned || 0);
      const up = Number(r.unit_price || 0);

      m.total_allocated += qa;
      m.total_used      += qu;
      m.total_returned  += qr;
      m.cost_allocated  += qa * up;
      m.cost_used       += qu * up;

      // Accumulate per-variant breakdown (multiple breakdown rows can share a variant_id).
      let vb = m.variants.find((v) => v.variant_id === varId);
      if (!vb) {
        vb = {
          variant_id:            varId,
          quantity_variant_id:   r.quantity_variant_id ? Number(r.quantity_variant_id) : null,
          variant_name:          r.variant_name,
          quantity_variant_name: r.quantity_variant_name ?? null,
          quantity_per_unit:     r.quantity_per_unit ? Number(r.quantity_per_unit) : null,
          unit_price:            up,
          qty_allocated:         0,
          qty_used:              0,
          qty_returned:          0,
          qty_remaining:         0,
        };
        m.variants.push(vb);
      }
      vb.qty_allocated += qa;
      vb.qty_used      += qu;
      vb.qty_returned  += qr;
      vb.qty_remaining  = vb.qty_allocated - vb.qty_used - vb.qty_returned;
    }

    Array.from(byMat.values()).forEach((m) => {
      m.remaining_unused = m.total_allocated - m.total_used - m.total_returned;
      m.revertible_used  = m.total_used;
    });

    setRows(
      Array.from(byMat.values())
        .filter((m) => m.total_allocated > 0)
        .sort((a, b) => a.material_name.localeCompare(b.material_name)),
    );
    setLoading(false);
  }, [numericProjectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleExpand = (materialId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(materialId)) next.delete(materialId);
      else next.add(materialId);
      return next;
    });
  };

  const openDialog = (mat: MaterialRow, act: Action) => {
    setSelected(mat);
    setAction(act);
    setMvInput(null);
    setUnitsInput('');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    if (mvInput === null) { toast.error('Pick a packaging variant first'); return; }

    const qpu = selected.variants.find(v => v.quantity_variant_id === mvInput)?.quantity_per_unit ?? null;
    const unitsParsed = parseQuarterQty(String(unitsInput), { label: 'Units' });
    if (!unitsParsed.ok) { toast.error(unitsParsed.error); return; }
    const units = unitsParsed.value;
    const qty = units * (qpu ?? 1);

    setSaving(true);
    const rpc = action === 'record'
      ? 'record_material_usage_by_material'
      : 'revert_material_usage_by_material';
    const params = action === 'record'
      ? { p_project_id: numericProjectId, p_material_id: selected.material_id, p_qty_used: qty,
          p_qty_variant_id: mvInput }
      : { p_project_id: numericProjectId, p_material_id: selected.material_id, p_qty_to_revert: qty,
          p_qty_variant_id: mvInput };

    const { data, error } = await supabase.rpc(rpc, params as any);
    setSaving(false);

    if (error) { toast.error(error.message); return; }

    const result = Array.isArray(data) ? data[0] : data;
    if (action === 'record') {
      const cost = Number(result?.cost_of_usage || 0);
      toast.success(`Recorded ${qty.toFixed(3)} ${selected.metric ?? ''} used — Rs.${cost.toFixed(2)} (FIFO)`);
    } else {
      const value = Number(result?.value_reverted || 0);
      toast.success(`Reverted ${qty.toFixed(3)} ${selected.metric ?? ''} — Rs.${value.toFixed(2)} (LIFO)`);
    }

    setDialogOpen(false);
    setSelected(null);
    setMvInput(null);
    setUnitsInput('');
    fetchAll();
    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { projectId } }));
  };

  const totalAllocatedCost = rows.reduce((s, m) => s + m.cost_allocated, 0);
  const totalUsedCost      = rows.reduce((s, m) => s + m.cost_used, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Box className="h-5 w-5 text-slate-500" />
              On-Site Stock Usage
            </CardTitle>
            <div className="text-sm text-slate-600 text-right">
              <div>Allocated value: Rs. {totalAllocatedCost.toFixed(2)}</div>
              <div>Consumed value: Rs. {totalUsedCost.toFixed(2)}</div>
            </div>
          </div>
          <p className="text-sm text-slate-600 mt-2">
            Record quantity consumed on-site. FIFO picks the oldest-allocated stock first.
            Revert Usage (LIFO) un-consumes — stock returns to the project&apos;s allocated pool, <strong>not</strong> to the store.
            Click a row to see the packaging-variant breakdown.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-slate-500 text-sm p-4">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-500 py-10">
              <Box className="h-10 w-10 mx-auto text-slate-300 mb-2" />
              <p className="font-medium">No materials allocated to this project.</p>
              <p className="text-sm">Raise a Material Request to get stock allocated.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-6" />
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Alloc. Cost</TableHead>
                  <TableHead className="text-right">Used Cost</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const unit     = m.metric || '';
                  const isExpanded = expanded.has(m.material_id);

                  return [
                    /* ── Material summary row ── */
                    <TableRow
                      key={`mat-${m.material_id}`}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => toggleExpand(m.material_id)}
                    >
                      <TableCell className="w-6 pl-3 pr-0">
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 text-slate-400" />
                          : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      </TableCell>
                      <TableCell className="font-medium">
                        {m.material_name}
                        {unit && <span className="text-slate-400 text-xs ml-1">({unit})</span>}
                      </TableCell>
                      <TableCell className="text-right">{m.total_allocated.toFixed(3)}</TableCell>
                      <TableCell className="text-right">{m.total_used.toFixed(3)}</TableCell>
                      <TableCell className="text-right">{m.total_returned.toFixed(3)}</TableCell>
                      <TableCell className="text-right font-semibold">{m.remaining_unused.toFixed(3)}</TableCell>
                      <TableCell className="text-right">Rs. {m.cost_allocated.toFixed(2)}</TableCell>
                      <TableCell className="text-right">Rs. {m.cost_used.toFixed(2)}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={() => openDialog(m, 'record')}
                            disabled={m.remaining_unused <= 0}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            <Play className="h-3 w-3 mr-1" /> Record
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openDialog(m, 'revert')}
                            disabled={m.revertible_used <= 0}
                          >
                            <Undo2 className="h-3 w-3 mr-1" /> Revert
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>,

                    /* ── Variant breakdown sub-rows (FIFO order: allocated oldest → newest) ── */
                    ...(isExpanded
                      ? m.variants.map((v) => {
                          const units = toUnits(v.qty_allocated, v.quantity_per_unit);
                          const remainingUnits = toUnits(v.qty_remaining, v.quantity_per_unit);
                          const usedUnits = toUnits(v.qty_used, v.quantity_per_unit);

                          return (
                            <TableRow key={`var-${m.material_id}-${v.variant_id}`} className="bg-blue-50/40 text-sm">
                              <TableCell />
                              <TableCell className="pl-8">
                                <div className="flex items-start gap-2">
                                  <Package className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                                  <div>
                                    <div className="font-medium text-slate-700">
                                      {v.quantity_variant_name ?? v.variant_name}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      Rs.{Number(v.unit_price).toFixed(2)}/{unit || 'unit'}
                                      <span className="ml-1 text-[10px] text-slate-400">(incl. GST)</span>
                                      {v.quantity_per_unit && (
                                        <span className="ml-1 text-slate-400">
                                          · {v.quantity_per_unit}{unit}/unit
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-slate-600">
                                <div>{v.qty_allocated.toFixed(3)}</div>
                                {units && <div className="text-xs text-slate-400">{units}</div>}
                              </TableCell>
                              <TableCell className="text-right text-slate-600">
                                <div>{v.qty_used.toFixed(3)}</div>
                                {usedUnits && <div className="text-xs text-slate-400">{usedUnits}</div>}
                              </TableCell>
                              <TableCell className="text-right text-slate-600">
                                {v.qty_returned.toFixed(3)}
                              </TableCell>
                              <TableCell className="text-right font-semibold text-slate-700">
                                <div>{v.qty_remaining.toFixed(3)}</div>
                                {remainingUnits && <div className="text-xs text-slate-400">{remainingUnits}</div>}
                              </TableCell>
                              <TableCell className="text-right text-slate-500 text-xs">
                                Rs. {(v.qty_allocated * v.unit_price).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right text-slate-500 text-xs">
                                Rs. {(v.qty_used * v.unit_price).toFixed(2)}
                              </TableCell>
                              <TableCell />
                            </TableRow>
                          );
                        })
                      : []),
                  ];
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Record / Revert Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setSelected(null); setMvInput(null); setUnitsInput(''); } }}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action === 'record' ? 'Record On-Site Usage (FIFO)' : 'Revert Usage (LIFO)'}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              {/* Material summary */}
              <div className="text-sm text-slate-600 space-y-1">
                <div>
                  <strong>{selected.material_name}</strong>
                  {selected.metric && <span className="text-slate-400 ml-1">({selected.metric})</span>}
                </div>
                <div>
                  Allocated: {selected.total_allocated.toFixed(3)} ·
                  Used: {selected.total_used.toFixed(3)} ·
                  Returned: {selected.total_returned.toFixed(3)}
                </div>
                <div>
                  {action === 'record' ? (
                    <>Available to use: <strong>{selected.remaining_unused.toFixed(3)} {selected.metric || ''}</strong></>
                  ) : (
                    <>Revertible used: <strong>{selected.revertible_used.toFixed(3)} {selected.metric || ''}</strong></>
                  )}
                </div>
              </div>

              {/* Packaging variant (MV) selector */}
              {(() => {
                // Aggregate variants by packaging type
                const pkgMap = new Map<number, PkgVariant>();
                selected.variants.forEach(v => {
                  const key = v.quantity_variant_id ?? -v.variant_id;
                  const avail = action === 'record' ? v.qty_remaining : v.qty_used;
                  if (!pkgMap.has(key)) {
                    pkgMap.set(key, {
                      qty_variant_id:   v.quantity_variant_id,
                      qty_variant_name: v.quantity_variant_name ?? v.variant_name,
                      quantity_per_unit: v.quantity_per_unit,
                      qty_available: 0,
                    });
                  }
                  pkgMap.get(key)!.qty_available += avail;
                });
                const pkgList = Array.from(pkgMap.values()).filter(p => p.qty_available > 0);

                const selPkg = mvInput !== null ? pkgMap.get(mvInput) ?? null : null;
                const qpu    = selPkg?.quantity_per_unit ?? null;
                const unitsN = parseFloat(unitsInput);
                const totalQty = selPkg && qpu && !isNaN(unitsN) && unitsN > 0
                  ? unitsN * qpu : null;

                return (
                  <div className="space-y-3">
                    {/* MV cards */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Packaging Variant (Material Variant)
                      </Label>
                      <div className="rounded border divide-y text-xs overflow-hidden">
                        {pkgList.map(pv => {
                          const isSelected = mvInput === pv.qty_variant_id;
                          const stockUnits = pv.quantity_per_unit
                            ? (pv.qty_available / pv.quantity_per_unit).toFixed(2) + ' units'
                            : null;
                          return (
                            <button
                              key={pv.qty_variant_id ?? pv.qty_variant_name}
                              type="button"
                              onClick={() => {
                                setMvInput(isSelected ? null : (pv.qty_variant_id ?? null));
                                setUnitsInput('');
                              }}
                              className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                                isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="font-medium text-slate-800">{pv.qty_variant_name}</div>
                              <div className="text-right text-slate-500 shrink-0 ml-4">
                                <div className="font-semibold text-slate-700">
                                  {pv.qty_available.toFixed(3)} {selected.metric}
                                </div>
                                {stockUnits && <div>{stockUnits}</div>}
                              </div>
                            </button>
                          );
                        })}
                        {pkgList.length === 0 && (
                          <div className="px-3 py-2 text-slate-400">
                            No {action === 'record' ? 'available' : 'used'} stock found.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Units input — shown only after a packaging variant is picked. */}
                    {selPkg && qpu ? (
                      <div className="space-y-1.5">
                        <Label>Number of {selPkg.qty_variant_name}s * <span className="text-xs text-slate-400">(multiples of {QUANTITY_STEP})</span></Label>
                        <Input
                          type="number" step={QUANTITY_STEP} min={QUANTITY_STEP}
                          value={unitsInput}
                          onChange={(e) => setUnitsInput(e.target.value)}
                          placeholder={`e.g. ${Math.floor(selPkg.qty_available / qpu)}`}
                          autoFocus
                        />
                        {totalQty !== null && (
                          <div className="text-xs bg-blue-50 border border-blue-100 rounded px-3 py-1.5 text-blue-700 font-medium">
                            = {totalQty.toFixed(3)} {selected.metric}
                            <span className="text-blue-400 font-normal ml-1">
                              ({unitsInput} × {qpu} {selected.metric})
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-slate-400">
                          {action === 'record'
                            ? 'FIFO picks the oldest-allocated price variant of this packaging first.'
                            : 'LIFO un-consumes the most recently used price variant of this packaging first.'}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                        Select a packaging variant above to enter the number of units.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className={action === 'record' ? 'bg-blue-600 hover:bg-blue-700' : ''}
              variant={action === 'record' ? 'default' : 'outline'}
            >
              {saving
                ? (action === 'record' ? 'Recording…' : 'Reverting…')
                : (action === 'record' ? 'Record Usage' : 'Revert Usage')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
