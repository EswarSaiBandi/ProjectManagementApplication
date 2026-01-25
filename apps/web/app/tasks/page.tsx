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
import { Plus, Search, CheckCircle2, Circle, Clock, Filter, Pencil, Trash2 } from 'lucide-react';
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
    const [projects, setProjects] = useState<Project[]>([]);
    const [teamNames, setTeamNames] = useState<string[]>([]);

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
        fetchProjects();
        fetchTeamNames();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        fetchTasks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, projectFilter]);

    const fetchProjects = async () => {
        const { data, error } = await supabase.from('projects').select('project_id, project_name').order('project_name');
        if (error) {
            console.error('Projects fetch error:', error);
            setProjects([]);
            return;
        }
        setProjects((data || []) as Project[]);
        if (!form.project_id && (data || []).length) {
            setForm((p) => ({ ...p, project_id: String((data || [])[0].project_id) }));
        }
        // Ensure tasks list gets project names once projects load
        fetchTasks();
    };

    const fetchTeamNames = async () => {
        const { data, error } = await supabase.from('profiles').select('full_name').order('full_name');
        if (error) {
            console.error('Profiles fetch error:', error);
            setTeamNames([]);
            return;
        }
        const names = (data || []).map((r: any) => String(r.full_name || '').trim()).filter(Boolean);
        setTeamNames(Array.from(new Set(names)));
    };

    const fetchTasks = async () => {
        try {
            setLoading(true);
            // Schema-safe: avoid selecting columns that may not exist (task_id/created_at vary across installs)
            const { data, error } = await supabase.from('project_tasks').select('*');

            if (error) throw error;

            // Filter by status if needed (case-insensitive)
            let filteredData = (data || []) as any[];
            if (projectFilter !== 'all') {
                filteredData = filteredData.filter((t) => String(t.project_id) === String(projectFilter));
            }
            if (statusFilter !== 'all') {
                filteredData = filteredData.filter((t) => (t.status || '').toLowerCase() === statusFilter.toLowerCase());
            }

            const projectNameById = new Map<number, string>();
            projects.forEach((p) => projectNameById.set(p.project_id, p.project_name));

            const rows: ProjectTask[] = filteredData.map((t: any) => ({
                ...t,
                project_name: projectNameById.get(Number(t.project_id)) || undefined,
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
        setForm({
            project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.project_id ? String(projects[0].project_id) : ''),
            title: '',
            description: '',
            status: 'Todo',
            priority: 'Medium',
            due_date: '',
            assignee_name: '',
        });
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
        setForm({
            project_id: String(t.project_id),
            title: t.title || '',
            description: t.description || '',
            status: t.status || 'Todo',
            priority: t.priority || 'Medium',
            due_date: t.due_date ? String(t.due_date).split('T')[0] : '',
            assignee_name: t.assignee_name || '',
        });
        setIsOpen(true);
    };

    const handleSave = async () => {
        if (isSaving) return;
        const projectIdNum = Number(form.project_id);
        if (!Number.isFinite(projectIdNum)) {
            toast.error('Project is required');
            return;
        }
        if (!form.title.trim()) {
            toast.error('Title is required');
            return;
        }

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
                            <DialogDescription>Create tasks using the shared `project_tasks` table.</DialogDescription>
                        </DialogHeader>

                        <datalist id="team-member-names">
                            {teamNames.map((n) => (
                                <option key={n} value={n} />
                            ))}
                        </datalist>

                        <div className="space-y-4 py-2">
                            <div className="space-y-2">
                                <Label>Project *</Label>
                                <Select value={form.project_id} onValueChange={(v) => setForm((p) => ({ ...p, project_id: v }))}>
                                    <SelectTrigger className="bg-white">
                                        <SelectValue placeholder="Select project" />
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

                            <div className="space-y-2">
                                <Label>Title *</Label>
                                <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="bg-white" />
                            </div>

                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="bg-white" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Status</Label>
                                    <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                                        <SelectTrigger className="bg-white">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                            {STATUS_OPTIONS.map((s) => (
                                                <SelectItem key={s} value={s} className="bg-white hover:bg-gray-100">
                                                    {s}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Priority</Label>
                                    <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
                                        <SelectTrigger className="bg-white">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                            {PRIORITY_OPTIONS.map((p) => (
                                                <SelectItem key={p} value={p} className="bg-white hover:bg-gray-100">
                                                    {p}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Due date</Label>
                                    <Input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} className="bg-white" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Assignee</Label>
                                    <Input
                                        list="team-member-names"
                                        value={form.assignee_name}
                                        onChange={(e) => setForm((p) => ({ ...p, assignee_name: e.target.value }))}
                                        className="bg-white"
                                        placeholder="Start typing name..."
                                    />
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
                                <Filter className="mr-2 h-4 w-4" />
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
            <Card>
                <CardHeader>
                    <CardTitle>Task List</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading tasks...</div>
                    ) : filteredTasks.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {searchQuery ? 'No tasks found matching your search.' : 'No tasks found.'}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {filteredTasks.map((task) => (
                                <div
                                    key={(task.id ?? task.task_id ?? `${task.project_id}-${task.title}`) as any}
                                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        {getStatusIcon(task.status)}
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold">{task.title}</h3>
                                                {getStatusBadge(task.status)}
                                                <Badge variant="outline">{task.priority || '—'}</Badge>
                                            </div>
                                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                                                <span>{getProjectName(task)}</span>
                                                {task.assignee_name && (
                                                    <>
                                                        <span>•</span>
                                                        <span>{task.assignee_name}</span>
                                                    </>
                                                )}
                                                {task.due_date ? (
                                                    <>
                                                        <span>•</span>
                                                        <span>Due: {new Date(task.due_date).toLocaleDateString()}</span>
                                                    </>
                                                ) : null}
                                            </div>
                                            {task.description && (
                                                <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        {(task.status || '').toLowerCase() !== 'done' ? (
                                            <Button variant="outline" size="sm" onClick={() => quickMarkDone(task)} title="Mark done">
                                                <CheckCircle2 className="h-4 w-4" />
                                            </Button>
                                        ) : null}
                                        <Button variant="outline" size="sm" onClick={() => openEdit(task)} title="Edit">
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => handleDelete(task)} title="Delete">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                        <Link href={`/projects/${task.project_id}`}>
                                            <Button variant="outline" size="sm">
                                                View
                                            </Button>
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

