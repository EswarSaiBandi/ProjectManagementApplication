'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type AppRole = 'Admin' | 'ProjectManager' | 'SiteSupervisor' | 'Client' | 'Vendor' | null;

interface RoleState {
  role: AppRole;
  userId: string | null;
  loading: boolean;
  isAdmin: boolean;
  isProjectManager: boolean;
  isSupervisor: boolean;
  isClient: boolean;
  canWrite: boolean;       // Admin, ProjectManager, SiteSupervisor
  canManage: boolean;      // Admin, ProjectManager only
}

const INITIAL: RoleState = {
  role: null,
  userId: null,
  loading: true,
  isAdmin: false,
  isProjectManager: false,
  isSupervisor: false,
  isClient: false,
  canWrite: false,
  canManage: false,
};

export function useRole(): RoleState {
  const [state, setState] = useState<RoleState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setState({ ...INITIAL, loading: false });
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (cancelled) return;

      const role = (profile?.role ?? null) as AppRole;
      setState({
        role,
        userId: user.id,
        loading: false,
        isAdmin: role === 'Admin',
        isProjectManager: role === 'ProjectManager',
        isSupervisor: role === 'SiteSupervisor',
        isClient: role === 'Client',
        canWrite: role === 'Admin' || role === 'ProjectManager' || role === 'SiteSupervisor',
        canManage: role === 'Admin' || role === 'ProjectManager',
      });
    };

    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}
