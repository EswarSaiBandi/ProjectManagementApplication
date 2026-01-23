'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, CheckCircle2, Circle, Clock, AlertCircle, Filter } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

type Task = {
    activity_id: number;
    activity_name: string;
    project_id: number;
    project_name?: string;
    owner: string | null;
    start_date: string;
    end_date: string;
    status: string;
    progress: number;
    tag: string | null;
    description: string | null;
};

export default function TasksPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchTasks();
    }, [statusFilter]);

    const fetchTasks = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('site_activities')
                .select(`
                    activity_id,
                    activity_name,
                    project_id,
                    owner,
                    start_date,
                    end_date,
                    status,
                    progress,
                    tag,
                    description,
                    projects:project_id (
                        project_name
                    )
                `)
                .order('start_date', { ascending: false });

            if (error) throw error;

            // Filter by status if needed (case-insensitive)
            let filteredData = data || [];
            if (statusFilter !== 'all') {
                filteredData = filteredData.filter((task: any) => 
                    task.status?.toLowerCase() === statusFilter.toLowerCase()
                );
            }

            const tasksWithProjectNames = filteredData.map((task: any) => ({
                ...task,
                project_name: task.projects?.project_name || 'Unknown Project',
            }));

            setTasks(tasksWithProjectNames);
        } catch (error) {
            console.error('Error fetching tasks:', error);
            toast.error('Failed to load tasks');
        } finally {
            setLoading(false);
        }
    };

    const filteredTasks = tasks.filter(task => {
        const matchesSearch = task.activity_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            task.project_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            task.owner?.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesSearch;
    });

    const getStatusIcon = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'completed':
            case 'done':
                return <CheckCircle2 className="h-4 w-4 text-green-500" />;
            case 'in progress':
            case 'in-progress':
            case 'ongoing':
                return <Clock className="h-4 w-4 text-blue-500" />;
            case 'pending':
            case 'not started':
                return <Circle className="h-4 w-4 text-gray-400" />;
            default:
                return <Circle className="h-4 w-4 text-gray-400" />;
        }
    };

    const getStatusBadge = (status: string) => {
        const statusLower = status?.toLowerCase() || '';
        if (statusLower.includes('completed') || statusLower.includes('done')) {
            return <Badge variant="default" className="bg-green-500">Completed</Badge>;
        } else if (statusLower.includes('progress') || statusLower.includes('ongoing')) {
            return <Badge variant="default" className="bg-blue-500">In Progress</Badge>;
        } else {
            return <Badge variant="secondary">Pending</Badge>;
        }
    };

    const stats = {
        total: tasks.length,
        completed: tasks.filter(t => t.status?.toLowerCase().includes('completed') || t.status?.toLowerCase().includes('done')).length,
        inProgress: tasks.filter(t => t.status?.toLowerCase().includes('progress') || t.status?.toLowerCase().includes('ongoing')).length,
        todo: tasks.filter(t => !t.status?.toLowerCase().includes('completed') && !t.status?.toLowerCase().includes('done') && !t.status?.toLowerCase().includes('progress')).length,
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Tasks</h2>
                    <p className="text-muted-foreground">Manage and track your project tasks</p>
                </div>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    New Task
                </Button>
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
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[180px]">
                                <Filter className="mr-2 h-4 w-4" />
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="Pending">Pending</SelectItem>
                                <SelectItem value="In Progress">In Progress</SelectItem>
                                <SelectItem value="Completed">Completed</SelectItem>
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
                                    key={task.activity_id}
                                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        {getStatusIcon(task.status)}
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold">{task.activity_name}</h3>
                                                {getStatusBadge(task.status)}
                                                {task.tag && (
                                                    <Badge variant="outline">{task.tag}</Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                                                <span>{task.project_name}</span>
                                                {task.owner && (
                                                    <>
                                                        <span>•</span>
                                                        <span>{task.owner}</span>
                                                    </>
                                                )}
                                                <span>•</span>
                                                <span>Progress: {task.progress}%</span>
                                                <span>•</span>
                                                <span>Due: {new Date(task.end_date).toLocaleDateString()}</span>
                                            </div>
                                            {task.description && (
                                                <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                                            )}
                                        </div>
                                    </div>
                                    <Link href={`/projects/${task.project_id}`}>
                                        <Button variant="outline" size="sm">
                                            View
                                        </Button>
                                    </Link>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

