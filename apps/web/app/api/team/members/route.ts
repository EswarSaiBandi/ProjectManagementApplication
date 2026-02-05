import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
    return NextResponse.json({ error: message }, { status });
}

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
    try {
        let supabaseAdmin;
        try {
            supabaseAdmin = getSupabaseAdmin();
        } catch (e: any) {
            return jsonError(
                e?.message === 'Missing SUPABASE_SERVICE_ROLE_KEY'
                    ? 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY (set it in apps/web/.env.local and restart dev server)'
                    : (e?.message || 'Server misconfigured'),
                500
            );
        }

        const authHeader = req.headers.get('authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
        if (!token) return jsonError('Unauthorized', 401);

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        if (!supabaseUrl || !anonKey) return jsonError('Server misconfigured: missing Supabase anon env', 500);

        // Verify requester identity from JWT
        const supabaseAuth = createClient(supabaseUrl, anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
        if (userError || !userData?.user) return jsonError('Unauthorized', 401);

        // Permission check (best-effort):
        // - If requester has a role set, require Admin or ProjectManager
        // - If requester has no profile/role yet (common during initial setup), allow (otherwise app is blocked)
        const { data: requesterProfile, error: requesterProfileError } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('user_id', userData.user.id)
            .limit(1);
        if (requesterProfileError) return jsonError('Failed to validate permissions', 500);

        const requesterRoleRaw = requesterProfile?.[0]?.role;
        const requesterRole = String(requesterRoleRaw || '').toLowerCase();
        const allowedCreators = new Set(['admin', 'projectmanager']);
        if (requesterRole && !allowedCreators.has(requesterRole)) {
            return jsonError('Forbidden', 403);
        }

        const body = await req.json().catch(() => null);
        const email = String(body?.email || '').trim();
        const password = String(body?.password || '');
        const full_name = String(body?.full_name || '').trim();
        const role = String(body?.role || '').trim();
        const phone = String(body?.phone || '').trim();

        if (!email || !isValidEmail(email)) return jsonError('Valid email is required');
        if (!password || password.length < 6) return jsonError('Password must be at least 6 characters');
        if (!full_name) return jsonError('Full name is required');
        if (!role) return jsonError('Role is required');

        // Create auth user without sending confirmation email
        const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name },
        });
        if (createError || !created?.user) {
            return jsonError(createError?.message || 'Failed to create user', 400);
        }

        // Create profile row
        const { error: profileError } = await supabaseAdmin.from('profiles').insert([
            {
                user_id: created.user.id,
                full_name,
                role,
                phone: phone || null,
            },
        ]);

        if (profileError) {
            // Attempt cleanup to avoid orphaned auth user
            try {
                await supabaseAdmin.auth.admin.deleteUser(created.user.id);
            } catch {
                // ignore cleanup failures
            }
            return jsonError(profileError.message || 'Failed to create profile', 400);
        }

        return NextResponse.json({ user_id: created.user.id });
    } catch (e: any) {
        return jsonError(e?.message || 'Unexpected error', 500);
    }
}

