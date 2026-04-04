'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
    Plus, CheckCircle2, XCircle, Clock, CalendarDays,
    User, Trash2, RotateCcw, ChevronRight, Palmtree
} from 'lucide-react';

type LeaveRequest = {
    leave_id: number;
    user_id: string;
    full_name: string | null;
    start_date: string;
    end_date: string;
    leave_type: string;
    reason: string | null;
    status: string;
    approved_at: string | null;
    created_at: string;
};

type TeamMember = { user_id: string; full_name: string | null; role: string };

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Emergency Leave', 'Annual Leave', 'Other'];

function diffDays(start: string, end: string) {
    return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
}

function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateShort(d: string) {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    Pending:                  { label: 'Pending',                cls: 'bg-amber-100 text-amber-700 border-amber-200',   icon: <Clock className="h-3.5 w-3.5" /> },
    Approved:                 { label: 'Approved',               cls: 'bg-green-100 text-green-700 border-green-200',   icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    Rejected:                 { label: 'Rejected',               cls: 'bg-red-100 text-red-700 border-red-200',          icon: <XCircle className="h-3.5 w-3.5" /> },
    'Cancellation Requested': { label: 'Cancellation Requested', cls: 'bg-orange-100 text-orange-700 border-orange-200', icon: <RotateCcw className="h-3.5 w-3.5" /> },
    Cancelled:                { label: 'Cancelled',              cls: 'bg-slate-100 text-slate-500 border-slate-200',    icon: <XCircle className="h-3.5 w-3.5" /> },
};

const BORDER_COLOR: Record<string, string> = {
    Pending:                  'border-l-amber-400',
    Approved:                 'border-l-green-500',
    Rejected:                 'border-l-red-400',
    'Cancellation Requested': 'border-l-orange-400',
    Cancelled:                'border-l-slate-300',
};

type AdminView = 'all' | 'pending' | 'approved' | 'rejected' | 'cancellation' | 'cancelled';

type WeeklyOffSubject = 'profile' | 'labour';

type FieldStaffOption = { id: number; name: string };

/** 0 = Sunday … 6 = Saturday (same as JS Date.getDay()) */
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

type LeaveBalance = { accrued_days: number; used_days: number; available_days: number };

function calcLeaveBalance(profileCreatedAt: string, approvedLeaves: LeaveRequest[]): LeaveBalance {
    const floor = new Date('2025-01-01');
    const joined = new Date(profileCreatedAt);
    const start = joined > floor ? joined : floor;
    const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    const nowMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const months = Math.max(1,
        (nowMonth.getFullYear() - startMonth.getFullYear()) * 12 +
        (nowMonth.getMonth() - startMonth.getMonth()) + 1
    );
    const accrued = months;
    const used = approvedLeaves.reduce((sum, l) => {
        const s = new Date(l.start_date);
        const e = new Date(l.end_date);
        return sum + Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    }, 0);
    return { accrued_days: accrued, used_days: used, available_days: Math.max(0, accrued - used) };
}

export default function LeavesPage() {
    const [role, setRole] = useState('');
    const [myUserId, setMyUserId] = useState('');
    const [profileCreatedAt, setProfileCreatedAt] = useState('');
    const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [token, setToken] = useState('');
    const [activeTab, setActiveTab] = useState<'my' | 'manage' | 'weekly-off'>('my');
    const [adminFilter, setAdminFilter] = useState<AdminView>('all');

    const [woSubjectType, setWoSubjectType] = useState<WeeklyOffSubject>('profile');
    const [woProfileUserId, setWoProfileUserId] = useState('');
    const [woLabourId, setWoLabourId] = useState('');
    const [woFieldStaff, setWoFieldStaff] = useState<FieldStaffOption[]>([]);
    const [woDays, setWoDays] = useState<Set<number>>(new Set());
    const [woLoadingList, setWoLoadingList] = useState(false);
    const [woLoadingDays, setWoLoadingDays] = useState(false);
    const [woSaving, setWoSaving] = useState(false);

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [form, setForm] = useState({
        target_user_id: '', start_date: '', end_date: '',
        leave_type: 'Casual Leave', reason: '', auto_approve: false,
    });

    const isAdmin = role === 'Admin' || role === 'ProjectManager';

    useEffect(() => { init(); }, []);

    const init = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: session } = await supabase.auth.getSession();
        const t = session?.session?.access_token || '';
        setToken(t);
        setMyUserId(user.id);
        const { data: profile } = await supabase.from('profiles').select('role, created_at').eq('user_id', user.id).single();
        const r = profile?.role || '';
        setRole(r);
        setProfileCreatedAt(profile?.created_at || new Date().toISOString());
        await Promise.all([
            fetchLeaves(t),
            ...(r === 'Admin' || r === 'ProjectManager' ? [fetchTeamMembers()] : []),
        ]);
        setLoading(false);
    };

    const fetchWeeklyOffFieldStaff = async () => {
        setWoLoadingList(true);
        try {
            const { data: pm, error: pmErr } = await supabase
                .from('project_manpower')
                .select('labour_id')
                .not('labour_id', 'is', null);
            if (pmErr) throw pmErr;
            const ids = Array.from(
                new Set(
                    (pm || [])
                        .map((r: { labour_id: number | null }) => r.labour_id)
                        .filter((id): id is number => typeof id === 'number')
                )
            );
            if (ids.length === 0) {
                setWoFieldStaff([]);
                return;
            }
            const { data: lm, error: lmErr } = await supabase
                .from('labour_master')
                .select('id, name')
                .in('id', ids)
                .eq('is_active', true)
                .order('name');
            if (lmErr) throw lmErr;
            setWoFieldStaff((lm as FieldStaffOption[]) || []);
        } catch (e: unknown) {
            console.error(e);
            toast.error(e instanceof Error ? e.message : 'Failed to load field staff');
            setWoFieldStaff([]);
        } finally {
            setWoLoadingList(false);
        }
    };

    useEffect(() => {
        if (activeTab !== 'weekly-off' || !isAdmin) return;
        void fetchWeeklyOffFieldStaff();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, isAdmin]);

    useEffect(() => {
        if (activeTab !== 'weekly-off' || !isAdmin) return;
        let cancelled = false;
        (async () => {
            if (woSubjectType === 'profile' && !woProfileUserId) {
                setWoDays(new Set());
                setWoLoadingDays(false);
                return;
            }
            if (woSubjectType === 'labour' && !woLabourId) {
                setWoDays(new Set());
                setWoLoadingDays(false);
                return;
            }
            setWoLoadingDays(true);
            try {
                if (woSubjectType === 'profile') {
                    const { data, error } = await supabase
                        .from('weekly_offs')
                        .select('day_of_week')
                        .eq('profile_user_id', woProfileUserId);
                    if (error) throw error;
                    if (!cancelled) setWoDays(new Set((data || []).map((r: { day_of_week: number }) => r.day_of_week)));
                } else {
                    const { data, error } = await supabase
                        .from('weekly_offs')
                        .select('day_of_week')
                        .eq('labour_id', Number(woLabourId));
                    if (error) throw error;
                    if (!cancelled) setWoDays(new Set((data || []).map((r: { day_of_week: number }) => r.day_of_week)));
                }
            } catch (e: unknown) {
                if (!cancelled) {
                    console.error(e);
                    toast.error(e instanceof Error ? e.message : 'Failed to load weekly offs');
                    setWoDays(new Set());
                }
            } finally {
                if (!cancelled) setWoLoadingDays(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [activeTab, isAdmin, woSubjectType, woProfileUserId, woLabourId]);

    const toggleWoDay = (d: number) => {
        setWoDays((prev) => {
            const next = new Set(prev);
            if (next.has(d)) next.delete(d);
            else next.add(d);
            return next;
        });
    };

    const handleSaveWeeklyOffs = async () => {
        if (!myUserId) return;
        if (woSubjectType === 'profile' && !woProfileUserId) {
            toast.error('Select a team member');
            return;
        }
        if (woSubjectType === 'labour' && !woLabourId) {
            toast.error('Select a field staff member');
            return;
        }
        setWoSaving(true);
        try {
            if (woSubjectType === 'profile') {
                const { error: delErr } = await supabase.from('weekly_offs').delete().eq('profile_user_id', woProfileUserId);
                if (delErr) throw delErr;
                if (woDays.size > 0) {
                    const rows = Array.from(woDays).map((day_of_week) => ({
                        profile_user_id: woProfileUserId,
                        day_of_week,
                        created_by: myUserId,
                    }));
                    const { error: insErr } = await supabase.from('weekly_offs').insert(rows);
                    if (insErr) throw insErr;
                }
            } else {
                const lid = Number(woLabourId);
                const { error: delErr } = await supabase.from('weekly_offs').delete().eq('labour_id', lid);
                if (delErr) throw delErr;
                if (woDays.size > 0) {
                    const rows = Array.from(woDays).map((day_of_week) => ({
                        labour_id: lid,
                        day_of_week,
                        created_by: myUserId,
                    }));
                    const { error: insErr } = await supabase.from('weekly_offs').insert(rows);
                    if (insErr) throw insErr;
                }
            }
            toast.success('Weekly off days saved');
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Failed to save');
        } finally {
            setWoSaving(false);
        }
    };

    const fetchLeaves = async (t: string) => {
        const res = await fetch('/api/team/leaves', { headers: { Authorization: `Bearer ${t}` } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(json?.error || 'Failed to load leaves'); return; }
        setAllLeaves(json.leaves || []);
    };

    const fetchTeamMembers = async () => {
        const { data } = await supabase.from('profiles').select('user_id, full_name, role')
            .neq('role', 'Client').eq('is_active', true).order('full_name');
        setTeamMembers((data || []) as TeamMember[]);
    };

    const openApplyDialog = (forUserId?: string) => {
        setForm({ target_user_id: forUserId || myUserId, start_date: '', end_date: '', leave_type: 'Casual Leave', reason: '', auto_approve: false });
        setIsDialogOpen(true);
    };

    const handleSubmit = async () => {
        if (!form.start_date || !form.end_date) { toast.error('Select start and end dates'); return; }
        if (new Date(form.end_date) < new Date(form.start_date)) { toast.error('End date must be after start date'); return; }
        setIsSaving(true);
        try {
            const res = await fetch('/api/team/leaves', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(form),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || 'Failed to submit');
            toast.success(form.auto_approve ? 'Leave raised and approved' : 'Leave request submitted');
            setIsDialogOpen(false);
            await fetchLeaves(token);
        } catch (e: any) { toast.error(e.message); }
        finally { setIsSaving(false); }
    };

    const handleStatusChange = async (leave_id: number, status: 'Approved' | 'Rejected') => {
        const res = await fetch('/api/team/leaves', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ leave_id, status }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(json?.error || 'Failed'); return; }
        toast.success(`Leave ${status.toLowerCase()}`);
        await fetchLeaves(token);
    };

    // User cancels own pending leave — soft cancel (keeps history)
    const handleRevoke = async (leave_id: number) => {
        const res = await fetch(`/api/team/leaves?leave_id=${leave_id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(json?.error || 'Failed to revoke'); return; }
        toast.success('Leave request cancelled');
        await fetchLeaves(token);
    };

    // Admin hard delete — permanently removes record
    const handleAdminDelete = async (leave_id: number) => {
        if (!confirm('Permanently delete this leave record?')) return;
        const res = await fetch(`/api/team/leaves?leave_id=${leave_id}&force=true`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(json?.error || 'Failed to delete'); return; }
        toast.success('Leave record deleted');
        await fetchLeaves(token);
    };

    const handleRequestCancellation = async (leave_id: number) => {
        if (!confirm('Request cancellation of this approved leave? Admin will need to approve it.')) return;
        const res = await fetch('/api/team/leaves', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ leave_id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(json?.error || 'Failed'); return; }
        toast.success('Cancellation request sent to admin');
        await fetchLeaves(token);
    };

    const myLeaves = allLeaves.filter(l => l.user_id === myUserId);
    const myApprovedLeaves = myLeaves.filter(l => l.status === 'Approved');
    const leaveBalance: LeaveBalance | null = profileCreatedAt
        ? calcLeaveBalance(profileCreatedAt, myApprovedLeaves)
        : null;
    const pending = allLeaves.filter(l => l.status === 'Pending');
    const cancellationRequests = allLeaves.filter(l => l.status === 'Cancellation Requested');
    const cancelledLeaves = allLeaves.filter(l => l.status === 'Cancelled');
    const filteredAdmin = adminFilter === 'all' ? allLeaves
        : adminFilter === 'cancellation' ? allLeaves.filter(l => l.status === 'Cancellation Requested')
        : adminFilter === 'cancelled' ? cancelledLeaves
        : allLeaves.filter(l => l.status === adminFilter.charAt(0).toUpperCase() + adminFilter.slice(1));

    if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading...</div>;

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Leave Management</h2>
                    <p className="text-muted-foreground mt-1">Apply and track your leave requests</p>
                </div>
                <Button onClick={() => openApplyDialog()} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" />
                    {isAdmin ? 'Raise Leave' : 'Apply for Leave'}
                </Button>
            </div>

            {/* Leave balance banner */}
            {leaveBalance && (
                <Card className="border-l-4 border-l-blue-500 bg-gradient-to-r from-blue-50 to-indigo-50">
                    <CardContent className="py-4 px-6">
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                                    <CalendarDays className="h-5 w-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-blue-800">Leave Balance</p>
                                    <p className="text-xs text-blue-600 mt-0.5">1 leave credited per month · unused leaves carry forward</p>
                                </div>
                            </div>
                            <div className="flex gap-6">
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-blue-700">{leaveBalance.accrued_days}</p>
                                    <p className="text-xs text-blue-500 font-medium">Accrued</p>
                                </div>
                                <div className="w-px bg-blue-200" />
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-red-500">{leaveBalance.used_days}</p>
                                    <p className="text-xs text-red-400 font-medium">Used</p>
                                </div>
                                <div className="w-px bg-blue-200" />
                                <div className="text-center">
                                    <p className={`text-2xl font-bold ${leaveBalance.available_days > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                                        {leaveBalance.available_days}
                                    </p>
                                    <p className="text-xs text-green-500 font-medium">Available</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: 'Pending',   count: myLeaves.filter(l => l.status === 'Pending').length,   cls: 'border-l-amber-400', textCls: 'text-amber-600' },
                    { label: 'Approved',  count: myLeaves.filter(l => l.status === 'Approved').length,  cls: 'border-l-green-500', textCls: 'text-green-600' },
                    { label: 'Rejected',  count: myLeaves.filter(l => l.status === 'Rejected').length,  cls: 'border-l-red-400',   textCls: 'text-red-500' },
                    { label: 'Cancelled', count: myLeaves.filter(l => l.status === 'Cancelled').length, cls: 'border-l-slate-300', textCls: 'text-slate-500' },
                ].map(({ label, count, cls, textCls }) => (
                    <Card key={label} className={`border-l-4 ${cls}`}>
                        <CardContent className="py-4 px-5">
                            <p className="text-sm text-muted-foreground">{label}</p>
                            <p className={`text-3xl font-bold mt-1 ${textCls}`}>{count}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">my requests</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b">
                <button
                    onClick={() => setActiveTab('my')}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'my' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-slate-700'}`}
                >
                    My Leaves
                </button>
                {isAdmin && (
                    <button
                        onClick={() => setActiveTab('manage')}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'manage' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-slate-700'}`}
                    >
                        Manage All
                        {pending.length > 0 && (
                            <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{pending.length}</span>
                        )}
                    </button>
                )}
                {isAdmin && (
                    <button
                        type="button"
                        onClick={() => setActiveTab('weekly-off')}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'weekly-off' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-slate-700'}`}
                    >
                        <Palmtree className="h-4 w-4" />
                        Weekly off
                    </button>
                )}
            </div>

            {/* MY LEAVES */}
            {activeTab === 'my' && (
                <div className="space-y-3">
                    {myLeaves.length === 0 ? (
                        <Card>
                            <CardContent className="py-16 text-center">
                                <CalendarDays className="h-12 w-12 mx-auto text-slate-200 mb-4" />
                                <p className="text-slate-500 font-medium">No leave requests yet</p>
                                <p className="text-sm text-muted-foreground mt-1">Click "Apply for Leave" to submit your first request</p>
                            </CardContent>
                        </Card>
                    ) : (
                        myLeaves.map(leave => {
                            const sc = STATUS_CONFIG[leave.status] || STATUS_CONFIG.Pending;
                            const days = diffDays(leave.start_date, leave.end_date);
                            return (
                                <Card key={leave.leave_id} className={`border-l-4 ${BORDER_COLOR[leave.status] || 'border-l-slate-300'}`}>
                                    <CardContent className="py-4 px-5">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="space-y-2 flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <Badge className={`flex items-center gap-1 text-xs border ${sc.cls}`}>
                                                        {sc.icon}{sc.label}
                                                    </Badge>
                                                    <span className="font-semibold text-slate-800">{leave.leave_type}</span>
                                                    <span className="text-xs text-muted-foreground bg-slate-100 px-2 py-0.5 rounded-full">
                                                        {days} day{days > 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-sm text-slate-600">
                                                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                    <span>{fmtDate(leave.start_date)}</span>
                                                    {leave.start_date !== leave.end_date && (
                                                        <>
                                                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                            <span>{fmtDate(leave.end_date)}</span>
                                                        </>
                                                    )}
                                                </div>
                                                {leave.reason && (
                                                    <p className="text-sm text-muted-foreground italic">"{leave.reason}"</p>
                                                )}
                                                <p className="text-xs text-muted-foreground">
                                                    Applied on {fmtDate(leave.created_at)}
                                                </p>
                                            </div>
                                            <div className="flex-shrink-0">
                                                {leave.status === 'Pending' && (
                                                    <Button
                                                        variant="outline" size="sm"
                                                        className="border-red-300 text-red-600 hover:bg-red-50"
                                                        onClick={() => handleRevoke(leave.leave_id)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Revoke
                                                    </Button>
                                                )}
                                                {leave.status === 'Approved' && (
                                                    <Button
                                                        variant="outline" size="sm"
                                                        className="border-orange-400 text-orange-600 hover:bg-orange-50"
                                                        onClick={() => handleRequestCancellation(leave.leave_id)}
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Request Cancellation
                                                    </Button>
                                                )}
                                                {leave.status === 'Cancellation Requested' && (
                                                    <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-md px-2 py-1.5 flex items-center gap-1">
                                                        <Clock className="h-3.5 w-3.5" /> Awaiting admin approval
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })
                    )}
                </div>
            )}

            {/* ADMIN: MANAGE */}
            {activeTab === 'manage' && isAdmin && (
                <div className="space-y-4">
                    {/* Filter tabs */}
                    <div className="flex gap-2 flex-wrap">
                        {([
                            { key: 'all',          label: `All (${allLeaves.length})` },
                            { key: 'pending',      label: `Pending (${pending.length})` },
                            { key: 'cancellation', label: `Cancellation Requests (${cancellationRequests.length})`, highlight: cancellationRequests.length > 0 },
                            { key: 'approved',     label: `Approved (${allLeaves.filter(l => l.status === 'Approved').length})` },
                            { key: 'rejected',     label: `Rejected (${allLeaves.filter(l => l.status === 'Rejected').length})` },
                            { key: 'cancelled',    label: `Cancelled (${cancelledLeaves.length})` },
                        ] as { key: AdminView; label: string; highlight?: boolean }[]).map(({ key, label, highlight }) => (
                            <button
                                key={key}
                                onClick={() => setAdminFilter(key)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                    adminFilter === key
                                        ? 'bg-blue-600 text-white'
                                        : highlight
                                            ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-300'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                        <div className="ml-auto">
                            <Button variant="outline" size="sm" onClick={() => openApplyDialog()}>
                                <Plus className="h-3.5 w-3.5 mr-1" /> Raise on Behalf
                            </Button>
                        </div>
                    </div>

                    {filteredAdmin.length === 0 ? (
                        <Card>
                            <CardContent className="py-12 text-center text-muted-foreground">No requests found.</CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-2">
                            {filteredAdmin.map(leave => {
                                const sc = STATUS_CONFIG[leave.status] || STATUS_CONFIG.Pending;
                                const days = diffDays(leave.start_date, leave.end_date);
                                return (
                                    <Card key={leave.leave_id} className={`border-l-4 ${BORDER_COLOR[leave.status] || 'border-l-slate-300'}`}>
                                        <CardContent className="py-4 px-5">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="space-y-1.5 flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <div className="flex items-center gap-1.5">
                                                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                            <span className="font-semibold text-slate-800 text-sm">{leave.full_name || 'Unknown'}</span>
                                                        </div>
                                                        <Badge className={`flex items-center gap-1 text-xs border ${sc.cls}`}>
                                                            {sc.icon}{sc.label}
                                                        </Badge>
                                                        <span className="text-sm text-slate-600">{leave.leave_type}</span>
                                                        <span className="text-xs text-muted-foreground bg-slate-100 px-2 py-0.5 rounded-full">
                                                            {days} day{days > 1 ? 's' : ''}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-sm text-slate-600">
                                                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                        <span>{fmtDateShort(leave.start_date)}</span>
                                                        {leave.start_date !== leave.end_date && (
                                                            <>
                                                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                                <span>{fmtDateShort(leave.end_date)}</span>
                                                            </>
                                                        )}
                                                        <span className="text-muted-foreground ml-1">· Applied {fmtDateShort(leave.created_at)}</span>
                                                    </div>
                                                    {leave.reason && <p className="text-sm text-muted-foreground italic">"{leave.reason}"</p>}
                                                </div>

                                                {/* Action buttons based on current status */}
                                                <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                                                    {leave.status === 'Pending' && (
                                                        <>
                                                            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white"
                                                                onClick={() => handleStatusChange(leave.leave_id, 'Approved')}>
                                                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                                                            </Button>
                                                            <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50"
                                                                onClick={() => handleStatusChange(leave.leave_id, 'Rejected')}>
                                                                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                                                            </Button>
                                                        </>
                                                    )}
                                                    {leave.status === 'Approved' && (
                                                        <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50"
                                                            onClick={() => handleStatusChange(leave.leave_id, 'Rejected')}>
                                                            <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                                                        </Button>
                                                    )}
                                                    {leave.status === 'Cancellation Requested' && (
                                                        <>
                                                            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white"
                                                                onClick={() => handleRevoke(leave.leave_id)}>
                                                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve Cancellation
                                                            </Button>
                                                            <Button size="sm" variant="outline" className="border-green-400 text-green-700 hover:bg-green-50"
                                                                onClick={() => handleStatusChange(leave.leave_id, 'Approved')}>
                                                                <XCircle className="h-3.5 w-3.5 mr-1" /> Deny Cancellation
                                                            </Button>
                                                        </>
                                                    )}
                                                    {leave.status === 'Rejected' && (
                                                        <Button size="sm" variant="outline" className="border-green-400 text-green-700 hover:bg-green-50"
                                                            onClick={() => handleStatusChange(leave.leave_id, 'Approved')}>
                                                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Re-approve
                                                        </Button>
                                                    )}
                                                    <Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-500 hover:bg-red-50"
                                                        onClick={() => handleAdminDelete(leave.leave_id)} title="Delete permanently">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'weekly-off' && isAdmin && (
                <Card>
                    <CardContent className="py-6 px-5 space-y-5">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-800">Weekly off days</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                Set recurring weekdays off for team members (with login) or field staff on manpower. On a weekly off, check-in asks for an extra confirmation (including proxy check-in).
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Applies to</Label>
                            <Select
                                value={woSubjectType}
                                onValueChange={(v) => {
                                    const t = v as WeeklyOffSubject;
                                    setWoSubjectType(t);
                                    setWoProfileUserId('');
                                    setWoLabourId('');
                                    setWoDays(new Set());
                                }}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-white">
                                    <SelectItem value="profile" className="bg-white hover:bg-slate-50">Team (login accounts)</SelectItem>
                                    <SelectItem value="labour" className="bg-white hover:bg-slate-50">Field staff (manpower)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {woSubjectType === 'profile' ? (
                            <div className="space-y-2">
                                <Label>Team member</Label>
                                <Select value={woProfileUserId || '__none__'} onValueChange={(v) => setWoProfileUserId(v === '__none__' ? '' : v)}>
                                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                                    <SelectContent className="bg-white max-h-72">
                                        <SelectItem value="__none__" className="bg-white hover:bg-slate-50">Select…</SelectItem>
                                        {teamMembers.map((m) => (
                                            <SelectItem key={m.user_id} value={m.user_id} className="bg-white hover:bg-slate-50">
                                                {m.full_name || 'Unnamed'} · {m.role}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label>Field staff</Label>
                                {woLoadingList ? (
                                    <p className="text-sm text-muted-foreground">Loading…</p>
                                ) : woFieldStaff.length === 0 ? (
                                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                        No active labour linked to projects. Add people in the manpower module first.
                                    </p>
                                ) : (
                                    <Select value={woLabourId || '__none__'} onValueChange={(v) => setWoLabourId(v === '__none__' ? '' : v)}>
                                        <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                                        <SelectContent className="bg-white max-h-72">
                                            <SelectItem value="__none__" className="bg-white hover:bg-slate-50">Select…</SelectItem>
                                            {woFieldStaff.map((l) => (
                                                <SelectItem key={l.id} value={String(l.id)} className="bg-white hover:bg-slate-50">
                                                    {l.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Off days (each week)</Label>
                            {woLoadingDays ? (
                                <p className="text-sm text-muted-foreground">Loading schedule…</p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {WEEKDAY_LABELS.map((label, d) => (
                                        <button
                                            key={d}
                                            type="button"
                                            onClick={() => toggleWoDay(d)}
                                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                                                woDays.has(d)
                                                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground">Sunday = 0 … Saturday = 6 (same as the attendance calendar).</p>
                        </div>

                        <div className="flex gap-2">
                            <Button onClick={() => void handleSaveWeeklyOffs()} disabled={woSaving || woLoadingDays} className="bg-blue-600 hover:bg-blue-700">
                                {woSaving ? 'Saving…' : 'Save weekly offs'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Apply / Raise Leave Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-md bg-white">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CalendarDays className="h-5 w-5 text-blue-600" />
                            {isAdmin ? 'Raise Leave Request' : 'Apply for Leave'}
                        </DialogTitle>
                        <DialogDescription>
                            {isAdmin ? 'Raise a leave for yourself or a team member.' : 'Submit your leave request for admin approval.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {isAdmin && (
                            <div className="space-y-1.5">
                                <Label>For Member</Label>
                                <Select value={form.target_user_id} onValueChange={v => setForm(f => ({ ...f, target_user_id: v }))}>
                                    <SelectTrigger><SelectValue placeholder="Select member..." /></SelectTrigger>
                                    <SelectContent className="bg-white">
                                        {teamMembers.map(m => (
                                            <SelectItem key={m.user_id} value={m.user_id} className="bg-white hover:bg-slate-50">
                                                {m.full_name || 'Unnamed'} {m.user_id === myUserId ? '(me)' : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <Label>Leave Type</Label>
                            <Select value={form.leave_type} onValueChange={v => setForm(f => ({ ...f, leave_type: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-white">
                                    {LEAVE_TYPES.map(t => <SelectItem key={t} value={t} className="bg-white hover:bg-slate-50">{t}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>From</Label>
                                <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>To</Label>
                                <Input type="date" value={form.end_date} min={form.start_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                            </div>
                        </div>
                        {form.start_date && form.end_date && new Date(form.end_date) >= new Date(form.start_date) && (
                            <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-sm text-blue-700">
                                <CalendarDays className="h-4 w-4 flex-shrink-0" />
                                <span><strong>{diffDays(form.start_date, form.end_date)}</strong> day{diffDays(form.start_date, form.end_date) > 1 ? 's' : ''} of leave</span>
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Textarea placeholder="Brief reason..." value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={2} />
                        </div>
                        {isAdmin && (
                            <div
                                onClick={() => setForm(f => ({ ...f, auto_approve: !f.auto_approve }))}
                                className={`flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer transition-all ${form.auto_approve ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-200'}`}
                            >
                                <div>
                                    <p className="text-sm font-medium">Auto-approve</p>
                                    <p className="text-xs text-muted-foreground">Mark as Approved immediately</p>
                                </div>
                                <div className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${form.auto_approve ? 'bg-green-500' : 'bg-slate-300'}`}>
                                    <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${form.auto_approve ? 'translate-x-5' : 'translate-x-0'}`} />
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSubmit} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
                            {isSaving ? 'Submitting...' : form.auto_approve ? 'Raise & Approve' : 'Submit Request'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
