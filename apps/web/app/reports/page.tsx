'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    BarChart3, Download, FileText,
    DollarSign, Package, Activity, Printer, ListTodo,
    CheckCircle2, AlertTriangle, FolderKanban,
    TrendingUp, TrendingDown, Wallet, PiggyBank,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

/* ─── Types ────────────────────────────────────────────────── */
type Project = { project_id: number; project_name: string; status: string; location: string | null; start_date: string | null };

type CostingSummary = {
    project_id: number;
    total_actual_cost: number;
    budgeted_total: number;
    cost_variance: number;
    income_total: number;
    profit_loss: number;
    material_cost_actual: number;
    labor_cost_inhouse: number;
    labor_cost_outsourced: number;
    expenses_total: number;
};

type ProjectSummary = {
    project: Project;
    totalCost: number;
    budgetedTotal: number;
    costVariance: number;
    incomeTotal: number;
    profitLoss: number;
    materialCost: number;
    laborInhouse: number;
    laborOutsourced: number;
    otherExpenses: number;
    pendingTasks: number;
    doneTasks: number;
    totalTasks: number;
    totalActivities: number;
    completedActivities: number;
    avgProgress: number;
    pendingMaterials: number;
    approvedMaterials: number;
};

type QuickStats = {
    totalProjectCost: number;
    totalBudget: number;
    totalVariance: number;
    totalIncome: number;
    totalProfitLoss: number;
    pendingTasks: number;
    doneTasks: number;
    pendingMaterials: number;
    avgProgress: number;
    totalProjects: number;
    activeProjects: number;
};

type ReportView = 'summary' | 'projects' | 'tasks' | 'materials' | 'financial';

const fmt = (n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n));

function isTaskDone(status: string | null | undefined): boolean {
    const s = (status || '').toLowerCase();
    return s === 'done' || s.includes('complete');
}

function isActivityComplete(status: string | null | undefined, progress: number | null | undefined): boolean {
    const st = (status || '').toLowerCase();
    return st.includes('complet') || (progress ?? 0) >= 100;
}

