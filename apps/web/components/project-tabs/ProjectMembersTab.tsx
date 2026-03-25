'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { UserPlus, UserMinus, Users } from 'lucide-react';
import { useRole } from '@/hooks/useRole';

interface Profile {
    user_id: string;
    full_name: string | null;
    role: string | null;
    phone: string | null;
}

interface ProjectMember {
    id: number;
    user_id: string;
    role: string;
    assigned_at: string;
    full_name: string | null;
    profile_role: string | null;
}

interface Props {
    projectId: string;
}

export default function ProjectMembersTab({ projectId }: Props) {
    const { canManage } = useRole();
    const [members, setMembers] = useState<ProjectMember[]>([]);
    const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [selectedRole, setSelectedRole] = useState<'SiteSupervisor' | 'Client'>('SiteSupervisor');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchMembers();
        if (canManage) fetchProfiles();
    }, [projectId, canManage]);

    const fetchMembers = async () => {
        setLoading(true);

        // Step 1: fetch project_members rows
        const { data: pmRows, error } = await supabase
            .from('project_members')
            .select('id, user_id, role, assigned_at')
            .eq('project_id', projectId)
            .order('assigned_at', { ascending: false });

        if (error) {
            toast.error('Failed to load members: ' + error.message);
            setLoading(false);
            return;
        }

        const rows = pmRows || [];
        if (rows.length === 0) { setMembers([]); setLoading(false); return; }

        // Step 2: fetch profiles for those user IDs separately
        const userIds = rows.map((r: any) => r.user_id);
        const { data: profileRows } = await supabase
            .from('profiles')
            .select('user_id, full_name, role')
            .in('user_id', userIds);

        const profileMap: Record<string, { full_name: string | null; role: string | null }> = {};
        (profileRows || []).forEach((p: any) => { profileMap[p.user_id] = { full_name: p.full_name, role: p.role }; });

        setMembers(rows.map((m: any) => ({
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            assigned_at: m.assigned_at,
            full_name: profileMap[m.user_id]?.full_name ?? null,
            profile_role: profileMap[m.user_id]?.role ?? null,
        })));

        setLoading(false);
    };

    const fetchProfiles = async () => {
        const { data, error } = await supabase
            .from('profiles')
            .select('user_id, full_name, role, phone')
            .in('role', ['SiteSupervisor', 'Client'])
            .order('full_name');

        if (!error) setAllProfiles(data || []);
    };

    const handleAssign = async () => {
        if (!selectedUserId) {
            toast.error('Please select a user');
            return;
        }

        setSaving(true);
        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase
            .from('project_members')
            .upsert({
                project_id: parseInt(projectId),
                user_id: selectedUserId,
                role: selectedRole,
                assigned_by: user?.id,
            }, { onConflict: 'project_id,user_id' });

        setSaving(false);

        if (error) {
            toast.error('Failed to assign member: ' + error.message);
        } else {
            toast.success('Member assigned successfully');
            setSelectedUserId('');
            fetchMembers();
        }
    };

    const handleRemove = async (memberId: number, fullName: string | null) => {
        if (!confirm(`Remove ${fullName || 'this member'} from the project?`)) return;

        const { error } = await supabase
            .from('project_members')
            .delete()
            .eq('id', memberId);

        if (error) {
            toast.error('Failed to remove member: ' + error.message);
        } else {
            toast.success('Member removed');
            fetchMembers();
        }
    };

    const assignedUserIds = new Set(members.map(m => m.user_id));
    const availableProfiles = allProfiles.filter(p => !assignedUserIds.has(p.user_id));

    const roleBadgeClass = (role: string) =>
        role === 'SiteSupervisor'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-purple-100 text-purple-700';

    return (
        <Card className="bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50">
                <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-600" />
                    Project Members
                </CardTitle>
                <p className="text-sm text-slate-500 mt-1">
                    Supervisors and Clients assigned to this project.
                </p>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">

                {/* Assign form — admin only */}
                {canManage && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                        <p className="text-sm font-semibold text-blue-900">Assign a Member</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="space-y-1 md:col-span-1">
                                <Label className="text-xs text-slate-600">Role</Label>
                                <Select
                                    value={selectedRole}
                                    onValueChange={(v) => setSelectedRole(v as 'SiteSupervisor' | 'Client')}
                                >
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
                                <Label className="text-xs text-slate-600">User</Label>
                                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                    <SelectTrigger className="bg-white">
                                        <SelectValue placeholder="Select user..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white">
                                        {availableProfiles
                                            .filter(p => p.role === selectedRole)
                                            .map(p => (
                                                <SelectItem key={p.user_id} value={p.user_id}>
                                                    {p.full_name || p.user_id}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-end">
                                <Button
                                    onClick={handleAssign}
                                    disabled={saving || !selectedUserId}
                                    className="bg-blue-600 hover:bg-blue-700 w-full"
                                >
                                    <UserPlus className="h-4 w-4 mr-2" />
                                    {saving ? 'Assigning...' : 'Assign'}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Member list */}
                {loading ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Loading members...</p>
                ) : members.length === 0 ? (
                    <p className="text-sm text-slate-500 py-8 text-center">
                        No members assigned yet.
                        {canManage && ' Use the form above to assign supervisors or clients.'}
                    </p>
                ) : (
                    <div className="divide-y rounded-lg border">
                        {members.map((member) => (
                            <div key={member.id} className="flex items-center justify-between p-3 hover:bg-slate-50">
                                <div>
                                    <p className="font-medium text-slate-900">{member.full_name || member.user_id}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Badge className={`text-xs ${roleBadgeClass(member.role)}`}>
                                            {member.role === 'SiteSupervisor' ? 'Site Supervisor' : 'Client'}
                                        </Badge>
                                        <span className="text-xs text-slate-400">
                                            Assigned {new Date(member.assigned_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                                {canManage && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemove(member.id, member.full_name)}
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    >
                                        <UserMinus className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
