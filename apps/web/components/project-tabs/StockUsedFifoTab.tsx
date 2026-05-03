'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Box, Play, Undo2 } from 'lucide-react';

type MaterialRow = {
  material_id: number;
  material_name: string;
  metric: string | null;
  total_allocated: number;
  total_used: number;
  total_returned: number;
  remaining_unused: number;    // allocated − used − returned
  revertible_used: number;     // total_used (you can revert up to this)
  cost_allocated: number;
  cost_used: number;
};

type Action = 'record' | 'revert';

export default function StockUsedFifoTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [action, setAction] = useState<Action>('record');
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('project_allocation_breakdown')
      .select('material_id, material_name, metric, qty_allocated, qty_used, qty_returned, unit_price')
      .eq('project_id', numericProjectId);

    if (error) {
      console.error(error);
      toast.error('Failed to load project inventory: ' + error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    // Aggregate per material.
    const byMat = new Map<number, MaterialRow>();
    for (const r of (data as any[]) || []) {
      const id = r.material_id as number;
      if (!byMat.has(id)) {
        byMat.set(id, {
          material_id: id,
          material_name: r.material_name,
          metric: r.metric,
          total_allocated: 0,
          total_used: 0,
          total_returned: 0,
          remaining_unused: 0,
          revertible_used: 0,
          cost_allocated: 0,
          cost_used: 0,
        });
      }
      const m = byMat.get(id)!;
      const qa = Number(r.qty_allocated || 0);
      const qu = Number(r.qty_used || 0);
      const qr = Number(r.qty_returned || 0);
      const up = Number(r.unit_price || 0);
      m.total_allocated += qa;
      m.total_used      += qu;
      m.total_returned  += qr;
      m.cost_allocated  += qa * up;
      m.cost_used       += qu * up;
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

  const openDialog = (mat: MaterialRow, act: Action) => {
    setSelected(mat);
    setAction(act);
    setQtyInput('');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    const qty = Number(qtyInput);
    if (!qty || qty <= 0) { toast.error('Quantity must be > 0'); return; }

    if (action === 'record') {
      if (qty > selected.remaining_unused + 1e-9) {
        toast.error(`Only ${selected.remaining_unused.toFixed(3)} available to use`);
        return;
      }
    } else {
      if (qty > selected.revertible_used + 1e-9) {
        toast.error(`Only ${selected.revertible_used.toFixed(3)} recorded as used (revertible)`);
        return;
      }
    }

    setSaving(true);
    const rpc = action === 'record'
      ? 'record_material_usage_by_material'
      : 'revert_material_usage_by_material';
    const params = action === 'record'
      ? { p_project_id: numericProjectId, p_material_id: selected.material_id, p_qty_used: qty }
      : { p_project_id: numericProjectId, p_material_id: selected.material_id, p_qty_to_revert: qty };

    const { data, error } = await supabase.rpc(rpc, params as any);
    setSaving(false);

    if (error) { toast.error(error.message); return; }

    const result = Array.isArray(data) ? data[0] : data;
    if (action === 'record') {
      const cost = Number(result?.cost_of_usage || 0);
      toast.success(`Recorded ${qty} used — cost Rs. ${cost.toFixed(2)} (FIFO)`);
    } else {
      const value = Number(result?.value_reverted || 0);
      toast.success(`Reverted ${qty} used — value Rs. ${value.toFixed(2)} (LIFO)`);
    }

    setDialogOpen(false);
    setSelected(null);
    setQtyInput('');
    fetchAll();

    // Tell Project Inventory / Costing tabs to re-fetch if they listen.
    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { projectId } }));
  };

  const totalAllocatedCost = rows.reduce((s, m) => s + m.cost_allocated, 0);
  const totalUsedCost = rows.reduce((s, m) => s + m.cost_used, 0);

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
            Enter quantity consumed on-site. The system picks the oldest-allocated stock first (FIFO) and calculates exact cost automatically.
            Revert Usage (LIFO) un-consumes — stock returns to the project&apos;s allocated-but-unused pool, NOT to the store.
          </p>
        </CardHeader>
        <CardContent>
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
                  const unit = m.metric || '';
                  return (
                    <TableRow key={m.material_id}>
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
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={() => openDialog(m, 'record')}
                            disabled={m.remaining_unused <= 0}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            <Play className="h-3 w-3 mr-1" /> Record Usage
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setSelected(null); setQtyInput(''); } }}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action === 'record' ? 'Record On-Site Usage (FIFO)' : 'Revert Usage (LIFO)'}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-slate-600 space-y-1">
                <div><strong>{selected.material_name}</strong>{selected.metric && <span className="text-slate-400 ml-1">({selected.metric})</span>}</div>
                <div>Allocated: {selected.total_allocated.toFixed(3)} &middot; Used: {selected.total_used.toFixed(3)} &middot; Returned: {selected.total_returned.toFixed(3)}</div>
                <div>
                  {action === 'record' ? (
                    <>Available to use: <strong>{selected.remaining_unused.toFixed(3)} {selected.metric || ''}</strong></>
                  ) : (
                    <>Revertible (recorded-used): <strong>{selected.revertible_used.toFixed(3)} {selected.metric || ''}</strong></>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  type="number" step="0.001" min={0}
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-slate-500">
                  {action === 'record'
                    ? 'FIFO consumes the oldest allocated stock first. Cost is derived from each variant’s exact unit price — no averaging.'
                    : 'LIFO unconsumes the most-recently-used stock first. The reverted quantity returns to the project’s allocated-but-unused pool (not to the store).'}
                </p>
              </div>
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
