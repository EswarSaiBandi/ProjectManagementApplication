'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Search, CheckCircle2, Circle, Clock, Pencil, Trash2, FolderKanban, User, CalendarDays, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

type Project = {
    project_id: number;
    project_name: string;
};

type ProjectTask = {
    id?: number;
    task_id?: number;
    project_id: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    assignee_name: string | null;
    created_at?: string;
    updated_at?: string;
    project_name?: string;
};

const STATUS_OPTIONS = ['Todo', 'In Progress', 'Done'] as const;
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High'] as const;

function getProjectName(t: ProjectTask): string {
    return t.project_name || `Project #${t.project_id}`;
}

export default function TasksPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [projectFilter, setProjectFilter] = useState<string>('all');
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [initializing, setInitializing] = useState(true);
    const [projects, setProjects] = useState<Project[]>([]);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [assignableMembers, setAssignableMembers] = useState<{ user_id: string; full_name: string; role: string }[]>([]);
    const [loadingAssignees, setLoadingAssignees] = useState(false);
    // undefined = role not yet determined (block fetches), null = no restriction (Admin/PM), number[] = restricted
    const [allowedProjectIds, setAllowedProjectIds] = useState<number[] | null | undefined>(undefined);

    // Dialog state
    const [isOpen, setIsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editing, setEditing] = useState<ProjectTask | null>(null);
    const [editingKey, setEditingKey] = useState<{ column: 'id' | 'task_id'; value: number } | null>(null);

    const [form, setForm] = useState({
        project_id: '',
        title: '',
        description: '',
        status: 'Todo',
        priority: 'Medium',
        due_date: '',
        assignee_name: '',
    });

    useEffect(() => {
        initPage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (allowedProjectIds !== undefined) fetchTasks(allowedProjectIds);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, projectFilter, allowedProjectIds]);

    const initPage = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', user.id)
                .single();

            const role = profile?.role || null;
            setUserRole(role);

            if (role === 'SiteSupervisor') {
                const { data: memberships } = await supabase
                    .from('project_members')
                    .select('project_id')
                    .eq('user_id', user.id);
                const ids = (memberships || []).map((m: any) => Number(m.project_id));
                setAllowedProjectIds(ids);
                await fetchProjects(ids, ids);
            } else {
                setAllowedProjectIds(null);
                await fetchProjects(null, null);
            }
        } finally {
            setInitializing(false);
        }
    };

    const fetchProjects = async (restrictToIds: number[] | null, taskIds: number[] | null) => {
        let query = supabase.from('projects').select('project_id, project_name').order('project_name');
        if (restrictToIds !== null && restrictToIds.length > 0) {
            query = query.in('project_id', restrictToIds);
        } else if (restrictToIds !== null && restrictToIds.length === 0) {
            setProjects([]);
            fetchTasks(taskIds);
            return;
        }
        const { data, error } = await query;
        if (error) {
            console.error('Projects fetch error:', error);
            setProjects([]);
            return;
        }
        setProjects((data || []) as Project[]);
        if (!form.project_id && (data || []).length) {
            setForm((p) => ({ ...p, project_id: String((data || [])[0].project_id) }));
        }
        fetchTasks(taskIds);
    };

    const fetchAssignableMembers = async (projectId: string) => {
        if (!projectId) { setAssignableMembers([]); return; }
        setLoadingAssignees(true);
        const pid = Number(projectId);

        // Admin + PM always eligible
        const { data: adminData } = await supabase
            .from('profiles')
            .select('user_id, full_name, role')
            .in('role', ['Admin', 'ProjectManager'])
            .eq('is_active', true)
            .order('full_name');

        // SiteSupervisors assigned to this project
        const { data: memberRows } = await supabase
            .from('project_members')
            .select('user_id')
            .eq('project_id', pid);

        const supIds = (memberRows || []).map((m: any) => m.user_id);
        let supData: any[] = [];
        if (supIds.length > 0) {
            const { data: sd } = await supabase
                .from('profiles')
                .select('user_id, full_name, role')
                .in('user_id', supIds)
                .eq('role', 'SiteSupervisor')
                .eq('is_active', true)
                .order('full_name');
            supData = sd || [];
        }

        const merged = [...(adminData || []), ...supData];
        const seen = new Set<string>();
        const unique = merged.filter(p => {
            if (seen.has(p.user_id) || !p.full_name) return false;
            seen.add(p.user_id); return true;
        });
        setAssignableMembers(unique);
        setLoadingAssignees(false);
    };

    const fetchTasks = async (idsOverride?: number[] | null) => {
        // Use explicit override if provided, otherwise fall back to state
        const effectiveIds: number[] | null = idsOverride !== undefined ? (idsOverride ?? null) : (allowedProjectIds ?? null);
        try {
            setLoading(true);
            let query = supabase.from('project_tasks').select('*');

            // Restrict to assigned projects for Site Supervisors
            if (effectiveIds !== null) {
                if (effectiveIds.length === 0) {
                    setTasks([]);
                    setLoading(false);
                    return;
                }
                query = query.in('project_id', effectiveIds);
            }

            const { data, error } = await query;
            if (error) throw error;

            // Filter by status if needed (case-insensitive)
            let filteredData = (data || []) as any[];
            if (projectFilter !== 'all') {
                filteredData = filteredData.filter((t) => String(t.project_id) === String(projectFilter));
            }
            if (statusFilter !== 'all') {
                filteredData = filteredData.filter((t) => (t.status || '').toLowerCase() === statusFilter.toLowerCase());
            }

            // Always fetch project names fresh from DB to avoid stale state
            const uniqueProjectIds = Array.from(new Set(filteredData.map((t: any) => Number(t.project_id))));
            const projectNameById = new Map<number, string>();
            if (uniqueProjectIds.length > 0) {
                const { data: projData } = await supabase
                    .from('projects')
                    .select('project_id, project_name')
                    .in('project_id', uniqueProjectIds);
                (projData || []).forEach((p: any) => projectNameById.set(Number(p.project_id), p.project_name));
            }

            const rows: ProjectTask[] = filteredData.map((t: any) => ({
                ...t,
                project_name: projectNameById.get(Number(t.project_id)) || `Project #${t.project_id}`,
            }));

            // Client-side sort (prefer updated_at/created_at/id/task_id)
            rows.sort((a, b) => {
                const aKey =
                    (a.updated_at ? Date.parse(a.updated_at) : NaN) ||
                    (a.created_at ? Date.parse(a.created_at) : NaN) ||
                    (typeof a.id === 'number' ? a.id : NaN) ||
                    (typeof a.task_id === 'number' ? a.task_id : NaN) ||
                    0;
                const bKey =
                    (b.updated_at ? Date.parse(b.updated_at) : NaN) ||
                    (b.created_at ? Date.parse(b.created_at) : NaN) ||
                    (typeof b.id === 'number' ? b.id : NaN) ||
                    (typeof b.task_id === 'number' ? b.task_id : NaN) ||
                    0;
                return bKey - aKey;
            });

            setTasks(rows);
        } catch (error: any) {
            console.error('Error fetching tasks:', error);
            toast.error(error?.message || 'Failed to load tasks');
            setTasks([]);
        } finally {
            setLoading(false);
        }
    };

    const filteredTasks = tasks.filter(task => {
        const q = searchQuery.toLowerCase().trim();
        if (!q) return true;
        return (
            (task.title || '').toLowerCase().includes(q) ||
            getProjectName(task).toLowerCase().includes(q) ||
            (task.assignee_name || '').toLowerCase().includes(q) ||
            (task.status || '').toLowerCase().includes(q) ||
            (task.priority || '').toLowerCase().includes(q)
        );
    });

    const getStatusIcon = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'done':
                return <CheckCircle2 className="h-4 w-4 text-green-500" />;
            case 'in progress':
            case 'in-progress':
            case 'ongoing':
                return <Clock className="h-4 w-4 text-blue-500" />;
            case 'pending':
            case 'not started':
            case 'todo':
                return <Circle className="h-4 w-4 text-gray-400" />;
            default:
                return <Circle className="h-4 w-4 text-gray-400" />;
        }
    };

    const getStatusBadge = (status: string) => {
        const statusLower = status?.toLowerCase() || '';
        if (statusLower.includes('done')) return <Badge variant="default" className="bg-green-500">Done</Badge>;
        if (statusLower.includes('progress') || statusLower.includes('ongoing')) return <Badge variant="default" className="bg-blue-500">In Progress</Badge>;
        return <Badge variant="secondary">Todo</Badge>;
    };

    const stats = {
        total: tasks.length,
        completed: tasks.filter(t => t.status?.toLowerCase().includes('done')).length,
        inProgress: tasks.filter(t => t.status?.toLowerCase().includes('progress') || t.status?.toLowerCase().includes('ongoing')).length,
        todo: tasks.filter(t => t.status?.toLowerCase().includes('todo') || t.status?.toLowerCase().includes('pending') || !t.status).length,
    };

    const openNew = () => {
        setEditing(null);
        setEditingKey(null);
        // Start with empty project so user must pick one first
        const defaultProject = projectFilter !== 'all' ? projectFilter : '';
        setForm({
            project_id: defaultProject,
            title: '',
            description: '',
            status: 'Todo',
            priority: 'Medium',
            due_date: '',
            assignee_name: '',
        });
        setAssignableMembers([]);
        if (defaultProject) fetchAssignableMembers(defaultProject);
        setIsOpen(true);
    };

    const openEdit = (t: ProjectTask) => {
        setEditing(t);
        const key =
            typeof t.id === 'number'
                ? { column: 'id' as const, value: t.id }
                : typeof t.task_id === 'number'
                    ? { column: 'task_id' as const, value: t.task_id }
                    : null;
        setEditingKey(key);
        const pid = String(t.project_id);
        setForm({
            project_id: pid,
            title: t.title || '',
            description: t.description || '',
            status: t.status || 'Todo',
            priority: t.priority || 'Medium',
            due_date: t.due_date ? String(t.due_date).split('T')[0] : '',
            assignee_name: t.assignee_name || '',
        });
        fetchAssignableMembers(pid);
        setIsOpen(true);
    };

    const handleSave = async () => {
        if (isSaving) return;
        const projectIdNum = Number(form.project_id);
        if (!Number.isFinite(projectIdNum))  { toast.error('Project is required'); return; }
        if (!form.title.trim())              { toast.error('Title is required'); return; }
        if (!form.description.trim())        { toast.error('Description is required'); return; }
        if (!form.due_date)                  { toast.error('Due date is required'); return; }
        if (!form.assignee_name.trim())      { toast.error('Assignee is required'); return; }

        setIsSaving(true);
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id ?? null;

        const payload: any = {
            project_id: projectIdNum,
            title: form.title.trim(),
            name: form.title.trim(),
            task_name: form.title.trim(),
            content: form.description.trim() ? `${form.title.trim()}\n\n${form.description.trim()}` : form.title.trim(),
            description: form.description.trim() ? form.description.trim() : null,
            status: form.status,
            priority: form.priority,
            due_date: form.due_date || null,
            assignee_name: form.assignee_name.trim() ? form.assignee_name.trim() : null,
            updated_at: new Date().toISOString(),
        };

        try {
            if (editing) {
                if (!editingKey) {
                    toast.error('Cannot update: missing identifier');
                    setIsSaving(false);
                    return;
                }
                const { error } = await supabase.from('project_tasks').update(payload).eq(editingKey.column, editingKey.value);
                if (error) throw error;
                toast.success('Task updated');
            } else {
                const { error } = await supabase.from('project_tasks').insert([{ ...payload, created_by: userId }]);
                if (error) throw error;
                toast.success('Task created');
            }
            setIsOpen(false);
            setEditing(null);
            setEditingKey(null);
            fetchTasks();
        } catch (e: any) {
            console.error('Save task error:', e);
            toast.error(e.message || 'Failed to save task');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (t: ProjectTask) => {
        const key =
            typeof t.id === 'number'
                ? { column: 'id' as const, value: t.id }
                : typeof t.task_id === 'number'
                    ? { column: 'task_id' as const, value: t.task_id }
                    : null;
        if (!key) {
            toast.error('Cannot delete: missing identifier');
            return;
        }
        if (!confirm(`Delete task "${t.title}"?`)) return;
        const { error } = await supabase.from('project_tasks').delete().eq(key.column, key.value);
        if (error) {
            console.error('Delete task error:', error);
            toast.error(error.message || 'Failed to delete');
            return;
        }
        toast.success('Deleted');
        fetchTasks();
    };

    const quickMarkDone = async (t: ProjectTask) => {
        const key =
            typeof t.id === 'number'
                ? { column: 'id' as const, value: t.id }
                : typeof t.task_id === 'number'
                    ? { column: 'task_id' as const, value: t.task_id }
                    : null;
        if (!key) return;
        const { error } = await supabase
            .from('project_tasks')
            .update({ status: 'Done', updated_at: new Date().toISOString() })
            .eq(key.column, key.value);
        if (error) {
            console.error('Mark done error:', error);
            toast.error(error.message || 'Failed to update');
            return;
        }
        fetchTasks();
    };

    if (initializing) {
        return (
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Loading...
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Tasks</h2>
                    <p className="text-muted-foreground">Manage and track your project tasks</p>
                </div>
                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                    <DialogTrigger asChild>
                        <Button onClick={openNew}>
                            <Plus className="mr-2 h-4 w-4" />
                            New Task
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-white max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{editing ? 'Edit Task' : 'New Task'}</DialogTitle>
                            <DialogDescription>
                                {editing ? 'Update the task details below.' : 'Select a project first — assignee options will update accordingly.'}
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-2">
                            {/* Project — must be picked first */}
                            <div className="space-y-2">
                                <Label>Project *</Label>
                                <Select
                                    value={form.project_id}
                                    onValueChange={(v) => {
                                        setForm((p) => ({ ...p, project_id: v, assignee_name: '' }));
                                        fetchAssignableMembers(v);
                                    }}
                                >
                                    <SelectTrigger className="bg-white">
                                        <SelectValue placeholder="Select a project first..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                        {projects.map((p) => (
                                            <SelectItem key={p.project_id} value={String(p.project_id)} className="bg-white hover:bg-gray-100">
                                                {p.project_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Rest of form — visually dimmed until project selected */}
                            <div className={`space-y-4 transition-opacity ${!form.project_id ? 'opacity-40 pointer-events-none' : ''}`}>
                                <div className="space-y-2">
                                    <Label>Title *</Label>
                                    <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="bg-white" placeholder="e.g. Finalize electrical BOQ" />
                                </div>

                                <div className="space-y-2">
                                    <Label>Description *</Label>
                                    <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="bg-white" rows={2} />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Status *</Label>
                                        <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                                            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                            <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                                {STATUS_OPTIONS.map((s) => (
                                                    <SelectItem key={s} value={s} className="bg-white hover:bg-gray-100">{s}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Priority *</Label>
                                        <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
                                            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                            <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                                {PRIORITY_OPTIONS.map((p) => (
                                                    <SelectItem key={p} value={p} className="bg-white hover:bg-gray-100">{p}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Due date *</Label>
                                        <Input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} className="bg-white" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>
                                            Assignee *
                                            {loadingAssignees && <span className="ml-2 text-xs text-muted-foreground">Loading...</span>}
                                        </Label>
                                        <Select
                                            value={form.assignee_name}
                                            onValueChange={(v) => setForm((p) => ({ ...p, assignee_name: v === '__none__' ? '' : v }))}
                                        >
                                            <SelectTrigger className="bg-white">
                                                <SelectValue placeholder="Select assignee..." />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border border-gray-200 shadow-lg z-[9999]">
                                                <SelectItem value="__none__" className="text-slate-400 italic">Unassigned</SelectItem>
                                                {assignableMembers.map((m) => (
                                                    <SelectItem key={m.user_id} value={m.full_name} className="bg-white hover:bg-gray-100">
                                                        <span>{m.full_name}</span>
                                                        <span className="ml-2 text-xs text-slate-400">
                                                            {m.role === 'SiteSupervisor' ? '· Supervisor' : m.role === 'Admin' ? '· Admin' : '· PM'}
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                                {assignableMembers.length === 0 && !loadingAssignees && (
                                                    <div className="px-3 py-2 text-xs text-slate-400 italic">No eligible members for this project</div>
                                                )}
                                            </SelectContent>
                                        </Select>
                                        {assignableMembers.length === 0 && !loadingAssignees && form.project_id && (
                                            <p className="text-xs text-amber-600">No supervisors assigned to this project. Add them via the Members tab.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleSave} disabled={isSaving}>
                                {isSaving ? 'Saving...' : 'Save'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.total}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Completed</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.completed}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                        <Clock className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.inProgress}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">To Do</CardTitle>
                        <Circle className="h-4 w-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.todo}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search tasks..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <Select value={projectFilter} onValueChange={setProjectFilter}>
                            <SelectTrigger className="w-[220px]">
                                <SelectValue placeholder="Project" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                <SelectItem value="all" className="bg-white hover:bg-gray-100">All Projects</SelectItem>
                                {projects.map((p) => (
                                    <SelectItem key={p.project_id} value={String(p.project_id)} className="bg-white hover:bg-gray-100">
                                        {p.project_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[180px]">
                                <Search className="mr-2 h-4 w-4" />
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                <SelectItem value="all" className="bg-white hover:bg-gray-100">All Status</SelectItem>
                                <SelectItem value="Todo" className="bg-white hover:bg-gray-100">Todo</SelectItem>
                                <SelectItem value="In Progress" className="bg-white hover:bg-gray-100">In Progress</SelectItem>
                                <SelectItem value="Done" className="bg-white hover:bg-gray-100">Done</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Task List */}
            <div className="space-y-3">
                {loading ? (
                    <Card><CardContent className="text-center py-10 text-muted-foreground">Loading tasks...</CardContent></Card>
                ) : filteredTasks.length === 0 ? (
                    <Card><CardContent className="text-center py-10 text-muted-foreground">
                        {searchQuery ? 'No tasks match your search.' : 'No tasks found.'}
                    </CardContent></Card>
                ) : (
                    filteredTasks.map((task) => {
                        const isDone = (task.status || '').toLowerCase() === 'done';
                        const isOverdue = task.due_date && !isDone && new Date(task.due_date) < new Date();
                        const priorityBorder: Record<string, string> = {
                            High: 'border-l-red-500',
                            Medium: 'border-l-amber-400',
                            Low: 'border-l-slate-300',
                        };
                        const priorityBadge: Record<string, string> = {
                            High: 'bg-red-100 text-red-700',
                            Medium: 'bg-amber-100 text-amber-700',
                            Low: 'bg-slate-100 text-slate-600',
                        };
                        const statusBadge: Record<string, string> = {
                            'done': 'bg-green-100 text-green-700',
                            'in progress': 'bg-blue-100 text-blue-700',
                            'todo': 'bg-slate-100 text-slate-600',
                        };
                        const borderClass = isDone ? 'border-l-green-400' : (priorityBorder[task.priority] || 'border-l-slate-300');
                        return (
                            <Card
                                key={(task.id ?? task.task_id ?? `${task.project_id}-${task.title}`) as any}
                                className={`border-l-4 ${borderClass} ${isDone ? 'opacity-60' : ''} hover:shadow-sm transition-shadow`}
                            >
                                <CardContent className="py-4">
                                    <div className="flex items-start justify-between gap-4">
                                        {/* Left: content */}
                                        <div className="flex gap-3 flex-1 min-w-0">
                                            <div className="mt-0.5 flex-shrink-0">
                                                {isDone
                                                    ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                                                    : isOverdue
                                                        ? <AlertCircle className="h-5 w-5 text-red-500" />
                                                        : <Circle className="h-5 w-5 text-slate-300" />
                                                }
                                            </div>
                                            <div className="flex-1 min-w-0 space-y-1.5">
                                                {/* Title + badges */}
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className={`font-semibold text-slate-900 ${isDone ? 'line-through text-muted-foreground' : ''}`}>
                                                        {task.title}
                                                    </h3>
                                                    <Badge className={`text-xs ${statusBadge[(task.status || '').toLowerCase()] || 'bg-slate-100 text-slate-600'}`}>
                                                        {task.status || 'Todo'}
                                                    </Badge>
                                                    <Badge className={`text-xs ${priorityBadge[task.priority] || 'bg-slate-100 text-slate-600'}`}>
                                                        {task.priority || '—'}
                                                    </Badge>
                                                </div>

                                                {/* Meta row */}
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                    <Link href={`/projects/${task.project_id}`} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                                                        <FolderKanban className="h-3.5 w-3.5" />
                                                        <span className="font-medium text-slate-600">{task.project_name || getProjectName(task)}</span>
                                                    </Link>
                                                    {task.assignee_name && (
                                                        <span className="flex items-center gap-1">
                                                            <User className="h-3.5 w-3.5" />
                                                            {task.assignee_name}
                                                        </span>
                                                    )}
                                                    {task.due_date && (
                                                        <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
                                                            <CalendarDays className="h-3.5 w-3.5" />
                                                            {isOverdue ? 'Overdue · ' : 'Due '}
                                                            {new Date(task.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Description */}
                                                {task.description && (
                                                    <p className="text-sm text-muted-foreground line-clamp-2">{task.description}</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right: actions */}
                                        <div className="flex gap-1.5 items-center flex-shrink-0">
                                            {!isDone && (
                                                <Button variant="outline" size="sm" onClick={() => quickMarkDone(task)} title="Mark done"
                                                    className="border-green-400 text-green-600 hover:bg-green-50">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button variant="outline" size="sm" onClick={() => openEdit(task)} title="Edit">
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleDelete(task)} title="Delete"
                                                className="border-red-200 text-red-500 hover:bg-red-50">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })
                )}
            </div>
        </div>
    );
}

