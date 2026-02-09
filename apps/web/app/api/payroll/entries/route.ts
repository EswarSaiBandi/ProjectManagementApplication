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

async function getRole(supabaseAdmin: ReturnType<typeof getSupabaseAdmin>, userId: string) {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('user_id', userId)
        .limit(1);
    if (error) return { error: jsonError('Failed to validate permissions', 500) } as const;
    const role = String(data?.[0]?.role || '').toLowerCase();
    return { role } as const;
}

function isManager(role: string) {
    return role === 'admin' || role === 'projectmanager';
}

// TEMP: open access to payroll management for all authenticated users.
// TODO: revert to role-based access (Admin/ProjectManager) before production.
const OPEN_PAYROLL_TO_ALL = true;

function monthToFirstDay(month: string) {
    // expects YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    return `${month}-01`;
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

        const { searchParams } = new URL(req.url);
        const userIdParam = searchParams.get('user_id');

        let q = supabaseAdmin
            .from('payroll_entries')
            .select('*, profiles:user_id(full_name, role)')
            .order('pay_month', { ascending: false })
            .limit(200);

        if (userIdParam) q = q.eq('user_id', userIdParam);
        if (!OPEN_PAYROLL_TO_ALL) {
            const roleRes = await getRole(supabaseAdmin, requester.user.id);
            if ('error' in roleRes) return roleRes.error;
            if (!isManager(roleRes.role)) q = q.eq('user_id', requester.user.id);
        }

        const { data, error } = await q;
        if (error) return jsonError(error.message || 'Failed to load payroll', 400);

        const entries = (data || []).map((r: any) => ({
            ...r,
            employee_name: r.profiles?.full_name ?? null,
            employee_role: r.profiles?.role ?? null,
            profiles: undefined,
        }));

        return NextResponse.json({ entries, can_manage: true });
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

        if (!OPEN_PAYROLL_TO_ALL) {
            const roleRes = await getRole(supabaseAdmin, requester.user.id);
            if ('error' in roleRes) return roleRes.error;
            if (!isManager(roleRes.role)) return jsonError('Forbidden', 403);
        }

        const body = await req.json().catch(() => null);
        const user_id = String(body?.user_id || '').trim();
        const pay_type = String(body?.pay_type || '').trim();
        const month = String(body?.month || '').trim();
        const pay_month = monthToFirstDay(month);

        if (!user_id) return jsonError('user_id is required');
        if (!pay_month) return jsonError('month must be YYYY-MM');
        if (pay_type !== 'Monthly' && pay_type !== 'Daily') return jsonError('pay_type must be Monthly or Daily');

        const incentive = Number(body?.incentive ?? 0);
        const exception_amount = Number(body?.exception_amount ?? 0);
        const notes = String(body?.notes || '').trim() || null;
        const status = String(body?.status || 'Draft');

        const base = {
            user_id,
            pay_month,
            pay_type,
            incentive: Number.isFinite(incentive) ? incentive : 0,
            exception_amount: Number.isFinite(exception_amount) ? exception_amount : 0,
            notes,
            status: status === 'Paid' ? 'Paid' : 'Draft',
            paid_at: status === 'Paid' ? new Date().toISOString() : null,
            created_by: requester.user.id,
        };

        let payload: any = base;
        if (pay_type === 'Monthly') {
            const monthly_salary = Number(body?.monthly_salary);
            if (!Number.isFinite(monthly_salary) || monthly_salary < 0) return jsonError('monthly_salary must be a valid number');
            payload = { ...base, monthly_salary };
        } else {
            const daily_rate = Number(body?.daily_rate);
            const days_worked = Number(body?.days_worked);
            if (!Number.isFinite(daily_rate) || daily_rate < 0) return jsonError('daily_rate must be a valid number');
            if (!Number.isFinite(days_worked) || days_worked < 0) return jsonError('days_worked must be a valid number');
            payload = { ...base, daily_rate, days_worked };
        }

        const { data, error } = await supabaseAdmin.from('payroll_entries').insert([payload]).select('payroll_id').limit(1);
        if (error) return jsonError(error.message || 'Failed to create payslip', 400);

        return NextResponse.json({ payroll_id: data?.[0]?.payroll_id });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

export async function PUT(req: Request) {
    try {
        let supabaseAdmin;
        try {
            supabaseAdmin = getSupabaseAdmin();
        } catch (e: any) {
            return jsonError(e?.message || 'Server misconfigured', 500);
        }

        const requester = await getRequester(req);
        if ('error' in requester) return requester.error;

        if (!OPEN_PAYROLL_TO_ALL) {
            const roleRes = await getRole(supabaseAdmin, requester.user.id);
            if ('error' in roleRes) return roleRes.error;
            if (!isManager(roleRes.role)) return jsonError('Forbidden', 403);
        }

        const body = await req.json().catch(() => null);
        const payroll_id = Number(body?.payroll_id);
        if (!Number.isFinite(payroll_id)) return jsonError('payroll_id is required');

        const updates: any = {};
        if (body?.status) {
            updates.status = String(body.status) === 'Paid' ? 'Paid' : 'Draft';
            updates.paid_at = updates.status === 'Paid' ? new Date().toISOString() : null;
        }
        if (body?.incentive != null) {
            const incentive = Number(body.incentive);
            updates.incentive = Number.isFinite(incentive) ? incentive : 0;
        }
        if (body?.exception_amount != null) {
            const ex = Number(body.exception_amount);
            updates.exception_amount = Number.isFinite(ex) ? ex : 0;
        }
        if (body?.notes != null) {
            updates.notes = String(body.notes || '').trim() || null;
        }

        // type-specific edits
        if (body?.monthly_salary != null) {
            const v = Number(body.monthly_salary);
            if (!Number.isFinite(v) || v < 0) return jsonError('monthly_salary must be valid');
            updates.monthly_salary = v;
            updates.daily_rate = null;
            updates.days_worked = null;
            updates.pay_type = 'Monthly';
        }
        if (body?.daily_rate != null || body?.days_worked != null) {
            const daily_rate = Number(body.daily_rate);
            const days_worked = Number(body.days_worked);
            if (!Number.isFinite(daily_rate) || daily_rate < 0) return jsonError('daily_rate must be valid');
            if (!Number.isFinite(days_worked) || days_worked < 0) return jsonError('days_worked must be valid');
            updates.daily_rate = daily_rate;
            updates.days_worked = days_worked;
            updates.monthly_salary = null;
            updates.pay_type = 'Daily';
        }

        const { error } = await supabaseAdmin.from('payroll_entries').update(updates).eq('payroll_id', payroll_id);
        if (error) return jsonError(error.message || 'Failed to update payslip', 400);

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

export async function DELETE(req: Request) {
    try {
        let supabaseAdmin;
        try {
            supabaseAdmin = getSupabaseAdmin();
        } catch (e: any) {
            return jsonError(e?.message || 'Server misconfigured', 500);
        }

        const requester = await getRequester(req);
        if ('error' in requester) return requester.error;

        if (!OPEN_PAYROLL_TO_ALL) {
            const roleRes = await getRole(supabaseAdmin, requester.user.id);
            if ('error' in roleRes) return roleRes.error;
            if (!isManager(roleRes.role)) return jsonError('Forbidden', 403);
        }

        const { searchParams } = new URL(req.url);
        const payroll_id = Number(searchParams.get('payroll_id'));
        if (!Number.isFinite(payroll_id)) return jsonError('payroll_id is required');

        const { error } = await supabaseAdmin.from('payroll_entries').delete().eq('payroll_id', payroll_id);
        if (error) return jsonError(error.message || 'Failed to delete payslip', 400);

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

