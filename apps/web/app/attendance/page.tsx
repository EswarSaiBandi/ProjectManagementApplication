'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { AttendancePanel } from '@/components/attendance/AttendancePanel';
import { Button } from '@/components/ui/button';
import { ClipboardCheck } from 'lucide-react';

type Me = { user_id: string; full_name: string | null; role: string | null; email: string | null };

function localToday() {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default function AttendancePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [nameDirectory, setNameDirectory] = useState<{ user_id: string; full_name: string | null }[]>([]);
  const [checkedInToday, setCheckedInToday] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        setMe(null);
        setLoading(false);
        return;
      }
      const { data: prof } = await supabase.from('profiles').select('user_id, full_name, role').eq('user_id', user.id).limit(1);
      const row = prof?.[0];
      const m: Me = {
        user_id: user.id,
        full_name: row?.full_name ?? null,
        role: row?.role ?? null,
        email: user.email ?? null,
      };
      setMe(m);

      if (m.role === 'Admin' || m.role === 'ProjectManager') {
        const { data: allP } = await supabase.from('profiles').select('user_id, full_name').order('full_name');
        setNameDirectory((allP || []) as { user_id: string; full_name: string | null }[]);
      } else {
        setNameDirectory([]);
      }

      if (m.role && m.role !== 'Client') {
        const today = localToday();
        const { data: log } = await supabase
          .from('attendance_logs')
          .select('check_in_at')
          .eq('user_id', user.id)
          .eq('work_date', today)
          .maybeSingle();
        setCheckedInToday(!!(log as { check_in_at?: string } | null)?.check_in_at);
      }

      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>;
  }

  if (!me) {
    return <div className="text-sm text-muted-foreground">Sign in to use attendance.</div>;
  }

  if (me.role === 'Client') {
    return (
      <div className="max-w-lg space-y-2">
        <h2 className="text-2xl font-bold">Attendance</h2>
        <p className="text-muted-foreground">Attendance check-in is not required for client accounts.</p>
        <Button asChild variant="outline">
          <Link href="/projects">Back to projects</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-8 w-8 text-blue-600" />
            Attendance
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Check in when you start work and check out when you finish. Each action requires a live camera photo and your current GPS
            location. Admins can review everyone&apos;s records under Team → Attendance or in the report below.
          </p>
          {checkedInToday === false && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3 inline-block">
              You have not checked in today ({localToday()}). Use Check In below.
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {(me.role === 'Admin' || me.role === 'ProjectManager') && (
            <Button asChild variant="outline" size="sm">
              <Link href="/team?tab=attendance">Open Team → Attendance</Link>
            </Button>
          )}
        </div>
      </div>

      <AttendancePanel
        me={me}
        nameDirectory={nameDirectory}
        showAdminReport={me.role === 'Admin' || me.role === 'ProjectManager'}
      />
    </div>
  );
}
