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
import { Undo2, RotateCcw, X } from 'lucide-react';

type MaterialRow = {
  material_id: number;
  material_name: string;
  metric: string | null;
  total_allocated: number;
  total_used: number;
  total_returned: number;       // already-accepted returns
  pending_return: number;        // pending return requests qty
  returnable: number;            // allocated - used - accepted_returns - pending
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

export default function ReturnsFifoTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [pending, setPending] = useState<PendingReturn[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [conditionInput, setConditionInput] = useState(CONDITION_OPTIONS[1]);
  const [reasonInput, setReasonInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    // Allocation breakdown per material (for this project)
    const breakdownRes = await supabase
      .from('project_allocation_breakdown')
      .select('material_id, material_name, metric, qty_allocated, qty_used, qty_returned')
      .eq('project_id', numericProjectId);

    // Pending returns (to subtract from returnable AND list below)
    const pendingRes = await supabase
      .from('material_returns')
      .select(`
        return_id, return_number, project_id, material_id, returned_quantity,
        condition, reason, created_at,
        materials_master!inner(material_name, metric)
      `)
      .eq('project_id', numericProjectId)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false });

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
      return_id: r.return_id,
      return_number: r.return_number,
      material_id: r.material_id,
      material_name: r.materials_master?.material_name || 'Unknown',
      metric: r.materials_master?.metric ?? null,
      returned_quantity: Number(r.returned_quantity || 0),
      condition: r.condition,
      reason: r.reason,
      created_at: r.created_at,
    }));

    // Pending qty per material
    const pendingByMat = new Map<number, number>();
    for (const p of pendingList) {
      pendingByMat.set(p.material_id, (pendingByMat.get(p.material_id) || 0) + p.returned_quantity);
    }

    // Aggregate breakdown per material
    const byMat = new Map<number, MaterialRow>();
    for (const r of (breakdownRes.data as any[]) || []) {
      const id = r.material_id as number;
      if (!byMat.has(id)) {
        byMat.set(id, {
          material_id: id,
          material_name: r.material_name,
          metric: r.metric,
          total_allocated: 0,
          total_used: 0,
          total_returned: 0,
          pending_return: 0,
          returnable: 0,
        });
      }
      const m = byMat.get(id)!;
      m.total_allocated += Number(r.qty_allocated || 0);
      m.total_used      += Number(r.qty_used || 0);
      m.total_returned  += Number(r.qty_returned || 0);
    }

    Array.from(byMat.values()).forEach((m) => {
      m.pending_return = pendingByMat.get(m.material_id) || 0;
      m.returnable = m.total_allocated - m.total_used - m.total_returned - m.pending_return;
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

  const openDialog = (m: MaterialRow) => {
    setSelected(m);
    setQtyInput(m.returnable.toString());
    setConditionInput(CONDITION_OPTIONS[1]);
    setReasonInput('');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    const qty = Number(qtyInput);
    if (!qty || qty <= 0) { toast.error('Quantity must be > 0'); return; }
    if (qty > selected.returnable + 1e-9) {
      toast.error(`Only ${selected.returnable.toFixed(3)} returnable for this material`);
      return;
    }
    if (!conditionInput) { toast.error('Condition is required'); return; }

    setSaving(true);
    const { data, error } = await supabase.rpc('submit_material_return_request', {
      p_project_id:  numericProjectId,
      p_material_id: selected.material_id,
      p_quantity:    qty,
      p_condition:   conditionInput,
      p_reason:      reasonInput.trim() || null,
    });
    setSaving(false);

    if (error) { toast.error(error.message); return; }

    const result = Array.isArray(data) ? data[0] : data;
    toast.success(`Return request submitted (${result?.return_number || '#'}), awaiting store approval`);
    setDialogOpen(false);
    setSelected(null);
    fetchAll();
    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { projectId } }));
  };

  const handleCancel = async (p: PendingReturn) => {
    if (!confirm(`Cancel return request ${p.return_number} (${p.returned_quantity.toFixed(3)} ${p.metric || ''} of ${p.material_name})?`)) return;
    const reason = window.prompt('Reason for cancellation (optional):', '') || undefined;

    setCancellingId(p.return_id);
    const { error } = await supabase.rpc('cancel_material_return_request', {
      p_return_id: p.return_id,
      p_reason: reason?.trim() || null,
    });
    setCancellingId(null);

    if (error) { toast.error(error.message); return; }
    toast.success(`Return request ${p.return_number} cancelled`);
    fetchAll();
    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { projectId } }));
  };

  return (
    <div className="space-y-4">
      {/* Per-material returnable summary + Request Return action */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Undo2 className="h-5 w-5 text-slate-500" />
            Return to Store
          </CardTitle>
          <p className="text-sm text-slate-600 mt-2">
            Submit a return request (material + quantity + condition). Stock moves only after store admin approves the request — LIFO at that point, newest-in-the-project slice returns first.
          </p>
        </CardHeader>
        <CardContent>
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
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Already Returned</TableHead>
                  <TableHead className="text-right">Pending Return</TableHead>
                  <TableHead className="text-right">Returnable</TableHead>
                  <TableHead className="text-right">Action</TableHead>
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
                      <TableCell className="text-right">
                        {m.pending_return > 0 ? (
                          <Badge variant="outline" className="text-amber-700 border-amber-300">
                            {m.pending_return.toFixed(3)}
                          </Badge>
                        ) : (
                          '0.000'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{m.returnable.toFixed(3)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDialog(m)}
                          disabled={m.returnable <= 0}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> Request Return
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending requests list */}
      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Return Requests ({pending.length})</CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Awaiting review on the Store &rarr; Material Returns tab. Stock movement (LIFO) happens only after the store accepts.
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
                    <TableCell>
                      <Badge variant="outline">{p.condition}</Badge>
                    </TableCell>
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

      {/* Submit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setSelected(null); }}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Request Return to Store</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-slate-600 space-y-1">
                <div><strong>{selected.material_name}</strong>{selected.metric && <span className="text-slate-400 ml-1">({selected.metric})</span>}</div>
                <div>Returnable now: <strong>{selected.returnable.toFixed(3)} {selected.metric || ''}</strong></div>
                {selected.pending_return > 0 && (
                  <div className="text-amber-700">
                    {selected.pending_return.toFixed(3)} already pending in other return requests.
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  type="number" step="0.001" min={0}
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  autoFocus
                />
              </div>
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
              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  rows={2}
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  placeholder="Why are you returning this stock?"
                />
                <p className="text-xs text-slate-500">
                  Stock is not moved yet. On approval, LIFO will credit the newest allocation slice back to its original batch.
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
