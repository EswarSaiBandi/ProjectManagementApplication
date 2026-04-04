'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Link from 'next/link';
import { Plus, Search, Mail, Phone, Briefcase, Pencil, ShieldCheck, UserX, UserCheck, FolderKanban, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AttendancePanel } from '@/components/attendance/AttendancePanel';

type TeamMember = {
    user_id: string;
    full_name: string | null;
    role: string | null;
    phone: string | null;
    email?: string;
    projects_count?: number;
    is_active?: boolean;
};

type ProjectMemberRow = {
    id: number;
    project_id: number;
    user_id: string;
    role: string;
    project_name?: string;
};

type ProjectRow = {
    project_id: number;
    project_name: string;
};

type LeaveRequest = {
    leave_id: number;
    user_id: string;
    start_date: string;
    end_date: string;
    leave_type: string;
    reason: string | null;
    status: string;
    approved_by: string | null;
    approved_at: string | null;
    created_at: string;
};

export default function TeamPage() {
    const [activeTab, setActiveTab] = useState<'members' | 'attendance' | 'leaves' | 'access'>('members');
    const [searchQuery, setSearchQuery] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);

    const [me, setMe] = useState<{ user_id: string; full_name: string | null; role: string | null; email: string | null } | null>(null);
    
    // Dialog states
    const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);
    const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [showResetPassword, setShowResetPassword] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [isResettingPassword, setIsResettingPassword] = useState(false);
    /** Login email from Auth (read-only in edit dialog); empty while loading or on error */
    const [memberEmailForEdit, setMemberEmailForEdit] = useState<string>('');
    
    // Form state
    const [memberForm, setMemberForm] = useState({
        email: '',
        password: '',
        full_name: '',
        role: 'SiteSupervisor',
        phone: '',
    });

    // Leaves overview (full list via API; personal actions live on /leaves)
    const [teamLeaves, setTeamLeaves] = useState<(LeaveRequest & { full_name?: string | null })[]>([]);
    const [leaveOverviewLoading, setLeaveOverviewLoading] = useState(false);
    const [leavePersonFilter, setLeavePersonFilter] = useState<string>('__all__');

    // Access management
    const [allProjects, setAllProjects] = useState<ProjectRow[]>([]);
    const [selectedMemberForAccess, setSelectedMemberForAccess] = useState<TeamMember | null>(null);
    const [memberProjectAccess, setMemberProjectAccess] = useState<ProjectMemberRow[]>([]);
    const [accessLoading, setAccessLoading] = useState(false);
    const [assignProjectId, setAssignProjectId] = useState('');
    const [assignRole, setAssignRole] = useState<'SiteSupervisor' | 'Client'>('SiteSupervisor');
    const [isSavingAccess, setIsSavingAccess] = useState(false);
    const [isAccessDialogOpen, setIsAccessDialogOpen] = useState(false);

    useEffect(() => {
        fetchTeamMembers();
        fetchAllProjects();
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const tab = new URLSearchParams(window.location.search).get('tab');
        if (tab === 'members' || tab === 'access' || tab === 'attendance' || tab === 'leaves') {
            setActiveTab(tab);
        }
    }, []);

    const fetchAllProjects = async () => {
        const { data } = await supabase
            .from('projects')
            .select('project_id, project_name')
            .order('project_name');
        setAllProjects(data || []);
    };

    const openAccessDialog = async (member: TeamMember) => {
        setSelectedMemberForAccess(member);
        setAssignProjectId('');
        setAssignRole(member.role === 'Client' ? 'Client' : 'SiteSupervisor');
        setIsAccessDialogOpen(true);
        setAccessLoading(true);

        const { data, error } = await supabase
            .from('project_members')
            .select('id, project_id, user_id, role')
            .eq('user_id', member.user_id);

        if (error) {
            toast.error('Failed to load access: ' + error.message);
            setAccessLoading(false);
            return;
        }

        // Fetch project names separately for reliability
        const rows = data || [];
        const projectIds = rows.map((r: any) => r.project_id);
        let projectNameMap: Record<number, string> = {};
        if (projectIds.length > 0) {
            const { data: projects } = await supabase
                .from('projects')
                .select('project_id, project_name')
                .in('project_id', projectIds);
            (projects || []).forEach((p: any) => {
                projectNameMap[p.project_id] = p.project_name;
            });
        }

        setMemberProjectAccess(rows.map((r: any) => ({
            id: r.id,
            project_id: r.project_id,
            user_id: r.user_id,
            role: r.role,
            project_name: projectNameMap[r.project_id] || `Project #${r.project_id}`,
        })));
        setAccessLoading(false);
    };

    const handleAssignProject = async () => {
        if (!selectedMemberForAccess || !assignProjectId) {
            toast.error('Please select a project');
            return;
        }
        setIsSavingAccess(true);
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase
            .from('project_members')
            .upsert({
                project_id: parseInt(assignProjectId),
                user_id: selectedMemberForAccess.user_id,
                role: assignRole,
                assigned_by: user?.id,
            }, { onConflict: 'project_id,user_id' });

        setIsSavingAccess(false);
        if (error) {
            toast.error('Failed to assign: ' + error.message);
        } else {
            toast.success('Project access granted');
            setAssignProjectId('');
            await openAccessDialog(selectedMemberForAccess);
        }
    };

    const handleRevokeProject = async (accessId: number) => {
        const { error } = await supabase
            .from('project_members')
            .delete()
            .eq('id', accessId);

        if (error) {
            toast.error('Failed to revoke: ' + error.message);
        } else {
            toast.success('Access revoked');
            if (selectedMemberForAccess) await openAccessDialog(selectedMemberForAccess);
        }
    };

    const handleToggleActive = async (member: TeamMember) => {
        const newStatus = !member.is_active;
        const { error } = await supabase
            .from('profiles')
            .update({ is_active: newStatus })
            .eq('user_id', member.user_id);

        if (error) {
            toast.error('Failed to update status: ' + error.message);
        } else {
            toast.success(`${member.full_name || 'Member'} marked as ${newStatus ? 'Active' : 'Inactive'}`);
            fetchTeamMembers();
            // Keep dialog in sync if open
            if (editingMember?.user_id === member.user_id) {
                setEditingMember({ ...editingMember, is_active: newStatus });
            }
        }
    };

    useEffect(() => {
        const loadMe = async () => {
            const { data: authData } = await supabase.auth.getUser();
            const user = authData?.user;
            if (!user) {
                setMe(null);
                return;
            }
            const { data: prof, error } = await supabase
                .from('profiles')
                .select('user_id, full_name, role')
                .eq('user_id', user.id)
                .limit(1);
            if (error) {
                console.error('Profile fetch error:', error);
                setMe({ user_id: user.id, full_name: null, role: null, email: user.email || null });
                return;
            }
            setMe({
                user_id: user.id,
                full_name: prof?.[0]?.full_name ?? null,
                role: prof?.[0]?.role ?? null,
                email: user.email || null,
            });
        };
        loadMe();
    }, []);

    const fetchTeamMembers = async () => {
        try {
            setLoading(true);
            // Fetch profiles
            const { data: profiles, error: profilesError } = await supabase
                .from('profiles')
                .select('user_id, full_name, role, phone, is_active')
                .order('full_name');

            if (profilesError) throw profilesError;

            // Fetch project counts for each user
            const membersWithProjects = await Promise.all(
                (profiles || []).map(async (profile) => {
                    const { count } = await supabase
                        .from('projects')
                        .select('*', { count: 'exact', head: true })
                        .eq('client_id', profile.user_id);

                    return {
                        ...profile,
                        email: '', // Email not available from profiles table
                        projects_count: count || 0,
                    };
                })
            );

            setTeamMembers(membersWithProjects);
        } catch (error) {
            console.error('Error fetching team members:', error);
            toast.error('Failed to load team members');
        } finally {
            setLoading(false);
        }
    };

    const loadTeamLeavesOverview = async () => {
        if (!me?.user_id) return;
        setLeaveOverviewLoading(true);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) return;
            const res = await fetch('/api/team/leaves', {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || 'Failed to load leaves');
            setTeamLeaves((json?.leaves || []) as (LeaveRequest & { full_name?: string | null })[]);
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to load leaves');
            setTeamLeaves([]);
        } finally {
            setLeaveOverviewLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab !== 'leaves') return;
        if (!me?.user_id) return;
        loadTeamLeavesOverview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, me?.user_id]);

    const handleSetLeaveStatus = async (leave_id: number, status: 'Approved' | 'Rejected') => {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not logged in');
            const res = await fetch('/api/team/leaves', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ leave_id, status }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || 'Failed to update leave');
            toast.success(`Leave ${status.toLowerCase()}`);
            await loadTeamLeavesOverview();
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to update leave');
        }
    };

    const filteredMembers = teamMembers.filter(member => {
        const matchesSearch =
            (member.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
            (member.role?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
            (member.email?.toLowerCase().includes(searchQuery.toLowerCase()) || false);
        const matchesStatus = showInactive ? true : member.is_active !== false;
        return matchesSearch && matchesStatus;
    });

    const getInitials = (name: string | null) => {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const handleNewMember = () => {
        setEditingMember(null);
        setMemberEmailForEdit('');
        setMemberForm({
            email: '',
            password: '',
            full_name: '',
            role: 'SiteSupervisor',
            phone: '',
        });
        setIsMemberDialogOpen(true);
    };

    const handleEditMember = async (member: TeamMember) => {
        setEditingMember(member);
        setMemberEmailForEdit('');
        setMemberForm({
            email: '',
            password: '', // Don't show password for edit
            full_name: member.full_name || '',
            role: member.role || 'SiteSupervisor',
            phone: member.phone || '',
        });
        setShowResetPassword(false);
        setNewPassword('');
        setIsMemberDialogOpen(true);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) {
                setMemberEmailForEdit('—');
                return;
            }
            const res = await fetch(`/api/team/members?user_id=${encodeURIComponent(member.user_id)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMemberEmailForEdit(json?.error ? String(json.error) : 'Unable to load email');
                return;
            }
            setMemberEmailForEdit(String(json?.email || '—'));
        } catch {
            setMemberEmailForEdit('Unable to load email');
        }
    };

    const handleResetPassword = async () => {
        if (!editingMember) return;
        if (!newPassword || newPassword.length < 6) {
            toast.error('Password must be at least 6 characters');
            return;
        }
        setIsResettingPassword(true);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not logged in');

            const res = await fetch('/api/team/members', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ user_id: editingMember.user_id, new_password: newPassword }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || 'Failed to reset password');

            toast.success(`Password reset for ${editingMember.full_name}. They have been logged out from all devices.`);
            setNewPassword('');
            setShowResetPassword(false);
        } catch (e: any) {
            toast.error(e?.message || 'Failed to reset password');
        } finally {
            setIsResettingPassword(false);
        }
    };

    const handleSaveMember = async () => {
        if (!memberForm.full_name.trim()) {
            toast.error('Full Name is required');
            return;
        }
        if (!editingMember) {
            if (!memberForm.email.trim()) {
                toast.error('Email is required for new members');
                return;
            }
            if (!memberForm.password) {
                toast.error('Password is required for new members');
                return;
            }
        }

        setIsSaving(true);
        try {
            if (editingMember) {
                // Update existing profile
                const { error } = await supabase
                    .from('profiles')
                    .update({
                        full_name: memberForm.full_name,
                        role: memberForm.role,
                        phone: memberForm.phone || null,
                    })
                    .eq('user_id', editingMember.user_id);

                if (error) throw error;
                toast.success('Team member updated successfully');
            } else {
                // Create new user without triggering Supabase email rate limits
                const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
                if (sessionError) throw sessionError;
                const token = sessionData?.session?.access_token;
                if (!token) throw new Error('You must be logged in to create a member');

                const res = await fetch('/api/team/members', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        email: memberForm.email,
                        password: memberForm.password,
                        full_name: memberForm.full_name,
                        role: memberForm.role,
                        phone: memberForm.phone,
                    }),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json?.error || 'Failed to create team member');
                }

                toast.success('Team member created successfully. No email was sent — share the credentials with them.');
            }

            setIsMemberDialogOpen(false);
            setShowResetPassword(false);
            setNewPassword('');
            fetchTeamMembers();
        } catch (error: any) {
            console.error('Error saving team member:', error);
            toast.error(error.message || 'Failed to save team member');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteMember = async (member: TeamMember) => {
        if (!confirm(`Are you sure you want to remove "${member.full_name || 'this member'}" from the team?`)) {
            return;
        }

        try {
            // Note: We can only delete the profile, not the auth user from client side
            // The auth user will remain but won't have a profile
            const { error } = await supabase
                .from('profiles')
                .delete()
                .eq('user_id', member.user_id);

            if (error) throw error;
            toast.success('Team member removed successfully');
            fetchTeamMembers();
        } catch (error: any) {
            console.error('Error deleting team member:', error);
            toast.error(error.message || 'Failed to remove team member');
        }
    };

    const stats = {
        total: teamMembers.length,
        active: teamMembers.filter(m => m.is_active !== false).length,
        inactive: teamMembers.filter(m => m.is_active === false).length,
        admins: teamMembers.filter(m => m.role === 'Admin' || m.role === 'ProjectManager').length,
    };

    const roleLower = String(me?.role || '').toLowerCase();
    const isManager = roleLower === 'admin' || roleLower === 'projectmanager';
    const filteredTeamLeaves = teamLeaves.filter(
        (l) => leavePersonFilter === '__all__' || l.user_id === leavePersonFilter
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Team</h2>
                    <p className="text-muted-foreground">Members, access, attendance and leave overviews</p>
                </div>
                {activeTab === 'members' ? (
                    <Button onClick={handleNewMember}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Member
                    </Button>
                ) : activeTab === 'leaves' ? (
                    <div className="flex gap-2">
                        <Button asChild variant="outline">
                            <Link href="/leaves">Open Leaves</Link>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={loadTeamLeavesOverview}>
                            Refresh
                        </Button>
                    </div>
                ) : null}
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                <TabsList className="w-full justify-start bg-transparent p-0 gap-2">
                    <TabsTrigger value="members">Members</TabsTrigger>
                    <TabsTrigger value="access">
                        <ShieldCheck className="h-4 w-4 mr-1" />
                        Access Management
                    </TabsTrigger>
                    <TabsTrigger value="attendance">Attendance</TabsTrigger>
                    <TabsTrigger value="leaves">Leaves</TabsTrigger>
                </TabsList>

                <TabsContent value="members" className="space-y-6">
                    {/* Stats */}
                    <div className="grid gap-4 md:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Members</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.total}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Active</CardTitle>
                                <Badge variant="default" className="bg-green-500">Active</Badge>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.active}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Inactive</CardTitle>
                                <Badge variant="secondary" className="bg-red-100 text-red-700">Inactive</Badge>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.inactive}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Admins / Managers</CardTitle>
                                <Briefcase className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.admins}</div>
                                <p className="text-xs text-muted-foreground mt-1">{stats.total - stats.admins} supervisors &amp; clients</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Search + Filter */}
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex gap-3 items-center">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        placeholder="Search team members by name or role..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-10"
                                    />
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowInactive(!showInactive)}
                                    className={showInactive
                                        ? 'border-red-400 text-red-700 bg-red-50 hover:bg-red-100'
                                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                                    }
                                >
                                    {showInactive ? (
                                        <><UserX className="h-4 w-4 mr-1" />Showing All</>
                                    ) : (
                                        <><UserCheck className="h-4 w-4 mr-1" />Active Only</>
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Team Grid */}
                    {loading ? (
                        <Card>
                            <CardContent className="py-8 text-center text-muted-foreground">
                                Loading team members...
                            </CardContent>
                        </Card>
                    ) : filteredMembers.length === 0 ? (
                        <Card>
                            <CardContent className="py-8 text-center text-muted-foreground">
                                {searchQuery ? 'No team members found matching your search.' : 'No team members found.'}
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {filteredMembers.map((member) => (
                                <Card key={member.user_id} className={`hover:shadow-md transition-shadow ${member.is_active === false ? 'opacity-60 border-dashed border-red-200' : ''}`}>
                                    <CardHeader>
                                        <div className="flex items-center gap-4">
                                            <Avatar>
                                                <AvatarImage src="" />
                                                <AvatarFallback>{getInitials(member.full_name)}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <CardTitle className="text-lg">{member.full_name || 'Unnamed User'}</CardTitle>
                                                <p className="text-sm text-muted-foreground">{member.role || 'No Role'}</p>
                                                {member.email && (
                                                    <p className="text-xs text-slate-400 truncate mt-0.5">{member.email}</p>
                                                )}
                                            </div>
                                            <Badge
                                                variant="default"
                                                className={member.is_active === false ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}
                                            >
                                                {member.is_active === false ? 'Inactive' : 'Active'}
                                            </Badge>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        {member.email && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <Mail className="h-4 w-4 text-muted-foreground" />
                                                <span className="text-muted-foreground">{member.email}</span>
                                            </div>
                                        )}
                                        {member.phone && (
                                            <div className="flex items-center gap-2 text-sm">
                                                <Phone className="h-4 w-4 text-muted-foreground" />
                                                <span className="text-muted-foreground">{member.phone}</span>
                                            </div>
                                        )}
                                        <div className="pt-2 border-t">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground">Projects</span>
                                                <span className="font-semibold">{member.projects_count || 0}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 pt-2 flex-wrap">
                                            <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEditMember(member)}>
                                                <Pencil className="mr-2 h-4 w-4" />
                                                Edit
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="flex-1"
                                                onClick={() => openAccessDialog(member)}
                                                title="Manage project access"
                                            >
                                                <FolderKanban className="mr-2 h-4 w-4" />
                                                Access
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className={`flex-1 ${member.is_active === false ? 'border-green-500 text-green-700 hover:bg-green-50' : 'border-orange-400 text-orange-600 hover:bg-orange-50'}`}
                                                onClick={() => handleToggleActive(member)}
                                            >
                                                {member.is_active === false
                                                    ? <><UserCheck className="mr-2 h-4 w-4" />Activate</>
                                                    : <><UserX className="mr-2 h-4 w-4" />Deactivate</>
                                                }
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}

                    {/* Add/Edit Member Dialog */}
                    <Dialog
                        open={isMemberDialogOpen}
                        onOpenChange={(open) => {
                            setIsMemberDialogOpen(open);
                            if (!open) {
                                setMemberEmailForEdit('');
                                setShowResetPassword(false);
                                setNewPassword('');
                            }
                        }}
                    >
                        <DialogContent className="max-w-lg bg-white">
                            <DialogHeader>
                                <DialogTitle className="text-lg font-semibold">
                                    {editingMember ? 'Edit Team Member' : 'Add Team Member'}
                                </DialogTitle>
                                <DialogDescription className="text-sm text-muted-foreground">
                                    {editingMember
                                        ? 'Update details for this team member.'
                                        : 'Create a new account. No email will be sent.'}
                                </DialogDescription>
                            </DialogHeader>

                            {/* Edit mode: show avatar + email header */}
                            {editingMember && (
                                <div className="flex items-center gap-3 px-1 py-2 bg-slate-50 rounded-lg border">
                                    <div className="h-11 w-11 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-base flex-shrink-0">
                                        {getInitials(editingMember.full_name)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-medium text-sm truncate">{editingMember.full_name}</p>
                                        {(memberEmailForEdit || editingMember.email) ? (
                                            <p className="text-xs text-muted-foreground truncate">
                                                {memberEmailForEdit || editingMember.email}
                                            </p>
                                        ) : (
                                            <p className="text-xs text-muted-foreground">Loading email…</p>
                                        )}
                                    </div>
                                    <Badge className={`ml-auto flex-shrink-0 ${editingMember.is_active === false ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                        {editingMember.is_active === false ? 'Inactive' : 'Active'}
                                    </Badge>
                                </div>
                            )}

                            <div className="space-y-4 py-2">
                                {/* Full Name */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="full_name">Full Name <span className="text-red-500">*</span></Label>
                                    <Input
                                        id="full_name"
                                        value={memberForm.full_name}
                                        onChange={(e) => setMemberForm({ ...memberForm, full_name: e.target.value })}
                                        placeholder="e.g. Ravi Kumar"
                                    />
                                </div>

                                {editingMember && (
                                    <div className="space-y-1.5">
                                        <Label htmlFor="member_email_readonly">Email</Label>
                                        <Input
                                            id="member_email_readonly"
                                            type="email"
                                            readOnly
                                            className="bg-slate-50 text-slate-700 cursor-default"
                                            value={memberEmailForEdit === '' ? 'Loading email…' : memberEmailForEdit}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Login email (from account). It cannot be changed here — contact support or recreate the user if needed.
                                        </p>
                                    </div>
                                )}

                                {/* Email — only for new member */}
                                {!editingMember && (
                                    <div className="space-y-1.5">
                                        <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            value={memberForm.email}
                                            onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })}
                                            placeholder="e.g. ravi@company.com"
                                        />
                                    </div>
                                )}

                                {/* Password — only for new member */}
                                {!editingMember && (
                                    <div className="space-y-1.5">
                                        <Label htmlFor="password">Password <span className="text-red-500">*</span></Label>
                                        <Input
                                            id="password"
                                            type="password"
                                            value={memberForm.password}
                                            onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })}
                                            placeholder="Minimum 6 characters"
                                        />
                                        <p className="text-xs text-muted-foreground">Share this with the member — they can change it after logging in.</p>
                                    </div>
                                )}

                                {/* Role + Phone side by side */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="role">Role <span className="text-red-500">*</span></Label>
                                        <Select value={memberForm.role} onValueChange={(value) => setMemberForm({ ...memberForm, role: value })}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                                <SelectItem value="Admin" className="bg-white hover:bg-gray-100">Admin</SelectItem>
                                                <SelectItem value="SiteSupervisor" className="bg-white hover:bg-gray-100">Site Supervisor</SelectItem>
                                                <SelectItem value="Client" className="bg-white hover:bg-gray-100">Client</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="phone">Phone</Label>
                                        <Input
                                            id="phone"
                                            type="tel"
                                            value={memberForm.phone}
                                            onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })}
                                            placeholder="+91 98765 43210"
                                        />
                                    </div>
                                </div>

                                {/* Active / Inactive + Reset Password — edit mode only */}
                                {editingMember && (
                                    <div className="space-y-3">
                                        {/* Account status */}
                                        <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-slate-50">
                                            <div>
                                                <p className="text-sm font-medium">Account Status</p>
                                                <p className="text-xs text-muted-foreground">Inactive members cannot log in</p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleToggleActive(editingMember)}
                                                className={editingMember.is_active === false
                                                    ? 'border-green-500 text-green-700 hover:bg-green-50'
                                                    : 'border-orange-400 text-orange-600 hover:bg-orange-50'
                                                }
                                            >
                                                {editingMember.is_active === false
                                                    ? <><UserCheck className="mr-2 h-4 w-4" />Activate</>
                                                    : <><UserX className="mr-2 h-4 w-4" />Deactivate</>
                                                }
                                            </Button>
                                        </div>

                                        {/* Reset Password */}
                                        <div className="rounded-lg border px-4 py-3 bg-slate-50 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-medium">Reset Password</p>
                                                    <p className="text-xs text-muted-foreground">Logs them out from all devices instantly</p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => { setShowResetPassword(!showResetPassword); setNewPassword(''); }}
                                                    className="border-slate-400 text-slate-600 hover:bg-slate-100"
                                                >
                                                    {showResetPassword ? 'Cancel' : 'Reset Password'}
                                                </Button>
                                            </div>
                                            {showResetPassword && (
                                                <div className="flex gap-2 items-center pt-1">
                                                    <Input
                                                        type="password"
                                                        placeholder="New password (min 6 chars)"
                                                        value={newPassword}
                                                        onChange={(e) => setNewPassword(e.target.value)}
                                                        className="bg-white flex-1"
                                                    />
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        onClick={handleResetPassword}
                                                        disabled={isResettingPassword || newPassword.length < 6}
                                                        className="bg-red-600 hover:bg-red-700 text-white flex-shrink-0"
                                                    >
                                                        {isResettingPassword ? 'Resetting...' : 'Confirm Reset'}
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="gap-2">
                                <Button variant="outline" onClick={() => setIsMemberDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleSaveMember} disabled={isSaving}>
                                    {isSaving ? 'Saving...' : editingMember ? 'Save Changes' : 'Create Member'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>

                {/* ── Access Management Tab ── */}
                <TabsContent value="access" className="space-y-6">
                    <Card>
                        <CardHeader className="border-b bg-slate-50">
                            <CardTitle className="flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-blue-600" />
                                Access Management
                            </CardTitle>
                            <p className="text-sm text-slate-500 mt-1">
                                Assign or revoke project access for Site Supervisors and Clients.
                                Click a member row to manage their access.
                            </p>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y">
                                {teamMembers
                                    .filter(m => m.role === 'SiteSupervisor' || m.role === 'Client')
                                    .map(member => (
                                        <div
                                            key={member.user_id}
                                            className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer"
                                            onClick={() => openAccessDialog(member)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Avatar>
                                                    <AvatarFallback>{getInitials(member.full_name)}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="font-semibold text-slate-900">{member.full_name || 'Unnamed'}</p>
                                                    <p className="text-xs text-slate-500">{member.role}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Badge className={member.is_active === false ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                                                    {member.is_active === false ? 'Inactive' : 'Active'}
                                                </Badge>
                                                <Button size="sm" variant="outline">
                                                    <FolderKanban className="h-4 w-4 mr-1" />
                                                    Manage Access
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                {teamMembers.filter(m => m.role === 'SiteSupervisor' || m.role === 'Client').length === 0 && (
                                    <div className="p-8 text-center text-slate-500 text-sm">
                                        No Site Supervisors or Clients found. Add team members with these roles first.
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Access Dialog ── */}
                <Dialog open={isAccessDialogOpen} onOpenChange={setIsAccessDialogOpen}>
                    <DialogContent className="bg-white max-w-2xl">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-blue-600" />
                                Project Access — {selectedMemberForAccess?.full_name}
                            </DialogTitle>
                            <DialogDescription>
                                {selectedMemberForAccess?.role} · Assign or revoke project access below.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-2">
                            {/* Assign new project */}
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                                <p className="text-sm font-semibold text-blue-900">Grant Project Access</p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="space-y-1 md:col-span-1">
                                        <Label className="text-xs">Access Role</Label>
                                        <Select value={assignRole} onValueChange={(v) => setAssignRole(v as 'SiteSupervisor' | 'Client')}>
                                            <SelectTrigger className="bg-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white">
                                                <SelectItem value="SiteSupervisor">Site Supervisor</SelectItem>
                                                <SelectItem value="Client">Client</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1 md:col-span-1">
                                        <Label className="text-xs">Project</Label>
                                        <Select value={assignProjectId} onValueChange={setAssignProjectId}>
                                            <SelectTrigger className="bg-white">
                                                <SelectValue placeholder="Select project..." />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white">
                                                {allProjects
                                                    .filter(p => !memberProjectAccess.some(a => a.project_id === p.project_id))
                                                    .map(p => (
                                                        <SelectItem key={p.project_id} value={p.project_id.toString()}>
                                                            {p.project_name}
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex items-end">
                                        <Button
                                            onClick={handleAssignProject}
                                            disabled={isSavingAccess || !assignProjectId}
                                            className="bg-blue-600 hover:bg-blue-700 w-full"
                                        >
                                            {isSavingAccess ? 'Saving...' : 'Grant Access'}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Current access list */}
                            <div>
                                <p className="text-sm font-semibold text-slate-700 mb-2">Current Project Access</p>
                                {accessLoading ? (
                                    <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
                                ) : memberProjectAccess.length === 0 ? (
                                    <p className="text-sm text-slate-400 py-4 text-center">No projects assigned yet.</p>
                                ) : (
                                    <div className="divide-y border rounded-lg">
                                        {memberProjectAccess.map(access => (
                                            <div key={access.id} className="flex items-center justify-between p-3 hover:bg-slate-50">
                                                <div>
                                                    <p className="font-medium text-slate-900">{access.project_name || `Project #${access.project_id}`}</p>
                                                    <Badge className="mt-1 text-xs bg-blue-100 text-blue-700">
                                                        {access.role === 'SiteSupervisor' ? 'Site Supervisor' : 'Client'}
                                                    </Badge>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleRevokeProject(access.id)}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                >
                                                    <X className="h-4 w-4 mr-1" />
                                                    Revoke
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                <TabsContent value="attendance" className="space-y-6">
                    <AttendancePanel
                        me={me}
                        nameDirectory={teamMembers.map((m) => ({ user_id: m.user_id, full_name: m.full_name }))}
                        showAdminReport
                        mode="team-overview"
                    />
                </TabsContent>

                <TabsContent value="leaves" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Leave overview</CardTitle>
                            <p className="text-sm text-muted-foreground">
                                {isManager
                                    ? 'All team leave records loaded from the server. Filter by person to review one employee. Approve or reject pending rows here.'
                                    : 'Your leave records (same data as the Leaves page). Use Leaves to submit new requests or manage cancellations.'}
                            </p>
                        </CardHeader>
                        <CardContent className="flex flex-wrap gap-2">
                            <Button asChild variant="default">
                                <Link href="/leaves">Go to Leaves</Link>
                            </Button>
                        </CardContent>
                    </Card>

                    {isManager && (
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex flex-wrap items-end gap-3">
                                    <div className="space-y-1 min-w-[200px]">
                                        <Label className="text-xs">Person</Label>
                                        <Select
                                            value={leavePersonFilter}
                                            onValueChange={setLeavePersonFilter}
                                        >
                                            <SelectTrigger className="bg-white w-[240px]">
                                                <SelectValue placeholder="Everyone" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white">
                                                <SelectItem value="__all__">Everyone</SelectItem>
                                                {teamMembers
                                                    .slice()
                                                    .sort((a, b) =>
                                                        String(a.full_name || a.user_id).localeCompare(String(b.full_name || b.user_id))
                                                    )
                                                    .map((m) => (
                                                        <SelectItem key={m.user_id} value={m.user_id}>
                                                            {m.full_name || m.user_id.slice(0, 8) + '…'}
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Records</CardTitle>
                            <Button variant="ghost" size="sm" onClick={loadTeamLeavesOverview}>
                                Refresh
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {leaveOverviewLoading ? (
                                <div className="text-sm text-muted-foreground">Loading…</div>
                            ) : filteredTeamLeaves.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No leave records in this view.</div>
                            ) : (
                                <div className="overflow-x-auto max-h-[480px] overflow-y-auto border rounded-md">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                {isManager && <TableHead>Person</TableHead>}
                                                <TableHead>Dates</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Reason</TableHead>
                                                {isManager && <TableHead className="text-right">Actions</TableHead>}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredTeamLeaves.map((l) => (
                                                <TableRow key={l.leave_id}>
                                                    {isManager && (
                                                        <TableCell className="font-medium whitespace-nowrap">
                                                            {l.full_name || l.user_id.slice(0, 8) + '…'}
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="font-medium whitespace-nowrap">
                                                        {l.start_date} → {l.end_date}
                                                    </TableCell>
                                                    <TableCell>{l.leave_type}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="secondary">{l.status}</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground text-sm max-w-[240px] truncate" title={l.reason || ''}>
                                                        {l.reason || '—'}
                                                    </TableCell>
                                                    {isManager && (
                                                        <TableCell className="text-right">
                                                            {l.status === 'Pending' ? (
                                                                <div className="flex justify-end gap-2">
                                                                    <Button size="sm" onClick={() => handleSetLeaveStatus(l.leave_id, 'Approved')}>
                                                                        Approve
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => handleSetLeaveStatus(l.leave_id, 'Rejected')}
                                                                    >
                                                                        Reject
                                                                    </Button>
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground">—</span>
                                                            )}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

