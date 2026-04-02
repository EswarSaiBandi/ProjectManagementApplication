'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FileText, Printer, Receipt, Trash2, Filter, Banknote, ImagePlus, ExternalLink } from 'lucide-react';

const LABOUR_OVERHEAD_REF = 'labour_overhead';
/** Matches seeded row in migration `20260401000700_mignonminds_company_overhead_project.sql`. */
const COMPANY_OVERHEAD_PROJECT_NAME = 'MignonMinds — company overhead';

type LabourRow = {
  id: number;
  name: string;
  labour_type: 'In-House' | 'Outsourced';
  designation: string | null;
  monthly_salary: number | null;
};

type ProjectRow = { project_id: number; project_name: string };

type ManpowerRow = {
  id: number;
  project_id: number;
  labour_id: number | null;
  labour_type: 'In-House' | 'Outsourced';
  labor_type?: string;
  start_date: string | null;
  end_date: string | null;
  bandwidth_pct: number | null;
  daily_wage: number | null;
  incentive: number | null;
  notes: string | null;
};

type EnrichedAssignment = ManpowerRow & {
  labour: LabourRow | null;
  project: ProjectRow | null;
  estCost: number | null;
  workingDays: number | null;
};

type OverheadLedger = {
  ledger_id: number;
  project_id: number;
  cost_category: string;
  cost_type: string;
  amount: number;
  description: string | null;
  cost_date: string;
  reference_type: string | null;
  reference_id: number | null;
};

type ManpowerPayment = {
  payment_id: number;
  labour_id: number;
  project_id: number | null;
  amount: number;
  payment_date: string;
  notes: string | null;
  screenshot_path: string | null;
  created_at: string;
};

