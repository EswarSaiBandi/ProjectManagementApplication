'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    BarChart3, TrendingUp, Download, FileText, Users,
    DollarSign, Package, Activity, Printer, ListTodo,
    CheckCircle2, Clock, AlertTriangle, FolderKanban,
    ShoppingCart, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

/* ─── Types ────────────────────────────────────────────────── */
type Project = { project_id: number; project_name: string; status: string; location: string | null; start_date: string | null };

type ProjectSummary = {
    project: Project;
    totalCost: number;
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
    pendingTasks: number;
    doneTasks: number;
    pendingMaterials: number;
    avgProgress: number;
    totalProjects: number;
    activeProjects: number;
};

const fmt = (n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n));

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

const MAT_BADGE: Record<string, string> = {
    Pending:  'bg-amber-100 text-amber-700',
    Approved: 'bg-green-100 text-green-700',
    Rejected: 'bg-red-100 text-red-700',
    Fulfilled:'bg-teal-100 text-teal-700',
};

/* ─── Page ─────────────────────────────────────────────────── */
export default function ReportsPage() {
    const [userRole, setUserRole] = useState('');
    const [allowedIds, setAllowedIds] = useState<number[] | null>(null); // null = all, [] = none
    const [initializing, setInitializing] = useState(true);

    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('all');
    const [reportType, setReportType] = useState<'summary' | 'projects' | 'tasks' | 'materials'>('summary');
    const [loading, setLoading] = useState(false);

    const [quickStats, setQuickStats] = useState<QuickStats>({ totalProjectCost: 0, pendingTasks: 0, doneTasks: 0, pendingMaterials: 0, avgProgress: 0, totalProjects: 0, activeProjects: 0 });
    const [summaries, setSummaries] = useState<ProjectSummary[]>([]);

    /* ── Init: get role + allowed project IDs ── */
    useEffect(() => {
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).single();
            const role = profile?.role || '';
            setUserRole(role);

            if (role === 'SiteSupervisor') {
                const { data: mem } = await supabase.from('project_members').select('project_id').eq('user_id', user.id);
                setAllowedIds((mem || []).map((m: any) => Number(m.project_id)));
            } else {
                setAllowedIds(null); // Admin/PM: all projects
            }
            setInitializing(false);
        })();
    }, []);

    /* ── Fetch projects list (for filter dropdown) ── */
    useEffect(() => {
        if (initializing) return;
        (async () => {
            let q = supabase.from('projects').select('project_id, project_name, status, location, start_date').order('project_name');
            if (allowedIds !== null) {
                if (allowedIds.length === 0) { setProjects([]); return; }
                q = q.in('project_id', allowedIds);
            }
            const { data } = await q;
            setProjects((data || []) as Project[]);
        })();
    }, [initializing, allowedIds]);

    /* ── Main data fetch ── */
    const fetchData = useCallback(async () => {
        if (initializing) return;
        setLoading(true);

        // Determine project IDs to query
        let ids: number[] | null = allowedIds; // null = all
        if (selectedProject !== 'all') {
            ids = [parseInt(selectedProject)];
        } else if (allowedIds !== null && allowedIds.length === 0) {
            setLoading(false); return;
        }

        // 1. Projects
        let pq = supabase.from('projects').select('project_id, project_name, status, location, start_date').order('project_name');
        if (ids !== null) pq = pq.in('project_id', ids);
        const { data: projs } = await pq;
        const projList = (projs || []) as Project[];

        const projIds = projList.map(p => p.project_id);
        if (projIds.length === 0) {
            setSummaries([]);
            setQuickStats({ totalProjectCost: 0, pendingTasks: 0, doneTasks: 0, pendingMaterials: 0, avgProgress: 0, totalProjects: 0, activeProjects: 0 });
            setLoading(false); return;
        }

        // 2. Tasks
        const { data: tasks } = await supabase.from('project_tasks').select('task_id, project_id, status').in('project_id', projIds);
        const taskRows = tasks || [];

        // 3. Activities (for progress)
        const { data: acts } = await supabase.from('site_activities').select('activity_id, project_id, status, progress').in('project_id', projIds);
        const actRows = acts || [];

        // 4. Material requests
        const { data: mats } = await supabase.from('purchase_requests').select('request_id, project_id, status').in('project_id', projIds);
        const matRows = mats || [];

        // 5. Project costing (total cost per project)
        const { data: costings } = await supabase.from('project_costing').select('project_id, total_cost').in('project_id', projIds);
        const costMap: Record<number, number> = {};
        (costings || []).forEach((c: any) => { costMap[c.project_id] = (costMap[c.project_id] || 0) + (parseFloat(c.total_cost) || 0); });

        // Build per-project summaries
        const built: ProjectSummary[] = projList.map(project => {
            const pid = project.project_id;
            const pTasks = taskRows.filter((t: any) => t.project_id === pid);
            const pendingTasks = pTasks.filter((t: any) => (t.status || '').toLowerCase() !== 'done').length;
            const doneTasks = pTasks.filter((t: any) => (t.status || '').toLowerCase() === 'done').length;

            const pActs = actRows.filter((a: any) => a.project_id === pid);
            const completedActs = pActs.filter((a: any) => (a.status || '').toLowerCase().includes('complet') || (a.progress || 0) >= 100).length;
            const avgProgress = pActs.length > 0 ? Math.round(pActs.reduce((s: number, a: any) => s + (a.progress || 0), 0) / pActs.length) : 0;

            const pMats = matRows.filter((m: any) => m.project_id === pid);
            const pendingMats = pMats.filter((m: any) => (m.status || '').toLowerCase() === 'pending').length;
            const approvedMats = pMats.filter((m: any) => ['approved', 'fulfilled'].includes((m.status || '').toLowerCase())).length;

            return {
                project,
                totalCost: costMap[pid] || 0,
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

        // Quick stats (aggregate)
        setQuickStats({
            totalProjectCost: built.reduce((s, b) => s + b.totalCost, 0),
            pendingTasks:     built.reduce((s, b) => s + b.pendingTasks, 0),
            doneTasks:        built.reduce((s, b) => s + b.doneTasks, 0),
            pendingMaterials: built.reduce((s, b) => s + b.pendingMaterials, 0),
            avgProgress:      built.length > 0 ? Math.round(built.reduce((s, b) => s + b.avgProgress, 0) / built.length) : 0,
            totalProjects:    projList.length,
            activeProjects:   projList.filter(p => ['Planning','Execution','Handover'].includes(p.status)).length,
        });

        setLoading(false);
    }, [initializing, allowedIds, selectedProject]);

    useEffect(() => { fetchData(); }, [fetchData]);

    /* ── Export ── */
    const exportCSV = (rows: any[], name: string) => {
        if (!rows.length) { toast.error('No data to export'); return; }
        const headers = Object.keys(rows[0]);
        const csv = [headers.join(','), ...rows.map(r => headers.map(h => {
            const v = r[h]; if (v === null || v === undefined) return '';
            if (typeof v === 'object') return JSON.stringify(v); return String(v).replace(/,/g, ';');
        }).join(','))].join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        a.download = `${name}_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        toast.success('Exported successfully');
    };

    const handleExport = () => {
        const rows = summaries.map(s => ({
            Project: s.project.project_name,
            Status: s.project.status,
            'Total Cost (₹)': s.totalCost,
            'Pending Tasks': s.pendingTasks,
            'Done Tasks': s.doneTasks,
            'Avg Progress (%)': s.avgProgress,
            'Pending Materials': s.pendingMaterials,
        }));
        exportCSV(rows, 'project_report');
    };

    if (initializing) {
        return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading...</div>;
    }

    const statusGroups = projects.reduce<Record<string, number>>((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1; return acc;
    }, {});

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between print:hidden">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Reports</h2>
                    <p className="text-muted-foreground mt-1">
                        {userRole === 'SiteSupervisor'
                            ? `Showing your ${projects.length} assigned project${projects.length !== 1 ? 's' : ''}`
                            : 'Analytics across all projects'}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => window.print()}>
                        <Printer className="mr-2 h-4 w-4" /> Print
                    </Button>
                    <Button onClick={handleExport} className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Download className="mr-2 h-4 w-4" /> Export CSV
                    </Button>
                </div>
            </div>

            {/* Quick Summary Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="border-l-4 border-l-blue-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Project Cost</CardTitle>
                        <DollarSign className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-700">₹{fmt(quickStats.totalProjectCost)}</div>
                        <p className="text-xs text-muted-foreground mt-1">{quickStats.totalProjects} projects · {quickStats.activeProjects} active</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-amber-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Pending Tasks</CardTitle>
                        <ListTodo className="h-4 w-4 text-amber-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-amber-600">{quickStats.pendingTasks}</div>
                        <p className="text-xs text-muted-foreground mt-1">{quickStats.doneTasks} completed</p>
                    </CardContent>
                </Card>

                <Card className="border-l-4 border-l-orange-400">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Material Requests</CardTitle>
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
                        <CardTitle className="text-sm font-medium text-muted-foreground">Avg Project Progress</CardTitle>
                        <Activity className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{quickStats.avgProgress}%</div>
                        <Progress value={quickStats.avgProgress} className="mt-2 h-1.5" />
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="pt-5 pb-4">
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="space-y-1.5 min-w-[180px]">
                            <Label>Report View</Label>
                            <Select value={reportType} onValueChange={(v: any) => setReportType(v)}>
                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                    <SelectItem value="summary">Project Summary</SelectItem>
                                    <SelectItem value="tasks">Task Breakdown</SelectItem>
                                    <SelectItem value="materials">Material Requests</SelectItem>
                                    {(userRole === 'Admin' || userRole === 'ProjectManager') && (
                                        <SelectItem value="projects">Project Status</SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5 min-w-[200px]">
                            <Label>Project Filter</Label>
                            <Select value={selectedProject} onValueChange={setSelectedProject}>
                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                    <SelectItem value="all">All Projects</SelectItem>
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
                <Card><CardContent className="py-12 text-center text-muted-foreground">Loading report data...</CardContent></Card>
            ) : summaries.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No project data found.</CardContent></Card>
            ) : (
                <>
                    {/* ── Project Summary ── */}
                    {reportType === 'summary' && (
                        <div className="space-y-4">
                            {summaries.map(s => {
                                const taskPct = s.totalTasks > 0 ? Math.round((s.doneTasks / s.totalTasks) * 100) : 0;
                                return (
                                    <Card key={s.project.project_id} className="border-l-4 border-l-blue-400">
                                        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <FolderKanban className="h-5 w-5 text-blue-500" />
                                                <div>
                                                    <Link href={`/projects/${s.project.project_id}`} className="font-semibold text-base hover:underline text-blue-700">
                                                        {s.project.project_name}
                                                    </Link>
                                                    <p className="text-xs text-muted-foreground">{s.project.location || 'No location'}</p>
                                                </div>
                                            </div>
                                            <Badge className={STATUS_COLOR[s.project.status] || 'bg-slate-100 text-slate-600'}>
                                                {s.project.status}
                                            </Badge>
                                        </CardHeader>
                                        <CardContent className="pt-4">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                {/* Total Cost */}
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <DollarSign className="h-3 w-3" /> Total Cost
                                                    </p>
                                                    <p className="text-lg font-bold text-blue-700">₹{fmt(s.totalCost)}</p>
                                                </div>
                                                {/* Tasks */}
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
                                                            <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${taskPct}%` }} />
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">{taskPct}%</span>
                                                    </div>
                                                </div>
                                                {/* Material Requests */}
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Package className="h-3 w-3" /> Material Requests
                                                    </p>
                                                    <div className="flex gap-2 items-center">
                                                        {s.pendingMaterials > 0 ? (
                                                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
                                                                <AlertTriangle className="h-3.5 w-3.5" /> {s.pendingMaterials} pending
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600">
                                                                <CheckCircle2 className="h-3.5 w-3.5" /> All clear
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">{s.approvedMaterials} approved/fulfilled</p>
                                                </div>
                                                {/* Activity Progress */}
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Activity className="h-3 w-3" /> Activity Progress
                                                    </p>
                                                    <p className="text-lg font-bold text-green-600">{s.avgProgress}%</p>
                                                    <div className="flex items-center gap-1">
                                                        <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                                                            <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${s.avgProgress}%` }} />
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">{s.completedActivities}/{s.totalActivities}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}

                    {/* ── Task Breakdown ── */}
                    {reportType === 'tasks' && (
                        <Card>
                            <CardHeader className="border-b">
                                <CardTitle className="flex items-center gap-2">
                                    <ListTodo className="h-5 w-5 text-amber-500" /> Task Breakdown by Project
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4">
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
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex-1 bg-slate-200 rounded-full h-2">
                                                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                                                            </div>
                                                            <span className="text-xs font-semibold w-9 text-right">{pct}%</span>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        {/* Totals row */}
                                        <TableRow className="bg-slate-50 font-semibold border-t-2">
                                            <TableCell colSpan={2} className="font-bold">Total</TableCell>
                                            <TableCell className="text-center">{summaries.reduce((s, r) => s + r.totalTasks, 0)}</TableCell>
                                            <TableCell className="text-center text-green-600">{summaries.reduce((s, r) => s + r.doneTasks, 0)}</TableCell>
                                            <TableCell className="text-center text-amber-600">{summaries.reduce((s, r) => s + r.pendingTasks, 0)}</TableCell>
                                            <TableCell />
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )}

                    {/* ── Material Requests ── */}
                    {reportType === 'materials' && (
                        <Card>
                            <CardHeader className="border-b">
                                <CardTitle className="flex items-center gap-2">
                                    <Package className="h-5 w-5 text-orange-400" /> Material Request Status by Project
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-4">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Project</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-center">Pending</TableHead>
                                            <TableHead className="text-center">Approved / Fulfilled</TableHead>
                                            <TableHead>Pending Rate</TableHead>
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
                                                            ? <span className="inline-flex items-center gap-1 text-amber-600 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{s.pendingMaterials}</span>
                                                            : <span className="text-slate-400">0</span>}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <span className="text-green-600 font-semibold">{s.approvedMaterials}</span>
                                                    </TableCell>
                                                    <TableCell>
                                                        {total === 0 ? (
                                                            <span className="text-xs text-slate-400">No requests</span>
                                                        ) : (
                                                            <div className="flex items-center gap-2">
                                                                <div className="flex-1 bg-slate-200 rounded-full h-2">
                                                                    <div className={`h-2 rounded-full ${pct > 50 ? 'bg-amber-400' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
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

                    {/* ── Project Status (Admin only) ── */}
                    {reportType === 'projects' && (userRole === 'Admin' || userRole === 'ProjectManager') && (
                        <div className="space-y-4">
                            {/* Status distribution */}
                            <Card>
                                <CardHeader className="border-b pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <BarChart3 className="h-5 w-5 text-blue-500" /> Status Distribution
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
                                                    <div className={`h-2 rounded-full ${STATUS_BAR[status] || 'bg-slate-400'}`} style={{ width: `${pct}%`, minWidth: count > 0 ? '6px' : undefined }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="border-b pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <FileText className="h-5 w-5 text-blue-500" /> All Projects
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Project</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Location</TableHead>
                                                <TableHead>Start Date</TableHead>
                                                <TableHead className="text-right">Total Cost</TableHead>
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
                                                        {s.project.start_date ? new Date(s.project.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-blue-700">
                                                        {s.totalCost > 0 ? `₹${fmt(s.totalCost)}` : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <span className="text-green-600 font-semibold">{s.doneTasks}</span>
                                                        <span className="text-muted-foreground text-xs"> / {s.totalTasks}</span>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-2">
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
