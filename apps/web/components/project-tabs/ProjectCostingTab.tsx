'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Calculator, Plus, TrendingUp, TrendingDown, DollarSign, 
  AlertCircle, CheckCircle, Package, Users, UserCheck, Building2,
  Pencil, Trash2
} from 'lucide-react';

type CostSummary = {
  project_id: number;
  project_name: string;
  material_cost_actual: number;
  labor_cost_inhouse: number;
  labor_cost_outsourced: number;
  budgeted_total: number;
  expenses_total: number;
  income_total: number;
  total_actual_cost: number;
  cost_variance: number;
  profit_loss: number;
};

type BudgetEntry = {
  ledger_id: number;
  cost_category: string;
  cost_type: string;
  amount: number;
  description: string | null;
  cost_date: string;
  created_at: string;
};

type ManpowerCostRow = {
  id: number;
  labour_type: 'In-House' | 'Outsourced';
  start_date: string | null;
  end_date: string | null;
  bandwidth_pct: number | null;
  daily_wage: number | null;
  incentive: number | null;
  labour: { name: string; designation: string | null; monthly_salary: number | null } | null;
};

function workingDays(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

function calcManpowerCost(r: ManpowerCostRow): number {
  if (!r.start_date || !r.end_date) return 0;
  const days = workingDays(r.start_date, r.end_date);
  if (r.labour_type === 'In-House') {
    const salary = r.labour?.monthly_salary ?? 0;
    const bw = r.bandwidth_pct ?? 0;
    return (salary / 24) * (bw / 100) * days;
  }
  return (r.daily_wage ?? 0) * days + (r.incentive ?? 0);
}

const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function ProjectCostingTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>([]);
  const [manpowerRows, setManpowerRows] = useState<ManpowerCostRow[]>([]);
  const [costCategories, setCostCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<BudgetEntry | null>(null);

  const [form, setForm] = useState({
    cost_category: 'Material',
    amount: '',
    description: '',
    cost_date: new Date().toISOString().split('T')[0],
  });

  const fetchCostingSummary = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('project_costing_summary')
      .select('*')
      .eq('project_id', numericProjectId)
      .single();

    if (error) {
      console.error('Fetch costing summary error:', error);
      setCostSummary(null);
    } else {
      setCostSummary(data as CostSummary);
    }
    setLoading(false);
  };

  const fetchCostCategories = async () => {
    const { data, error } = await supabase
      .from('dynamic_field_options')
      .select('option_value')
      .eq('field_type', 'cost_category')
      .eq('is_active', true)
      .order('display_order');

    if (!error && data) {
      setCostCategories(data.map(d => d.option_value));
    } else {
      setCostCategories(['Material', 'Labor', 'Equipment', 'Overhead', 'Other']);
    }
  };

  const fetchBudgetEntries = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    const { data, error } = await supabase
      .from('project_cost_ledger')
      .select('*')
      .eq('project_id', numericProjectId)
      .order('cost_date', { ascending: false });
    if (!error && data) setBudgetEntries(data as BudgetEntry[]);
  };

  const fetchManpowerCosts = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    const { data: pmRows } = await supabase
      .from('project_manpower')
      .select('id, labour_type, labor_type, start_date, end_date, bandwidth_pct, daily_wage, incentive, labour_id')
      .eq('project_id', numericProjectId)
      .order('created_at', { ascending: false });

    if (!pmRows || pmRows.length === 0) { setManpowerRows([]); return; }

    const labourIds = [...new Set(pmRows.map((r: any) => r.labour_id).filter(Boolean))];
    let labourMap: Record<number, any> = {};
    if (labourIds.length > 0) {
      const { data: lRows } = await supabase
        .from('labour_master')
        .select('id, name, designation, monthly_salary')
        .in('id', labourIds);
      (lRows || []).forEach((l: any) => { labourMap[l.id] = l; });
    }

    setManpowerRows(pmRows.map((r: any) => ({
      id: r.id,
      labour_type: r.labour_type ?? r.labor_type ?? 'In-House',
      start_date: r.start_date,
      end_date: r.end_date,
      bandwidth_pct: r.bandwidth_pct,
      daily_wage: r.daily_wage,
      incentive: r.incentive,
      labour: r.labour_id ? labourMap[r.labour_id] ?? null : null,
    })));
  };

  useEffect(() => {
    fetchCostingSummary();
    fetchBudgetEntries();
    fetchCostCategories();
    fetchManpowerCosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const resetForm = () => {
    setForm({
      cost_category: 'Material',
      amount: '',
      description: '',
      cost_date: new Date().toISOString().split('T')[0],
    });
  };

  const openNew = () => {
    setEditing(null);
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (entry: BudgetEntry) => {
    setEditing(entry);
    setForm({
      cost_category: entry.cost_category,
      amount: String(entry.amount),
      description: entry.description || '',
      cost_date: entry.cost_date.split('T')[0],
    });
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!Number.isFinite(numericProjectId)) { toast.error('Invalid project'); return; }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { toast.error('Amount must be greater than 0'); return; }
    if (!form.cost_date) { toast.error('Date is required'); return; }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    if (editing) {
      const { error } = await supabase
        .from('project_cost_ledger')
        .update({
          cost_category: form.cost_category,
          amount,
          description: form.description.trim() || null,
          cost_date: form.cost_date,
        })
        .eq('ledger_id', editing.ledger_id);
      if (error) { toast.error(error.message || 'Failed to update'); setIsSaving(false); return; }
      toast.success('Budget entry updated');
    } else {
      const { error } = await supabase.from('project_cost_ledger').insert([{
        project_id: numericProjectId,
        cost_category: form.cost_category,
        cost_type: 'Budgeted',
        amount,
        description: form.description.trim() || null,
        cost_date: form.cost_date,
        created_by: userId,
      }]);
      if (error) { toast.error(error.message || 'Failed to add'); setIsSaving(false); return; }
      toast.success('Budget entry added');
    }

    setIsOpen(false);
    setEditing(null);
    resetForm();
    await fetchCostingSummary();
    await fetchBudgetEntries();
    setIsSaving(false);
  };

  const handleDelete = async (entry: BudgetEntry) => {
    if (!confirm(`Delete budget entry of ₹${Number(entry.amount).toLocaleString('en-IN')} (${entry.cost_category})?`)) return;
    const { error } = await supabase.from('project_cost_ledger').delete().eq('ledger_id', entry.ledger_id);
    if (error) { toast.error(error.message || 'Failed to delete'); return; }
    toast.success('Deleted');
    await fetchCostingSummary();
    await fetchBudgetEntries();
  };

  // Compute manpower costs client-side for the breakdown table
  const inHouseRows    = manpowerRows.filter(r => r.labour_type === 'In-House');
  const outsourcedRows = manpowerRows.filter(r => r.labour_type === 'Outsourced');
  const clientInHouseCost    = inHouseRows.reduce((s, r) => s + calcManpowerCost(r), 0);
  const clientOutsourcedCost = outsourcedRows.reduce((s, r) => s + calcManpowerCost(r), 0);
  const clientTotalLabour    = clientInHouseCost + clientOutsourcedCost;

  // Use view values when available, fall back to client-side calculation
  const totalInHouseCost    = costSummary?.labor_cost_inhouse    ?? clientInHouseCost;
  const totalOutsourcedCost = costSummary?.labor_cost_outsourced ?? clientOutsourcedCost;
  const totalLaborCost      = totalInHouseCost + totalOutsourcedCost;

  const variancePercent = costSummary?.budgeted_total
    ? ((costSummary.cost_variance / costSummary.budgeted_total) * 100).toFixed(1)
    : '0';

  const profitMarginPercent = costSummary?.income_total
    ? ((costSummary.profit_loss / costSummary.income_total) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-4">
      {/* Real-Time Cost Summary */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Calculator className="h-6 w-6 text-blue-600" />
            Dynamic Project Costing - Real-Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading cost data...</div>
          ) : costSummary ? (
            <div className="grid grid-cols-4 gap-4">
              {/* Budget vs Actual */}
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-slate-500 mb-1">Budgeted Cost</div>
                  <div className="text-2xl font-bold">₹{costSummary.budgeted_total.toLocaleString('en-IN')}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-slate-500 mb-1">Actual Cost (Live)</div>
                  <div className="text-2xl font-bold text-orange-600">₹{costSummary.total_actual_cost.toLocaleString('en-IN')}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-slate-500 mb-1">Variance</div>
                  <div className={`text-2xl font-bold ${costSummary.cost_variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {costSummary.cost_variance >= 0 ? '+' : ''}₹{costSummary.cost_variance.toLocaleString('en-IN')}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{variancePercent}%</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-slate-500 mb-1">Profit/Loss</div>
                  <div className={`text-2xl font-bold ${costSummary.profit_loss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {costSummary.profit_loss >= 0 ? '+' : ''}₹{costSummary.profit_loss.toLocaleString('en-IN')}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{profitMarginPercent}% margin</div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">No cost data available</div>
          )}
        </CardContent>
      </Card>

      {/* Cost Breakdown by Category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Actual Cost Breakdown (Live from Movements)</CardTitle>
        </CardHeader>
        <CardContent>
          {costSummary && (
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-blue-50">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <Package className="h-10 w-10 text-blue-500" />
                    <div>
                      <div className="text-xs text-slate-600 mb-1">Material Costs</div>
                      <div className="text-xl font-bold text-blue-700">
                        ₹{costSummary.material_cost_actual.toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">From outward movements</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-purple-50">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <Users className="h-10 w-10 text-purple-500" />
                    <div>
                      <div className="text-xs text-slate-600 mb-1">Labour Costs</div>
                      <div className="text-xl font-bold text-purple-700">
                        {fmt(totalLaborCost)}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        In-House: {fmt(totalInHouseCost)}<br/>
                        Outsourced: {fmt(totalOutsourcedCost)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-green-50">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <DollarSign className="h-10 w-10 text-green-500" />
                    <div>
                      <div className="text-xs text-slate-600 mb-1">Other Expenses</div>
                      <div className="text-xl font-bold text-green-700">
                        ₹{costSummary.expenses_total.toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">From transactions</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manpower Cost Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-500" /> Manpower Cost Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {manpowerRows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No labour assigned to this project yet. Add labour from the Manpower tab.
            </div>
          ) : (
            <div className="space-y-4">
              {/* In-House */}
              {inHouseRows.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <UserCheck className="h-4 w-4 text-blue-600" />
                    <span className="font-semibold text-sm text-blue-700">In-House</span>
                    <span className="ml-auto text-sm font-bold text-blue-700">{fmt(clientInHouseCost)}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Designation</TableHead>
                        <TableHead className="w-[100px]">Bandwidth</TableHead>
                        <TableHead className="w-[160px]">Period</TableHead>
                        <TableHead className="w-[70px] text-center">Days</TableHead>
                        <TableHead className="w-[110px]">Rate/Day</TableHead>
                        <TableHead className="w-[120px] text-right">Est. Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inHouseRows.map(r => {
                        const salary  = r.labour?.monthly_salary ?? 0;
                        const bw      = r.bandwidth_pct ?? 0;
                        const rateDay = salary ? (salary / 24) * (bw / 100) : null;
                        const days    = r.start_date && r.end_date ? workingDays(r.start_date, r.end_date) : null;
                        const cost    = calcManpowerCost(r);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.labour?.name || '—'}</TableCell>
                            <TableCell className="text-slate-600 text-sm">{r.labour?.designation || '—'}</TableCell>
                            <TableCell><Badge className="bg-blue-100 text-blue-700">{bw}%</Badge></TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {r.start_date ? new Date(r.start_date).toLocaleDateString('en-IN') : '—'} → {r.end_date ? new Date(r.end_date).toLocaleDateString('en-IN') : '—'}
                            </TableCell>
                            <TableCell className="text-center text-sm">{days ?? '—'}</TableCell>
                            <TableCell className="text-sm">{rateDay ? fmt(rateDay) : '—'}</TableCell>
                            <TableCell className="text-right font-semibold text-blue-700">{cost > 0 ? fmt(cost) : '—'}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Outsourced */}
              {outsourcedRows.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 mt-2">
                    <Building2 className="h-4 w-4 text-amber-600" />
                    <span className="font-semibold text-sm text-amber-700">Outsourced</span>
                    <span className="ml-auto text-sm font-bold text-amber-700">{fmt(clientOutsourcedCost)}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Designation</TableHead>
                        <TableHead className="w-[160px]">Period</TableHead>
                        <TableHead className="w-[70px] text-center">Days</TableHead>
                        <TableHead className="w-[110px]">Daily Wage</TableHead>
                        <TableHead className="w-[100px]">Incentive</TableHead>
                        <TableHead className="w-[120px] text-right">Est. Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outsourcedRows.map(r => {
                        const days = r.start_date && r.end_date ? workingDays(r.start_date, r.end_date) : null;
                        const cost = calcManpowerCost(r);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.labour?.name || '—'}</TableCell>
                            <TableCell className="text-slate-600 text-sm">{r.labour?.designation || '—'}</TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {r.start_date ? new Date(r.start_date).toLocaleDateString('en-IN') : '—'} → {r.end_date ? new Date(r.end_date).toLocaleDateString('en-IN') : '—'}
                            </TableCell>
                            <TableCell className="text-center text-sm">{days ?? '—'}</TableCell>
                            <TableCell className="text-sm">{r.daily_wage ? fmt(r.daily_wage) : '—'}</TableCell>
                            <TableCell className="text-sm">{r.incentive ? fmt(r.incentive) : '—'}</TableCell>
                            <TableCell className="text-right font-semibold text-amber-700">{cost > 0 ? fmt(cost) : '—'}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Total labour summary bar */}
              <div className="mt-3 p-3 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-between">
                <div className="text-sm font-medium text-purple-800">Total Labour Cost (In-House + Outsourced)</div>
                <div className="text-lg font-bold text-purple-700">{fmt(clientTotalLabour)}</div>
              </div>
              {clientTotalLabour > 0 && costSummary?.budgeted_total && costSummary.budgeted_total > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Labour as % of budget</span>
                    <span>{((clientTotalLabour / costSummary.budgeted_total) * 100).toFixed(1)}%</span>
                  </div>
                  <Progress value={Math.min((clientTotalLabour / costSummary.budgeted_total) * 100, 100)} className="h-1.5" />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Budget Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Budget Entries</CardTitle>
            <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) { setEditing(null); resetForm(); } }}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                  <Plus className="h-4 w-4 mr-2" /> Add Budget
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-xl">
                <DialogHeader>
                  <DialogTitle>{editing ? 'Edit Budget Entry' : 'Add Budget Entry'}</DialogTitle>
                  <DialogDescription>Set budgeted costs by category</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Cost Category *</Label>
                      <Select value={form.cost_category} onValueChange={(v) => setForm({ ...form, cost_category: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {costCategories.map(category => (
                            <SelectItem key={category} value={category}>{category}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Budget Amount (₹) *</Label>
                      <Input
                        type="number"
                        min={0}
                        value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value })}
                        className="bg-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={form.cost_date}
                      onChange={(e) => setForm({ ...form, cost_date: e.target.value })}
                      className="bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="bg-white"
                      rows={2}
                      placeholder="Budget allocation notes"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setIsOpen(false); setEditing(null); resetForm(); }}>Cancel</Button>
                  <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                    {isSaving ? 'Saving...' : editing ? 'Update' : 'Add Budget'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
          {budgetEntries.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Calculator className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No budget entries yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-[140px]">Amount</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgetEntries.map((entry) => (
                  <TableRow key={entry.ledger_id} className="hover:bg-slate-50">
                    <TableCell className="text-sm">{new Date(entry.cost_date).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.cost_category}</Badge>
                    </TableCell>
                    <TableCell className="font-semibold">₹{Number(entry.amount).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-sm text-slate-600">{entry.description || '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline" size="sm"
                          onClick={() => openEdit(entry)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          onClick={() => handleDelete(entry)}
                          title="Delete"
                          className="text-red-500 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="bg-slate-50 font-semibold border-t-2">
                  <TableCell colSpan={2} className="text-right text-sm">Total Budget</TableCell>
                  <TableCell className="font-bold text-blue-700">
                    ₹{budgetEntries.reduce((s, e) => s + Number(e.amount), 0).toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Variance Analysis */}
      {costSummary && costSummary.budgeted_total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Variance Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Overall Variance */}
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div>
                  <div className="text-sm text-slate-600">Overall Budget Variance</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Budgeted: ₹{costSummary.budgeted_total.toLocaleString('en-IN')} | 
                    Actual: ₹{costSummary.total_actual_cost.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${costSummary.cost_variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {costSummary.cost_variance >= 0 ? (
                      <span className="flex items-center gap-2">
                        <TrendingUp className="h-6 w-6" />
                        +₹{costSummary.cost_variance.toLocaleString('en-IN')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <TrendingDown className="h-6 w-6" />
                        -₹{Math.abs(costSummary.cost_variance).toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                  <div className={`text-sm ${costSummary.cost_variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {variancePercent}% {costSummary.cost_variance >= 0 ? 'under budget' : 'over budget'}
                  </div>
                </div>
              </div>

              {/* Cost Breakdown with Progress Bars */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Material Costs</span>
                    <span className="text-sm font-semibold">₹{costSummary.material_cost_actual.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ 
                        width: `${Math.min((costSummary.material_cost_actual / costSummary.total_actual_cost) * 100, 100)}%` 
                      }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {((costSummary.material_cost_actual / costSummary.total_actual_cost) * 100).toFixed(1)}% of total cost
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Labor Costs (In-House + Outsourced)</span>
                    <span className="text-sm font-semibold">₹{totalLaborCost.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div 
                      className="bg-purple-600 h-2 rounded-full transition-all"
                      style={{ 
                        width: `${Math.min((totalLaborCost / costSummary.total_actual_cost) * 100, 100)}%` 
                      }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {((totalLaborCost / costSummary.total_actual_cost) * 100).toFixed(1)}% of total cost
                    <span className="ml-2">
                      (In-House: ₹{costSummary.labor_cost_inhouse.toLocaleString('en-IN')} | 
                      Outsourced: ₹{costSummary.labor_cost_outsourced.toLocaleString('en-IN')})
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Other Expenses</span>
                    <span className="text-sm font-semibold">₹{costSummary.expenses_total.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div 
                      className="bg-green-600 h-2 rounded-full transition-all"
                      style={{ 
                        width: `${Math.min((costSummary.expenses_total / costSummary.total_actual_cost) * 100, 100)}%` 
                      }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {((costSummary.expenses_total / costSummary.total_actual_cost) * 100).toFixed(1)}% of total cost
                  </div>
                </div>
              </div>

              {/* Income vs Cost */}
              <div className="mt-6 p-4 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-xs text-slate-600 mb-1">Total Income</div>
                    <div className="text-xl font-bold text-green-600">₹{costSummary.income_total.toLocaleString('en-IN')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-600 mb-1">Total Cost</div>
                    <div className="text-xl font-bold text-orange-600">₹{costSummary.total_actual_cost.toLocaleString('en-IN')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-600 mb-1">Net Profit/Loss</div>
                    <div className={`text-xl font-bold ${costSummary.profit_loss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {costSummary.profit_loss >= 0 ? '+' : ''}₹{costSummary.profit_loss.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Cost Health Indicator */}
              <div className="mt-4 flex items-center gap-3 p-3 rounded-lg border bg-white">
                {costSummary.cost_variance >= 0 ? (
                  <>
                    <CheckCircle className="h-6 w-6 text-green-600" />
                    <div>
                      <div className="font-medium text-green-700">Project is Under Budget</div>
                      <div className="text-sm text-slate-600">
                        You have ₹{costSummary.cost_variance.toLocaleString('en-IN')} remaining from budget
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-6 w-6 text-red-600" />
                    <div>
                      <div className="font-medium text-red-700">Project is Over Budget</div>
                      <div className="text-sm text-slate-600">
                        You have exceeded budget by ₹{Math.abs(costSummary.cost_variance).toLocaleString('en-IN')}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cost Tracking Info */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <div className="font-semibold mb-2">How Dynamic Costing Works:</div>
              <ul className="space-y-1 list-disc list-inside">
                <li><strong>Material Costs</strong>: Auto-calculated from outward material movements (issues &amp; utilization)</li>
                <li><strong>In-House Labour</strong>: (Monthly Salary ÷ 24) × Bandwidth % × Working Days — from the Manpower tab</li>
                <li><strong>Outsourced Labour</strong>: Daily Wage × Working Days + Incentive — from the Manpower tab</li>
                <li><strong>Real-Time Variance</strong>: Automatically updates as manpower entries and movements are recorded</li>
                <li><strong>Profit/Loss</strong>: Calculated from income transactions minus all actual costs</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
