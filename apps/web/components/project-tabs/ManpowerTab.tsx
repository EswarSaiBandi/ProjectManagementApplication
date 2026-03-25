'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Plus, Pencil, Trash, Building2, UserCheck, DollarSign, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/* ─── Types ─────────────────────────────────────────────────────────── */
type LabourMaster = {
  id: number;
  name: string;
  labour_type: 'In-House' | 'Outsourced';
  designation: string | null;
  monthly_salary: number | null;
  is_active: boolean;
};

type ManpowerRow = {
  id: number;
  project_id: number;
  labour_id: number | null;
  labour_type: 'In-House' | 'Outsourced';
  start_date: string | null;
  end_date: string | null;
  bandwidth_pct: number | null;   // In-House only
  daily_wage: number | null;      // Outsourced only
  incentive: number | null;       // Outsourced only
  notes: string | null;
  created_at: string;
  // Joined from labour_master
  labour?: LabourMaster;
};

/* ─── Helpers ────────────────────────────────────────────────────────── */
function workingDays(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  if (e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

function calcCost(row: ManpowerRow): number | null {
  if (!row.start_date || !row.end_date) return null;
  const days = workingDays(row.start_date, row.end_date);
  if (row.labour_type === 'In-House') {
    const salary = row.labour?.monthly_salary;
    if (!salary || !row.bandwidth_pct) return null;
    const ratePerDay = salary / 24;
    return parseFloat((ratePerDay * (row.bandwidth_pct / 100) * days).toFixed(2));
  } else {
    if (!row.daily_wage) return null;
    return parseFloat(((row.daily_wage * days) + (row.incentive ?? 0)).toFixed(2));
  }
}

function fmt(n: number) { return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`; }

/* ─── Component ──────────────────────────────────────────────────────── */
export default function ManpowerTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [activeTab, setActiveTab] = useState<'in-house' | 'outsourced'>('in-house');
  const [rows, setRows] = useState<ManpowerRow[]>([]);
  const [labourMaster, setLabourMaster] = useState<LabourMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ManpowerRow | null>(null);

  const [form, setForm] = useState({
    labour_id: '',
    labour_type: 'In-House' as 'In-House' | 'Outsourced',
    start_date: '',
    end_date: '',
    bandwidth_pct: '',
    daily_wage: '',
    incentive: '',
    notes: '',
  });

  /* ── Fetch rows with labour info ── */
  const fetchRows = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    const { data: pmRows, error } = await supabase
      .from('project_manpower')
      .select('*')
      .eq('project_id', numericProjectId)
      .order('created_at', { ascending: false });

    if (error) { toast.error('Failed to load: ' + error.message); setLoading(false); return; }
    // Normalise: original column is 'labor_type' (no u); new migration adds 'labour_type' (with u)
    const pm = ((pmRows || []) as any[]).map(r => ({
      ...r,
      labour_type: r.labour_type ?? r.labor_type ?? 'In-House',
    })) as ManpowerRow[];

    const labourIds = [...new Set(pm.map(r => r.labour_id).filter(Boolean))];
    if (labourIds.length > 0) {
      const { data: lRows } = await supabase
        .from('labour_master')
        .select('id, name, labour_type, designation, monthly_salary, is_active')
        .in('id', labourIds);
      const map: Record<number, LabourMaster> = {};
      (lRows || []).forEach((l: any) => { map[l.id] = l; });
      setRows(pm.map(r => ({ ...r, labour: r.labour_id ? map[r.labour_id] : undefined })));
    } else {
      setRows(pm);
    }
    setLoading(false);
  };

  /* ── Fetch active labour master entries ── */
  const fetchLabourMaster = async () => {
    const { data } = await supabase
      .from('labour_master')
      .select('id, name, labour_type, designation, monthly_salary, is_active')
      .eq('is_active', true)
      .order('name');
    setLabourMaster((data || []) as LabourMaster[]);
  };

  useEffect(() => { fetchRows(); fetchLabourMaster(); }, [numericProjectId]);

  /* ── Derived ── */
  const inHouseRows    = rows.filter(r => r.labour_type === 'In-House');
  const outsourcedRows = rows.filter(r => r.labour_type === 'Outsourced');

  // Filter by the labour type chosen in the dialog form, not the current table tab
  const activeLabour = labourMaster.filter(l => l.labour_type === form.labour_type);

  const selectedLabour = labourMaster.find(l => l.id === Number(form.labour_id));

  /* ── Cost preview for dialog ── */
  const costPreview = useMemo(() => {
    if (!form.start_date || !form.end_date) return null;
    const days = workingDays(form.start_date, form.end_date);
    if (days <= 0) return null;
    if (form.labour_type === 'In-House') {
      const salary = selectedLabour?.monthly_salary;
      const bw = Number(form.bandwidth_pct);
      if (!salary || !bw) return null;
      return (salary / 24) * (bw / 100) * days;
    } else {
      const dw = Number(form.daily_wage);
      if (!dw) return null;
      return (dw * days) + (Number(form.incentive) || 0);
    }
  }, [form, selectedLabour]);

  /* ── Total cost per tab ── */
  const totalInHouseCost    = inHouseRows.reduce((s, r) => s + (calcCost(r) ?? 0), 0);
  const totalOutsourcedCost = outsourcedRows.reduce((s, r) => s + (calcCost(r) ?? 0), 0);

  /* ── Reset / Open ── */
  const resetForm = () => setForm({
    labour_id: '',
    labour_type: activeTab === 'in-house' ? 'In-House' : 'Outsourced',
    start_date: '',
    end_date: '',
    bandwidth_pct: '',
    daily_wage: '',
    incentive: '',
    notes: '',
  });

  const openNew = () => { setEditing(null); resetForm(); setIsOpen(true); };

  const openEdit = (r: ManpowerRow) => {
    setEditing(r);
    setForm({
      labour_id:     String(r.labour_id ?? ''),
      labour_type:   r.labour_type,
      start_date:    r.start_date ? r.start_date.split('T')[0] : '',
      end_date:      r.end_date   ? r.end_date.split('T')[0]   : '',
      bandwidth_pct: r.bandwidth_pct != null ? String(r.bandwidth_pct) : '',
      daily_wage:    r.daily_wage  != null ? String(r.daily_wage)  : '',
      incentive:     r.incentive   != null ? String(r.incentive)   : '',
      notes:         r.notes || '',
    });
    setIsOpen(true);
  };

  /* ── Save ── */
  const handleSave = async () => {
    if (isSaving) return;
    if (!form.labour_id)    { toast.error('Please select a person'); return; }
    if (!form.start_date)   { toast.error('Start date is required'); return; }
    if (!form.end_date)     { toast.error('End date is required'); return; }
    if (new Date(form.start_date) > new Date(form.end_date)) { toast.error('End date must be after start date'); return; }

    if (form.labour_type === 'In-House') {
      const bw = Number(form.bandwidth_pct);
      if (!form.bandwidth_pct || !Number.isFinite(bw) || bw <= 0 || bw > 100) {
        toast.error('Bandwidth must be between 1% and 100%'); return;
      }
    } else {
      const dw = Number(form.daily_wage);
      if (!form.daily_wage || !Number.isFinite(dw) || dw <= 0) {
        toast.error('Daily wage is required for outsourced labour'); return;
      }
    }

    setIsSaving(true);
    const payload: any = {
      project_id:    numericProjectId,
      labour_id:     Number(form.labour_id),
      labor_type:    form.labour_type,   // original column name (no 'u')
      labour_type:   form.labour_type,   // new column name (with 'u')
      role:          selectedLabour?.designation || selectedLabour?.name || '',
      headcount:     1,
      start_date:    form.start_date,
      end_date:      form.end_date,
      bandwidth_pct: form.labour_type === 'In-House' ? Number(form.bandwidth_pct) : null,
      daily_wage:    form.labour_type === 'Outsourced' ? Number(form.daily_wage) : null,
      incentive:     form.labour_type === 'Outsourced' ? (Number(form.incentive) || 0) : null,
      notes:         form.notes.trim() || null,
    };

    if (editing) {
      const { error } = await supabase.from('project_manpower').update(payload).eq('id', editing.id);
      if (error) { toast.error(error.message); setIsSaving(false); return; }
      toast.success('Updated');
    } else {
      const { error } = await supabase.from('project_manpower').insert([payload]);
      if (error) { toast.error(error.message); setIsSaving(false); return; }
      toast.success('Added');
    }

    setIsOpen(false);
    setEditing(null);
    resetForm();
    await fetchRows();
    setIsSaving(false);
  };

  const handleDelete = async (r: ManpowerRow) => {
    if (!confirm(`Remove "${r.labour?.name || 'this entry'}" from the project?`)) return;
    const { error } = await supabase.from('project_manpower').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Removed');
    fetchRows();
  };

  /* ─── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-slate-500" /> Manpower &amp; Labour Management
            </CardTitle>
            <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
              <Plus className="h-4 w-4 mr-2" /> Add Labour
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'in-house' | 'outsourced')}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="in-house" className="flex items-center gap-2">
                <UserCheck className="h-4 w-4" />
                In-House ({inHouseRows.length})
                {totalInHouseCost > 0 && (
                  <span className="ml-1 text-xs text-blue-600 font-semibold">{fmt(totalInHouseCost)}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="outsourced" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Outsourced ({outsourcedRows.length})
                {totalOutsourcedCost > 0 && (
                  <span className="ml-1 text-xs text-amber-600 font-semibold">{fmt(totalOutsourcedCost)}</span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* In-House Table */}
            <TabsContent value="in-house">
              {loading ? (
                <div className="py-8 text-center text-muted-foreground">Loading...</div>
              ) : inHouseRows.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">No in-house labour assigned yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead className="w-[120px]">Bandwidth</TableHead>
                      <TableHead className="w-[170px]">Period</TableHead>
                      <TableHead className="w-[90px]">Days</TableHead>
                      <TableHead className="w-[110px]">Rate/Day</TableHead>
                      <TableHead className="w-[120px]">Est. Cost</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inHouseRows.map(r => {
                      const salary  = r.labour?.monthly_salary ?? 0;
                      const rateDay = salary ? salary / 24 : null;
                      const days    = r.start_date && r.end_date ? workingDays(r.start_date, r.end_date) : null;
                      const cost    = calcCost(r);
                      return (
                        <TableRow key={r.id} className="hover:bg-slate-50">
                          <TableCell className="font-medium">{r.labour?.name || '—'}</TableCell>
                          <TableCell className="text-slate-600 text-sm">{r.labour?.designation || '—'}</TableCell>
                          <TableCell>
                            <Badge className="bg-blue-100 text-blue-700">{r.bandwidth_pct ?? '—'}%</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {r.start_date ? new Date(r.start_date).toLocaleDateString('en-IN') : '—'} →{' '}
                            {r.end_date   ? new Date(r.end_date).toLocaleDateString('en-IN')   : '—'}
                          </TableCell>
                          <TableCell className="text-center text-sm">{days ?? '—'}</TableCell>
                          <TableCell className="text-sm">
                            {rateDay ? fmt(rateDay * ((r.bandwidth_pct ?? 100) / 100)) : '—'}
                          </TableCell>
                          <TableCell className="font-semibold text-blue-700">
                            {cost != null ? fmt(cost) : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="outline" size="sm" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="outline" size="sm" onClick={() => handleDelete(r)}><Trash className="h-3.5 w-3.5" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Total row */}
                    {inHouseRows.length > 0 && (
                      <TableRow className="bg-blue-50 font-semibold border-t-2">
                        <TableCell colSpan={6} className="text-right text-sm">Total Estimated Cost</TableCell>
                        <TableCell className="text-blue-700 font-bold">{fmt(totalInHouseCost)}</TableCell>
                        <TableCell />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {/* Outsourced Table */}
            <TabsContent value="outsourced">
              {loading ? (
                <div className="py-8 text-center text-muted-foreground">Loading...</div>
              ) : outsourcedRows.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">No outsourced labour assigned yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead className="w-[170px]">Period</TableHead>
                      <TableHead className="w-[80px]">Days</TableHead>
                      <TableHead className="w-[110px]">Daily Wage</TableHead>
                      <TableHead className="w-[100px]">Incentive</TableHead>
                      <TableHead className="w-[120px]">Est. Cost</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outsourcedRows.map(r => {
                      const days = r.start_date && r.end_date ? workingDays(r.start_date, r.end_date) : null;
                      const cost = calcCost(r);
                      return (
                        <TableRow key={r.id} className="hover:bg-slate-50">
                          <TableCell className="font-medium">{r.labour?.name || '—'}</TableCell>
                          <TableCell className="text-slate-600 text-sm">{r.labour?.designation || '—'}</TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {r.start_date ? new Date(r.start_date).toLocaleDateString('en-IN') : '—'} →{' '}
                            {r.end_date   ? new Date(r.end_date).toLocaleDateString('en-IN')   : '—'}
                          </TableCell>
                          <TableCell className="text-center text-sm">{days ?? '—'}</TableCell>
                          <TableCell className="text-sm">{r.daily_wage ? fmt(r.daily_wage) : '—'}</TableCell>
                          <TableCell className="text-sm">{r.incentive ? fmt(r.incentive) : '—'}</TableCell>
                          <TableCell className="font-semibold text-amber-700">
                            {cost != null ? fmt(cost) : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="outline" size="sm" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="outline" size="sm" onClick={() => handleDelete(r)}><Trash className="h-3.5 w-3.5" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {outsourcedRows.length > 0 && (
                      <TableRow className="bg-amber-50 font-semibold border-t-2">
                        <TableCell colSpan={6} className="text-right text-sm">Total Estimated Cost</TableCell>
                        <TableCell className="text-amber-700 font-bold">{fmt(totalOutsourcedCost)}</TableCell>
                        <TableCell />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) { setEditing(null); resetForm(); } }}>
        <DialogContent className="bg-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Labour Assignment' : 'Add Labour to Project'}</DialogTitle>
            <DialogDescription>
              {form.labour_type === 'In-House'
                ? 'Select an in-house employee and set their bandwidth allocation for this project.'
                : 'Select an outsourced contractor and enter their daily wage for this project.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Labour Type */}
            <div className="space-y-2">
              <Label>Labour Type *</Label>
              <Select
                value={form.labour_type}
                onValueChange={(v: 'In-House' | 'Outsourced') =>
                  setForm({ ...form, labour_type: v, labour_id: '', bandwidth_pct: '', daily_wage: '', incentive: '' })
                }
              >
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="In-House">In-House (Employee)</SelectItem>
                  <SelectItem value="Outsourced">Outsourced (Contractor)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Person selector */}
            <div className="space-y-2">
              <Label>
                {form.labour_type === 'In-House' ? 'Employee *' : 'Contractor *'}
              </Label>
              <Select
                value={form.labour_id || '__none__'}
                onValueChange={(v) => setForm({ ...form, labour_id: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder={`Select ${form.labour_type === 'In-House' ? 'employee' : 'contractor'}...`} />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-60">
                  <SelectItem value="__none__">— Select —</SelectItem>
                  {activeLabour.map(l => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}{l.designation ? ` · ${l.designation}` : ''}
                      {l.labour_type === 'In-House' && l.monthly_salary
                        ? ` (₹${Number(l.monthly_salary).toLocaleString('en-IN')}/mo)`
                        : ''}
                    </SelectItem>
                  ))}
                  {activeLabour.length === 0 && (
                    <div className="px-3 py-2 text-xs text-slate-400 italic">
                      No active {form.labour_type === 'In-House' ? 'employees' : 'contractors'} in registry. Add them in the Labour module.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* In-House salary info */}
            {form.labour_type === 'In-House' && selectedLabour && (
              <div className="p-3 rounded-md bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Monthly salary: <strong>₹{Number(selectedLabour.monthly_salary).toLocaleString('en-IN')}</strong>
                  {' → '}Rate/day = <strong>₹{((selectedLabour.monthly_salary ?? 0) / 24).toFixed(0)}</strong>
                  {form.bandwidth_pct
                    ? ` → At ${form.bandwidth_pct}% bandwidth = ₹${(((selectedLabour.monthly_salary ?? 0) / 24) * (Number(form.bandwidth_pct) / 100)).toFixed(0)}/day`
                    : ''}
                </span>
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start Date *</Label>
                <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="bg-white" />
              </div>
              <div className="space-y-2">
                <Label>End Date *</Label>
                <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="bg-white" />
              </div>
            </div>

            {/* Working days indicator */}
            {form.start_date && form.end_date && new Date(form.start_date) <= new Date(form.end_date) && (
              <p className="text-xs text-muted-foreground -mt-2">
                Duration: <strong>{workingDays(form.start_date, form.end_date)} days</strong>
              </p>
            )}

            {/* In-House: Bandwidth */}
            {form.labour_type === 'In-House' && (
              <div className="space-y-2">
                <Label>Bandwidth Allocation (%) *</Label>
                <Input
                  type="number" min={1} max={100}
                  value={form.bandwidth_pct}
                  onChange={e => setForm({ ...form, bandwidth_pct: e.target.value })}
                  className="bg-white"
                  placeholder="e.g. 50 for 50%"
                />
                <p className="text-xs text-muted-foreground">
                  % of working time dedicated to this project (100 = full-time)
                </p>
              </div>
            )}

            {/* Outsourced: Daily wage + Incentive */}
            {form.labour_type === 'Outsourced' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Daily Wage (₹) *</Label>
                  <Input
                    type="number" min={0}
                    value={form.daily_wage}
                    onChange={e => setForm({ ...form, daily_wage: e.target.value })}
                    className="bg-white"
                    placeholder="Per day rate"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Incentive (₹)</Label>
                  <Input
                    type="number" min={0}
                    value={form.incentive}
                    onChange={e => setForm({ ...form, incentive: e.target.value })}
                    className="bg-white"
                    placeholder="One-time bonus"
                  />
                </div>
              </div>
            )}

            {/* Cost preview */}
            {costPreview != null && (
              <div className="p-3 rounded-md bg-green-50 border border-green-200 text-sm text-green-800 flex items-center gap-2">
                <DollarSign className="h-4 w-4 shrink-0" />
                <span>
                  Estimated cost for this assignment:{' '}
                  <strong className="text-green-700">{fmt(costPreview)}</strong>
                </span>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-white" placeholder="Optional" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {isSaving ? 'Saving...' : editing ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
