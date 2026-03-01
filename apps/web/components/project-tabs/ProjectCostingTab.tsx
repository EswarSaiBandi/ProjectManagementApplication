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
import { 
  Calculator, Plus, TrendingUp, TrendingDown, DollarSign, 
  AlertCircle, CheckCircle, Package, Users, Wrench 
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

export default function ProjectCostingTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>([]);
  const [costCategories, setCostCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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

    if (!error && data) {
      setBudgetEntries(data as BudgetEntry[]);
    }
  };

  useEffect(() => {
    fetchCostingSummary();
    fetchBudgetEntries();
    fetchCostCategories();
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
    resetForm();
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!Number.isFinite(numericProjectId)) {
      toast.error('Invalid project');
      return;
    }

    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast.error('Amount must be greater than 0');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload = {
      project_id: numericProjectId,
      cost_category: form.cost_category,
      cost_type: 'Budgeted',
      amount: amount,
      description: form.description.trim() || null,
      cost_date: form.cost_date,
      created_by: userId,
    };

    const { error } = await supabase.from('project_cost_ledger').insert([payload]);
    if (error) {
      console.error('Insert budget error:', error);
      toast.error(error.message || 'Failed to add budget entry');
      setIsSaving(false);
      return;
    }

    toast.success('Budget entry added');
    setIsOpen(false);
    resetForm();
    await fetchCostingSummary();
    await fetchBudgetEntries();
    setIsSaving(false);
  };

  const totalLaborCost = (costSummary?.labor_cost_inhouse || 0) + (costSummary?.labor_cost_outsourced || 0);
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
                      <div className="text-xs text-slate-600 mb-1">Labor Costs</div>
                      <div className="text-xl font-bold text-purple-700">
                        ₹{totalLaborCost.toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        In-House: ₹{costSummary.labor_cost_inhouse.toLocaleString('en-IN')}<br/>
                        Outsourced: ₹{costSummary.labor_cost_outsourced.toLocaleString('en-IN')}
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

      {/* Budget Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Budget Entries</CardTitle>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                  <Plus className="h-4 w-4 mr-2" /> Add Budget
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-xl">
                <DialogHeader>
                  <DialogTitle>Add Budget Entry</DialogTitle>
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
                  <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                  <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                    {isSaving ? 'Saving...' : 'Add Budget'}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgetEntries.map((entry) => (
                  <TableRow key={entry.ledger_id}>
                    <TableCell className="text-sm">{new Date(entry.cost_date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.cost_category}</Badge>
                    </TableCell>
                    <TableCell className="font-semibold">₹{entry.amount.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-sm text-slate-600">{entry.description || '—'}</TableCell>
                  </TableRow>
                ))}
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
                <li><strong>Material Costs</strong>: Auto-calculated from outward material movements (issues & utilization)</li>
                <li><strong>Labor Costs</strong>: In-House from payroll entries + Outsourced from payment records</li>
                <li><strong>Real-Time Variance</strong>: Automatically updates as movements and payments are recorded</li>
                <li><strong>Profit/Loss</strong>: Calculated from income transactions minus all actual costs</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
