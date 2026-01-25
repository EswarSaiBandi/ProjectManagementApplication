'use client';

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ListTodo, BarChart3, Plus, Download, MessageSquare, ExternalLink, MoreVertical, Pencil, Trash, Search } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ActivityDetailsDialog } from "./ActivityDetailsDialog";
import GanttChart from "./GanttChart";


type Activity = {
    activity_id: number;
    project_id: number;
    activity_name: string;
    description?: string | null;
    dependencies?: string | null;
    start_date: string;
    end_date: string;
    tag: string;
    owner: string;
    progress: number;
    status: string;
};

const STATUS_OPTIONS = ["Pending", "In Progress", "Completed"] as const;

const MASTER_ACTIVITIES = [
    { name: "Snags", tag: "Site Work" },
    { name: "Plumbing Drawing", tag: "Design" },
    { name: "Flooring", tag: "Civil" },
    { name: "Electrical Cabling", tag: "MEP" },
    { name: "Brickwork", tag: "Civil" },
    { name: "Plastering", tag: "Civil" },
    { name: "Painting", tag: "Finishing" },
    { name: "HVAC Installation", tag: "MEP" },
    { name: "Fire Fighting Sys", tag: "MEP" },
    { name: "False Ceiling", tag: "Finishing" },
    { name: "Carpentry", tag: "Finishing" },
    { name: "Waterproofing", tag: "Civil" },
    { name: "Demolition", tag: "Site Work" },
    { name: "Site Clearance", tag: "Site Work" },
    { name: "Excavation", tag: "Civil" },
    { name: "Foundation", tag: "Civil" },
    { name: "Structural Steel", tag: "Civil" },
    { name: "Glass Work", tag: "Finishing" },
    { name: "Landscaping", tag: "Site Work" },
    { name: "Sewerage Line", tag: "Plumbing" },
];

