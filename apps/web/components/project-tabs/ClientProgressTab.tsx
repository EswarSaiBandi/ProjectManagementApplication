'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
    Calendar, Filter, Search, MoreVertical, Edit2, Trash2,
    MessageSquare, ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// Reusing the Activity Type structure
type Activity = {
    activity_id: number;
    activity_name: string;
    description?: string; // New
    dependencies?: string; // New (text for now)
    start_date: string;
    end_date: string;
    tag: string;
    owner: string | null; // JSON or string
    progress: number;
    status: string;
};

export default function ClientProgressTab({ projectId, readOnly = false }: { projectId: string; readOnly?: boolean }) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'details' | 'chart'>('details');

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [teamNames, setTeamNames] = useState<string[]>([]);
    const [newActivity, setNewActivity] = useState<{
        activity_name: string;
        description: string;
        dependencies: string;
        start_date: string;
        end_date: string;
        tag: string;
        owner: string;
    }>({
        activity_name: '',
        description: '',
        dependencies: '',
        start_date: '',
        end_date: '',
        tag: 'Site Work',
        owner: ''
    });

    // Filters State - Reuse existing
    const [filters, setFilters] = useState({
        activity: '',
        description: '',
        dependency: '',
        startDate: '',
        endDate: '',
        tag: '',
        owner: '',
        status: ''
    });

    const fetchActivities = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('site_activities')
            .select('*')
            .eq('project_id', Number(projectId))
            .order('start_date', { ascending: true });

        if (error) {
            console.error('Error fetching activities:', error);
            toast.error("Failed to load activities.");
        } else {
            setActivities(data || []);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (projectId) fetchActivities();
    }, [projectId]);

    useEffect(() => {
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
        fetchTeamNames();
    }, []);

    const handleFilterChange = (key: keyof typeof filters, value: string) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    // Filter Logic
    const filteredActivities = activities.filter(activity => {
        const ownerStr = String(activity.owner || '').trim().toLowerCase();
        const ownerFilter = filters.owner.trim().toLowerCase();
        const statusFilter = filters.status.trim().toLowerCase();
        const activityStatusStr = String(activity.status || '').toLowerCase();
        const progressStr = String(activity.progress ?? '');
        const matchesStatusOrProgress =
            !statusFilter ||
            activityStatusStr.includes(statusFilter) ||
            progressStr.includes(filters.status.trim());
        const matchesOwner = !ownerFilter || ownerStr === ownerFilter;

        return (
            (activity.activity_name?.toLowerCase() || '').includes(filters.activity.toLowerCase()) &&
            (activity.description?.toLowerCase() || '').includes(filters.description.toLowerCase()) &&
            (filters.dependency === '' || (activity.dependencies?.toLowerCase() || '').includes(filters.dependency.toLowerCase())) &&
            (activity.start_date?.includes(filters.startDate) || !filters.startDate) &&
            (activity.end_date?.includes(filters.endDate) || !filters.endDate) &&
            (String(activity.tag || '').toLowerCase().includes(filters.tag.trim().toLowerCase()) || !filters.tag.trim()) &&
            matchesOwner &&
            matchesStatusOrProgress
        );
    });

    const getInitials = (name: string | null) => {
        if (!name) return 'UA';
        return name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
    };

    const handleEditClick = (activity: Activity) => {
        setEditingId(activity.activity_id);
        const startDate = activity.start_date ? new Date(activity.start_date).toISOString().split('T')[0] : '';
        const endDate = activity.end_date ? new Date(activity.end_date).toISOString().split('T')[0] : '';

        setNewActivity({
            activity_name: activity.activity_name,
            description: activity.description || '',
            dependencies: activity.dependencies || '',
            start_date: startDate,
            end_date: endDate,
            tag: activity.tag,
            owner: activity.owner || ''
        });
        setIsDialogOpen(true);
    };

    const handleDeleteClick = async (id: number) => {
        if (!confirm("Are you sure you want to delete this activity?")) return;
        const { error } = await supabase.from('site_activities').delete().eq('activity_id', id);
        if (error) {
            console.error("Error deleting:", error);
            toast.error("Failed to delete activity.");
        } else {
            toast.success("Activity deleted.");
            fetchActivities();
        }
    };

    const handleSave = async () => {
        if (!projectId || !Number.isFinite(Number(projectId))) {
            toast.error("Invalid project");
            return;
        }
        if (!newActivity.activity_name.trim()) {
            toast.error("Activity name is required");
            return;
        }
        if (!newActivity.start_date || !newActivity.end_date) {
            toast.error("Start date and end date are required");
            return;
        }
        if (new Date(newActivity.start_date) > new Date(newActivity.end_date)) {
            toast.error("End date must be on or after start date");
            return;
        }

        setIsSaving(true);
        const payload = {
            project_id: Number(projectId),
            activity_name: newActivity.activity_name,
            description: newActivity.description,
            dependencies: newActivity.dependencies,
            start_date: newActivity.start_date,
            end_date: newActivity.end_date,
            tag: newActivity.tag,
            owner: newActivity.owner
        };

        let error;
        if (editingId) {
            const { error: updateError } = await supabase
                .from('site_activities')
                .update(payload)
                .eq('activity_id', editingId);
            error = updateError;
        } else {
            const { error: insertError } = await supabase
                .from('site_activities')
                .insert({ ...payload, progress: 0, status: 'Pending' });
            error = insertError;
        }

        if (error) {
            console.error("Save error:", error);
            toast.error(error.message || "Failed to save activity.");
        } else {
            toast.success(editingId ? "Activity updated." : "Activity added.");
            setIsDialogOpen(false);
            setEditingId(null);
            setNewActivity({
                activity_name: '',
                description: '',
                dependencies: '',
                start_date: '',
                end_date: '',
                tag: 'Site Work',
                owner: ''
            });
            fetchActivities();
        }
        setIsSaving(false);
    };

    return (
        <div className="space-y-4">
            <datalist id="team-member-names-filter">
                {teamNames.map((n) => (
                    <option key={n} value={n} />
                ))}
            </datalist>
            {/* Top Controls (View Toggle) */}
            <div className="flex justify-between items-center">
                <div className="flex bg-slate-100 p-1 rounded-md">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewMode('details')}
                        className={cn(
                            "h-8 px-4 text-xs font-semibold rounded-sm transition-all",
                            viewMode === 'details' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"
                        )}
                    >
                        Details
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewMode('chart')}
                        className={cn(
                            "h-8 px-4 text-xs font-semibold rounded-sm transition-all",
                            viewMode === 'chart' ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"
                        )}
                    >
                        Chart
                    </Button>
                </div>

                <div className="flex gap-2">
                    <Dialog open={isDialogOpen} onOpenChange={(open) => {
                        setIsDialogOpen(open);
                        if (!open) {
                            setEditingId(null);
                            setNewActivity({
                                activity_name: '',
                                description: '',
                                dependencies: '',
                                start_date: '',
                                end_date: '',
                                tag: 'Site Work',
                                owner: ''
                            });
                        }
                    }}>
                        {!readOnly && (
                            <DialogTrigger asChild>
                                <Button className="bg-blue-600 h-9 text-xs">
                                    <PlusIcon className="w-3 h-3 mr-1.5" /> Activity
                                </Button>
                            </DialogTrigger>
                        )}
                        <DialogContent className="max-w-2xl bg-white">
                            <DialogHeader>
                                <DialogTitle>{editingId ? "Edit Activity" : "Add Activity"}</DialogTitle>
                                <DialogDescription>Enter the details for this activity.</DialogDescription>
                            </DialogHeader>
                            <datalist id="team-member-names">
                                {teamNames.map((n) => (
                                    <option key={n} value={n} />
                                ))}
                            </datalist>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Activity</Label>
                                    <Input
                                        className="col-span-3"
                                        value={newActivity.activity_name}
                                        onChange={(e) => setNewActivity({ ...newActivity, activity_name: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Description</Label>
                                    <Input
                                        className="col-span-3"
                                        value={newActivity.description}
                                        onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Dependencies</Label>
                                    <Input
                                        className="col-span-3"
                                        value={newActivity.dependencies}
                                        onChange={(e) => setNewActivity({ ...newActivity, dependencies: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Start Date</Label>
                                    <Input
                                        type="date"
                                        className="col-span-3"
                                        value={newActivity.start_date}
                                        onChange={(e) => setNewActivity({ ...newActivity, start_date: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">End Date</Label>
                                    <Input
                                        type="date"
                                        className="col-span-3"
                                        value={newActivity.end_date}
                                        onChange={(e) => setNewActivity({ ...newActivity, end_date: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Tag</Label>
                                    <Input
                                        className="col-span-3"
                                        value={newActivity.tag}
                                        onChange={(e) => setNewActivity({ ...newActivity, tag: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Owner</Label>
                                    <Input
                                        className="col-span-3"
                                        list="team-member-names"
                                        value={newActivity.owner}
                                        onChange={(e) => setNewActivity({ ...newActivity, owner: e.target.value })}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                                <Button onClick={handleSave} disabled={isSaving}>{isSaving ? "Saving..." : "Save"}</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Button variant="outline" className="h-9 text-xs text-blue-600 border-blue-200 bg-blue-50">
                        <PlusIcon className="w-3 h-3 mr-1.5" /> Import from Other Project
                    </Button>
                </div>
            </div>

            {/* Table View */}
            {viewMode === 'details' && (
                <div className="rounded-md border bg-white overflow-hidden">
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            <TableRow>
                                {/* Activity Name Column */}
                                <TableHead className="w-[180px] align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Activity</span>
                                        <div className="relative">
                                            <Filter className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                            <Input
                                                className="h-8 pl-7 text-xs bg-white"
                                                placeholder=""
                                                value={filters.activity}
                                                onChange={(e) => handleFilterChange('activity', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </TableHead>

                                {/* Description */}
                                <TableHead className="min-w-[150px] align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Description</span>
                                        <div className="relative">
                                            <Search className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                            <Input
                                                className="h-8 pl-7 text-xs bg-white"
                                                placeholder=""
                                                value={filters.description}
                                                onChange={(e) => handleFilterChange('description', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </TableHead>

                                {/* Dependency */}
                                <TableHead className="w-[120px] align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Dependency</span>
                                        <div className="relative">
                                            <Search className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                            <Input
                                                className="h-8 pl-7 text-xs bg-white"
                                                placeholder=""
                                                value={filters.dependency}
                                                onChange={(e) => handleFilterChange('dependency', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </TableHead>

                                {/* Dates */}
                                <TableHead className="w-[130px] align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Start Date</span>
                                        <div className="relative">
                                            <Calendar className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                            <Input
                                                type="date"
                                                className="h-8 pl-7 text-xs bg-white"
                                                value={filters.startDate}
                                                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </TableHead>
                                <TableHead className="w-[130px] align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">End Date</span>
                                        <div className="relative">
                                            <Calendar className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                            <Input
                                                type="date"
                                                className="h-8 pl-7 text-xs bg-white"
                                                value={filters.endDate}
                                                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </TableHead>

                                {/* Tag */}
                                <TableHead className="w-[100px] align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Tag</span>
                                        <div className="relative">
                                            <Filter className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                            <Input
                                                className="h-8 pl-7 text-xs bg-white"
                                                placeholder=""
                                                value={filters.tag}
                                                onChange={(e) => handleFilterChange('tag', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </TableHead>

                                {/* Owner */}
                                <TableHead className="w-[100px] align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Owner</span>
                                        <Select
                                            value={filters.owner || "__all__"}
                                            onValueChange={(v) => handleFilterChange('owner', v === "__all__" ? "" : v)}
                                        >
                                            <SelectTrigger className="h-8 text-xs bg-white">
                                                <SelectValue placeholder="All" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__all__">All</SelectItem>
                                                {teamNames.map((n) => (
                                                    <SelectItem key={n} value={n}>
                                                        {n}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </TableHead>

                                {/* Progress */}
                                <TableHead className="w-[140px] align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Current Status</span>
                                        <div className="relative">
                                            <Search className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                            <Input
                                                className="h-8 pl-7 text-xs bg-white"
                                                placeholder=""
                                                value={filters.status}
                                                onChange={(e) => handleFilterChange('status', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </TableHead>

                                {/* Actions */}
                                <TableHead className="w-[80px] text-center align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Comments</span>
                                        <div className="h-8"></div>
                                    </div>
                                </TableHead>
                                <TableHead className="w-[60px] text-center align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Details</span>
                                        <div className="h-8"></div>
                                    </div>
                                </TableHead>
                                <TableHead className="w-[60px] text-center align-top py-3">
                                    <div className="flex flex-col gap-2">
                                        <span className="font-semibold text-slate-700">Actions</span>
                                        <div className="h-8"></div>
                                    </div>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredActivities.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={11} className="text-center h-24 text-muted-foreground">
                                        No activities found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredActivities.map((activity) => (
                                    <TableRow key={activity.activity_id} className="group hover:bg-slate-50/50">
                                        <TableCell className="font-medium text-slate-700">
                                            {activity.activity_name}
                                        </TableCell>
                                        <TableCell className="text-slate-500 text-xs">
                                            {activity.description || '-'}
                                        </TableCell>
                                        <TableCell className="text-slate-500 text-xs text-center">
                                            {activity.dependencies || '-'}
                                        </TableCell>
                                        <TableCell className="text-slate-600 text-xs whitespace-nowrap">
                                            {format(new Date(activity.start_date), 'MMM dd, yyyy')}
                                        </TableCell>
                                        <TableCell className="text-slate-600 text-xs whitespace-nowrap">
                                            {(() => {
                                                const start = new Date(activity.start_date);
                                                const end = new Date(activity.end_date);
                                                const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                                                return (
                                                    <div className="flex flex-col">
                                                        <span>{format(end, 'MMM dd, yyyy')}</span>
                                                        <span className="text-[10px] text-slate-400">({diff} days)</span>
                                                    </div>
                                                );
                                            })()}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-200 border-none font-normal text-xs">
                                                {activity.tag}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Avatar className="h-6 w-6">
                                                <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${activity.owner || 'UA'}`} />
                                                <AvatarFallback className="text-[10px] bg-blue-100 text-blue-700">
                                                    {getInitials(activity.owner)}
                                                </AvatarFallback>
                                            </Avatar>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Progress value={activity.progress} className="h-2 flex-1" indicatorClassName={activity.progress === 100 ? "bg-green-500" : "bg-blue-500"} />
                                                <span className="text-xs text-slate-500 w-8 text-right">{activity.progress}%</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md">
                                                <MessageSquare className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md">
                                                <ExternalLink className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                        {!readOnly && (
                                        <TableCell className="text-center">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <MoreVertical className="h-4 w-4 text-slate-400" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEditClick(activity)}>
                                                        <Edit2 className="mr-2 h-4 w-4" /> Edit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => handleDeleteClick(activity.activity_id)}>
                                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}

            {viewMode === 'chart' && (
                <div className="h-[500px] flex items-center justify-center border rounded-lg bg-slate-50 text-slate-500">
                    {/* Placeholder - could look into reusing GanttChart component here if needed, 
                       or just keeping it simple as this is 'Client Progress' 
                   */}
                    Graph View Coming Soon
                </div>
            )}
        </div>
    );
}

function PlusIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
        </svg>
    )
}
