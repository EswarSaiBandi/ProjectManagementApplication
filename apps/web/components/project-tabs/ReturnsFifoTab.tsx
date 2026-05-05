'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Undo2, RotateCcw, X, ChevronDown, ChevronRight, Package } from 'lucide-react';

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
  qty_returnable: number;             // allocated − used − returned for this packaging type
};

type MaterialRow = {
  material_id: number;
  material_name: string;
  metric: string | null;
  total_allocated: number;
  total_used: number;
  total_returned: number;
  pending_return: number;
  returnable: number;           // after deducting pending returns
  variants: VariantBreakdown[];
};

type PendingReturn = {
  return_id: number;
  return_number: string;
  material_id: number;
  material_name: string;
  metric: string | null;
  returned_quantity: number;
  condition: string;
  reason: string | null;
  created_at: string;
};

const CONDITION_OPTIONS = ['Excellent', 'Good', 'Fair', 'Damaged'];

/* ─────────────────────────── Helpers ───────────────────────────── */

function toUnits(qty: number, qtyPerUnit: number | null): string | null {
  if (!qtyPerUnit || qtyPerUnit <= 0) return null;
  return (qty / qtyPerUnit).toFixed(2) + ' units';
}

/* ─────────────────────────── Component ─────────────────────────── */

export default function ReturnsFifoTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [pending, setPending] = useState<PendingReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  // variantUnits[pkg_key] = physical units being returned for that packaging variant.
  // pkg_key is qty_variant_id when the price variant has a packaging, or -variant_id for legacy rows.
  const [variantUnits, setVariantUnits] = useState<Record<number, string>>({});
  const [conditionInput, setConditionInput] = useState(CONDITION_OPTIONS[1]);
  const [reasonInput, setReasonInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    const [breakdownRes, pendingRes] = await Promise.all([
      supabase
        .from('project_allocation_breakdown')
        .select(
          'material_id, material_name, metric, ' +
          'variant_id, quantity_variant_id, variant_name, quantity_variant_name, quantity_per_unit, unit_price, ' +
          'qty_allocated, qty_used, qty_returned'
        )
        .eq('project_id', numericProjectId),

      supabase
        .from('material_returns')
        .select(`
          return_id, return_number, project_id, material_id, returned_quantity,
          condition, reason, created_at,
          materials_master!inner(material_name, metric)
        `)
        .eq('project_id', numericProjectId)
        .eq('status', 'Pending')
        .order('created_at', { ascending: false }),
    ]);

    if (breakdownRes.error) {
      toast.error('Failed to load project inventory: ' + breakdownRes.error.message);
      setRows([]);
      setPending([]);
      setLoading(false);
      return;
    }
    if (pendingRes.error) {
      toast.error('Failed to load pending returns: ' + pendingRes.error.message);
    }

    const pendingList: PendingReturn[] = ((pendingRes.data as any[]) || []).map((r) => ({
      return_id:         r.return_id,
      return_number:     r.return_number,
      material_id:       r.material_id,
      material_name:     r.materials_master?.material_name || 'Unknown',
      metric:            r.materials_master?.metric ?? null,
      returned_quantity: Number(r.returned_quantity || 0),
      condition:         r.condition,
      reason:            r.reason,
      created_at:        r.created_at,
    }));

    const pendingByMat = new Map<number, number>();
    for (const p of pendingList) {
      pendingByMat.set(p.material_id, (pendingByMat.get(p.material_id) || 0) + p.returned_quantity);
    }

    // Build per-material aggregations with per-variant breakdown.
    const byMat = new Map<number, MaterialRow>();

    for (const r of (breakdownRes.data as any[]) || []) {
      const matId = r.material_id as number;
      const varId = r.variant_id as number;

      if (!byMat.has(matId)) {
        byMat.set(matId, {
          material_id:    matId,
          material_name:  r.material_name,
          metric:         r.metric,
          total_allocated: 0,
          total_used:     0,
          total_returned: 0,
          pending_return: 0,
          returnable:     0,
          variants:       [],
        });
      }

      const m  = byMat.get(matId)!;
      const qa = Number(r.qty_allocated || 0);
      const qu = Number(r.qty_used || 0);
      const qr = Number(r.qty_returned || 0);
      const up = Number(r.unit_price || 0);

      m.total_allocated += qa;
      m.total_used      += qu;
      m.total_returned  += qr;

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
      m.pending_return = pendingByMat.get(m.material_id) || 0;
      m.returnable     = m.total_allocated - m.total_used - m.total_returned - m.pending_return;
    });

    setRows(
      Array.from(byMat.values())
        .filter((m) => m.total_allocated > 0)
        .sort((a, b) => a.material_name.localeCompare(b.material_name)),
    );
    setPending(pendingList);
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

  const openDialog = (m: MaterialRow) => {
    setSelected(m);
    setVariantUnits({});
    setConditionInput(CONDITION_OPTIONS[1]);
    setReasonInput('');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    if (!conditionInput) { toast.error('Condition is required'); return; }

    // Re-derive the packaging map so submit and UI stay consistent.
    const pkgMap = new Map<number, PkgVariant>();
    selected.variants.forEach(v => {
      const key = v.quantity_variant_id ?? -v.variant_id;
      if (!pkgMap.has(key)) {
        pkgMap.set(key, {
          qty_variant_id:    v.quantity_variant_id,
          qty_variant_name:  v.quantity_variant_name ?? v.variant_name,
          quantity_per_unit: v.quantity_per_unit,
          qty_returnable:    0,
        });
      }
      pkgMap.get(key)!.qty_returnable += v.qty_remaining;
    });

    // Build the list of per-MV submissions from variantUnits (one row per MV with a positive entry).
    const submissions: Array<{
      pkg_key:          number;
      qty_variant_id:   number | null;
      qty_variant_name: string;
      qty:              number;
      number_of_units:  number | null;
    }> = [];

    for (const [pkgKeyStr, raw] of Object.entries(variantUnits)) {
      const pkgKey = Number(pkgKeyStr);
      const pv     = pkgMap.get(pkgKey);
      if (!pv) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;

      const qpu = pv.quantity_per_unit;
      const qty = qpu ? n * qpu : n;       // qpu null → input already in base metric
      const numberOfUnits = qpu ? n : null;

      if (qty - pv.qty_returnable > 1e-9) {
        toast.error(`"${pv.qty_variant_name}": only ${pv.qty_returnable.toFixed(3)} ${selected.metric || ''} returnable`);
        return;
      }

      submissions.push({
        pkg_key:          pkgKey,
        qty_variant_id:   pv.qty_variant_id,
        qty_variant_name: pv.qty_variant_name,
        qty,
        number_of_units:  numberOfUnits,
      });
    }

    if (submissions.length === 0) {
      toast.error('Enter units for at least one packaging variant');
      return;
    }

    const totalQty = submissions.reduce((s, r) => s + r.qty, 0);
    if (totalQty - selected.returnable > 1e-9) {
      toast.error(`Total ${totalQty.toFixed(3)} exceeds ${selected.returnable.toFixed(3)} ${selected.metric || ''} returnable for this material`);
      return;
    }

    setSaving(true);
    const succeeded: string[] = [];
    for (const s of submissions) {
      const { data, error } = await supabase.rpc('submit_material_return_request', {
        p_project_id:  numericProjectId,
        p_material_id: selected.material_id,
        p_quantity:    s.qty,
        p_condition:   conditionInput,
        p_reason:      reasonInput.trim() || null,
        ...(s.qty_variant_id   !== null && { p_qty_variant_id:  s.qty_variant_id }),
        ...(s.number_of_units  !== null && { p_number_of_units: s.number_of_units }),
      });
      if (error) {
        setSaving(false);
        const soFar = succeeded.length
          ? ` (${succeeded.length} request${succeeded.length === 1 ? '' : 's'} already submitted: ${succeeded.join(', ')})`
          : '';
        toast.error(`"${s.qty_variant_name}" failed: ${error.message}${soFar}`);
        fetchAll();
        return;
      }
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.return_number) succeeded.push(result.return_number);
    }
    setSaving(false);

    toast.success(
      submissions.length === 1
        ? `Return request submitted (${succeeded[0] || '#'}), awaiting store approval`
        : `${submissions.length} return requests submitted (${succeeded.join(', ')}), awaiting store approval`,
    );
    setDialogOpen(false);
    setSelected(null);
    setVariantUnits({});
    fetchAll();
    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { projectId } }));
  };

  const handleCancel = async (p: PendingReturn) => {
    if (!confirm(`Cancel return request ${p.return_number} (${p.returned_quantity.toFixed(3)} ${p.metric || ''} of ${p.material_name})?`)) return;
    const reason = window.prompt('Reason for cancellation (optional):', '') || undefined;

    setCancellingId(p.return_id);
    const { error } = await supabase.rpc('cancel_material_return_request', {
      p_return_id: p.return_id,
      p_reason:    reason?.trim() || null,
    });
    setCancellingId(null);

    if (error) { toast.error(error.message); return; }
    toast.success(`Return request ${p.return_number} cancelled`);
    fetchAll();
    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { projectId } }));
  };

  return (
    <div className="space-y-4">
      {/* Per-material returnable summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Undo2 className="h-5 w-5 text-slate-500" />
            Return to Store
          </CardTitle>
          <p className="text-sm text-slate-600 mt-2">
            Submit a return request per packaging (material + MV + units + condition). Stock moves back to the store only after admin approves — LIFO at that point (newest allocation slice of the same packaging credited first).
            Click a row to see the packaging-variant breakdown.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-slate-500 text-sm p-4">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-500 py-10">
              <Undo2 className="h-10 w-10 mx-auto text-slate-300 mb-2" />
              <p className="font-medium">No materials allocated to this project.</p>
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
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Returnable</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const unit = m.metric || '';
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
                      <TableCell className="text-right">
                        {m.pending_return > 0 ? (
                          <Badge variant="outline" className="text-amber-700 border-amber-300">
                            {m.pending_return.toFixed(3)}
                          </Badge>
                        ) : '0.000'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{m.returnable.toFixed(3)}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDialog(m)}
                          disabled={m.returnable <= 0}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> Request Return
                        </Button>
                      </TableCell>
                    </TableRow>,

                    /* ── Variant breakdown sub-rows ── */
                    ...(isExpanded
                      ? m.variants.map((v) => {
                          const remaining = v.qty_allocated - v.qty_used - v.qty_returned;
                          const remUnits  = toUnits(remaining, v.quantity_per_unit);
                          const allocUnits = toUnits(v.qty_allocated, v.quantity_per_unit);

                          return (
                            <TableRow key={`var-${m.material_id}-${v.variant_id}`} className="bg-green-50/40 text-sm">
                              <TableCell />
                              <TableCell className="pl-8">
                                <div className="flex items-start gap-2">
                                  <Package className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                                  <div>
                                    <div className="font-medium text-slate-700">
                                      {v.quantity_variant_name ?? v.variant_name}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      Rs.{Number(v.unit_price).toFixed(2)}/{unit || 'unit'}
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
                                {allocUnits && <div className="text-xs text-slate-400">{allocUnits}</div>}
                              </TableCell>
                              <TableCell className="text-right text-slate-600">{v.qty_used.toFixed(3)}</TableCell>
                              <TableCell className="text-right text-slate-600">{v.qty_returned.toFixed(3)}</TableCell>
                              <TableCell />
                              <TableCell className="text-right font-semibold text-slate-700">
                                <div>{remaining.toFixed(3)}</div>
                                {remUnits && <div className="text-xs text-slate-400">{remUnits}</div>}
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

      {/* Pending return requests list */}
      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Return Requests ({pending.length})</CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Awaiting review on the Store → Material Returns tab. Stock movement (LIFO) happens only after the store accepts.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Return #</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => (
                  <TableRow key={p.return_id}>
                    <TableCell className="font-mono text-xs">{p.return_number}</TableCell>
                    <TableCell>
                      {p.material_name}
                      {p.metric && <span className="text-slate-400 text-xs ml-1">({p.metric})</span>}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{p.returned_quantity.toFixed(3)}</TableCell>
                    <TableCell><Badge variant="outline">{p.condition}</Badge></TableCell>
                    <TableCell className="text-xs text-slate-600 max-w-[280px] truncate" title={p.reason || ''}>
                      {p.reason || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {new Date(p.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancel(p)}
                        disabled={cancellingId === p.return_id}
                        className="text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <X className="h-3 w-3 mr-1" />
                        {cancellingId === p.return_id ? 'Cancelling…' : 'Cancel'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Submit return dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setSelected(null); setVariantUnits({}); } }}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Request Return to Store (LIFO on approval)</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              {/* Material + returnable summary */}
              <div className="text-sm text-slate-600 space-y-1">
                <div>
                  <strong>{selected.material_name}</strong>
                  {selected.metric && <span className="text-slate-400 ml-1">({selected.metric})</span>}
                </div>
                <div>
                  Returnable now:{' '}
                  <strong>{selected.returnable.toFixed(3)} {selected.metric || ''}</strong>
                </div>
                {selected.pending_return > 0 && (
                  <div className="text-amber-700 text-xs">
                    {selected.pending_return.toFixed(3)} already pending in other return requests.
                  </div>
                )}
              </div>

              {/* Per-packaging-variant units grid — mirrors the admin fulfill dialog. */}
              {(() => {
                const pkgList: Array<PkgVariant & { pkg_key: number }> = (() => {
                  const m = new Map<number, PkgVariant & { pkg_key: number }>();
                  selected.variants.forEach(v => {
                    const key = v.quantity_variant_id ?? -v.variant_id;
                    if (!m.has(key)) {
                      m.set(key, {
                        pkg_key:           key,
                        qty_variant_id:    v.quantity_variant_id,
                        qty_variant_name:  v.quantity_variant_name ?? v.variant_name,
                        quantity_per_unit: v.quantity_per_unit,
                        qty_returnable:    0,
                      });
                    }
                    m.get(key)!.qty_returnable += v.qty_remaining;
                  });
                  return Array.from(m.values()).filter(p => p.qty_returnable > 0);
                })();

                const metric = selected.metric || '';

                const totalQty = pkgList.reduce((sum, pv) => {
                  const n = parseFloat(variantUnits[pv.pkg_key] ?? '');
                  if (!Number.isFinite(n) || n <= 0) return sum;
                  return sum + n * (pv.quantity_per_unit ?? 1);
                }, 0);

                const hasAnyUnits = totalQty > 0;
                const overReturnable = totalQty - selected.returnable > 1e-9;

                return (
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">
                      Return Units per Packaging Variant
                    </Label>

                    {pkgList.length === 0 ? (
                      <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                        No returnable stock found for this material.
                      </div>
                    ) : (
                      <>
                        <div className="rounded border text-xs overflow-hidden">
                          <div className="bg-slate-100 grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 font-semibold text-slate-600">
                            <span>Packaging</span>
                            <span className="text-right">Returnable</span>
                            <span className="text-right w-20">Units</span>
                            <span className="text-right w-20">= {metric}</span>
                          </div>
                          {pkgList.map(pv => {
                            const qpu      = pv.quantity_per_unit ?? 1;
                            const unitsVal = variantUnits[pv.pkg_key] ?? '';
                            const numUnits = parseFloat(unitsVal);
                            const rowQty   = Number.isFinite(numUnits) && numUnits > 0 ? numUnits * qpu : null;
                            const stockInUnits = pv.quantity_per_unit
                              ? (pv.qty_returnable / pv.quantity_per_unit).toFixed(2) + ' units'
                              : null;
                            return (
                              <div
                                key={pv.pkg_key}
                                className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2 items-center border-t transition-colors ${
                                  rowQty ? 'bg-blue-50' : ''
                                }`}
                              >
                                <div>
                                  <div className="font-medium text-slate-800">
                                    {pv.qty_variant_name}
                                  </div>
                                  <div className="text-slate-400">
                                    {pv.quantity_per_unit
                                      ? `${pv.quantity_per_unit} ${metric}/unit`
                                      : `base-metric row`}
                                  </div>
                                </div>
                                <div className="text-right text-slate-500 shrink-0">
                                  <div className="font-semibold text-slate-700">
                                    {pv.qty_returnable.toFixed(3)} {metric}
                                  </div>
                                  {stockInUnits && <div>{stockInUnits}</div>}
                                </div>
                                <Input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  value={unitsVal}
                                  onChange={(e) =>
                                    setVariantUnits(prev => ({
                                      ...prev,
                                      [pv.pkg_key]: e.target.value,
                                    }))
                                  }
                                  className="bg-white w-20 text-right text-xs h-7 px-2"
                                  placeholder="0"
                                />
                                <div className={`text-right font-semibold w-20 ${rowQty ? 'text-blue-700' : 'text-slate-300'}`}>
                                  {rowQty !== null ? rowQty.toFixed(2) : '—'}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {hasAnyUnits && (
                          <div className={`text-xs rounded px-3 py-2 font-medium flex items-center justify-between border ${
                            overReturnable
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-green-50 text-green-700 border-green-200'
                          }`}>
                            <span>Total: {totalQty.toFixed(3)} {metric}</span>
                            <span>
                              {overReturnable
                                ? `exceeds ${selected.returnable.toFixed(3)} ${metric} returnable`
                                : `${(selected.returnable - totalQty).toFixed(3)} ${metric} remaining`}
                            </span>
                          </div>
                        )}

                        <p className="text-xs text-slate-400">
                          One return request per packaging. Price variant is auto-picked LIFO on approval
                          (newest allocation slice of that packaging credited first).
                        </p>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Condition */}
              <div className="space-y-2">
                <Label>Condition *</Label>
                <Select value={conditionInput} onValueChange={setConditionInput}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    {CONDITION_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Reason */}
              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  rows={2}
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  placeholder="Why are you returning this stock?"
                />
                <p className="text-xs text-slate-500">
                  Stock is not moved yet. Each packaging creates its own return request; on approval, LIFO credits the newest allocation slice of that packaging back to its original batch.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
              {saving ? 'Submitting…' : 'Submit Return Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
