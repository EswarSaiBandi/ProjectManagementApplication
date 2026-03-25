'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Camera, Clock, FileText, LocateFixed, Plus, Search, Mail, Phone, Briefcase, Pencil, Trash, ShieldCheck, UserX, UserCheck, FolderKanban, X } from 'lucide-react';
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

type AttendanceLog = {
    attendance_id: number;
    user_id: string;
    work_date: string; // YYYY-MM-DD
    check_in_at: string | null;
    check_out_at: string | null;
    check_in_lat: number | null;
    check_in_lng: number | null;
    check_in_accuracy: number | null;
    check_in_photo_path: string | null;
    check_out_lat: number | null;
    check_out_lng: number | null;
    check_out_accuracy: number | null;
    check_out_photo_path: string | null;
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

type PayrollEntry = {
    payroll_id: number;
    user_id: string;
    pay_month: string; // YYYY-MM-01
    pay_type: 'Monthly' | 'Daily';
    monthly_salary: number | null;
    daily_rate: number | null;
    days_worked: number | null;
    incentive: number;
    exception_amount: number;
    notes: string | null;
    status: 'Draft' | 'Paid';
    paid_at: string | null;
    created_at: string;
    employee_name?: string | null;
    employee_role?: string | null;
};

function getLocalISODate(d = new Date()) {
    // Local date in YYYY-MM-DD (e.g. "2026-02-08")
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

function osmEmbedUrl(lat: number, lng: number) {
    const d = 0.01; // ~1km-ish, good enough for viewing
    const left = lng - d;
    const right = lng + d;
    const top = lat + d;
    const bottom = lat - d;
    const bbox = `${left},${bottom},${right},${top}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(
        `${lat},${lng}`
    )}`;
}

export default function TeamPage() {
    const [activeTab, setActiveTab] = useState<'members' | 'attendance' | 'leaves' | 'payslips' | 'access'>('members');
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
    
    // Form state
    const [memberForm, setMemberForm] = useState({
        email: '',
        password: '',
        full_name: '',
        role: 'SiteSupervisor',
        phone: '',
    });

    // Attendance
    const [todayLog, setTodayLog] = useState<AttendanceLog | null>(null);
    const [attendanceHistory, setAttendanceHistory] = useState<AttendanceLog[]>([]);
    const [isAttendanceDialogOpen, setIsAttendanceDialogOpen] = useState(false);
    const [attendanceAction, setAttendanceAction] = useState<'checkin' | 'checkout'>('checkin');
    const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
    const [geoError, setGeoError] = useState<string | null>(null);
    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [isAttendanceDetailsOpen, setIsAttendanceDetailsOpen] = useState(false);
    const [selectedAttendance, setSelectedAttendance] = useState<AttendanceLog | null>(null);
    const [attendanceDetailsLoading, setAttendanceDetailsLoading] = useState(false);
    const [attendanceSignedUrls, setAttendanceSignedUrls] = useState<{ checkInUrl: string | null; checkOutUrl: string | null }>({
        checkInUrl: null,
        checkOutUrl: null,
    });

    // Leaves (self + manager approvals)
    const [myLeaves, setMyLeaves] = useState<LeaveRequest[]>([]);
    const [pendingLeaves, setPendingLeaves] = useState<(LeaveRequest & { full_name?: string | null })[]>([]);
    const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
    const [leaveForm, setLeaveForm] = useState({
        start_date: getLocalISODate(),
        end_date: getLocalISODate(),
        leave_type: 'Leave',
        reason: '',
    });

    // Payslips
    const [payrollEntries, setPayrollEntries] = useState<PayrollEntry[]>([]);
    const [canManagePayroll, setCanManagePayroll] = useState(false);
    const [payrollLoading, setPayrollLoading] = useState(false);
    const [isPayrollDialogOpen, setIsPayrollDialogOpen] = useState(false);
    const [editingPayroll, setEditingPayroll] = useState<PayrollEntry | null>(null);
    const [payrollForm, setPayrollForm] = useState({
        user_id: '',
        month: '', // YYYY-MM
        pay_type: 'Monthly' as 'Monthly' | 'Daily',
        monthly_salary: '',
        daily_rate: '',
        days_worked: '',
        incentive: '',
        exception_amount: '',
        status: 'Draft' as 'Draft' | 'Paid',
        notes: '',
    });

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

    const stopCamera = () => {
        try {
            streamRef.current?.getTracks().forEach((t) => t.stop());
        } catch {
            // ignore
        }
        streamRef.current = null;
        if (videoRef.current) {
            (videoRef.current as any).srcObject = null;
        }
        setIsCameraReady(false);
    };

    const startCamera = async () => {
        stopCamera();
        setIsCameraReady(false);
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
            (videoRef.current as any).srcObject = stream;
            await videoRef.current.play();
            // Wait for dimensions to be available so capture works reliably
            await new Promise<void>((resolve) => {
                let tries = 0;
                const tick = () => {
                    const v = videoRef.current;
                    if (v && v.videoWidth > 0 && v.videoHeight > 0) {
                        setIsCameraReady(true);
                        resolve();
                        return;
                    }
                    tries += 1;
                    if (tries >= 30) {
                        resolve();
                        return;
                    }
                    setTimeout(tick, 100);
                };
                tick();
            });
        }
    };

    const capturePhoto = async () => {
        const video = videoRef.current;
        if (!video) throw new Error('Camera not ready');
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) throw new Error('Camera not ready');

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Unable to capture');
        ctx.drawImage(video, 0, 0, w, h);

        const blob: Blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/jpeg', 0.85);
        });

        const url = URL.createObjectURL(blob);
        setPhotoBlob(blob);
        setPhotoPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
        });
        // Once we capture, we can stop the camera to save battery
        stopCamera();
    };

    const requestLocation = async () => {
        setGeoError(null);
        setGeo(null);
        if (!('geolocation' in navigator)) {
            setGeoError('Geolocation is not supported in this browser');
            return;
        }
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 12000,
                maximumAge: 0,
            });
        });
        setGeo({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
        });
    };

    const loadMyAttendance = async () => {
        if (!me?.user_id) return;
        const today = getLocalISODate();
        const { data: todayRows, error: todayError } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('user_id', me.user_id)
            .eq('work_date', today)
            .limit(1);
        if (todayError) {
            console.error('Attendance fetch error:', todayError);
            return;
        }
        setTodayLog((todayRows?.[0] as any) || null);

        const { data: hist, error: histError } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('user_id', me.user_id)
            .order('work_date', { ascending: false })
            .limit(30);
        if (histError) {
            console.error('Attendance history fetch error:', histError);
            return;
        }
        setAttendanceHistory((hist as any[]) || []);
    };

    const loadMyLeaves = async () => {
        if (!me?.user_id) return;
        const { data, error } = await supabase
            .from('leave_requests')
            .select('*')
            .eq('user_id', me.user_id)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) {
            console.error('Leave fetch error:', error);
            return;
        }
        setMyLeaves((data as any[]) || []);
    };

    const loadPendingLeaves = async () => {
        const role = String(me?.role || '').toLowerCase();
        const isManager = role === 'admin' || role === 'projectmanager';
        if (!isManager) {
            setPendingLeaves([]);
            return;
        }
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) return;
            const res = await fetch('/api/team/leaves', {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(json?.error || 'Failed to load pending leaves');
            }
            setPendingLeaves(json?.pending || []);
        } catch (e: any) {
            console.error(e);
            setPendingLeaves([]);
        }
    };

    useEffect(() => {
        if (!me?.user_id) return;
        loadMyAttendance();
        loadMyLeaves();
        loadPendingLeaves();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [me?.user_id]);

    const loadPayroll = async () => {
        try {
            setPayrollLoading(true);
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not logged in');

            const res = await fetch('/api/payroll/entries', {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || 'Failed to load payslips');

            setPayrollEntries((json?.entries || []) as PayrollEntry[]);
            setCanManagePayroll(Boolean(json?.can_manage));
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to load payslips');
            setPayrollEntries([]);
            setCanManagePayroll(false);
        } finally {
            setPayrollLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab !== 'payslips') return;
        if (!me?.user_id) return;
        loadPayroll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, me?.user_id]);

    useEffect(() => {
        if (!isAttendanceDialogOpen) {
            stopCamera();
            setGeo(null);
            setGeoError(null);
            setPhotoBlob(null);
            setPhotoPreviewUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return null;
            });
            return;
        }
        (async () => {
            try {
                await startCamera();
            } catch (e: any) {
                console.error(e);
                toast.error('Camera permission denied or not available');
            }
            try {
                await requestLocation();
            } catch (e: any) {
                const msg = e?.message || 'Failed to get location';
                setGeoError(msg);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAttendanceDialogOpen]);

    useEffect(() => {
        if (!isAttendanceDetailsOpen || !selectedAttendance) {
            setAttendanceSignedUrls({ checkInUrl: null, checkOutUrl: null });
            return;
        }
        (async () => {
            setAttendanceDetailsLoading(true);
            try {
                const checkInPath = selectedAttendance.check_in_photo_path;
                const checkOutPath = selectedAttendance.check_out_photo_path;

                const [checkIn, checkOut] = await Promise.all([
                    checkInPath
                        ? supabase.storage.from('attendance').createSignedUrl(checkInPath, 60 * 30)
                        : Promise.resolve({ data: null as any, error: null as any }),
                    checkOutPath
                        ? supabase.storage.from('attendance').createSignedUrl(checkOutPath, 60 * 30)
                        : Promise.resolve({ data: null as any, error: null as any }),
                ]);

                if (checkIn?.error) throw checkIn.error;
                if (checkOut?.error) throw checkOut.error;

                setAttendanceSignedUrls({
                    checkInUrl: checkIn?.data?.signedUrl || null,
                    checkOutUrl: checkOut?.data?.signedUrl || null,
                });
            } catch (e: any) {
                console.error(e);
                toast.error(e?.message || 'Failed to load attendance details');
                setAttendanceSignedUrls({ checkInUrl: null, checkOutUrl: null });
            } finally {
                setAttendanceDetailsLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAttendanceDetailsOpen, selectedAttendance?.attendance_id]);

    const handleConfirmAttendance = async () => {
        if (!me?.user_id) {
            toast.error('You must be logged in');
            return;
        }
        const today = getLocalISODate();

        if (!photoBlob) {
            toast.error('Please capture a photo');
            return;
        }
        if (!geo) {
            toast.error('Location is required. Please allow location access.');
            return;
        }

        setIsCapturing(true);
        try {
            const prefix = `${me.user_id}/${today}`;
            const fileName = `${attendanceAction}-${Date.now()}.jpg`;
            const path = `${prefix}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('attendance')
                .upload(path, photoBlob, { contentType: 'image/jpeg' });
            if (uploadError) {
                const msg = String(uploadError.message || '');
                if (msg.toLowerCase().includes('bucket not found')) {
                    throw new Error(
                        'Storage bucket "attendance" not found. Apply the storage migration `20260208120000_setup_attendance_storage.sql` (or create a private bucket named "attendance" in Supabase Storage), then retry.'
                    );
                }
                throw uploadError;
            }

            if (attendanceAction === 'checkin') {
                if (todayLog?.check_in_at) {
                    toast.error('Already checked in today');
                    return;
                }

                if (todayLog?.attendance_id) {
                    const { error } = await supabase
                        .from('attendance_logs')
                        .update({
                            check_in_at: new Date().toISOString(),
                            check_in_lat: geo.lat,
                            check_in_lng: geo.lng,
                            check_in_accuracy: geo.accuracy,
                            check_in_photo_path: path,
                        })
                        .eq('attendance_id', todayLog.attendance_id);
                    if (error) throw error;
                } else {
                    const { error } = await supabase.from('attendance_logs').insert([
                        {
                            user_id: me.user_id,
                            work_date: today,
                            check_in_at: new Date().toISOString(),
                            check_in_lat: geo.lat,
                            check_in_lng: geo.lng,
                            check_in_accuracy: geo.accuracy,
                            check_in_photo_path: path,
                        },
                    ]);
                    if (error) throw error;
                }

                toast.success('Checked in successfully');
            } else {
                if (!todayLog?.attendance_id || !todayLog.check_in_at) {
                    toast.error('You must check in first');
                    return;
                }
                if (todayLog.check_out_at) {
                    toast.error('Already checked out today');
                    return;
                }
                const { error } = await supabase
                    .from('attendance_logs')
                    .update({
                        check_out_at: new Date().toISOString(),
                        check_out_lat: geo.lat,
                        check_out_lng: geo.lng,
                        check_out_accuracy: geo.accuracy,
                        check_out_photo_path: path,
                    })
                    .eq('attendance_id', todayLog.attendance_id);
                if (error) throw error;
                toast.success('Checked out successfully');
            }

            setIsAttendanceDialogOpen(false);
            await loadMyAttendance();
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to save attendance');
        } finally {
            setIsCapturing(false);
        }
    };

    const handleRequestLeave = async () => {
        if (!me?.user_id) {
            toast.error('You must be logged in');
            return;
        }
        if (!leaveForm.start_date || !leaveForm.end_date) {
            toast.error('Start date and end date are required');
            return;
        }
        if (new Date(leaveForm.start_date) > new Date(leaveForm.end_date)) {
            toast.error('End date must be on or after start date');
            return;
        }
        setIsSaving(true);
        try {
            const { error } = await supabase.from('leave_requests').insert([
                {
                    user_id: me.user_id,
                    start_date: leaveForm.start_date,
                    end_date: leaveForm.end_date,
                    leave_type: leaveForm.leave_type,
                    reason: leaveForm.reason?.trim() ? leaveForm.reason.trim() : null,
                    status: 'Pending',
                },
            ]);
            if (error) throw error;
            toast.success('Leave requested');
            setIsLeaveDialogOpen(false);
            await loadMyLeaves();
            await loadPendingLeaves();
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to request leave');
        } finally {
            setIsSaving(false);
        }
    };

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
            await loadPendingLeaves();
            await loadMyLeaves();
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to update leave');
        }
    };

    const computePayrollTotal = (e: Pick<PayrollEntry, 'pay_type' | 'monthly_salary' | 'daily_rate' | 'days_worked' | 'incentive' | 'exception_amount'>) => {
        const incentive = Number(e.incentive || 0);
        const exceptionAmount = Number(e.exception_amount || 0);
        if (e.pay_type === 'Monthly') {
            const salary = Number(e.monthly_salary || 0);
            return salary + incentive + exceptionAmount;
        }
        const rate = Number(e.daily_rate || 0);
        const days = Number(e.days_worked || 0);
        return rate * days + incentive + exceptionAmount;
    };

    const openEditPayroll = (entry: PayrollEntry) => {
        setEditingPayroll(entry);
        setPayrollForm({
            user_id: entry.user_id,
            month: String(entry.pay_month || '').slice(0, 7),
            pay_type: entry.pay_type,
            monthly_salary: entry.monthly_salary != null ? String(entry.monthly_salary) : '',
            daily_rate: entry.daily_rate != null ? String(entry.daily_rate) : '',
            days_worked: entry.days_worked != null ? String(entry.days_worked) : '',
            incentive: entry.incentive != null ? String(entry.incentive) : '',
            exception_amount: entry.exception_amount != null ? String(entry.exception_amount) : '',
            status: entry.status,
            notes: entry.notes || '',
        });
        setIsPayrollDialogOpen(true);
    };

    const handleSavePayroll = async () => {
        if (!canManagePayroll) {
            toast.error('You do not have permission to manage payslips');
            return;
        }
        if (!payrollForm.user_id) {
            toast.error('Employee is required');
            return;
        }
        if (!payrollForm.month) {
            toast.error('Month is required');
            return;
        }
        setIsSaving(true);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not logged in');

            const basePayload: any = {
                user_id: payrollForm.user_id,
                month: payrollForm.month,
                pay_type: payrollForm.pay_type,
                incentive: payrollForm.incentive ? Number(payrollForm.incentive) : 0,
                exception_amount: payrollForm.exception_amount ? Number(payrollForm.exception_amount) : 0,
                status: payrollForm.status,
                notes: payrollForm.notes,
            };

            if (payrollForm.pay_type === 'Monthly') {
                if (!payrollForm.monthly_salary) throw new Error('Monthly salary is required');
                basePayload.monthly_salary = Number(payrollForm.monthly_salary);
            } else {
                if (!payrollForm.daily_rate) throw new Error('Daily rate is required');
                if (!payrollForm.days_worked) throw new Error('Days worked is required');
                basePayload.daily_rate = Number(payrollForm.daily_rate);
                basePayload.days_worked = Number(payrollForm.days_worked);
            }

            const method = editingPayroll ? 'PUT' : 'POST';
            const payload = editingPayroll ? { ...basePayload, payroll_id: editingPayroll.payroll_id } : basePayload;

            const res = await fetch('/api/payroll/entries', {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || 'Failed to save payslip');

            toast.success(editingPayroll ? 'Payslip updated' : 'Payslip created');
            setIsPayrollDialogOpen(false);
            setEditingPayroll(null);
            await loadPayroll();
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to save payslip');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeletePayroll = async (entry: PayrollEntry) => {
        if (!canManagePayroll) return;
        if (!confirm('Delete this payslip?')) return;
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (!token) throw new Error('Not logged in');

            const res = await fetch(`/api/payroll/entries?payroll_id=${entry.payroll_id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error || 'Failed to delete payslip');
            toast.success('Payslip deleted');
            await loadPayroll();
        } catch (e: any) {
            console.error(e);
            toast.error(e?.message || 'Failed to delete payslip');
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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Team</h2>
                    <p className="text-muted-foreground">Members, attendance and leave requests</p>
                </div>
                {activeTab === 'members' ? (
                    <Button onClick={handleNewMember}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Member
                    </Button>
                ) : activeTab === 'leaves' ? (
                    <Button onClick={() => setIsLeaveDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Request Leave
                    </Button>
                ) : activeTab === 'payslips' ? (
                    canManagePayroll ? (
                        <Button
                            onClick={() => {
                                setEditingPayroll(null);
                                setPayrollForm({
                                    user_id: '',
                                    month: new Date().toISOString().slice(0, 7),
                                    pay_type: 'Monthly',
                                    monthly_salary: '',
                                    daily_rate: '',
                                    days_worked: '',
                                    incentive: '',
                                    exception_amount: '',
                                    status: 'Draft',
                                    notes: '',
                                });
                                setIsPayrollDialogOpen(true);
                            }}
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Pay
                        </Button>
                    ) : null
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
                    <TabsTrigger value="payslips">Payslips</TabsTrigger>
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
                    <Dialog open={isMemberDialogOpen} onOpenChange={setIsMemberDialogOpen}>
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
                                        <p className="text-xs text-muted-foreground truncate">{editingMember.email}</p>
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
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Today</CardTitle>
                            <div className="text-xs text-muted-foreground">{getLocalISODate()}</div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center gap-2 text-sm">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                <span className="text-muted-foreground">
                                    {todayLog?.check_in_at
                                        ? todayLog.check_out_at
                                            ? `Checked out`
                                            : `Checked in`
                                        : 'Not checked in'}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => {
                                        setAttendanceAction('checkin');
                                        setIsAttendanceDialogOpen(true);
                                    }}
                                    disabled={!me?.user_id || !!todayLog?.check_in_at}
                                >
                                    Check In
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setAttendanceAction('checkout');
                                        setIsAttendanceDialogOpen(true);
                                    }}
                                    disabled={!me?.user_id || !todayLog?.check_in_at || !!todayLog?.check_out_at}
                                >
                                    Check Out
                                </Button>
                                <Button variant="ghost" onClick={loadMyAttendance}>
                                    Refresh
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Check in/out requires <span className="font-medium">camera capture</span> and <span className="font-medium">GPS location</span>.
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-medium">Last 30 days</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {attendanceHistory.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No attendance records yet.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Check In</TableHead>
                                                <TableHead>Check Out</TableHead>
                                                <TableHead className="text-right">Accuracy (m)</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {attendanceHistory.map((r) => (
                                                <TableRow
                                                    key={r.attendance_id}
                                                    className="cursor-pointer"
                                                    onClick={() => {
                                                        setSelectedAttendance(r);
                                                        setIsAttendanceDetailsOpen(true);
                                                    }}
                                                >
                                                    <TableCell className="font-medium">{r.work_date}</TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">
                                                        {r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString() : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">
                                                        {r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString() : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-right text-muted-foreground text-sm">
                                                        {r.check_in_accuracy ? Math.round(r.check_in_accuracy) : '-'}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Dialog open={isAttendanceDetailsOpen} onOpenChange={setIsAttendanceDetailsOpen}>
                        <DialogContent className="max-w-4xl bg-white">
                            <DialogHeader>
                                <DialogTitle>Attendance details</DialogTitle>
                                <DialogDescription>
                                    {selectedAttendance ? `Work date: ${selectedAttendance.work_date}` : ''}
                                </DialogDescription>
                            </DialogHeader>

                            {!selectedAttendance ? (
                                <div className="text-sm text-muted-foreground">No record selected.</div>
                            ) : attendanceDetailsLoading ? (
                                <div className="text-sm text-muted-foreground">Loading…</div>
                            ) : (
                                <div className="grid gap-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <div className="text-sm font-medium">Check In</div>
                                            <div className="text-xs text-muted-foreground">
                                                {selectedAttendance.check_in_at ? new Date(selectedAttendance.check_in_at).toLocaleString() : '—'}
                                            </div>
                                            {selectedAttendance.check_in_lat != null && selectedAttendance.check_in_lng != null ? (
                                                <>
                                                    <div className="text-xs text-muted-foreground">
                                                        Location: {Number(selectedAttendance.check_in_lat).toFixed(6)},{' '}
                                                        {Number(selectedAttendance.check_in_lng).toFixed(6)}
                                                        {selectedAttendance.check_in_accuracy != null
                                                            ? ` (±${Math.round(Number(selectedAttendance.check_in_accuracy))}m)`
                                                            : ''}
                                                    </div>
                                                    <div className="rounded-md overflow-hidden border">
                                                        <iframe
                                                            title="Check-in map"
                                                            src={osmEmbedUrl(Number(selectedAttendance.check_in_lat), Number(selectedAttendance.check_in_lng))}
                                                            className="w-full h-[240px]"
                                                        />
                                                    </div>
                                                    <a
                                                        className="text-xs text-blue-600 hover:underline"
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        href={`https://www.google.com/maps?q=${selectedAttendance.check_in_lat},${selectedAttendance.check_in_lng}`}
                                                    >
                                                        Open in Google Maps
                                                    </a>
                                                </>
                                            ) : (
                                                <div className="text-xs text-muted-foreground">No location captured.</div>
                                            )}
                                            {attendanceSignedUrls.checkInUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={attendanceSignedUrls.checkInUrl} alt="Check-in" className="w-full rounded-md border object-cover max-h-[320px]" />
                                            ) : (
                                                <div className="text-xs text-muted-foreground">No check-in photo.</div>
                                            )}
                                        </div>

                                        <div className="space-y-2">
                                            <div className="text-sm font-medium">Check Out</div>
                                            <div className="text-xs text-muted-foreground">
                                                {selectedAttendance.check_out_at ? new Date(selectedAttendance.check_out_at).toLocaleString() : '—'}
                                            </div>
                                            {selectedAttendance.check_out_lat != null && selectedAttendance.check_out_lng != null ? (
                                                <>
                                                    <div className="text-xs text-muted-foreground">
                                                        Location: {Number(selectedAttendance.check_out_lat).toFixed(6)},{' '}
                                                        {Number(selectedAttendance.check_out_lng).toFixed(6)}
                                                        {selectedAttendance.check_out_accuracy != null
                                                            ? ` (±${Math.round(Number(selectedAttendance.check_out_accuracy))}m)`
                                                            : ''}
                                                    </div>
                                                    <div className="rounded-md overflow-hidden border">
                                                        <iframe
                                                            title="Check-out map"
                                                            src={osmEmbedUrl(Number(selectedAttendance.check_out_lat), Number(selectedAttendance.check_out_lng))}
                                                            className="w-full h-[240px]"
                                                        />
                                                    </div>
                                                    <a
                                                        className="text-xs text-blue-600 hover:underline"
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        href={`https://www.google.com/maps?q=${selectedAttendance.check_out_lat},${selectedAttendance.check_out_lng}`}
                                                    >
                                                        Open in Google Maps
                                                    </a>
                                                </>
                                            ) : (
                                                <div className="text-xs text-muted-foreground">No location captured.</div>
                                            )}
                                            {attendanceSignedUrls.checkOutUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={attendanceSignedUrls.checkOutUrl} alt="Check-out" className="w-full rounded-md border object-cover max-h-[320px]" />
                                            ) : (
                                                <div className="text-xs text-muted-foreground">No check-out photo.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <DialogFooter>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setIsAttendanceDetailsOpen(false);
                                        setSelectedAttendance(null);
                                    }}
                                >
                                    Close
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={isAttendanceDialogOpen} onOpenChange={setIsAttendanceDialogOpen}>
                        <DialogContent className="max-w-2xl bg-white">
                            <DialogHeader>
                                <DialogTitle>{attendanceAction === 'checkin' ? 'Check In' : 'Check Out'}</DialogTitle>
                                <DialogDescription>
                                    Capture a photo using the camera and record GPS location.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div className="rounded-md border bg-slate-50 p-3">
                                    {photoPreviewUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={photoPreviewUrl} alt="Captured" className="w-full rounded-md object-cover max-h-[320px]" />
                                    ) : (
                                        <video
                                            ref={videoRef}
                                            className="w-full rounded-md max-h-[320px] bg-black"
                                            playsInline
                                            muted
                                            onLoadedMetadata={() => setIsCameraReady(true)}
                                            onCanPlay={() => setIsCameraReady(true)}
                                        />
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={async () => {
                                            setPhotoBlob(null);
                                            setPhotoPreviewUrl((prev) => {
                                                if (prev) URL.revokeObjectURL(prev);
                                                return null;
                                            });
                                            try {
                                                await startCamera();
                                            } catch {
                                                toast.error('Camera not available');
                                            }
                                        }}
                                    >
                                        <Camera className="mr-2 h-4 w-4" />
                                        {photoPreviewUrl ? 'Retake' : 'Start camera'}
                                    </Button>
                                    <Button
                                        type="button"
                                        disabled={!streamRef.current || !isCameraReady}
                                        onClick={async () => {
                                            try {
                                                await capturePhoto();
                                            } catch (e: any) {
                                                toast.error(e?.message || 'Camera not ready');
                                            }
                                        }}
                                    >
                                        Capture photo
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={async () => {
                                            try {
                                                await requestLocation();
                                            } catch (e: any) {
                                                setGeoError(e?.message || 'Failed to get location');
                                            }
                                        }}
                                    >
                                        <LocateFixed className="mr-2 h-4 w-4" />
                                        Refresh location
                                    </Button>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {geo ? (
                                        <div>
                                            Location: {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)} (±{Math.round(geo.accuracy)}m)
                                        </div>
                                    ) : geoError ? (
                                        <div className="text-red-600">Location error: {geoError}</div>
                                    ) : (
                                        <div>Location: waiting for permission…</div>
                                    )}
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsAttendanceDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleConfirmAttendance} disabled={isCapturing}>
                                    {isCapturing ? 'Saving…' : 'Confirm'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>

                <TabsContent value="leaves" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-medium">My leave requests</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {myLeaves.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No leave requests yet.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Dates</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Reason</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {myLeaves.map((l) => (
                                                <TableRow key={l.leave_id}>
                                                    <TableCell className="font-medium">
                                                        {l.start_date} → {l.end_date}
                                                    </TableCell>
                                                    <TableCell>{l.leave_type}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="secondary">{l.status}</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">{l.reason || '-'}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {pendingLeaves.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm font-medium">Pending approvals</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Member</TableHead>
                                                <TableHead>Dates</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead>Reason</TableHead>
                                                <TableHead className="text-right">Action</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {pendingLeaves.map((l) => (
                                                <TableRow key={`pending-${l.leave_id}`}>
                                                    <TableCell className="font-medium">{l.full_name || l.user_id}</TableCell>
                                                    <TableCell>{l.start_date} → {l.end_date}</TableCell>
                                                    <TableCell>{l.leave_type}</TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">{l.reason || '-'}</TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <Button size="sm" onClick={() => handleSetLeaveStatus(l.leave_id, 'Approved')}>
                                                                Approve
                                                            </Button>
                                                            <Button size="sm" variant="outline" onClick={() => handleSetLeaveStatus(l.leave_id, 'Rejected')}>
                                                                Reject
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <Dialog open={isLeaveDialogOpen} onOpenChange={setIsLeaveDialogOpen}>
                        <DialogContent className="max-w-xl bg-white">
                            <DialogHeader>
                                <DialogTitle>Request leave</DialogTitle>
                                <DialogDescription>Submit a leave request for approval.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Start date</Label>
                                        <Input
                                            type="date"
                                            value={leaveForm.start_date}
                                            onChange={(e) => setLeaveForm((p) => ({ ...p, start_date: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>End date</Label>
                                        <Input
                                            type="date"
                                            value={leaveForm.end_date}
                                            onChange={(e) => setLeaveForm((p) => ({ ...p, end_date: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Type</Label>
                                    <Select value={leaveForm.leave_type} onValueChange={(v) => setLeaveForm((p) => ({ ...p, leave_type: v }))}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                            <SelectItem value="Leave" className="bg-white hover:bg-gray-100">Leave</SelectItem>
                                            <SelectItem value="Sick" className="bg-white hover:bg-gray-100">Sick</SelectItem>
                                            <SelectItem value="Work From Home" className="bg-white hover:bg-gray-100">Work From Home</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Reason</Label>
                                    <Textarea
                                        value={leaveForm.reason}
                                        onChange={(e) => setLeaveForm((p) => ({ ...p, reason: e.target.value }))}
                                        placeholder="Optional"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsLeaveDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleRequestLeave} disabled={isSaving}>
                                    {isSaving ? 'Submitting…' : 'Submit'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>

                <TabsContent value="payslips" className="space-y-6">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Payslips</CardTitle>
                            <Button variant="ghost" onClick={loadPayroll}>
                                Refresh
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {payrollLoading ? (
                                <div className="text-sm text-muted-foreground">Loading payslips…</div>
                            ) : payrollEntries.length === 0 ? (
                                <div className="text-sm text-muted-foreground">
                                    {canManagePayroll ? 'No payslips yet. Click “Add Pay” to create one.' : 'No payslips available.'}
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                {canManagePayroll && <TableHead>Employee</TableHead>}
                                                <TableHead>Month</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Base</TableHead>
                                                <TableHead className="text-right">Days</TableHead>
                                                <TableHead className="text-right">Incentive</TableHead>
                                                <TableHead className="text-right">Exception</TableHead>
                                                <TableHead className="text-right">Total</TableHead>
                                                <TableHead>Status</TableHead>
                                                {canManagePayroll && <TableHead className="text-right">Actions</TableHead>}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {payrollEntries.map((e) => {
                                                const base =
                                                    e.pay_type === 'Monthly'
                                                        ? Number(e.monthly_salary || 0)
                                                        : Number(e.daily_rate || 0);
                                                const total = computePayrollTotal(e);
                                                return (
                                                    <TableRow key={e.payroll_id}>
                                                        {canManagePayroll && (
                                                            <TableCell className="font-medium">
                                                                {e.employee_name || e.user_id}
                                                                {e.employee_role ? (
                                                                    <div className="text-xs text-muted-foreground">{e.employee_role}</div>
                                                                ) : null}
                                                            </TableCell>
                                                        )}
                                                        <TableCell className="font-medium">{String(e.pay_month).slice(0, 7)}</TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                <FileText className="h-4 w-4 text-muted-foreground" />
                                                                {e.pay_type}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {e.pay_type === 'Monthly'
                                                                ? `₹${base.toLocaleString('en-IN')}`
                                                                : `₹${base.toLocaleString('en-IN')}/day`}
                                                        </TableCell>
                                                        <TableCell className="text-right">{e.pay_type === 'Daily' ? (e.days_worked ?? '-') : '-'}</TableCell>
                                                        <TableCell className="text-right">₹{Number(e.incentive || 0).toLocaleString('en-IN')}</TableCell>
                                                        <TableCell className="text-right">₹{Number(e.exception_amount || 0).toLocaleString('en-IN')}</TableCell>
                                                        <TableCell className="text-right font-semibold">
                                                            ₹{Number(total || 0).toLocaleString('en-IN')}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant="secondary">{e.status}</Badge>
                                                        </TableCell>
                                                        {canManagePayroll && (
                                                            <TableCell className="text-right">
                                                                <div className="flex justify-end gap-2">
                                                                    <Button size="sm" variant="outline" onClick={() => openEditPayroll(e)}>
                                                                        <Pencil className="mr-2 h-4 w-4" />
                                                                        Edit
                                                                    </Button>
                                                                    <Button size="sm" variant="outline" onClick={() => handleDeletePayroll(e)}>
                                                                        <Trash className="mr-2 h-4 w-4" />
                                                                        Delete
                                                                    </Button>
                                                                </div>
                                                            </TableCell>
                                                        )}
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Dialog open={isPayrollDialogOpen} onOpenChange={setIsPayrollDialogOpen}>
                        <DialogContent className="max-w-2xl bg-white">
                            <DialogHeader>
                                <DialogTitle>{editingPayroll ? 'Edit Payslip' : 'Add Payslip'}</DialogTitle>
                                <DialogDescription>
                                    Create payslips for Monthly salary or Daily labour (with incentives/exceptions).
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-2">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Employee *</Label>
                                        <Select
                                            value={payrollForm.user_id}
                                            onValueChange={(v) => setPayrollForm((p) => ({ ...p, user_id: v }))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select employee" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                                {teamMembers.map((m) => (
                                                    <SelectItem key={m.user_id} value={m.user_id} className="bg-white hover:bg-gray-100">
                                                        {m.full_name || m.user_id} {m.role ? `(${m.role})` : ''}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Month *</Label>
                                        <Input
                                            type="month"
                                            value={payrollForm.month}
                                            onChange={(e) => setPayrollForm((p) => ({ ...p, month: e.target.value }))}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Pay type *</Label>
                                        <Select
                                            value={payrollForm.pay_type}
                                            onValueChange={(v) => setPayrollForm((p) => ({ ...p, pay_type: v as any }))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                                <SelectItem value="Monthly" className="bg-white hover:bg-gray-100">Fixed Monthly Salary</SelectItem>
                                                <SelectItem value="Daily" className="bg-white hover:bg-gray-100">Daily Labour</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Status</Label>
                                        <Select
                                            value={payrollForm.status}
                                            onValueChange={(v) => setPayrollForm((p) => ({ ...p, status: v as any }))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                                <SelectItem value="Draft" className="bg-white hover:bg-gray-100">Draft</SelectItem>
                                                <SelectItem value="Paid" className="bg-white hover:bg-gray-100">Paid</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {payrollForm.pay_type === 'Monthly' ? (
                                    <div className="space-y-2">
                                        <Label>Monthly salary *</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            value={payrollForm.monthly_salary}
                                            onChange={(e) => setPayrollForm((p) => ({ ...p, monthly_salary: e.target.value }))}
                                            placeholder="e.g. 50000"
                                        />
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Daily rate *</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                value={payrollForm.daily_rate}
                                                onChange={(e) => setPayrollForm((p) => ({ ...p, daily_rate: e.target.value }))}
                                                placeholder="e.g. 800"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Days worked *</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                value={payrollForm.days_worked}
                                                onChange={(e) => setPayrollForm((p) => ({ ...p, days_worked: e.target.value }))}
                                                placeholder="e.g. 26"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Incentive (optional)</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            value={payrollForm.incentive}
                                            onChange={(e) => setPayrollForm((p) => ({ ...p, incentive: e.target.value }))}
                                            placeholder="0"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Exception amount (optional)</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            value={payrollForm.exception_amount}
                                            onChange={(e) => setPayrollForm((p) => ({ ...p, exception_amount: e.target.value }))}
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>Notes</Label>
                                    <Textarea
                                        value={payrollForm.notes}
                                        onChange={(e) => setPayrollForm((p) => ({ ...p, notes: e.target.value }))}
                                        placeholder="Optional"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsPayrollDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleSavePayroll} disabled={isSaving}>
                                    {isSaving ? 'Saving…' : editingPayroll ? 'Update' : 'Create'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>
            </Tabs>
        </div>
    );
}

