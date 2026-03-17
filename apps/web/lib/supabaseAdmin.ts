import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

let cached: SupabaseClient | null = null;
let fileEnvCache: Record<string, string> | null = null;

function loadFileEnvOnce() {
    if (fileEnvCache) return fileEnvCache;

    const merged: Record<string, string> = {};
    const candidates = [
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(process.cwd(), 'apps/web/.env.local'),
    ];

    for (const envPath of candidates) {
        if (!fs.existsSync(envPath)) continue;
        try {
            const raw = fs.readFileSync(envPath, 'utf8');
            for (const line of raw.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const equalIndex = trimmed.indexOf('=');
                if (equalIndex <= 0) continue;
                const key = trimmed.slice(0, equalIndex).trim();
                let value = trimmed.slice(equalIndex + 1).trim();
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                if (!(key in merged)) merged[key] = value;
            }
        } catch {
            // Ignore unreadable env files and continue with process env.
        }
    }

    fileEnvCache = merged;
    return merged;
}

function resolveEnv(name: string) {
    const direct = process.env[name];
    if (direct) return direct;
    return loadFileEnvOnce()[name];
}

export function getSupabaseAdmin() {
    const supabaseUrl = resolveEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceRoleKey = resolveEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl) {
        throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
    }
    if (!serviceRoleKey) {
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
    }

    if (cached) return cached;

    cached = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });

    return cached;
}

