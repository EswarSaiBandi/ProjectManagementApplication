'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Package, Users, Wallet, TrendingUp, TrendingDown, CheckCircle,
  AlertCircle, Calculator, FileText,
} from 'lucide-react';

type CostSummary = {
  project_id: number;
  project_name: string;
  material_cost_actual: number;
  labor_cost_inhouse: number;
  labor_cost_outsourced: number;
  budgeted_total: number;
  expenses_total: number;
  income_total: number;          // deprecated, always 0 after view migration
  total_actual_cost: number;
  cost_variance: number;
  profit_loss: number;
};

function formatCurrency(n: number | null | undefined): string {
  const v = Number(n || 0);
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(v));
}

export default function FinancialTab({ projectId }: { projectId: string }) {
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [quotesTotal, setQuotesTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const fetchCostingSummary = async () => {
    const { data, error } = await supabase
      .from('project_costing_summary')
      .select('*')
      .eq('project_id', projectId)
      .single();

    if (error) {
      console.error('Fetch costing summary error:', error);
      setCostSummary(null);
    } else {
      setCostSummary(data as CostSummary);
    }
  };

  const fetchQuotesTotal = async () => {
    const { data, error } = await supabase
      .from('project_quotes')
      .select('total_amount')
      .eq('project_id', projectId);
    if (!error && data) {
      setQuotesTotal(data.reduce((s, r: any) => s + Number(r.total_amount || 0), 0));
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchCostingSummary(), fetchQuotesTotal()]);
    setLoading(false);
  };

  useEffect(() => {
    if (projectId) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Refresh when inventory changes (stock used / returns / etc.)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (String(detail?.projectId) !== String(projectId)) return;
      fetchCostingSummary();
    };
    window.addEventListener('inventory-updated', handler);
    return () => window.removeEventListener('inventory-updated', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const material    = Number(costSummary?.material_cost_actual ?? 0);
  const inhouse     = Number(costSummary?.labor_cost_inhouse ?? 0);
  const outsourced  = Number(costSummary?.labor_cost_outsourced ?? 0);
  const laborTotal  = inhouse + outsourced;
  const expenses    = Number(costSummary?.expenses_total ?? 0);
  const budget      = Number(costSummary?.budgeted_total ?? 0);
  const actual      = material + laborTotal + expenses;
  const profitLoss  = budget - actual;
  const marginPct   = budget > 0 ? ((profitLoss / budget) * 100).toFixed(1) : '0';

  const goToTab = (tabValue: string) => {
    const el = document.querySelector(`[data-value="${tabValue}"]`) as HTMLElement | null;
    el?.click();
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl flex items-center gap-2">
              <Wallet className="h-6 w-6 text-blue-600" />
              Financials — Overview
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => goToTab('project-costing')}
              className="text-xs"
            >
              <Calculator className="h-3 w-3 mr-1" /> Manage in Project Costing
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Read-only snapshot. Budget entries and other expenses are managed in the Project Costing tab;
            material costs flow from FIFO stock usage; manpower costs flow from the Manpower tab.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : !costSummary ? (
            <div className="text-center py-8 text-slate-500">No cost data available</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-slate-500 mb-1">Budget</div>
                  <div className="text-2xl font-bold">{formatCurrency(budget)}</div>
                  <div className="text-xs text-slate-500 mt-1">Total planned spend</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-slate-500 mb-1">Actual Cost</div>
                  <div className="text-2xl font-bold text-orange-600">{formatCurrency(actual)}</div>
                  <div className="text-xs text-slate-500 mt-1">Material + Manpower + Other</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs text-slate-500 mb-1">Profit / Loss</div>
                  <div className={`text-2xl font-bold ${profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {profitLoss >= 0 ? '+' : ''}{formatCurrency(profitLoss)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Budget − Actual ({marginPct}%)</div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost Breakdown */}
      {costSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Actual Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-blue-50">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <Package className="h-10 w-10 text-blue-500" />
                    <div>
                      <div className="text-xs text-slate-600 mb-1">Material</div>
                      <div className="text-xl font-bold text-blue-700">{formatCurrency(material)}</div>
                      <div className="text-xs text-slate-500 mt-1">FIFO cost of stock used</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-purple-50">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <Users className="h-10 w-10 text-purple-500" />
                    <div>
                      <div className="text-xs text-slate-600 mb-1">Manpower</div>
                      <div className="text-xl font-bold text-purple-700">{formatCurrency(laborTotal)}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        In-House: {formatCurrency(inhouse)}<br />
                        Outsourced: {formatCurrency(outsourced)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-emerald-50">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <Wallet className="h-10 w-10 text-emerald-500" />
                    <div>
                      <div className="text-xs text-slate-600 mb-1">Other Expenses (Overhead)</div>
                      <div className="text-xl font-bold text-emerald-700">{formatCurrency(expenses)}</div>
                      <div className="text-xs text-slate-500 mt-1">Project Expenses ledger entries</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {budget > 0 && (
              <div className="mt-6 p-4 rounded-lg border bg-white flex items-center gap-3">
                {profitLoss >= 0 ? (
                  <>
                    <CheckCircle className="h-6 w-6 text-green-600" />
                    <div>
                      <div className="font-medium text-green-700">In profit</div>
                      <div className="text-sm text-slate-600">
                        {formatCurrency(profitLoss)} left from budget after actual cost.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-6 w-6 text-red-600" />
                    <div>
                      <div className="font-medium text-red-700">In loss</div>
                      <div className="text-sm text-slate-600">
                        Actual cost has exceeded budget by {formatCurrency(Math.abs(profitLoss))}.
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

     

      {/* Deprecation note */}
      <Card className="bg-slate-50 border-slate-200">
        <CardContent className="pt-4 text-sm text-slate-600 space-y-2">
          <p className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-slate-500" />
            <strong className="text-slate-700">Where to record things now:</strong>
          </p>
          <ul className="list-disc list-inside ml-2 space-y-1">
            <li>
              <strong>Budget</strong> &amp; <strong>Overhead expenses</strong>: <em>Project Costing</em> tab
              (Budget Entries / Project Expenses sections).
            </li>
            <li><strong>Material cost</strong>: flows automatically from Stock Used (FIFO).</li>
            <li>
              <strong>Manpower cost</strong>: flows automatically from <em>Manpower</em> tab assignments.
            </li>
          </ul>
          <p className="text-xs text-slate-500">
            (The legacy Transactions module has been removed; its data is preserved in the database for
            historical reference but no longer affects this tab&apos;s calculations.)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
