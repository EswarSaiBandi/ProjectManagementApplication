'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Package, ChevronDown, ChevronRight, IndianRupee } from 'lucide-react';

type BreakdownRow = {
  project_id: number;
  project_name: string;
  allocation_id: number;
  allocation_date: string;
  allocation_status: string;
  material_id: number;
  material_name: string;
  metric: string | null;
  breakdown_id: number;
  variant_id: number;
  variant_name: string;
  batch_id: number;
  batch_date: string | null;
  unit_price: number;
  qty_allocated: number;
  qty_used: number;
  qty_returned: number;
  qty_remaining: number;
  cost_allocated: number;
  cost_used: number;
  value_returned: number;
  value_remaining: number;
};

type MaterialAggregate = {
  material_id: number;
  material_name: string;
  metric: string | null;
  total_allocated: number;
  total_used: number;
  total_returned: number;
  total_remaining: number;
  total_cost_allocated: number;
  total_cost_used: number;
  rows: BreakdownRow[];
};

export default function ProjectInventoryTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('project_allocation_breakdown')
      .select('*')
      .eq('project_id', numericProjectId)
      .order('material_name')
      .order('allocation_date', { ascending: false })
      .order('breakdown_id');

    if (error) {
      toast.error('Failed to load project inventory: ' + error.message);
      setRows([]);
    } else {
      setRows((data as BreakdownRow[]) || []);
    }
    setLoading(false);
  }, [numericProjectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (detail?.projectId === projectId) fetchAll();
    };
    window.addEventListener('inventory-updated', handler);
    return () => window.removeEventListener('inventory-updated', handler);
  }, [projectId, fetchAll]);

  const aggregates = useMemo<MaterialAggregate[]>(() => {
    const byMat = new Map<number, MaterialAggregate>();
    for (const r of rows) {
      if (!byMat.has(r.material_id)) {
        byMat.set(r.material_id, {
          material_id: r.material_id,
          material_name: r.material_name,
          metric: r.metric,
          total_allocated: 0,
          total_used: 0,
          total_returned: 0,
          total_remaining: 0,
          total_cost_allocated: 0,
          total_cost_used: 0,
          rows: [],
        });
      }
      const m = byMat.get(r.material_id)!;
      m.total_allocated     += Number(r.qty_allocated || 0);
      m.total_used          += Number(r.qty_used || 0);
      m.total_returned      += Number(r.qty_returned || 0);
      m.total_remaining     += Number(r.qty_remaining || 0);
      m.total_cost_allocated += Number(r.cost_allocated || 0);
      m.total_cost_used      += Number(r.cost_used || 0);
      m.rows.push(r);
    }
    return Array.from(byMat.values()).sort((a, b) => a.material_name.localeCompare(b.material_name));
  }, [rows]);

  const toggle = (materialId: number) => {
    const next = new Set(expanded);
    if (next.has(materialId)) next.delete(materialId);
    else next.add(materialId);
    setExpanded(next);
  };

  const totalCostAllocated = aggregates.reduce((s, m) => s + m.total_cost_allocated, 0);
  const totalCostUsed = aggregates.reduce((s, m) => s + m.total_cost_used, 0);

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="border-b bg-slate-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            Project Inventory (FIFO Breakdown)
          </CardTitle>
          <div className="text-sm text-slate-600 text-right">
            <div>Allocated value: <IndianRupee className="inline h-3 w-3" />{totalCostAllocated.toFixed(2)}</div>
            <div>Consumed value: <IndianRupee className="inline h-3 w-3" />{totalCostUsed.toFixed(2)}</div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Materials currently tracked for this project. Click a row to expand the FIFO price-variant breakdown.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 text-slate-500 text-sm">Loading…</div>
        ) : aggregates.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <Package className="h-10 w-10 mx-auto mb-2 text-slate-300" />
            <p className="font-medium">No materials allocated to this project yet.</p>

          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-8"></TableHead>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="text-right">Alloc. Cost</TableHead>
                <TableHead className="text-right">Used Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aggregates.map((m) => {
                const unit = m.metric || '';
                const open = expanded.has(m.material_id);
                return (
                  <>
                    <TableRow
                      key={`mat-${m.material_id}`}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => toggle(m.material_id)}
                    >
                      <TableCell>
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-medium">{m.material_name}</TableCell>
                      <TableCell className="text-right">{m.total_allocated.toFixed(3)} {unit}</TableCell>
                      <TableCell className="text-right">{m.total_used.toFixed(3)}</TableCell>
                      <TableCell className="text-right">{m.total_returned.toFixed(3)}</TableCell>
                      <TableCell className="text-right font-semibold">{m.total_remaining.toFixed(3)}</TableCell>
                      <TableCell className="text-right">Rs. {m.total_cost_allocated.toFixed(2)}</TableCell>
                      <TableCell className="text-right">Rs. {m.total_cost_used.toFixed(2)}</TableCell>
                    </TableRow>
                    {open && (
                      <TableRow key={`mat-${m.material_id}-detail`}>
                        <TableCell colSpan={8} className="p-0 bg-slate-50">
                          <div className="p-4">
                            <div className="text-xs font-semibold text-slate-600 mb-2">
                              FIFO breakdown by allocation × price variant
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Alloc. Date</TableHead>
                                  <TableHead>Alloc. Status</TableHead>
                                  <TableHead>Variant</TableHead>
                                  <TableHead>Batch</TableHead>
                                  <TableHead className="text-right">Unit Price <span className="text-[10px] font-normal text-slate-400">(incl. GST)</span></TableHead>
                                  <TableHead className="text-right">Allocated</TableHead>
                                  <TableHead className="text-right">Used</TableHead>
                                  <TableHead className="text-right">Returned</TableHead>
                                  <TableHead className="text-right">Remaining</TableHead>
                                  <TableHead className="text-right">Line Cost</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {m.rows.map((r) => (
                                  <TableRow key={r.breakdown_id}>
                                    <TableCell className="text-sm">
                                      {new Date(r.allocation_date).toLocaleDateString()}
                                      <span className="text-slate-400 ml-1">#{r.allocation_id}</span>
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline">{r.allocation_status}</Badge>
                                    </TableCell>
                                    <TableCell className="text-sm">{r.variant_name}</TableCell>
                                    <TableCell className="text-xs">
                                      #{r.batch_id}
                                      {r.batch_date && (
                                        <span className="text-slate-400 ml-1">
                                          ({new Date(r.batch_date).toLocaleDateString()})
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right">Rs. {Number(r.unit_price).toFixed(2)}</TableCell>
                                    <TableCell className="text-right">{Number(r.qty_allocated).toFixed(3)}</TableCell>
                                    <TableCell className="text-right">{Number(r.qty_used).toFixed(3)}</TableCell>
                                    <TableCell className="text-right">{Number(r.qty_returned).toFixed(3)}</TableCell>
                                    <TableCell className="text-right font-semibold">{Number(r.qty_remaining).toFixed(3)}</TableCell>
                                    <TableCell className="text-right">Rs. {Number(r.cost_allocated).toFixed(2)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