function escapeCsvCell(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

const STATUS_COLOR: Record<string, string> = {
    Planning:  'bg-blue-100 text-blue-700',
    Execution: 'bg-amber-100 text-amber-700',
    Handover:  'bg-purple-100 text-purple-700',
    Completed: 'bg-green-100 text-green-700',
};

const STATUS_BAR: Record<string, string> = {
    Planning:  'bg-blue-400',
    Execution: 'bg-amber-400',
    Handover:  'bg-purple-500',
    Completed: 'bg-green-500',
};

/* ─── Page ─────────────────────────────────────────────────── */
export default function ReportsPage() {
    const [userRole, setUserRole] = useState('');
    const [allowedIds, setAllowedIds] = useState<number[] | null>(null);
    const [initializing, setInitializing] = useState(true);

    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('all');
    const [reportType, setReportType] = useState<ReportView>('summary');
    const [loading, setLoading] = useState(false);

    const [quickStats, setQuickStats] = useState<QuickStats>({
        totalProjectCost: 0,
        totalBudget: 0,
        totalVariance: 0,
        totalIncome: 0,
        totalProfitLoss: 0,
        pendingTasks: 0,
        doneTasks: 0,
        pendingMaterials: 0,
        avgProgress: 0,
        totalProjects: 0,
        activeProjects: 0,
    });
    const [summaries, setSummaries] = useState<ProjectSummary[]>([]);

    const canSeeFinancial = userRole === 'Admin' || userRole === 'ProjectManager';

    useEffect(() => {
        if (!canSeeFinancial && (reportType === 'financial' || reportType === 'projects')) {
            setReportType('summary');
        }
    }, [canSeeFinancial, reportType]);

    useEffect(() => {
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
            const role = profile?.role || '';
            setUserRole(role);

            if (role === 'SiteSupervisor') {
                const { data: mem } = await supabase.from('project_members').select('project_id').eq('user_id', user.id);
                setAllowedIds((mem || []).map((m: { project_id: number }) => Number(m.project_id)));
            } else {
                setAllowedIds(null);
            }
            setInitializing(false);
        })();
    }, []);

    useEffect(() => {
        if (initializing) return;
        (async () => {
            let q = supabase.from('projects').select('project_id, project_name, status, location, start_date').order('project_name');
            if (allowedIds !== null) {
                if (allowedIds.length === 0) { setProjects([]); return; }
                q = q.in('project_id', allowedIds);
            }
            const { data, error } = await q;
            if (error) {
                toast.error('Could not load projects: ' + error.message);
                setProjects([]);
                return;
            }
            setProjects((data || []) as Project[]);
        })();
    }, [initializing, allowedIds]);

    const fetchData = useCallback(async () => {
        if (initializing) return;
        setLoading(true);

        let ids: number[] | null = allowedIds;
        if (selectedProject !== 'all') {
            ids = [parseInt(selectedProject, 10)];
        } else if (allowedIds !== null && allowedIds.length === 0) {
            setLoading(false);
            return;
        }

        let pq = supabase.from('projects').select('project_id, project_name, status, location, start_date').order('project_name');
        if (ids !== null) pq = pq.in('project_id', ids);
        const { data: projs, error: projErr } = await pq;
        if (projErr) {
            toast.error('Projects: ' + projErr.message);
            setSummaries([]);
            setLoading(false);
            return;
        }
        const projList = (projs || []) as Project[];
        const projIds = projList.map(p => p.project_id);

        if (projIds.length === 0) {
            setSummaries([]);
            setQuickStats({
                totalProjectCost: 0, totalBudget: 0, totalVariance: 0, totalIncome: 0, totalProfitLoss: 0,
                pendingTasks: 0, doneTasks: 0, pendingMaterials: 0, avgProgress: 0, totalProjects: 0, activeProjects: 0,
            });
            setLoading(false);
            return;
        }

        const [
            tasksRes,
            actsRes,
            matsRes,
            costingRes,
        ] = await Promise.all([
            supabase.from('project_tasks').select('task_id, project_id, status').in('project_id', projIds),
            supabase.from('site_activities').select('activity_id, project_id, status, progress').in('project_id', projIds),
            supabase.from('purchase_requests').select('pr_id, project_id, status').in('project_id', projIds),
            supabase
                .from('project_costing_summary')
                .select(
                    'project_id, total_actual_cost, budgeted_total, cost_variance, income_total, profit_loss, material_cost_actual, labor_cost_inhouse, labor_cost_outsourced, expenses_total'
                )
                .in('project_id', projIds),
        ]);

        if (tasksRes.error) toast.error('Tasks: ' + tasksRes.error.message);
        if (actsRes.error) toast.error('Activities: ' + actsRes.error.message);
        if (matsRes.error) toast.error('Purchase requests: ' + matsRes.error.message);
        if (costingRes.error) toast.error('Costing: ' + costingRes.error.message + ' — check project_costing_summary view exists.');

        const taskRows = tasksRes.data || [];
        const actRows = actsRes.data || [];
        const matRows = matsRes.data || [];
        const costingRows = (costingRes.data || []) as CostingSummary[];

        const costByProject: Record<number, CostingSummary> = {};
        costingRows.forEach((c) => {
            costByProject[c.project_id] = c;
        });

        const built: ProjectSummary[] = projList.map((project) => {
            const pid = project.project_id;
            const c = costByProject[pid];
            const pTasks = taskRows.filter((t: { project_id: number }) => t.project_id === pid);
            const pendingTasks = pTasks.filter((t: { status?: string }) => !isTaskDone(t.status)).length;
            const doneTasks = pTasks.filter((t: { status?: string }) => isTaskDone(t.status)).length;

            const pActs = actRows.filter((a: { project_id: number }) => a.project_id === pid);
            const completedActs = pActs.filter((a: { status?: string; progress?: number }) =>
                isActivityComplete(a.status, a.progress)
            ).length;
            const avgProgress = pActs.length > 0
                ? Math.round(pActs.reduce((s: number, a: { progress?: number }) => s + (a.progress || 0), 0) / pActs.length)
                : 0;

            const pMats = matRows.filter((m: { project_id: number }) => m.project_id === pid);
            const pendingMats = pMats.filter((m: { status?: string }) => (m.status || '').toLowerCase() === 'pending').length;
            const approvedMats = pMats.filter((m: { status?: string }) =>
                ['approved', 'fulfilled'].includes((m.status || '').toLowerCase())
            ).length;

            return {
                project,
                totalCost: c ? Number(c.total_actual_cost) || 0 : 0,
                budgetedTotal: c ? Number(c.budgeted_total) || 0 : 0,
                costVariance: c ? Number(c.cost_variance) || 0 : 0,
                incomeTotal: c ? Number(c.income_total) || 0 : 0,
                profitLoss: c ? Number(c.profit_loss) || 0 : 0,
                materialCost: c ? Number(c.material_cost_actual) || 0 : 0,
                laborInhouse: c ? Number(c.labor_cost_inhouse) || 0 : 0,
                laborOutsourced: c ? Number(c.labor_cost_outsourced) || 0 : 0,
                otherExpenses: c ? Number(c.expenses_total) || 0 : 0,
                pendingTasks,
                doneTasks,
                totalTasks: pTasks.length,
                totalActivities: pActs.length,
                completedActivities: completedActs,
                avgProgress,
                pendingMaterials: pendingMats,
                approvedMaterials: approvedMats,
            };
        });

        setSummaries(built);

        const totalBudget = built.reduce((s, b) => s + b.budgetedTotal, 0);
        const totalActual = built.reduce((s, b) => s + b.totalCost, 0);
        setQuickStats({
            totalProjectCost: totalActual,
            totalBudget,
            totalVariance: totalBudget - totalActual,
            totalIncome: built.reduce((s, b) => s + b.incomeTotal, 0),
            totalProfitLoss: built.reduce((s, b) => s + b.profitLoss, 0),
            pendingTasks: built.reduce((s, b) => s + b.pendingTasks, 0),
            doneTasks: built.reduce((s, b) => s + b.doneTasks, 0),
            pendingMaterials: built.reduce((s, b) => s + b.pendingMaterials, 0),
            avgProgress: built.length > 0 ? Math.round(built.reduce((s, b) => s + b.avgProgress, 0) / built.length) : 0,
            totalProjects: projList.length,
            activeProjects: projList.filter(p => ['Planning', 'Execution', 'Handover'].includes(p.status)).length,
        });

        setLoading(false);
    }, [initializing, allowedIds, selectedProject]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const exportCSV = (rows: Record<string, unknown>[], name: string) => {
        if (!rows.length) { toast.error('No data to export'); return; }
        const headers = Object.keys(rows[0]);
        const lines = [
            headers.map(escapeCsvCell).join(','),
            ...rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(',')),
        ];
        const csv = lines.join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        a.download = `${name}_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success('Exported successfully');
    };

    const handleExport = () => {
        if (reportType === 'financial' && canSeeFinancial) {
            exportCSV(
                summaries.map(s => ({
                    Project: s.project.project_name,
                    Status: s.project.status,
                    'Budget (₹)': s.budgetedTotal,
                    'Actual cost (₹)': s.totalCost,
                    'Variance (₹)': s.costVariance,
                    'Income (₹)': s.incomeTotal,
                    'Profit / Loss (₹)': s.profitLoss,
                    'Material (₹)': s.materialCost,
                    'Manpower in-house (₹)': s.laborInhouse,
                    'Manpower outsourced (₹)': s.laborOutsourced,
                    'Other expenses (₹)': s.otherExpenses,
                })),
                'financial_report'
            );
            return;
        }
        if (reportType === 'tasks') {
            exportCSV(
                summaries.map(s => ({
                    Project: s.project.project_name,
                    Status: s.project.status,
                    'Total tasks': s.totalTasks,
                    Done: s.doneTasks,
                    Pending: s.pendingTasks,
                    'Completion %': s.totalTasks > 0 ? Math.round((s.doneTasks / s.totalTasks) * 100) : 0,
                })),
                'tasks_report'
            );
            return;
        }
        if (reportType === 'materials') {
            exportCSV(
                summaries.map(s => ({
                    Project: s.project.project_name,
                    Status: s.project.status,
                    'Pending PRs': s.pendingMaterials,
                    'Approved / fulfilled': s.approvedMaterials,
                })),
                'materials_report'
            );
            return;
        }
        exportCSV(
            summaries.map(s => ({
                Project: s.project.project_name,
                Status: s.project.status,
                'Actual cost (₹)': s.totalCost,
                'Budget (₹)': s.budgetedTotal,
                'Pending tasks': s.pendingTasks,
                'Done tasks': s.doneTasks,
                'Avg progress %': s.avgProgress,
                'Pending materials': s.pendingMaterials,
            })),
            'project_report'
        );
    };

    const financialCards = useMemo(() => {
        if (!canSeeFinancial) return null;
        const v = quickStats.totalVariance;
        return (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 print:grid-cols-2">
                <Card className="border-l-4 border-l-violet-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total budget</CardTitle>
                        <PiggyBank className="h-4 w-4 text-violet-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-violet-800">₹{fmt(quickStats.totalBudget)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Sum of budget ledger entries</p>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-slate-600">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Budget variance</CardTitle>
                        {v >= 0 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${v >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {v >= 0 ? '+' : ''}₹{fmt(v)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Budget minus actual (portfolio)</p>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-cyan-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Income (credits)</CardTitle>
                        <Wallet className="h-4 w-4 text-cyan-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-cyan-700">₹{fmt(quickStats.totalIncome)}</div>
                        <p className="text-xs text-muted-foreground mt-1">Project-linked credit transactions</p>
                    </CardContent>
                </Card>
                <Card className="border-l-4 border-l-emerald-600">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Profit / loss</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${quickStats.totalProfitLoss >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                            {quickStats.totalProfitLoss >= 0 ? '+' : ''}₹{fmt(quickStats.totalProfitLoss)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Per-project P/L summed</p>
                    </CardContent>
                </Card>
            </div>
        );
    }, [canSeeFinancial, quickStats]);

    if (initializing) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground text-sm">
                <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                Loading reports…
            </div>
        );
    }

    return (
        <div className="space-y-6 print:space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:hidden">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Reports</h2>
                    
                    <p className="text-xs text-muted-foreground mt-2">
                        {userRole === 'SiteSupervisor'
                            ? `Your assignments: ${projects.length} project${projects.length !== 1 ? 's' : ''}`
                            : 'Organization-wide view'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <Button type="button" variant="outline" onClick={() => window.print()}>
                        <Printer className="mr-2 h-4 w-4" /> Print
                    </Button>
                    <Button type="button" onClick={handleExport} className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Download className="mr-2 h-4 w-4" /> Export CSV
                    </Button>
                </div>
            </div>

            {/* Operations */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="border-l-4 border-l-blue-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total actual cost</CardTitle>
                        <DollarSign className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-700">₹{fmt(quickStats.totalProjectCost)}</div>
                        <p className="text-xs text-muted-foreground mt-1">{quickStats.totalProjects} projects · {quickStats.activeProjects} active</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-amber-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Pending tasks</CardTitle>
                        <ListTodo className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-amber-600">{quickStats.pendingTasks}</div>
                        <p className="text-xs text-muted-foreground mt-1">{quickStats.doneTasks} completed</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-orange-400">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Purchase requests</CardTitle>
                        <Package className="h-4 w-4 text-orange-400" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${quickStats.pendingMaterials > 0 ? 'text-orange-500' : 'text-green-600'}`}>
                            {quickStats.pendingMaterials}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">pending approval</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-green-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Avg site progress</CardTitle>
                        <Activity className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{quickStats.avgProgress}%</div>
                        <Progress value={quickStats.avgProgress} className="mt-2 h-1.5" />
                    </CardContent>
                </Card>
            </div>

            {financialCards}

            <Card className="print:border print:shadow-none">
                <CardContent className="pt-5 pb-4">
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="space-y-1.5 min-w-[200px]">
                            <Label>Report view</Label>
                            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportView)}>
                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                    <SelectItem value="summary">Project summary</SelectItem>
                                    <SelectItem value="tasks">Task breakdown</SelectItem>
                                    <SelectItem value="materials">Purchase requests</SelectItem>
                                    {canSeeFinancial && (
                                        <>
                                            <SelectItem value="financial">Financial (costing)</SelectItem>
                                            <SelectItem value="projects">Project status (table)</SelectItem>
                                        </>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5 min-w-[220px]">
                            <Label>Project filter</Label>
                            <Select value={selectedProject} onValueChange={setSelectedProject}>
                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg max-h-[280px]">
                                    <SelectItem value="all">All projects</SelectItem>
                                    {projects.map(p => (
                                        <SelectItem key={p.project_id} value={String(p.project_id)}>
                                            {p.project_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <Card><CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
                    <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Loading report data…
                </CardContent></Card>
            ) : summaries.length === 0 ? (
                <Card>
                    <CardContent className="py-14 text-center text-muted-foreground space-y-2">
                        <p className="font-medium text-foreground">No projects in scope</p>
                        <p className="text-sm">
                            {allowedIds?.length === 0
                                ? 'You are not assigned to any projects. Ask an admin to add you under Project members.'
                                : 'Create a project or widen the filter.'}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {reportType === 'summary' && (
                        <div className="space-y-4">
                            {summaries.map(s => {
                                const taskPct = s.totalTasks > 0 ? Math.round((s.doneTasks / s.totalTasks) * 100) : 0;
                                return (
                                    <Card key={s.project.project_id} className="border-l-4 border-l-blue-400 print:break-inside-avoid">
                                        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <FolderKanban className="h-5 w-5 text-blue-500 shrink-0" />
                                                <div className="min-w-0">
                                                    <Link href={`/projects/${s.project.project_id}`} className="font-semibold text-base hover:underline text-blue-700 truncate block">
                                                        {s.project.project_name}
                                                    </Link>
                                                    <p className="text-xs text-muted-foreground truncate">{s.project.location || 'No location'}</p>
                                                </div>
                                            </div>
                                            <Badge className={STATUS_COLOR[s.project.status] || 'bg-slate-100 text-slate-600'}>
                                                {s.project.status}
                                            </Badge>
                                        </CardHeader>
                                        <CardContent className="pt-4">
                                            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <DollarSign className="h-3 w-3" /> Actual cost
                                                    </p>
                                                    <p className="text-lg font-bold text-blue-700">₹{fmt(s.totalCost)}</p>
                                                    {canSeeFinancial && s.budgetedTotal > 0 && (
                                                        <p className="text-xs text-muted-foreground">Budget ₹{fmt(s.budgetedTotal)}</p>
                                                    )}
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <ListTodo className="h-3 w-3" /> Tasks
                                                    </p>
                                                    <p className="text-lg font-bold">
                                                        <span className="text-green-600">{s.doneTasks}</span>
                                                        <span className="text-slate-400 text-sm font-normal"> / {s.totalTasks}</span>
                                                    </p>
                                                    <div className="flex items-center gap-1">
                                                        <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                                                            <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${taskPct}%` }} />
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">{taskPct}%</span>
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Package className="h-3 w-3" /> Purchase requests
                                                    </p>
                                                    <div className="flex gap-2 items-center">
                                                        {s.pendingMaterials > 0 ? (
                                                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
                                                                <AlertTriangle className="h-3.5 w-3.5" /> {s.pendingMaterials} pending
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600">
                                                                <CheckCircle2 className="h-3.5 w-3.5" /> Clear
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">{s.approvedMaterials} approved / fulfilled</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Activity className="h-3 w-3" /> Activity progress
                                                    </p>
                                                    <p className="text-lg font-bold text-green-600">{s.avgProgress}%</p>
                                                    <div className="flex items-center gap-1">
                                                        <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                                                            <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${s.avgProgress}%` }} />
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">{s.completedActivities}/{s.totalActivities}</span>
                                                    </div>
                                                </div>
                                                {canSeeFinancial && (
                                                    <div className="space-y-1 col-span-2 lg:col-span-2 xl:col-span-2 border-t lg:border-t-0 xl:border-t-0 pt-3 lg:pt-0 lg:border-l lg:pl-4 xl:pl-4">
                                                        <p className="text-xs font-medium text-muted-foreground">Financial snapshot</p>
                                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                                            <div>
                                                                <span className="text-muted-foreground">Material</span>
                                                                <p className="font-semibold">₹{fmt(s.materialCost)}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground">Manpower</span>
                                                                <p className="font-semibold">₹{fmt(s.laborInhouse + s.laborOutsourced)}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground">Other exp.</span>
                                                                <p className="font-semibold">₹{fmt(s.otherExpenses)}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted-foreground">P/L</span>
                                                                <p className={`font-semibold ${s.profitLoss >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                                                    {s.profitLoss >= 0 ? '+' : ''}₹{fmt(s.profitLoss)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}

                    {reportType === 'tasks' && (
                        <Card className="print:break-inside-avoid">
                            <CardHeader className="border-b">
                                <CardTitle className="flex items-center gap-2">
                                    <ListTodo className="h-5 w-5 text-amber-500" /> Task breakdown by project
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Project</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-center">Total</TableHead>
                                            <TableHead className="text-center">Done</TableHead>
                                            <TableHead className="text-center">Pending</TableHead>
                                            <TableHead>Completion</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {summaries.map(s => {
                                            const pct = s.totalTasks > 0 ? Math.round((s.doneTasks / s.totalTasks) * 100) : 0;
                                            return (
                                                <TableRow key={s.project.project_id}>
                                                    <TableCell>
                                                        <Link href={`/projects/${s.project.project_id}`} className="font-medium text-blue-600 hover:underline">
                                                            {s.project.project_name}
                                                        </Link>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge className={STATUS_COLOR[s.project.status] || 'bg-slate-100 text-slate-600'}>
                                                            {s.project.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-center font-semibold">{s.totalTasks}</TableCell>
                                                    <TableCell className="text-center">
                                                        <span className="text-green-600 font-semibold">{s.doneTasks}</span>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        {s.pendingTasks > 0
                                                            ? <span className="text-amber-600 font-semibold">{s.pendingTasks}</span>
                                                            : <span className="text-slate-400">0</span>}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2 min-w-[120px]">
                                                            <div className="flex-1 bg-slate-200 rounded-full h-2">
                                                                <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                                            </div>
                                                            <span className="text-xs font-semibold w-9 text-right">{pct}%</span>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        <TableRow className="bg-slate-50 font-semibold border-t-2">
                                            <TableCell colSpan={2} className="font-bold">Total</TableCell>
                                            <TableCell className="text-center">{summaries.reduce((acc, r) => acc + r.totalTasks, 0)}</TableCell>
                                            <TableCell className="text-center text-green-600">{summaries.reduce((acc, r) => acc + r.doneTasks, 0)}</TableCell>
                                            <TableCell className="text-center text-amber-600">{summaries.reduce((acc, r) => acc + r.pendingTasks, 0)}</TableCell>
                                            <TableCell />
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )}

                    {reportType === 'materials' && (
                        <Card className="print:break-inside-avoid">
                            <CardHeader className="border-b">
                                <CardTitle className="flex items-center gap-2">
                                    <Package className="h-5 w-5 text-orange-400" /> Purchase request status by project
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4 overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Project</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-center">Pending</TableHead>
                                            <TableHead className="text-center">Approved / fulfilled</TableHead>
                                            <TableHead>Pending share</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {summaries.map(s => {
                                            const total = s.pendingMaterials + s.approvedMaterials;
                                            const pct = total > 0 ? Math.round((s.pendingMaterials / total) * 100) : 0;
                                            return (
                                                <TableRow key={s.project.project_id}>
                                                    <TableCell>
                                                        <Link href={`/projects/${s.project.project_id}`} className="font-medium text-blue-600 hover:underline">
                                                            {s.project.project_name}
                                                        </Link>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge className={STATUS_COLOR[s.project.status] || 'bg-slate-100 text-slate-600'}>
                                                            {s.project.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        {s.pendingMaterials > 0
                                                            ? <span className="inline-flex items-center justify-center gap-1 text-amber-600 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{s.pendingMaterials}</span>
                                                            : <span className="text-slate-400">0</span>}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <span className="text-green-600 font-semibold">{s.approvedMaterials}</span>
                                                    </TableCell>
                                                    <TableCell>
                                                        {total === 0 ? (
                                                            <span className="text-xs text-slate-400">No requests</span>
                                                        ) : (
                                                            <div className="flex items-center gap-2 min-w-[120px]">
                                                                <div className="flex-1 bg-slate-200 rounded-full h-2">
                                                                    <div className={`h-2 rounded-full transition-all ${pct > 50 ? 'bg-amber-400' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
                                                                </div>
                                                                <span className="text-xs font-semibold w-9 text-right">{pct}%</span>
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )}

                    {reportType === 'financial' && canSeeFinancial && (
                        <Card className="print:break-inside-avoid">
                            <CardHeader className="border-b">
                                <CardTitle className="flex items-center gap-2">
                                    <BarChart3 className="h-5 w-5 text-violet-600" /> Financial costing by project
                                </CardTitle>
                                <p className="text-sm text-muted-foreground font-normal">
                                    Same source as Project → Costing: materials (movements), manpower, ledger actuals, and debit/credit transactions.
                                </p>
                            </CardHeader>
                            <CardContent className="pt-4 overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Project</TableHead>
                                            <TableHead className="text-right">Budget</TableHead>
                                            <TableHead className="text-right">Actual</TableHead>
                                            <TableHead className="text-right">Variance</TableHead>
                                            <TableHead className="text-right">Income</TableHead>
                                            <TableHead className="text-right">P/L</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {summaries.map(s => (
                                            <TableRow key={s.project.project_id}>
                                                <TableCell>
                                                    <Link href={`/projects/${s.project.project_id}`} className="font-medium text-blue-600 hover:underline">
                                                        {s.project.project_name}
                                                    </Link>
                                                </TableCell>
                                                <TableCell className="text-right">₹{fmt(s.budgetedTotal)}</TableCell>
                                                <TableCell className="text-right font-medium">₹{fmt(s.totalCost)}</TableCell>
                                                <TableCell className={`text-right font-medium ${s.costVariance >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                                    {s.costVariance >= 0 ? '+' : ''}₹{fmt(s.costVariance)}
                                                </TableCell>
                                                <TableCell className="text-right">₹{fmt(s.incomeTotal)}</TableCell>
                                                <TableCell className={`text-right font-semibold ${s.profitLoss >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                                    {s.profitLoss >= 0 ? '+' : ''}₹{fmt(s.profitLoss)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                <p className="text-xs text-muted-foreground mt-4">
                                    Variance = budget minus actual. P/L = income credits minus total actual cost (per project).
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {reportType === 'projects' && canSeeFinancial && (
                        <div className="space-y-4">
                            <Card>
                                <CardHeader className="border-b pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <BarChart3 className="h-5 w-5 text-blue-500" /> Status distribution
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4 space-y-3">
                                    {['Planning', 'Execution', 'Handover', 'Completed'].map(status => {
                                        const count = projects.filter(p => p.status === status).length;
                                        const pct = projects.length > 0 ? Math.round((count / projects.length) * 100) : 0;
                                        return (
                                            <div key={status} className="space-y-1">
                                                <div className="flex justify-between text-sm">
                                                    <span className="font-medium">{status}</span>
                                                    <span className="text-muted-foreground">{count} project{count !== 1 ? 's' : ''} ({pct}%)</span>
                                                </div>
                                                <div className="bg-slate-200 rounded-full h-2">
                                                    <div
                                                        className={`h-2 rounded-full transition-all ${STATUS_BAR[status] || 'bg-slate-400'}`}
                                                        style={{ width: `${pct}%`, minWidth: count > 0 ? '6px' : undefined }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="border-b pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <FileText className="h-5 w-5 text-blue-500" /> All projects
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4 overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Project</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Location</TableHead>
                                                <TableHead>Start date</TableHead>
                                                <TableHead className="text-right">Actual cost</TableHead>
                                                <TableHead className="text-center">Tasks</TableHead>
                                                <TableHead>Progress</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {summaries.map(s => (
                                                <TableRow key={s.project.project_id}>
                                                    <TableCell>
                                                        <Link href={`/projects/${s.project.project_id}`} className="font-medium text-blue-600 hover:underline">
                                                            {s.project.project_name}
                                                        </Link>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge className={STATUS_COLOR[s.project.status] || 'bg-slate-100 text-slate-600'}>
                                                            {s.project.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">{s.project.location || '—'}</TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">
                                                        {s.project.start_date
                                                            ? new Date(s.project.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                                                            : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-blue-700">
                                                        {s.totalCost > 0 ? `₹${fmt(s.totalCost)}` : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <span className="text-green-600 font-semibold">{s.doneTasks}</span>
                                                        <span className="text-muted-foreground text-xs"> / {s.totalTasks}</span>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2 min-w-[100px]">
                                                            <div className="flex-1 bg-slate-200 rounded-full h-2">
                                                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${s.avgProgress}%` }} />
                                                            </div>
                                                            <span className="text-xs font-semibold w-9 text-right">{s.avgProgress}%</span>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
