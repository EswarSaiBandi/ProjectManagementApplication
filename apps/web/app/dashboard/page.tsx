'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
    FolderKanban, CheckCircle2, Clock, Users, AlertCircle,
    TrendingUp, CalendarDays, ArrowRight, Activity, ClipboardCheck,
} from 'lucide-react';
import Link from 'next/link';

type Project = {
    project_id: number;
    project_name: string;
    status: string;
    start_date: string | null;
};

type Task = {
    task_id?: number;
    id?: number;
    title: string;
    status: string;
    priority: string;
    due_date: string | null;
    project_id: number;
    project_name?: string;
};

type Stats = {
    totalProjects: number;
    activeProjects: number;
    totalTasks: number;
    pendingTasks: number;
    doneTasks: number;
    teamCount: number;
};

const STATUS_COLOR: Record<string, string> = {
    Planning:  'bg-blue-100 text-blue-700',
    Execution: 'bg-amber-100 text-amber-700',
    Handover:  'bg-purple-100 text-purple-700',
    Completed: 'bg-green-100 text-green-700',
};

const PRIORITY_COLOR: Record<string, string> = {
    High:   'bg-red-100 text-red-700',
    Medium: 'bg-amber-100 text-amber-700',
    Low:    'bg-slate-100 text-slate-600',
};

type LeaveBalance = { accrued_days: number; used_days: number; available_days: number };

function calcLeaveBalance(profileCreatedAt: string, approvedDays: number): LeaveBalance {
    const floor = new Date('2025-01-01');
    const joined = new Date(profileCreatedAt);
    const start = joined > floor ? joined : floor;
    const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    const now = new Date();
    const nowMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const months = Math.max(1,
        (nowMonth.getFullYear() - startMonth.getFullYear()) * 12 +
        (nowMonth.getMonth() - startMonth.getMonth()) + 1
    );
    return { accrued_days: months, used_days: approvedDays, available_days: Math.max(0, months - approvedDays) };
}

