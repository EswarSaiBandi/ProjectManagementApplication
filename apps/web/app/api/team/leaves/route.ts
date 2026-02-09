import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
    return NextResponse.json({ error: message }, { status });
}

async function getRequester(req: Request) {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
    if (!token) return { error: jsonError('Unauthorized', 401) } as const;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!supabaseUrl || !anonKey) return { error: jsonError('Server misconfigured: missing Supabase anon env', 500) } as const;

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) return { error: jsonError('Unauthorized', 401) } as const;

    return { user: userData.user } as const;
}

async function requireManagerRole(supabaseAdmin: ReturnType<typeof getSupabaseAdmin>, userId: string) {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('user_id', userId)
        .limit(1);
    if (error) return { error: jsonError('Failed to validate permissions', 500) } as const;
    const role = String(data?.[0]?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'projectmanager') {
        return { error: jsonError('Forbidden', 403) } as const;
    }
    return { role } as const;
}

export async function GET(req: Request) {
    try {
        let supabaseAdmin;
        try {
            supabaseAdmin = getSupabaseAdmin();
        } catch (e: any) {
            return jsonError(e?.message || 'Server misconfigured', 500);
        }

        const requester = await getRequester(req);
        if ('error' in requester) return requester.error;

        const roleCheck = await requireManagerRole(supabaseAdmin, requester.user.id);
        if ('error' in roleCheck) return roleCheck.error;

        const { data, error } = await supabaseAdmin
            .from('leave_requests')
            .select('leave_id,user_id,start_date,end_date,leave_type,reason,status,created_at, profiles:user_id(full_name)')
            .eq('status', 'Pending')
            .order('created_at', { ascending: true })
            .limit(200);

        if (error) return jsonError(error.message || 'Failed to load pending leaves', 400);

        const pending = (data || []).map((r: any) => ({
            ...r,
            full_name: r.profiles?.full_name ?? null,
            profiles: undefined,
        }));

        return NextResponse.json({ pending });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

export async function POST(req: Request) {
    try {
        let supabaseAdmin;
        try {
            supabaseAdmin = getSupabaseAdmin();
        } catch (e: any) {
            return jsonError(e?.message || 'Server misconfigured', 500);
        }

        const requester = await getRequester(req);
        if ('error' in requester) return requester.error;

        const roleCheck = await requireManagerRole(supabaseAdmin, requester.user.id);
        if ('error' in roleCheck) return roleCheck.error;

        const body = await req.json().catch(() => null);
        const leave_id = Number(body?.leave_id);
        const status = String(body?.status || '');
        if (!Number.isFinite(leave_id)) return jsonError('leave_id is required');
        if (status !== 'Approved' && status !== 'Rejected') return jsonError('Invalid status');

        const { error } = await supabaseAdmin
            .from('leave_requests')
            .update({
                status,
                approved_by: requester.user.id,
                approved_at: new Date().toISOString(),
            })
            .eq('leave_id', leave_id);

        if (error) return jsonError(error.message || 'Failed to update leave', 400);

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

