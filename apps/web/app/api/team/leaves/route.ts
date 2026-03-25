import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
    return NextResponse.json({ error: message }, { status });
}

async function getRequesterWithRole(req: Request) {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
    if (!token) return { error: jsonError('Unauthorized', 401) } as const;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!supabaseUrl || !anonKey) return { error: jsonError('Server misconfigured', 500) } as const;

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) return { error: jsonError('Unauthorized', 401) } as const;

    let supabaseAdmin;
    try { supabaseAdmin = getSupabaseAdmin(); } catch (e: any) {
        return { error: jsonError(e?.message || 'Server misconfigured', 500) } as const;
    }

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('user_id', userData.user.id)
        .single();

    const role = String(profile?.role || '').toLowerCase();
    return { user: userData.user, role, supabaseAdmin } as const;
}

// GET: Admin/PM gets all leaves. SiteSupervisor gets their own.
export async function GET(req: Request) {
    try {
        const ctx = await getRequesterWithRole(req);
        if ('error' in ctx) return ctx.error;
        const { user, role, supabaseAdmin } = ctx;

        if (role === 'client') return jsonError('Forbidden', 403);

        let query = supabaseAdmin
            .from('leave_requests')
            .select('leave_id, user_id, start_date, end_date, leave_type, reason, status, approved_at, created_at, profiles:user_id(full_name)')
            .order('created_at', { ascending: false })
            .limit(200);

        // Non-admins only see their own
        if (role !== 'admin' && role !== 'projectmanager') {
            query = query.eq('user_id', user.id);
        }

        const { data, error } = await query;
        if (error) return jsonError(error.message || 'Failed to load leaves', 400);

        const leaves = (data || []).map((r: any) => ({
            ...r,
            full_name: r.profiles?.full_name ?? null,
            profiles: undefined,
        }));

        return NextResponse.json({ leaves });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

// PUT: Create a new leave request
// SiteSupervisor creates for themselves.
// Admin can create for any user_id and optionally auto-approve.
export async function PUT(req: Request) {
    try {
        const ctx = await getRequesterWithRole(req);
        if ('error' in ctx) return ctx.error;
        const { user, role, supabaseAdmin } = ctx;

        if (role === 'client') return jsonError('Forbidden', 403);

        const body = await req.json().catch(() => null);
        const start_date = String(body?.start_date || '').trim();
        const end_date = String(body?.end_date || '').trim();
        const leave_type = String(body?.leave_type || 'Leave').trim();
        const reason = String(body?.reason || '').trim();
        const auto_approve = body?.auto_approve === true && (role === 'admin' || role === 'projectmanager');

        // Determine target user
        let target_user_id = user.id;
        if ((role === 'admin' || role === 'projectmanager') && body?.target_user_id) {
            target_user_id = String(body.target_user_id);
        }

        if (!start_date || !end_date) return jsonError('start_date and end_date are required');
        if (new Date(end_date) < new Date(start_date)) return jsonError('end_date must be on or after start_date');

        const insertPayload: any = {
            user_id: target_user_id,
            start_date,
            end_date,
            leave_type,
            reason: reason || null,
            status: auto_approve ? 'Approved' : 'Pending',
        };

        if (auto_approve) {
            insertPayload.approved_by = user.id;
            insertPayload.approved_at = new Date().toISOString();
        }

        const { data, error } = await supabaseAdmin
            .from('leave_requests')
            .insert([insertPayload])
            .select('leave_id')
            .single();

        if (error) return jsonError(error.message || 'Failed to create leave request', 400);
        return NextResponse.json({ leave_id: data.leave_id });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

// POST: Approve or Reject a leave (Admin/PM only — works on any status)
export async function POST(req: Request) {
    try {
        const ctx = await getRequesterWithRole(req);
        if ('error' in ctx) return ctx.error;
        const { user, role, supabaseAdmin } = ctx;

        if (role !== 'admin' && role !== 'projectmanager') return jsonError('Forbidden', 403);

        const body = await req.json().catch(() => null);
        const leave_id = Number(body?.leave_id);
        const status = String(body?.status || '');
        if (!Number.isFinite(leave_id)) return jsonError('leave_id is required');
        if (status !== 'Approved' && status !== 'Rejected') return jsonError('Invalid status');

        const { error } = await supabaseAdmin
            .from('leave_requests')
            .update({ status, approved_by: user.id, approved_at: new Date().toISOString() })
            .eq('leave_id', leave_id);

        if (error) return jsonError(error.message || 'Failed to update leave', 400);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

// PATCH: User requests cancellation of an approved leave
export async function PATCH(req: Request) {
    try {
        const ctx = await getRequesterWithRole(req);
        if ('error' in ctx) return ctx.error;
        const { user, role, supabaseAdmin } = ctx;

        if (role === 'client') return jsonError('Forbidden', 403);

        const body = await req.json().catch(() => null);
        const leave_id = Number(body?.leave_id);
        if (!Number.isFinite(leave_id)) return jsonError('leave_id is required');

        // Fetch leave to check ownership and current status
        const { data: leave, error: fetchError } = await supabaseAdmin
            .from('leave_requests')
            .select('user_id, status')
            .eq('leave_id', leave_id)
            .single();

        if (fetchError || !leave) return jsonError('Leave not found', 404);
        if (leave.user_id !== user.id) return jsonError('Forbidden', 403);
        if (leave.status !== 'Approved') return jsonError('Only approved leaves can request cancellation', 400);

        const { error } = await supabaseAdmin
            .from('leave_requests')
            .update({ status: 'Cancellation Requested' })
            .eq('leave_id', leave_id);

        if (error) return jsonError(error.message || 'Failed to request cancellation', 400);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

// DELETE: Revoke/cancel a leave
// - User: only Pending → sets status to 'Cancelled' (keeps history visible)
// - Admin approving cancellation request → sets status to 'Cancelled'
// - Admin hard delete (force=true) → permanently deletes record
export async function DELETE(req: Request) {
    try {
        const ctx = await getRequesterWithRole(req);
        if ('error' in ctx) return ctx.error;
        const { user, role, supabaseAdmin } = ctx;

        if (role === 'client') return jsonError('Forbidden', 403);

        const { searchParams } = new URL(req.url);
        const leave_id = Number(searchParams.get('leave_id'));
        const force = searchParams.get('force') === 'true';
        if (!Number.isFinite(leave_id)) return jsonError('leave_id is required');

        const { data: leave, error: fetchError } = await supabaseAdmin
            .from('leave_requests')
            .select('user_id, status')
            .eq('leave_id', leave_id)
            .single();

        if (fetchError || !leave) return jsonError('Leave not found', 404);

        const isAdmin = role === 'admin' || role === 'projectmanager';
        if (!isAdmin && leave.user_id !== user.id) return jsonError('Forbidden', 403);
        if (!isAdmin && leave.status !== 'Pending') return jsonError('Only pending leaves can be revoked', 400);

        // Admin hard delete (trash icon)
        if (isAdmin && force) {
            const { error } = await supabaseAdmin
                .from('leave_requests')
                .delete()
                .eq('leave_id', leave_id);
            if (error) return jsonError(error.message || 'Failed to delete', 400);
            return NextResponse.json({ ok: true });
        }

        // Soft cancel — keeps record visible with 'Cancelled' status
        const { error } = await supabaseAdmin
            .from('leave_requests')
            .update({ status: 'Cancelled' })
            .eq('leave_id', leave_id);

        if (error) return jsonError(error.message || 'Failed to cancel leave', 400);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}