export default function DashboardPage() {
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState('');
    const [stats, setStats] = useState<Stats>({ totalProjects: 0, activeProjects: 0, totalTasks: 0, pendingTasks: 0, doneTasks: 0, teamCount: 0 });
    const [projects, setProjects] = useState<Project[]>([]);
    const [recentTasks, setRecentTasks] = useState<Task[]>([]);
    const [leaveBalance, setLeaveBalance] = useState<LeaveBalance | null>(null);
    const [showAttendanceCheckInReminder, setShowAttendanceCheckInReminder] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => { init(); }, []);

    const init = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, role, created_at')
            .eq('user_id', user.id)
            .single();

        const role = profile?.role || '';
        setUserName(profile?.full_name || user.email || '');
        setUserRole(role);

        // Determine project restriction for SiteSupervisor
        let allowedIds: number[] | null = null;
        if (role === 'SiteSupervisor') {
            const { data: memberships } = await supabase
                .from('project_members')
                .select('project_id')
                .eq('user_id', user.id);
            allowedIds = (memberships || []).map((m: any) => Number(m.project_id));
        }

        // Fetch approved leave days for this user
        if (role !== 'Client') {
            const { data: leaves } = await supabase
                .from('leave_requests')
                .select('start_date, end_date')
                .eq('user_id', user.id)
                .eq('status', 'Approved');
            const usedDays = (leaves || []).reduce((sum: number, l: any) => {
                const diff = Math.round((new Date(l.end_date).getTime() - new Date(l.start_date).getTime()) / 86400000) + 1;
                return sum + diff;
            }, 0);
            setLeaveBalance(calcLeaveBalance(profile?.created_at || new Date().toISOString(), usedDays));
        }

        if (role && role !== 'Client') {
            const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
            const { data: attLog } = await supabase
                .from('attendance_logs')
                .select('check_in_at')
                .eq('user_id', user.id)
                .eq('work_date', today)
                .maybeSingle();
            setShowAttendanceCheckInReminder(!((attLog as { check_in_at?: string } | null)?.check_in_at));
        } else {
            setShowAttendanceCheckInReminder(false);
        }

        await Promise.all([
            fetchProjects(allowedIds),
            ...(role !== 'Client' ? [fetchTasks(allowedIds)] : []),
            fetchTeamCount(role),
        ]);

        setLoading(false);
    };

    const fetchProjects = async (allowedIds: number[] | null) => {
        let query = supabase.from('projects').select('project_id, project_name, status, start_date').order('project_name');
        if (allowedIds !== null) {
            if (allowedIds.length === 0) { setProjects([]); return; }
            query = query.in('project_id', allowedIds);
        }
        const { data } = await query;
        const rows = (data || []) as Project[];
        setProjects(rows);

        const active = rows.filter(p => p.status === 'Execution' || p.status === 'Planning').length;
        setStats(s => ({ ...s, totalProjects: rows.length, activeProjects: active }));
    };

    const fetchTasks = async (allowedIds: number[] | null) => {
        let query = supabase.from('project_tasks').select('*').order('updated_at', { ascending: false }).limit(50);
        if (allowedIds !== null) {
            if (allowedIds.length === 0) { setRecentTasks([]); return; }
            query = query.in('project_id', allowedIds);
        }
        const { data } = await query;
        const rows = (data || []) as Task[];

        const total = rows.length;
        const done = rows.filter(t => (t.status || '').toLowerCase() === 'done').length;
        const pending = rows.filter(t => (t.status || '').toLowerCase() !== 'done').length;
        setStats(s => ({ ...s, totalTasks: total, doneTasks: done, pendingTasks: pending }));

        // Fetch project names for recent tasks
        const projectIds = Array.from(new Set(rows.map(t => t.project_id)));
        let projectNameMap: Record<number, string> = {};
        if (projectIds.length > 0) {
            const { data: projs } = await supabase
                .from('projects')
                .select('project_id, project_name')
                .in('project_id', projectIds);
            (projs || []).forEach((p: any) => { projectNameMap[p.project_id] = p.project_name; });
        }

        setRecentTasks(
            rows.slice(0, 6).map(t => ({ ...t, project_name: projectNameMap[t.project_id] || `Project #${t.project_id}` }))
        );
    };

    const fetchTeamCount = async (role: string) => {
        if (role !== 'Admin' && role !== 'ProjectManager') return;
        const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_active', true);
        setStats(s => ({ ...s, teamCount: count || 0 }));
    };

    const taskCompletion = stats.totalTasks > 0 ? Math.round((stats.doneTasks / stats.totalTasks) * 100) : 0;
    const statusGroups = projects.reduce<Record<string, number>>((acc, p) => {
        acc[p.status || 'Unknown'] = (acc[p.status || 'Unknown'] || 0) + 1;
        return acc;
    }, {});

    const greeting = () => {
        const h = new Date().getHours();
        if (h < 12) return 'Good morning';
        if (h < 17) return 'Good afternoon';
        return 'Good evening';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Loading dashboard...
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">
                        {greeting()}, {userName.split(' ')[0]} 👋
                    </h2>
                    <p className="text-muted-foreground mt-1">
                        Here's what's happening across your projects today.
                    </p>
                </div>
                <Badge className="text-sm px-3 py-1 bg-blue-100 text-blue-700 font-medium">
                    {userRole === 'SiteSupervisor' ? 'Site Supervisor' : userRole}
                </Badge>
            </div>

            {showAttendanceCheckInReminder && (
                <Card className="border-amber-200 bg-amber-50/80">
                    <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
                        <div className="flex items-start gap-3">
                            <ClipboardCheck className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium text-amber-900">Check in for today</p>
                                <p className="text-sm text-amber-800/90 mt-0.5">
                                    Daily attendance requires a photo and your location. Open Attendance to check in.
                                </p>
                            </div>
                        </div>
                        <Link
                            href="/attendance"
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-amber-700 text-white hover:bg-amber-800 px-4 py-2 shrink-0"
                        >
                            Go to attendance
                        </Link>
                    </CardContent>
                </Card>
            )}

            {/* Stat Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="border-l-4 border-l-blue-500">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Projects</CardTitle>
                        <FolderKanban className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalProjects}</div>
                        <p className="text-xs text-muted-foreground mt-1">{stats.activeProjects} currently active</p>
                    </CardContent>
                </Card>

                {userRole !== 'Client' && (
                    <Card className="border-l-4 border-l-amber-500">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Tasks</CardTitle>
                            <Clock className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.pendingTasks}</div>
                            <p className="text-xs text-muted-foreground mt-1">{stats.doneTasks} completed</p>
                        </CardContent>
                    </Card>
                )}

                {userRole !== 'Client' && (
                    <Card className="border-l-4 border-l-green-500">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Task Completion</CardTitle>
                            <TrendingUp className="h-4 w-4 text-green-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{taskCompletion}%</div>
                            <Progress value={taskCompletion} className="mt-2 h-1.5" />
                        </CardContent>
                    </Card>
                )}

                {/* Leave balance card — visible to all non-Client roles */}
                {userRole !== 'Client' && leaveBalance ? (
                    <Link href="/leaves">
                        <Card className="border-l-4 border-l-teal-500 hover:shadow-md transition-shadow cursor-pointer h-full">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Leave Balance</CardTitle>
                                <CalendarDays className="h-4 w-4 text-teal-500" />
                            </CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${leaveBalance.available_days > 0 ? 'text-teal-600' : 'text-slate-400'}`}>
                                    {leaveBalance.available_days} <span className="text-base font-normal text-muted-foreground">days</span>
                                </div>
                                <div className="flex items-center gap-3 mt-1.5">
                                    <p className="text-xs text-muted-foreground">{leaveBalance.accrued_days} accrued</p>
                                    <span className="text-muted-foreground">·</span>
                                    <p className="text-xs text-red-400">{leaveBalance.used_days} used</p>
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ) : (userRole === 'Admin' || userRole === 'ProjectManager') ? (
                    <Card className="border-l-4 border-l-purple-500">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Active Team Members</CardTitle>
                            <Users className="h-4 w-4 text-purple-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.teamCount}</div>
                            <p className="text-xs text-muted-foreground mt-1">across all projects</p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="border-l-4 border-l-purple-500">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tasks</CardTitle>
                            <CheckCircle2 className="h-4 w-4 text-purple-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.totalTasks}</div>
                            <p className="text-xs text-muted-foreground mt-1">across your projects</p>
                        </CardContent>
                    </Card>
                )}
            </div>

            <div className={`grid gap-6 ${userRole !== 'Client' ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                {/* Projects Overview */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-3 border-b">
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                            <FolderKanban className="h-4 w-4 text-blue-600" />
                            Projects Overview
                        </CardTitle>
                        <Link href="/projects" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                            View all <ArrowRight className="h-3 w-3" />
                        </Link>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-3">
                        {/* Status breakdown */}
                        {Object.keys(statusGroups).length > 0 && (
                            <div className="flex flex-wrap gap-2 pb-3 border-b">
                                {Object.entries(statusGroups).map(([status, count]) => (
                                    <div key={status} className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[status] || 'bg-slate-100 text-slate-600'}`}>
                                        <span>{status}</span>
                                        <span className="font-bold">{count}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {projects.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">No projects yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {projects.slice(0, 6).map(p => (
                                    <div key={p.project_id} className="flex items-center justify-between py-1.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="h-2 w-2 rounded-full bg-blue-400 flex-shrink-0" />
                                            <span className="text-sm font-medium truncate">{p.project_name}</span>
                                        </div>
                                        <Badge className={`text-xs flex-shrink-0 ${STATUS_COLOR[p.status] || 'bg-slate-100 text-slate-600'}`}>
                                            {p.status || 'Unknown'}
                                        </Badge>
                                    </div>
                                ))}
                                {projects.length > 6 && (
                                    <p className="text-xs text-muted-foreground text-center pt-1">
                                        +{projects.length - 6} more projects
                                    </p>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Recent Tasks — hidden for Client */}
                {userRole !== 'Client' && (
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b">
                            <CardTitle className="text-base font-semibold flex items-center gap-2">
                                <Activity className="h-4 w-4 text-amber-600" />
                                Recent Tasks
                            </CardTitle>
                            <Link href="/tasks" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                View all <ArrowRight className="h-3 w-3" />
                            </Link>
                        </CardHeader>
                        <CardContent className="pt-4 space-y-2">
                            {recentTasks.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-4 text-center">No tasks yet.</p>
                            ) : (
                                recentTasks.map((t, i) => {
                                    const isDone = (t.status || '').toLowerCase() === 'done';
                                    const isOverdue = t.due_date && !isDone && new Date(t.due_date) < new Date();
                                    return (
                                        <div key={t.task_id ?? t.id ?? i} className="flex items-start gap-3 py-2 border-b last:border-0">
                                            <div className="mt-0.5 flex-shrink-0">
                                                {isDone
                                                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                    : isOverdue
                                                        ? <AlertCircle className="h-4 w-4 text-red-500" />
                                                        : <Clock className="h-4 w-4 text-amber-500" />
                                                }
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-medium truncate ${isDone ? 'line-through text-muted-foreground' : ''}`}>
                                                    {t.title}
                                                </p>
                                                <p className="text-xs text-muted-foreground truncate">{t.project_name}</p>
                                            </div>
                                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                                <Badge className={`text-xs ${PRIORITY_COLOR[t.priority] || 'bg-slate-100 text-slate-600'}`}>
                                                    {t.priority}
                                                </Badge>
                                                {t.due_date && (
                                                    <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
                                                        <CalendarDays className="h-3 w-3 inline mr-0.5" />
                                                        {new Date(t.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Quick Links */}
            <Card>
                <CardHeader className="pb-3 border-b">
                    <CardTitle className="text-base font-semibold">Quick Access</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                            { label: 'Projects',  href: '/projects',  icon: FolderKanban,  color: 'text-blue-600 bg-blue-50',   roles: ['Admin','ProjectManager','SiteSupervisor','Client'] },
                            { label: 'Tasks',     href: '/tasks',     icon: CheckCircle2,  color: 'text-amber-600 bg-amber-50', roles: ['Admin','ProjectManager','SiteSupervisor'] },
                            { label: 'Schedule',  href: '/schedule',  icon: CalendarDays,  color: 'text-green-600 bg-green-50', roles: ['Admin','ProjectManager','SiteSupervisor'] },
                            { label: 'Reports',   href: '/reports',   icon: TrendingUp,    color: 'text-purple-600 bg-purple-50',roles: ['Admin','ProjectManager'] },
                        ].filter(item => item.roles.includes(userRole)).map(({ label, href, icon: Icon, color }) => (
                            <Link key={href} href={href}>
                                <div className="flex items-center gap-3 p-3 rounded-lg border hover:shadow-sm hover:border-slate-300 transition-all cursor-pointer">
                                    <div className={`p-2 rounded-md ${color}`}>
                                        <Icon className="h-4 w-4" />
                                    </div>
                                    <span className="text-sm font-medium">{label}</span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
