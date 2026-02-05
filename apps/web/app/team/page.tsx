'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Plus, Mail, Phone, MapPin, Briefcase, Pencil, Trash } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type TeamMember = {
    user_id: string;
    full_name: string | null;
    role: string | null;
    phone: string | null;
    email?: string;
    projects_count?: number;
};

export default function TeamPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Dialog states
    const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);
    const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    
    // Form state
    const [memberForm, setMemberForm] = useState({
        email: '',
        password: '',
        full_name: '',
        role: 'SiteSupervisor',
        phone: '',
    });

    useEffect(() => {
        fetchTeamMembers();
    }, []);

    const fetchTeamMembers = async () => {
        try {
            setLoading(true);
            // Fetch profiles
            const { data: profiles, error: profilesError } = await supabase
                .from('profiles')
                .select('user_id, full_name, role, phone')
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

    const filteredMembers = teamMembers.filter(member =>
        (member.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
        (member.role?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
        (member.email?.toLowerCase().includes(searchQuery.toLowerCase()) || false)
    );

    const getInitials = (name: string | null) => {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const handleNewMember = () => {
        setEditingMember(null);
        setMemberForm({
            email: '',
            password: '',
            full_name: '',
            role: 'SiteSupervisor',
            phone: '',
        });
        setIsMemberDialogOpen(true);
    };

    const handleEditMember = (member: TeamMember) => {
        setEditingMember(member);
        setMemberForm({
            email: '',
            password: '', // Don't show password for edit
            full_name: member.full_name || '',
            role: member.role || 'SiteSupervisor',
            phone: member.phone || '',
        });
        setIsMemberDialogOpen(true);
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
        active: teamMembers.length, // All profiles are considered active
        onLeave: 0, // Not tracked in current schema
        totalProjects: teamMembers.reduce((sum, m) => sum + (m.projects_count || 0), 0),
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Team</h2>
                    <p className="text-muted-foreground">Manage your team members and their assignments</p>
                </div>
                <Button onClick={handleNewMember}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Member
                </Button>
            </div>

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
                        <CardTitle className="text-sm font-medium">On Leave</CardTitle>
                        <Badge variant="secondary">On Leave</Badge>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.onLeave}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalProjects}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Search */}
            <Card>
                <CardContent className="pt-6">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search team members by name, role, or email..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
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
                        <Card key={member.user_id} className="hover:shadow-md transition-shadow">
                            <CardHeader>
                                <div className="flex items-center gap-4">
                                    <Avatar>
                                        <AvatarImage src="" />
                                        <AvatarFallback>{getInitials(member.full_name)}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1">
                                        <CardTitle className="text-lg">{member.full_name || 'Unnamed User'}</CardTitle>
                                        <p className="text-sm text-muted-foreground">{member.role || 'No Role'}</p>
                                    </div>
                                    <Badge variant="default">Active</Badge>
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
                                <div className="flex gap-2 pt-2">
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEditMember(member)}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        Edit
                                    </Button>
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handleDeleteMember(member)}>
                                        <Trash className="mr-2 h-4 w-4" />
                                        Remove
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Add/Edit Member Dialog */}
            <Dialog open={isMemberDialogOpen} onOpenChange={setIsMemberDialogOpen}>
                <DialogContent className="max-w-2xl bg-white">
                    <DialogHeader>
                        <DialogTitle>{editingMember ? 'Edit Team Member' : 'Add Team Member'}</DialogTitle>
                        <DialogDescription>
                            {editingMember 
                                ? 'Update team member information' 
                                : 'Create a new team member account. No email will be sent (avoids Supabase email rate limits).'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="full_name">Full Name *</Label>
                                <Input
                                    id="full_name"
                                    value={memberForm.full_name}
                                    onChange={(e) => setMemberForm({ ...memberForm, full_name: e.target.value })}
                                    placeholder="John Doe"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email *</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={memberForm.email}
                                    onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })}
                                    placeholder="john@example.com"
                                    disabled={!!editingMember} // Can't change email for existing members
                                />
                            </div>
                        </div>
                        {!editingMember && (
                            <div className="space-y-2">
                                <Label htmlFor="password">Password *</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={memberForm.password}
                                    onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })}
                                    placeholder="Minimum 6 characters"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Share this password with the member. They can change it after logging in.
                                </p>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="role">Role *</Label>
                                <Select value={memberForm.role} onValueChange={(value) => setMemberForm({ ...memberForm, role: value })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                        <SelectItem value="Admin" className="bg-white hover:bg-gray-100">Admin</SelectItem>
                                        <SelectItem value="ProjectManager" className="bg-white hover:bg-gray-100">Project Manager</SelectItem>
                                        <SelectItem value="SiteSupervisor" className="bg-white hover:bg-gray-100">Site Supervisor</SelectItem>
                                        <SelectItem value="Client" className="bg-white hover:bg-gray-100">Client</SelectItem>
                                        <SelectItem value="Vendor" className="bg-white hover:bg-gray-100">Vendor</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">Phone</Label>
                                <Input
                                    id="phone"
                                    type="tel"
                                    value={memberForm.phone}
                                    onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })}
                                    placeholder="+1 (555) 123-4567"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsMemberDialogOpen(false)}>
                            Cancel
                        </Button>
                        {editingMember && (
                            <Button variant="outline" onClick={() => handleDeleteMember(editingMember)}>
                                <Trash className="mr-2 h-4 w-4" />
                                Remove
                            </Button>
                        )}
                        <Button onClick={handleSaveMember} disabled={isSaving}>
                            {isSaving ? 'Saving...' : editingMember ? 'Update Member' : 'Create Member'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