export default function ActivitiesTab({ projectId }: { projectId: string }) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [isActivityOpen, setIsActivityOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [currentUser, setCurrentUser] = useState("Unknown");
    const [teamNames, setTeamNames] = useState<string[]>([]);
    const [createMode, setCreateMode] = useState<"bulk" | "custom">("bulk");

    // NEW: View Toggle State
    const [viewMode, setViewMode] = useState<'list' | 'chart'>('list');

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || "User";
                setCurrentUser(name);
                setNewActivity(prev => ({ ...prev, owner: name }));
                setBulkOwner(name);
            }
        };
        fetchUser();
    }, []);

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

    const [newActivity, setNewActivity] = useState({
        activity_name: '',
        description: '',
        dependencies: '',
        start_date: '',
        end_date: '',
        tag: 'Site Work',
        owner: currentUser,
        progress: 0,
        status: 'Pending'
    });

    // Search & Multi-select States
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedActivities, setSelectedActivities] = useState<string[]>([]); // For Bulk Add
    const [bulkStartDate, setBulkStartDate] = useState(() => {
        const d = new Date();
        return d.toISOString().split('T')[0];
    });
    const [bulkEndDate, setBulkEndDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
    });
    const [bulkOwner, setBulkOwner] = useState(currentUser);

    // Activity Details & History Modal State
    const [selectedActivityForDetails, setSelectedActivityForDetails] = useState<Activity | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const formatDate = (dateString: string) => {
        if (!dateString) return "";
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    };

    const fetchActivities = async () => {
        const { data: activitiesData, error } = await supabase
            .from('site_activities')
            .select('*')
            .eq('project_id', Number(projectId))
            .order('start_date', { ascending: true });

        if (activitiesData) {
            setActivities(activitiesData);

            // Sync selectedActivityForDetails if it's open
            if (selectedActivityForDetails) {
                const updatedFn = activitiesData.find(a => a.activity_id === selectedActivityForDetails.activity_id);
                if (updatedFn) {
                    setSelectedActivityForDetails(updatedFn);
                }
            }
        } else if (error) {
            console.error("Error fetching activities:", error);
        }
    };

    useEffect(() => {
        if (projectId) {
            fetchActivities();
        }
    }, [projectId]);

    const handleEditActivity = (activity: Activity) => {
        setEditingId(activity.activity_id);
        setCreateMode("custom");
        const startDate = activity.start_date ? new Date(activity.start_date).toISOString().split('T')[0] : '';
        const endDate = activity.end_date ? new Date(activity.end_date).toISOString().split('T')[0] : '';

        setNewActivity({
            activity_name: activity.activity_name,
            description: (activity.description ?? '') as string,
            dependencies: (activity.dependencies ?? '') as string,
            start_date: startDate,
            end_date: endDate,
            tag: activity.tag,
            owner: activity.owner,
            progress: Number(activity.progress ?? 0),
            status: activity.status || 'Pending'
        });
        setIsActivityOpen(true);
    };

    const handleSaveActivity = async () => {
        if (!projectId || !Number.isFinite(Number(projectId))) {
            toast.error("Invalid project");
            return;
        }

        setIsSaving(true);

        let error;

        if (editingId) {
            // Update Existing Activity
            if (!newActivity.activity_name.trim()) {
                toast.error("Activity name is required.");
                setIsSaving(false);
                return;
            }
            if (!newActivity.start_date || !newActivity.end_date) {
                toast.error("Start date and end date are required.");
                setIsSaving(false);
                return;
            }
            if (new Date(newActivity.start_date) > new Date(newActivity.end_date)) {
                toast.error("End date must be on or after start date.");
                setIsSaving(false);
                return;
            }
            const p = Number(newActivity.progress);
            if (!Number.isFinite(p) || p < 0 || p > 100) {
                toast.error("Progress must be between 0 and 100.");
                setIsSaving(false);
                return;
            }

            const computedStatus =
                p === 100 ? "Completed" : (newActivity.status || (p > 0 ? "In Progress" : "Pending"));

            const payload = {
                project_id: Number(projectId),
                activity_name: newActivity.activity_name,
                description: newActivity.description?.trim() ? newActivity.description.trim() : null,
                dependencies: newActivity.dependencies?.trim() ? newActivity.dependencies.trim() : null,
                start_date: newActivity.start_date,
                end_date: newActivity.end_date,
                tag: newActivity.tag,
                owner: newActivity.owner,
                progress: p,
                status: computedStatus,
            };

            const { error: updateError } = await supabase
                .from('site_activities')
                .update(payload)
                .eq('activity_id', editingId);
            error = updateError;

        } else {
            if (createMode === "custom") {
                // Single Insert (Custom)
                if (!newActivity.activity_name.trim()) {
                    toast.error("Activity name is required.");
                    setIsSaving(false);
                    return;
                }
                if (!newActivity.start_date || !newActivity.end_date) {
                    toast.error("Start date and end date are required.");
                    setIsSaving(false);
                    return;
                }
                if (new Date(newActivity.start_date) > new Date(newActivity.end_date)) {
                    toast.error("End date must be on or after start date.");
                    setIsSaving(false);
                    return;
                }
                const p = Number(newActivity.progress);
                if (!Number.isFinite(p) || p < 0 || p > 100) {
                    toast.error("Progress must be between 0 and 100.");
                    setIsSaving(false);
                    return;
                }
                const computedStatus =
                    p === 100 ? "Completed" : (newActivity.status || (p > 0 ? "In Progress" : "Pending"));

                const payload = {
                    project_id: Number(projectId),
                    activity_name: newActivity.activity_name,
                    description: newActivity.description?.trim() ? newActivity.description.trim() : null,
                    dependencies: newActivity.dependencies?.trim() ? newActivity.dependencies.trim() : null,
                    start_date: newActivity.start_date,
                    end_date: newActivity.end_date,
                    tag: newActivity.tag,
                    owner: newActivity.owner || currentUser,
                    progress: p,
                    status: computedStatus,
                };

                const { error: insertError } = await supabase
                    .from('site_activities')
                    .insert([payload]);
                error = insertError;
            } else {
                // Bulk Insert New Activities
                if (selectedActivities.length === 0) {
                    toast.error("Please select at least one activity.");
                    setIsSaving(false);
                    return;
                }
                if (!bulkStartDate || !bulkEndDate) {
                    toast.error("Start date and end date are required.");
                    setIsSaving(false);
                    return;
                }
                if (new Date(bulkStartDate) > new Date(bulkEndDate)) {
                    toast.error("End date must be on or after start date.");
                    setIsSaving(false);
                    return;
                }

                const bulkPayload = selectedActivities.map(activityName => {
                    const masterItem = MASTER_ACTIVITIES.find(m => m.name === activityName);
                    return {
                        project_id: Number(projectId),
                        activity_name: activityName,
                        start_date: bulkStartDate,
                        end_date: bulkEndDate,
                        tag: masterItem?.tag || 'Site Work',
                        owner: bulkOwner || currentUser,
                        progress: 0,
                        status: 'Pending'
                    };
                });

                const { error: insertError } = await supabase
                    .from('site_activities')
                    .insert(bulkPayload);
                error = insertError;
            }
        }

        if (!error) {
            toast.success(editingId ? "Activity updated successfully." : "Activities added successfully.");
            setIsActivityOpen(false);
            setEditingId(null);
            setCreateMode("bulk");
            setNewActivity({
                activity_name: '',
                description: '',
                dependencies: '',
                start_date: '',
                end_date: '',
                tag: 'Site Work',
                owner: currentUser,
                progress: 0,
                status: 'Pending'
            });
            setSelectedActivities([]);
            setSearchTerm("");
            fetchActivities();
        } else {
            console.error("Error saving activity:", error);
            toast.error(`Failed to save: ${error.message || "Unknown error"}`);
        }
        setIsSaving(false);
    };

    const toggleActivitySelection = (name: string) => {
        if (selectedActivities.includes(name)) {
            setSelectedActivities(selectedActivities.filter(item => item !== name));
        } else {
            setSelectedActivities([...selectedActivities, name]);
        }
    };

    const filteredMasterList = MASTER_ACTIVITIES.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleDeleteActivity = async (id: number) => {
        if (!confirm("Are you sure you want to delete this activity?")) return;

        const { error } = await supabase.from('site_activities').delete().eq('activity_id', id);

        if (!error) {
            toast.success("Activity deleted successfully.");
            fetchActivities();
        } else {
            console.error("Error deleting activity:", error);
            toast.error("Failed to delete activity.");
        }
    };

    return (
        <Card className="border-none shadow-sm flex flex-col h-[calc(100vh-200px)]">
            <CardHeader className="pb-4 pt-2">
                <div className="flex justify-between items-center">
                    {/* Left: View Toggle */}
                    <div className="flex bg-slate-100 p-1 rounded-md">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-8 px-4 text-xs font-semibold rounded-sm transition-all",
                                viewMode === 'list'
                                    ? "bg-white text-slate-800 shadow-sm"
                                    : "text-slate-500 hover:text-slate-800"
                            )}
                            onClick={() => setViewMode('list')}
                        >
                            <ListTodo className="h-4 w-4 mr-2" /> Details
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-8 px-4 text-xs font-semibold rounded-sm transition-all",
                                viewMode === 'chart'
                                    ? "bg-white text-slate-800 shadow-sm"
                                    : "text-slate-500 hover:text-slate-800"
                            )}
                            onClick={() => setViewMode('chart')}
                        >
                            <BarChart3 className="h-4 w-4 mr-2" /> Chart
                        </Button>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex space-x-2">
                        {/* Only show actions in list mode or specific actions in chart mode if needed */}
                        <Dialog open={isActivityOpen} onOpenChange={(open: boolean) => { setIsActivityOpen(open); if (!open) { setEditingId(null); setCreateMode("bulk"); setNewActivity({ activity_name: '', description: '', dependencies: '', start_date: '', end_date: '', tag: 'Site Work', owner: currentUser, progress: 0, status: 'Pending' }); setSelectedActivities([]); setSearchTerm(""); } }}>
                            <DialogTrigger asChild>
                                <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700 h-9" onClick={() => { setEditingId(null); }}>
                                    <Plus className="h-4 w-4 mr-2" /> Activity
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl bg-white rounded-xl shadow-2xl border-0">
                                <DialogHeader>
                                    <DialogTitle className="text-xl font-bold">{editingId ? 'Edit Activity' : 'Add New Activity'}</DialogTitle>
                                    <DialogDescription>
                                        {editingId ? "Update activity details." : "Create a custom activity or select from the master list."}
                                    </DialogDescription>
                                </DialogHeader>
                                <datalist id="team-member-names">
                                    {teamNames.map((n) => (
                                        <option key={n} value={n} />
                                    ))}
                                </datalist>

                                {editingId ? (
                                    // Edit Mode
                                    <div className="grid gap-4 py-4">
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">Name</Label>
                                            <Input
                                                className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                value={newActivity.activity_name}
                                                onChange={(e) => setNewActivity({ ...newActivity, activity_name: e.target.value })}
                                                placeholder="e.g. Demolition"
                                            />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">Description</Label>
                                            <Input
                                                className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                value={newActivity.description}
                                                onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
                                                placeholder="Optional"
                                            />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">Dependencies</Label>
                                            <Input
                                                className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                value={newActivity.dependencies}
                                                onChange={(e) => setNewActivity({ ...newActivity, dependencies: e.target.value })}
                                                placeholder="Optional (comma separated)"
                                            />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">Start Date</Label>
                                            <Input
                                                type="date"
                                                className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                value={newActivity.start_date}
                                                onChange={(e) => setNewActivity({ ...newActivity, start_date: e.target.value })}
                                            />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">End Date</Label>
                                            <Input
                                                type="date"
                                                className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                value={newActivity.end_date}
                                                onChange={(e) => setNewActivity({ ...newActivity, end_date: e.target.value })}
                                            />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">Tag</Label>
                                            <Input
                                                className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                value={newActivity.tag}
                                                onChange={(e) => setNewActivity({ ...newActivity, tag: e.target.value })}
                                                placeholder="e.g. Civil / MEP"
                                            />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">Owner</Label>
                                            <Input
                                                list="team-member-names"
                                                className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                value={newActivity.owner}
                                                onChange={(e) => setNewActivity({ ...newActivity, owner: e.target.value })}
                                                placeholder="e.g. Site Supervisor"
                                            />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">Progress</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={100}
                                                className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                value={newActivity.progress}
                                                onChange={(e) => setNewActivity({ ...newActivity, progress: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label className="text-right text-slate-700">Status</Label>
                                            <Select value={newActivity.status} onValueChange={(v) => setNewActivity({ ...newActivity, status: v })}>
                                                <SelectTrigger className="col-span-3 bg-white text-slate-900 border-slate-300">
                                                    <SelectValue placeholder="Select status" />
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
                                    </div>
                                ) : (
                                    // Create Mode (Bulk or Custom)
                                    <div className="py-2">
                                        <div className="flex items-center justify-between gap-3 mb-3">
                                            <div className="text-sm font-medium text-slate-700">Create mode</div>
                                            <Select value={createMode} onValueChange={(v) => setCreateMode(v as "bulk" | "custom")}>
                                                <SelectTrigger className="w-[200px] bg-white border border-slate-200">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-white border border-slate-200 shadow-lg">
                                                    <SelectItem value="bulk" className="bg-white hover:bg-slate-50">
                                                        Bulk add (master list)
                                                    </SelectItem>
                                                    <SelectItem value="custom" className="bg-white hover:bg-slate-50">
                                                        Custom activity
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {createMode === "custom" ? (
                                            <div className="grid gap-4 py-2">
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <Label className="text-right text-slate-700">Name</Label>
                                                    <Input
                                                        className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                        value={newActivity.activity_name}
                                                        onChange={(e) => setNewActivity({ ...newActivity, activity_name: e.target.value })}
                                                        placeholder="e.g. Plumbing Drawing"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <Label className="text-right text-slate-700">Description</Label>
                                                    <Input
                                                        className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                        value={newActivity.description}
                                                        onChange={(e) => setNewActivity({ ...newActivity, description: e.target.value })}
                                                        placeholder="Optional"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <Label className="text-right text-slate-700">Dependencies</Label>
                                                    <Input
                                                        className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                        value={newActivity.dependencies}
                                                        onChange={(e) => setNewActivity({ ...newActivity, dependencies: e.target.value })}
                                                        placeholder="Optional (comma separated)"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <Label className="text-right text-slate-700">Start Date</Label>
                                                    <Input
                                                        type="date"
                                                        className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                        value={newActivity.start_date}
                                                        onChange={(e) => setNewActivity({ ...newActivity, start_date: e.target.value })}
                                                    />
                                                </div>
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <Label className="text-right text-slate-700">End Date</Label>
                                                    <Input
                                                        type="date"
                                                        className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                        value={newActivity.end_date}
                                                        onChange={(e) => setNewActivity({ ...newActivity, end_date: e.target.value })}
                                                    />
                                                </div>
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <Label className="text-right text-slate-700">Tag</Label>
                                                    <Input
                                                        className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                        value={newActivity.tag}
                                                        onChange={(e) => setNewActivity({ ...newActivity, tag: e.target.value })}
                                                        placeholder="e.g. Civil / MEP"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-4 items-center gap-4">
                                                    <Label className="text-right text-slate-700">Owner</Label>
                                                    <Input
                                                        list="team-member-names"
                                                        className="col-span-3 bg-white text-slate-900 border-slate-300"
                                                        value={newActivity.owner}
                                                        onChange={(e) => setNewActivity({ ...newActivity, owner: e.target.value })}
                                                        placeholder="e.g. Site Supervisor"
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                <div className="relative">
                                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                                                    <Input
                                                        placeholder="Search standard activities..."
                                                        className="pl-9 bg-slate-50 border-slate-200"
                                                        value={searchTerm}
                                                        onChange={(e) => setSearchTerm(e.target.value)}
                                                    />
                                                </div>

                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <Label className="text-slate-700">Start Date</Label>
                                                        <Input
                                                            type="date"
                                                            className="bg-white text-slate-900 border-slate-300"
                                                            value={bulkStartDate}
                                                            onChange={(e) => setBulkStartDate(e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-slate-700">End Date</Label>
                                                        <Input
                                                            type="date"
                                                            className="bg-white text-slate-900 border-slate-300"
                                                            value={bulkEndDate}
                                                            onChange={(e) => setBulkEndDate(e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="space-y-1 col-span-2">
                                                        <Label className="text-slate-700">Owner</Label>
                                                        <Input
                                                            list="team-member-names"
                                                            className="bg-white text-slate-900 border-slate-300"
                                                            value={bulkOwner}
                                                            onChange={(e) => setBulkOwner(e.target.value)}
                                                            placeholder="e.g. Site Supervisor"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="border rounded-md h-[300px] overflow-y-auto">
                                                    <Table>
                                                        <TableBody>
                                                            {filteredMasterList.length === 0 ? (
                                                                <TableRow>
                                                                    <TableCell className="text-center text-slate-500 py-4">No activities found.</TableCell>
                                                                </TableRow>
                                                            ) : (
                                                                filteredMasterList.map((item) => (
                                                                    <TableRow
                                                                        key={item.name}
                                                                        className="cursor-pointer hover:bg-slate-50"
                                                                        onClick={() => toggleActivitySelection(item.name)}
                                                                    >
                                                                        <TableCell className="w-[40px]">
                                                                            <input
                                                                                type="checkbox"
                                                                                className="rounded border-gray-300 accent-blue-600 h-4 w-4"
                                                                                checked={selectedActivities.includes(item.name)}
                                                                                readOnly
                                                                            />
                                                                        </TableCell>
                                                                        <TableCell className="font-medium text-slate-700">{item.name}</TableCell>
                                                                        <TableCell className="text-right">
                                                                            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">{item.tag}</span>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                ))
                                                            )}
                                                        </TableBody>
                                                    </Table>
                                                </div>

                                                <p className="text-xs text-slate-500 text-right">
                                                    {selectedActivities.length} activities selected
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                                <DialogFooter>
                                    <Button onClick={handleSaveActivity} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                                        {isSaving ? 'Saving...' : (editingId ? 'Update Activity' : (createMode === "custom" ? "Add Activity" : `Add ${selectedActivities.length > 0 ? selectedActivities.length : ''} Activities`))}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        <Button variant="outline" size="sm" className="h-9 border-slate-200 text-slate-600 hover:bg-slate-50">
                            <Download className="h-4 w-4 mr-2" /> Import from Other Project
                        </Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-400">
                            <MoreVertical className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Filters Row (Only relevant for List view) */}
                {viewMode === 'list' && (
                    <div className="flex items-center space-x-4 mt-4">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Search activities..."
                                className="pl-9 h-9 bg-slate-50 border-slate-200"
                            />
                        </div>
                    </div>
                )}
            </CardHeader>

            <CardContent className="flex-1 overflow-hidden p-0 relative">
                {viewMode === 'list' ? (
                    <div className="h-full overflow-auto px-6 pb-6">
                        <Table>
                            <TableHeader className="bg-slate-50 sticky top-0 z-10">
                                <TableRow className="hover:bg-transparent border-b border-slate-200">
                                    <TableHead className="w-10">
                                        <input type="checkbox" className="rounded border-gray-300" />
                                    </TableHead>
                                    <TableHead className="font-semibold text-slate-500 text-xs uppercase tracking-wider">Activity</TableHead>
                                    <TableHead className="font-semibold text-slate-500 text-xs uppercase tracking-wider">Start Date</TableHead>
                                    <TableHead className="font-semibold text-slate-500 text-xs uppercase tracking-wider">End Date</TableHead>
                                    <TableHead className="font-semibold text-slate-500 text-xs uppercase tracking-wider">Tag</TableHead>
                                    <TableHead className="font-semibold text-slate-500 text-xs uppercase tracking-wider">Owner</TableHead>
                                    <TableHead className="font-semibold text-slate-500 text-xs uppercase tracking-wider">Current Status</TableHead>
                                    <TableHead className="font-semibold text-slate-500 text-xs uppercase tracking-wider">Comment</TableHead>
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-gray-500 text-center">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {activities.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="h-24 text-center text-slate-500">
                                            No activities found. Create one to get started.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    activities.map((activity) => (
                                        <TableRow key={activity.activity_id} className="group hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                                            <TableCell>
                                                <input type="checkbox" className="rounded border-gray-300" />
                                            </TableCell>
                                            <TableCell className="font-medium text-slate-900">
                                                {activity.activity_name}
                                            </TableCell>
                                            <TableCell className="text-slate-500 text-sm">
                                                {formatDate(activity.start_date)}
                                            </TableCell>
                                            <TableCell className="text-slate-500 text-sm">
                                                {formatDate(activity.end_date)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="bg-white text-slate-600 border-slate-200 font-normal">
                                                    {activity.tag}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Avatar className="h-6 w-6">
                                                        <AvatarFallback className="bg-indigo-100 text-indigo-600 text-[10px]">
                                                            {activity.owner?.substring(0, 2).toUpperCase() || "NA"}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1.5 w-[140px]">
                                                    <div className="flex justify-between text-xs">
                                                        <span className="font-medium text-slate-700">{activity.progress}%</span>
                                                        <span className={cn(
                                                            "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                                            activity.status === 'Completed' ? "bg-green-100 text-green-700" :
                                                                activity.status === 'In Progress' ? "bg-blue-100 text-blue-700" :
                                                                    "bg-gray-100 text-gray-600"
                                                        )}>
                                                            {activity.status}
                                                        </span>
                                                    </div>
                                                    <Progress value={activity.progress} className="h-1.5 bg-slate-100" indicatorClassName={cn(
                                                        activity.status === 'Completed' ? "bg-green-500" : "bg-blue-500"
                                                    )} />
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 px-2 text-slate-500 hover:text-blue-600"
                                                    onClick={() => { setSelectedActivityForDetails(activity); setIsDetailsOpen(true); }}
                                                >
                                                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> Note
                                                </Button>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center justify-center gap-1 opacity-100 text-slate-500">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 px-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50"
                                                        onClick={() => handleEditActivity(activity)}
                                                    >
                                                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 px-2 text-slate-600 hover:text-red-600 hover:bg-red-50"
                                                        onClick={() => handleDeleteActivity(activity.activity_id)}
                                                    >
                                                        <Trash className="h-3.5 w-3.5 mr-1.5" /> Delete
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 px-2 text-slate-600 hover:text-slate-800"
                                                        onClick={() => { setSelectedActivityForDetails(activity); setIsDetailsOpen(true); }}
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Details
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <GanttChart activities={activities} />
                )}
            </CardContent>

            <ActivityDetailsDialog
                activity={selectedActivityForDetails}
                isOpen={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                onUpdate={fetchActivities}
            />
        </Card>
    );
}