function workingDays(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  if (e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

function calcAssignmentCost(
  row: ManpowerRow,
  labour: LabourRow | null
): { est: number | null; days: number | null } {
  const lt = row.labour_type ?? (row.labor_type as string) ?? 'In-House';
  if (!row.start_date || !row.end_date) return { est: null, days: null };
  const days = workingDays(row.start_date, row.end_date);
  if (lt === 'In-House') {
    const salary = labour?.monthly_salary;
    if (!salary || row.bandwidth_pct == null) return { est: null, days };
    const ratePerDay = salary / 24;
    return { est: parseFloat((ratePerDay * (row.bandwidth_pct / 100) * days).toFixed(2)), days };
  }
  if (!row.daily_wage) return { est: null, days };
  return {
    est: parseFloat(((row.daily_wage * days) + (row.incentive ?? 0)).toFixed(2)),
    days,
  };
}

function fmt(n: number) {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Labels for estimated vs paid reconciliation (rounded ₹ balance). */
function paymentBalanceStatus(estimated: number, paid: number, balance: number): {
  label: string;
  hint: string;
  badgeClass: string;
} {
  const est = Math.round(estimated);
  const bal = Math.round(balance);
  if (est <= 0 && paid <= 0) {
    return {
      label: 'No estimate yet',
      hint: 'No assignment or overhead recorded for this person in the current view.',
      badgeClass: 'border-slate-200 text-slate-700 bg-slate-50',
    };
  }
  if (bal > 0) {
    return {
      label: 'Payment pending',
      hint: 'Estimated earnings are still higher than payments recorded.',
      badgeClass: 'border-amber-300 text-amber-900 bg-amber-50',
    };
  }
  if (bal < 0) {
    return {
      label: 'Advance paid',
      hint: 'Payments exceed the current estimate (advance, bonus, or timing difference).',
      badgeClass: 'border-sky-300 text-sky-900 bg-sky-50',
    };
  }
  return {
    label: 'Cleared so far',
    hint: 'Payments match estimated earnings for the current view.',
    badgeClass: 'border-emerald-300 text-emerald-900 bg-emerald-50',
  };
}

export default function ManpowerPayslipsPanel() {
  const [labourList, setLabourList] = useState<LabourRow[]>([]);
  const [projectList, setProjectList] = useState<ProjectRow[]>([]);
  const [assignments, setAssignments] = useState<EnrichedAssignment[]>([]);
  const [overheadRows, setOverheadRows] = useState<OverheadLedger[]>([]);
  const [paymentRows, setPaymentRows] = useState<ManpowerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOverhead, setLoadingOverhead] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);

  const [filterLabour, setFilterLabour] = useState<string>('all');
  /** Optional: limit which payment rows are listed (by payment_date). Balance & payslip still use all payments for the person. */
  const [paymentDateFrom, setPaymentDateFrom] = useState('');
  const [paymentDateTo, setPaymentDateTo] = useState('');

  const [payslipOpen, setPayslipOpen] = useState(false);
  const [payslipLabourId, setPayslipLabourId] = useState<string>('');

  const [ohProject, setOhProject] = useState<string>('');
  const [ohLabour, setOhLabour] = useState<string>('');
  const [ohAmount, setOhAmount] = useState('');
  const [ohDate, setOhDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [ohNotes, setOhNotes] = useState('');
  const [savingOh, setSavingOh] = useState(false);

  const [payLabour, setPayLabour] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [payNotes, setPayNotes] = useState('');
  const [payFile, setPayFile] = useState<File | null>(null);
  const [payFileInputKey, setPayFileInputKey] = useState(0);
  const [savingPay, setSavingPay] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data: pm, error: pmErr } = await supabase
      .from('project_manpower')
      .select('*')
      .order('created_at', { ascending: false });
    if (pmErr) {
      toast.error('Failed to load assignments: ' + pmErr.message);
      setAssignments([]);
      setLoading(false);
      return;
    }
    const raw = (pm || []) as any[];
    const labourIds = Array.from(
      new Set(raw.map((r) => r.labour_id).filter((id: unknown): id is number => typeof id === 'number'))
    );
    const projectIds = Array.from(new Set(raw.map((r) => r.project_id).filter(Boolean)));

    let labourMap: Record<number, LabourRow> = {};
    if (labourIds.length > 0) {
      const { data: lm } = await supabase
        .from('labour_master')
        .select('id, name, labour_type, designation, monthly_salary')
        .in('id', labourIds);
      (lm || []).forEach((l: any) => {
        labourMap[l.id] = l as LabourRow;
      });
    }

    let projectMap: Record<number, ProjectRow> = {};
    if (projectIds.length > 0) {
      const { data: pr } = await supabase
        .from('projects')
        .select('project_id, project_name')
        .in('project_id', projectIds);
      (pr || []).forEach((p: any) => {
        projectMap[p.project_id] = p as ProjectRow;
      });
    }

    const enriched: EnrichedAssignment[] = raw.map((r) => {
      const row: ManpowerRow = {
        id: r.id,
        project_id: r.project_id,
        labour_id: r.labour_id,
        labour_type: (r.labour_type ?? r.labor_type ?? 'In-House') as 'In-House' | 'Outsourced',
        start_date: r.start_date,
        end_date: r.end_date,
        bandwidth_pct: r.bandwidth_pct,
        daily_wage: r.daily_wage,
        incentive: r.incentive,
        notes: r.notes,
      };
      const labour = row.labour_id ? labourMap[row.labour_id] ?? null : null;
      const project = projectMap[row.project_id] ?? null;
      const { est, days } = calcAssignmentCost(row, labour);
      return { ...row, labour, project, estCost: est, workingDays: days };
    });

    setAssignments(enriched);
    setLoading(false);
  }, []);

  const fetchOverhead = useCallback(async () => {
    setLoadingOverhead(true);
    const { data, error } = await supabase
      .from('project_cost_ledger')
      .select('*')
      .eq('reference_type', LABOUR_OVERHEAD_REF)
      .order('cost_date', { ascending: false });
    if (error) {
      toast.error('Failed to load overhead entries: ' + error.message);
      setOverheadRows([]);
    } else {
      setOverheadRows((data || []) as OverheadLedger[]);
    }
    setLoadingOverhead(false);
  }, []);

  const fetchPayments = useCallback(async () => {
    setLoadingPayments(true);
    const { data, error } = await supabase
      .from('manpower_payments')
      .select('*')
      .order('payment_date', { ascending: false });
    if (error) {
      toast.error('Failed to load payments: ' + error.message);
      setPaymentRows([]);
    } else {
      setPaymentRows((data || []) as ManpowerPayment[]);
    }
    setLoadingPayments(false);
  }, []);

  const fetchLists = useCallback(async () => {
    const [{ data: l }, { data: p }] = await Promise.all([
      supabase.from('labour_master').select('id, name, labour_type, designation, monthly_salary').order('name'),
      supabase.from('projects').select('project_id, project_name').order('project_name'),
    ]);
    setLabourList((l || []) as LabourRow[]);
    setProjectList((p || []) as ProjectRow[]);
  }, []);

  useEffect(() => {
    fetchLists();
    loadAll();
    fetchOverhead();
    fetchPayments();
  }, [fetchLists, loadAll, fetchOverhead, fetchPayments]);

  useEffect(() => {
    if (filterLabour !== 'all') {
      setPayLabour(filterLabour);
      setOhLabour(filterLabour);
    }
  }, [filterLabour]);

  const filteredAssignments = useMemo(() => {
    return assignments.filter((r) => {
      if (filterLabour !== 'all' && r.labour_id !== Number(filterLabour)) return false;
      return true;
    });
  }, [assignments, filterLabour]);

  const filteredOverhead = useMemo(() => {
    return overheadRows.filter((o) => {
      if (filterLabour !== 'all' && o.reference_id !== Number(filterLabour)) return false;
      return true;
    });
  }, [overheadRows, filterLabour]);

  const paymentsForLabour = useMemo(() => {
    return paymentRows.filter((p) => {
      if (filterLabour !== 'all' && p.labour_id !== Number(filterLabour)) return false;
      return true;
    });
  }, [paymentRows, filterLabour]);

  const filteredPayments = useMemo(() => {
    return paymentsForLabour.filter((p) => {
      if (paymentDateFrom && p.payment_date < paymentDateFrom) return false;
      if (paymentDateTo && p.payment_date > paymentDateTo) return false;
      return true;
    });
  }, [paymentsForLabour, paymentDateFrom, paymentDateTo]);

  const labourIdsInView = useMemo(() => {
    const s = new Set<number>();
    filteredAssignments.forEach((r) => {
      if (r.labour_id) s.add(r.labour_id);
    });
    filteredOverhead.forEach((o) => {
      if (o.reference_id) s.add(o.reference_id);
    });
    paymentsForLabour.forEach((p) => {
      s.add(p.labour_id);
    });
    return Array.from(s).sort((a, b) => a - b);
  }, [filteredAssignments, filteredOverhead, paymentsForLabour]);

  const personBalanceRows = useMemo(() => {
    const ids = new Set<number>();
    labourIdsInView.forEach((id) => ids.add(id));
    const rows = Array.from(ids).map((lid) => {
      const estAssignments = filteredAssignments
        .filter((r) => r.labour_id === lid)
        .reduce((s, r) => s + (r.estCost ?? 0), 0);
      const estOverhead = filteredOverhead
        .filter((o) => o.reference_id === lid)
        .reduce((s, o) => s + Number(o.amount), 0);
      const estimated = estAssignments + estOverhead;
      const paid = paymentsForLabour.filter((p) => p.labour_id === lid).reduce((s, p) => s + Number(p.amount), 0);
      const labour = labourList.find((l) => l.id === lid);
      const name = labour?.name ?? `#${lid}`;
      const labourType = labour?.labour_type ?? null;
      return { labourId: lid, name, labourType, estimated, paid, balance: estimated - paid };
    });
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [labourIdsInView, filteredAssignments, filteredOverhead, paymentsForLabour, labourList]);

  const overheadProjectOptions = useMemo(() => {
    const company = projectList.find((p) => p.project_name === COMPANY_OVERHEAD_PROJECT_NAME);
    const rest = projectList
      .filter((p) => p.project_name !== COMPANY_OVERHEAD_PROJECT_NAME)
      .sort((a, b) => a.project_name.localeCompare(b.project_name));
    return company ? [company, ...rest] : rest;
  }, [projectList]);

  const balanceTotals = useMemo(() => {
    return personBalanceRows.reduce(
      (acc, r) => ({
        estimated: acc.estimated + r.estimated,
        paid: acc.paid + r.paid,
      }),
      { estimated: 0, paid: 0 }
    );
  }, [personBalanceRows]);

  const payslipLines = useMemo(() => {
    if (!payslipLabourId) return { assignments: [] as EnrichedAssignment[], overhead: [] as OverheadLedger[], labour: null as LabourRow | null };
    const lid = Number(payslipLabourId);
    const labour = labourList.find((l) => l.id === lid) ?? null;
    const asg = filteredAssignments.filter((r) => r.labour_id === lid);
    const oh = filteredOverhead.filter((o) => o.reference_id === lid);
    return { assignments: asg, overhead: oh, labour };
  }, [payslipLabourId, filteredAssignments, filteredOverhead, labourList]);

  const payslipTotalProject = useMemo(() => {
    let t = 0;
    payslipLines.assignments.forEach((r) => {
      if (r.estCost != null) t += r.estCost;
    });
    payslipLines.overhead.forEach((o) => {
      t += Number(o.amount);
    });
    return t;
  }, [payslipLines]);

  const payslipPaymentLines = useMemo(() => {
    if (!payslipLabourId) return [] as ManpowerPayment[];
    return paymentsForLabour.filter((p) => p.labour_id === Number(payslipLabourId));
  }, [paymentsForLabour, payslipLabourId]);

  const payslipTotalPaid = useMemo(
    () => payslipPaymentLines.reduce((s, p) => s + Number(p.amount), 0),
    [payslipPaymentLines]
  );

  const openPayslip = () => {
    if (filterLabour === 'all') {
      toast('Select a person to view the payslip.');
      return;
    }
    if (labourIdsInView.length === 0) {
      toast('No assignments, overhead, or payments for this person yet.');
      return;
    }
    setPayslipLabourId(filterLabour);
    setPayslipOpen(true);
  };

  const saveOverhead = async () => {
    if (savingOh) return;
    if (!ohProject || !ohLabour) {
      toast.error('Select where to charge overhead and the person');
      return;
    }
    const amount = Number(ohAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!ohDate) {
      toast.error('Date is required');
      return;
    }
    setSavingOh(true);
    const { data: ud } = await supabase.auth.getUser();
    const { error } = await supabase.from('project_cost_ledger').insert([
      {
        project_id: Number(ohProject),
        cost_category: 'Overhead',
        cost_type: 'Actual',
        amount,
        description: ohNotes.trim() || 'Manpower overhead',
        cost_date: ohDate,
        reference_type: LABOUR_OVERHEAD_REF,
        reference_id: Number(ohLabour),
        created_by: ud.user?.id ?? null,
      },
    ]);
    if (error) {
      toast.error(error.message);
      setSavingOh(false);
      return;
    }
    toast.success('Overhead recorded');
    setOhAmount('');
    setOhNotes('');
    await fetchOverhead();
    setSavingOh(false);
  };

  const openPaymentScreenshot = async (path: string) => {
    const { data, error } = await supabase.storage.from('manpower-payments').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      toast.error('Could not open screenshot');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const savePayment = async () => {
    if (savingPay) return;
    if (!payLabour) {
      toast.error('Select a person');
      return;
    }
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!payDate) {
      toast.error('Date is required');
      return;
    }
    if (!payFile) {
      toast.error('Upload proof of payment: UPI/bank screenshot, or a photo of cash handed over.');
      return;
    }
    if (payFile.size > 6 * 1024 * 1024) {
      toast.error('Image must be under 6 MB');
      return;
    }
    setSavingPay(true);
    const { data: ud } = await supabase.auth.getUser();
    const uid = ud.user?.id ?? 'anon';
    const ext = payFile.name.includes('.') ? payFile.name.split('.').pop() : 'jpg';
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('manpower-payments').upload(path, payFile, {
      contentType: payFile.type || 'image/jpeg',
      upsert: false,
    });
    if (upErr) {
      toast.error(upErr.message);
      setSavingPay(false);
      return;
    }
    const screenshotPath = path;
    const { error } = await supabase.from('manpower_payments').insert([
      {
        labour_id: Number(payLabour),
        project_id: null,
        amount,
        payment_date: payDate,
        notes: payNotes.trim() || null,
        screenshot_path: screenshotPath,
        created_by: ud.user?.id ?? null,
      },
    ]);
    if (error) {
      await supabase.storage.from('manpower-payments').remove([screenshotPath]);
      toast.error(error.message);
      setSavingPay(false);
      return;
    }
    toast.success('Payment recorded');
    setPayAmount('');
    setPayNotes('');
    setPayFile(null);
    setPayFileInputKey((k) => k + 1);
    await fetchPayments();
    setSavingPay(false);
  };

  const deletePayment = async (row: ManpowerPayment) => {
    if (!confirm('Delete this payment record?')) return;
    if (row.screenshot_path) {
      await supabase.storage.from('manpower-payments').remove([row.screenshot_path]);
    }
    const { error } = await supabase.from('manpower_payments').delete().eq('payment_id', row.payment_id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Deleted');
    await fetchPayments();
  };

  const deleteOverhead = async (row: OverheadLedger) => {
    if (!confirm('Delete this overhead entry?')) return;
    const { error } = await supabase.from('project_cost_ledger').delete().eq('ledger_id', row.ledger_id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Deleted');
    await fetchOverhead();
  };

  const projectName = (id: number) => projectList.find((p) => p.project_id === id)?.project_name ?? `Project #${id}`;
  const labourName = (id: number | null) =>
    id == null ? '—' : labourList.find((l) => l.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5 text-slate-600" />
            Payslip & payments
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose a person to see their full payment history, balance, and statement. Estimated cost follows project costing rules (in-house: salary ÷ 24 × bandwidth × days; outsourced: daily wage × days + incentive).{' '}
            <span className="text-slate-700">
              <strong>In-house:</strong> salary is <strong>due on the 5th</strong> of each month; build that cost from <strong>project assignments</strong> and/or <strong>overhead</strong> (use <strong>MignonMinds — company overhead</strong> for company-wide work like store maintenance).{' '}
              Outsourced staff are typically paid weekly.
            </span>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Person</Label>
              <Select value={filterLabour} onValueChange={setFilterLabour}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-[280px]">
                  <SelectItem value="all">All people</SelectItem>
                  {labourList.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payments from</Label>
              <Input
                type="date"
                className="bg-white"
                value={paymentDateFrom}
                onChange={(e) => setPaymentDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Payments to</Label>
              <Input
                type="date"
                className="bg-white"
                value={paymentDateTo}
                onChange={(e) => setPaymentDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2 flex flex-col justify-end">
              <Label className="invisible sm:block">Period</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  setPaymentDateFrom('');
                  setPaymentDateTo('');
                }}
              >
                Clear payment period
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Payment dates filter <strong>only the payment list</strong> below. Balance and payslip still use every payment recorded for the selected person(s).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setFilterLabour('all')}>
              Clear person filter
            </Button>
            <Button type="button" className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={openPayslip}>
              <FileText className="h-4 w-4 mr-2" />
              View payslip
            </Button>
          </div>
        </CardContent>
      </Card>

      {personBalanceRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Banknote className="h-5 w-5 text-violet-600" />
              Balance (estimated earnings − payments)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Estimated = all assignment costs and manpower overhead for the person to date. Paid = all recorded transfers; each payment reduces the balance. In-house rows show when salary is due; cost should be covered from projects and/or overhead (including MignonMinds for company roles).
            </p>
          </CardHeader>
          <CardContent>
            <TooltipProvider delayDuration={200}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment due</TableHead>
                    <TableHead className="text-right">Estimated</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {personBalanceRows.map((r) => {
                    const st = paymentBalanceStatus(r.estimated, r.paid, r.balance);
                    const dueLabel =
                      r.labourType === 'In-House'
                        ? '5th of month'
                        : r.labourType === 'Outsourced'
                          ? 'Weekly'
                          : '—';
                    const dueHint =
                      r.labourType === 'In-House'
                        ? 'Monthly salary run: pay on the 5th. Ensure estimated cost is built from project manpower and/or overhead lines (use MignonMinds — company overhead for non-project work).'
                        : r.labourType === 'Outsourced'
                          ? 'Typically paid weekly; costing comes from project assignments and any overhead you record.'
                          : '';
                    return (
                      <TableRow key={r.labourId}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block cursor-help">
                                <Badge variant="outline" className={`font-normal ${st.badgeClass}`}>
                                  {st.label}
                                </Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[260px]">
                              {st.hint}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          {dueHint ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-block cursor-help">
                                  <Badge
                                    variant="outline"
                                    className={
                                      r.labourType === 'In-House'
                                        ? 'font-normal border-violet-300 text-violet-900 bg-violet-50'
                                        : 'font-normal border-slate-200 text-slate-700 bg-slate-50'
                                    }
                                  >
                                    {dueLabel}
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[280px]">
                                {dueHint}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{fmt(Math.round(r.estimated))}</TableCell>
                        <TableCell className="text-right">{fmt(Math.round(r.paid))}</TableCell>
                        <TableCell
                          className={`text-right font-semibold ${
                            r.balance > 0 ? 'text-amber-800' : r.balance < 0 ? 'text-emerald-700' : 'text-slate-600'
                          }`}
                        >
                          {fmt(Math.round(r.balance))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {personBalanceRows.length > 1 && (
                    <TableRow className="border-t-2 font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell className="text-right">{fmt(Math.round(balanceTotals.estimated))}</TableCell>
                      <TableCell className="text-right">{fmt(Math.round(balanceTotals.paid))}</TableCell>
                      <TableCell className="text-right">
                        {fmt(Math.round(balanceTotals.estimated - balanceTotals.paid))}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TooltipProvider>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Work assignments (estimated)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading assignments…</div>
          ) : filteredAssignments.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              No assignment rows for this filter. Add people under each project&apos;s Manpower tab.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {filterLabour === 'all' && <TableHead>Person</TableHead>}
                  <TableHead>Type</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-center w-[70px]">Days</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssignments.map((r) => (
                  <TableRow key={r.id}>
                    {filterLabour === 'all' && (
                      <TableCell className="font-medium">{r.labour?.name ?? '—'}</TableCell>
                    )}
                    <TableCell>
                      <Badge variant="outline" className={r.labour_type === 'In-House' ? 'border-blue-200 text-blue-800' : 'border-amber-200 text-amber-800'}>
                        {r.labour_type === 'In-House' ? 'In-house' : 'Outsourced'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {r.start_date ? new Date(r.start_date).toLocaleDateString('en-IN') : '—'} →{' '}
                      {r.end_date ? new Date(r.end_date).toLocaleDateString('en-IN') : '—'}
                    </TableCell>
                    <TableCell className="text-center">{r.workingDays ?? '—'}</TableCell>
                    <TableCell className="text-right font-semibold">{r.estCost != null ? fmt(r.estCost) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-600" />
            Manpower overhead (actual)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Charge overhead to a <strong>client project</strong> or to <strong>MignonMinds — company overhead</strong> for company-wide roles (e.g. someone overseeing maintenance at a store). Ledger still needs a project row for costing.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Cost to *</Label>
              <Select value={ohProject} onValueChange={setOhProject}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Select project or company" />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-[280px]">
                  {overheadProjectOptions.length === 0 ? (
                    <SelectItem value="_empty" disabled>
                      No projects — run migrations (includes MignonMinds company overhead)
                    </SelectItem>
                  ) : (
                    overheadProjectOptions.map((p) => (
                      <SelectItem key={p.project_id} value={String(p.project_id)}>
                        {p.project_name === COMPANY_OVERHEAD_PROJECT_NAME
                          ? 'MignonMinds — company overhead'
                          : p.project_name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Person *</Label>
              <Select value={ohLabour} onValueChange={setOhLabour}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-[260px]">
                  {labourList.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (₹) *</Label>
              <Input className="bg-white" type="number" min={0} value={ohAmount} onChange={(e) => setOhAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input className="bg-white" type="date" value={ohDate} onChange={(e) => setOhDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea className="bg-white" rows={2} value={ohNotes} onChange={(e) => setOhNotes(e.target.value)} placeholder="Optional detail" />
          </div>
          <Button type="button" onClick={saveOverhead} disabled={savingOh} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {savingOh ? 'Saving…' : 'Save overhead'}
          </Button>

          {loadingOverhead ? (
            <div className="text-sm text-muted-foreground py-4">Loading overhead…</div>
          ) : filteredOverhead.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">No overhead lines for this filter.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {filterLabour === 'all' && <TableHead>Person</TableHead>}
                  <TableHead className="max-w-[200px]">Cost to</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[70px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOverhead.map((o) => (
                  <TableRow key={o.ledger_id}>
                    <TableCell className="text-sm">{new Date(o.cost_date).toLocaleDateString('en-IN')}</TableCell>
                    {filterLabour === 'all' && <TableCell>{labourName(o.reference_id)}</TableCell>}
                    <TableCell className="text-sm text-slate-700 max-w-[200px] truncate" title={projectName(o.project_id)}>
                      {projectName(o.project_id)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{fmt(Number(o.amount))}</TableCell>
                    <TableCell className="text-sm text-slate-600 max-w-[200px] truncate">{o.description || '—'}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteOverhead(o)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Banknote className="h-5 w-5 text-violet-600" />
            Payments to manpower
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            After you choose a person above, enter payment date, amount, and <strong>proof of payment</strong> (required). Pick a person in the filter or in the field below — their full history shows under this form.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Person *</Label>
              <Select value={payLabour} onValueChange={setPayLabour}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Select who was paid" />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-[260px]">
                  {labourList.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (₹) *</Label>
              <Input
                className="bg-white"
                type="number"
                min={0}
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment date *</Label>
              <Input className="bg-white" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4" />
                Proof of payment *
              </Label>
              <p className="text-xs text-muted-foreground">
                UPI or bank transfer: screenshot of the transaction. <strong>Cash:</strong> upload a clear photo of the cash paid (e.g. bundle/count).
              </p>
              <Input
                key={payFileInputKey}
                className="bg-white cursor-pointer"
                type="file"
                accept="image/*"
                onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
              />
              {payFile && (
                <p className="text-xs text-muted-foreground truncate" title={payFile.name}>
                  Selected: {payFile.name}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                className="bg-white"
                rows={2}
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Reference no., UPI id, etc."
              />
            </div>
          </div>
          <Button
            type="button"
            onClick={savePayment}
            disabled={
              savingPay ||
              !payLabour ||
              !payAmount ||
              !payDate ||
              !payFile ||
              Number(payAmount) <= 0
            }
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {savingPay ? 'Saving…' : 'Record payment'}
          </Button>

          {(paymentDateFrom || paymentDateTo) && (
            <p className="text-sm text-slate-600 border-l-2 border-violet-300 pl-3">
              Payment list: dates between{' '}
              <strong>{paymentDateFrom || '…'}</strong> and <strong>{paymentDateTo || '…'}</strong>
              {paymentsForLabour.length > 0 && filteredPayments.length === 0 && (
                <span className="text-amber-800"> — no rows in this range; adjust the period or clear it.</span>
              )}
            </p>
          )}

          {loadingPayments ? (
            <div className="text-sm text-muted-foreground py-4">Loading payments…</div>
          ) : filteredPayments.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {paymentsForLabour.length === 0
                ? 'No payments match the current person filter.'
                : 'No payments in the selected period. Change payment dates above or click “Clear payment period”.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {filterLabour === 'all' && <TableHead>Person</TableHead>}
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[100px]">Proof</TableHead>
                  <TableHead className="w-[56px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map((p) => (
                  <TableRow key={p.payment_id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {new Date(p.payment_date).toLocaleDateString('en-IN')}
                    </TableCell>
                    {filterLabour === 'all' && <TableCell>{labourName(p.labour_id)}</TableCell>}
                    <TableCell className="text-right font-semibold">{fmt(Number(p.amount))}</TableCell>
                    <TableCell className="text-sm text-slate-600 max-w-[180px] truncate">{p.notes || '—'}</TableCell>
                    <TableCell>
                      {p.screenshot_path ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => openPaymentScreenshot(p.screenshot_path!)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deletePayment(p)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={payslipOpen} onOpenChange={setPayslipOpen}>
        <DialogContent className="bg-white max-w-2xl max-h-[90vh] overflow-y-auto print:max-w-none print:shadow-none print:border-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Manpower statement
            </DialogTitle>
            <DialogDescription>
              Estimated earnings from assignments and manpower overhead, all payments recorded for this person, and balance due.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 print:block" id="manpower-payslip-print">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="space-y-2 flex-1">
                <Label>Person</Label>
                <Select value={payslipLabourId} onValueChange={setPayslipLabourId}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {(filterLabour !== 'all' ? [Number(filterLabour)] : labourIdsInView).map((id) => {
                      const name = labourList.find((l) => l.id === id)?.name ?? `#${id}`;
                      return (
                        <SelectItem key={id} value={String(id)}>
                          {name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>

            {payslipLines.labour && (
              <div className="rounded-lg border p-4 bg-slate-50 print:bg-white">
                <div className="text-lg font-bold">{payslipLines.labour.name}</div>
                <div className="text-sm text-slate-600">
                  {payslipLines.labour.designation || '—'} ·{' '}
                  {payslipLines.labour.labour_type === 'In-House' ? 'In-house' : 'Outsourced'}
                </div>
                {payslipLines.labour.labour_type === 'In-House' && (
                  <p className="text-xs text-violet-900 bg-violet-50 border border-violet-200 rounded-md px-2 py-1.5 mt-2">
                    <strong>Salary due:</strong> 5th of each month. Estimated pay should be covered from project assignments and/or overhead (including{' '}
                    <strong>MignonMinds — company overhead</strong> for company-wide duties).
                  </p>
                )}
              </div>
            )}

            <div>
              <div className="font-semibold text-sm mb-2">Work assignments (estimated)</div>
              {payslipLines.assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assignment lines for this person.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payslipLines.assignments.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.labour_type === 'In-House' ? 'In-house' : 'Outsourced'}</TableCell>
                        <TableCell className="text-sm">
                          {r.start_date ? new Date(r.start_date).toLocaleDateString('en-IN') : '—'} –{' '}
                          {r.end_date ? new Date(r.end_date).toLocaleDateString('en-IN') : '—'}
                        </TableCell>
                        <TableCell className="text-right">{r.estCost != null ? fmt(r.estCost) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <div className="font-semibold text-sm mb-2">Manpower overhead (recorded)</div>
              {payslipLines.overhead.length === 0 ? (
                <p className="text-sm text-muted-foreground">None recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Cost to</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payslipLines.overhead.map((o) => (
                      <TableRow key={o.ledger_id}>
                        <TableCell>{new Date(o.cost_date).toLocaleDateString('en-IN')}</TableCell>
                        <TableCell className="text-sm max-w-[180px] truncate" title={projectName(o.project_id)}>
                          {projectName(o.project_id)}
                        </TableCell>
                        <TableCell className="text-right">{fmt(Number(o.amount))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <div className="font-semibold text-sm mb-2 flex items-center gap-2">
                <Banknote className="h-4 w-4 text-violet-600" />
                Payment history
              </div>
              {payslipPaymentLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payslipPaymentLines.map((p) => (
                      <TableRow key={p.payment_id}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {new Date(p.payment_date).toLocaleDateString('en-IN')}
                        </TableCell>
                        <TableCell className="text-right">{fmt(Number(p.amount))}</TableCell>
                        <TableCell className="text-sm text-slate-600 max-w-[160px] truncate">{p.notes || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="flex justify-between items-center text-base font-semibold">
                <span>Estimated total (assignments + overhead)</span>
                <span>{fmt(payslipTotalProject)}</span>
              </div>
              <div className="flex justify-between items-center text-base">
                <span>Total paid</span>
                <span className="font-medium">{fmt(payslipTotalPaid)}</span>
              </div>
              <div className="flex justify-between items-center text-lg font-bold">
                <span>Balance due</span>
                <span
                  className={
                    payslipTotalProject - payslipTotalPaid > 0
                      ? 'text-amber-800'
                      : payslipTotalProject - payslipTotalPaid < 0
                        ? 'text-emerald-700'
                        : ''
                  }
                >
                  {fmt(payslipTotalProject - payslipTotalPaid)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayslipOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
