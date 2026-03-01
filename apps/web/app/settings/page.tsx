'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DynamicFieldsManager from '@/components/settings/DynamicFieldsManager';

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  role: string | null;
  phone: string | null;
};

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
  });

  const fetchMe = async () => {
    setLoading(true);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error('auth.getUser error:', userError);
      toast.error(userError.message || 'Failed to load user');
      setLoading(false);
      return;
    }

    const user = userData.user;
    if (!user) {
      setProfile(null);
      setEmail('');
      setUserId('');
      setLoading(false);
      return;
    }

    setEmail(user.email || '');
    setUserId(user.id);

    const inferredName =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      (user.email ? user.email.split('@')[0] : '') ||
      'User';

    const { data: rows, error } = await supabase
      .from('profiles')
      .select('user_id, full_name, role, phone')
      .eq('user_id', user.id)
      .limit(1);

    if (error) {
      console.error('profiles fetch error:', error);
      toast.error(error.message || 'Failed to load profile');
      setProfile(null);
      setLoading(false);
      return;
    }

    const existing = (rows || [])[0] as ProfileRow | undefined;

    if (!existing) {
      // Profile row may exist but be hidden by RLS, or may truly be missing.
      // Use upsert so we never hit duplicate key errors.
      const { error: upsertError } = await supabase.from('profiles').upsert(
        [
          {
            user_id: user.id,
            full_name: inferredName,
            role: (user.user_metadata?.role as string | undefined) || null,
            phone: null,
          },
        ],
        { onConflict: 'user_id' }
      );
      if (upsertError) {
        console.error('profiles upsert error:', upsertError);
        toast.error(upsertError.message || 'Failed to create profile');
        setProfile(null);
        setLoading(false);
        return;
      }

      // Re-fetch
      const { data: createdRows, error: refetchError } = await supabase
        .from('profiles')
        .select('user_id, full_name, role, phone')
        .eq('user_id', user.id)
        .limit(1);
      if (refetchError) {
        console.error('profiles refetch error:', refetchError);
        toast.error(refetchError.message || 'Failed to load profile');
        setProfile(null);
        setLoading(false);
        return;
      }
      const created = (createdRows || [])[0] as ProfileRow | undefined;
      if (!created) {
        toast.error('Profile is not accessible (RLS). Add a read policy for profiles.');
        setProfile(null);
        setLoading(false);
        return;
      }
      setProfile(created);
      setForm({
        full_name: (created.full_name || inferredName) as string,
        phone: (created.phone || '') as string,
      });
      setLoading(false);
      return;
    }

    setProfile(existing);
    setForm({
      full_name: (existing.full_name || inferredName) as string,
      phone: (existing.phone || '') as string,
    });
    setLoading(false);
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const handleSave = async () => {
    if (!userId) return;
    const fullName = form.full_name.trim();
    if (!fullName) {
      toast.error('Full name is required');
      return;
    }

    setSaving(true);
    // Use upsert so this works even if profile row was missing.
    const { error } = await supabase.from('profiles').upsert(
      [
        {
          user_id: userId,
          full_name: fullName,
          phone: form.phone.trim() ? form.phone.trim() : null,
        },
      ],
      { onConflict: 'user_id' }
    );

    if (error) {
      console.error('profile update error:', error);
      toast.error(error.message || 'Failed to save');
      setSaving(false);
      return;
    }

    toast.success('Saved');
    await fetchMe();
    setSaving(false);
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message || 'Failed to sign out');
      return;
    }
    window.location.href = '/login';
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage your account and preferences.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Account</CardTitle>
          <Button variant="outline" onClick={handleSignOut}>
            Sign out
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : !profile ? (
            <div className="py-8 text-center text-muted-foreground">Profile not found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={email || '—'} disabled className="bg-white" />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Input value={profile.role || '—'} disabled className="bg-white" />
              </div>
              <div className="space-y-2">
                <Label>Full name *</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  className="bg-white"
                />
              </div>

              <div className="md:col-span-2 flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white hover:bg-blue-700">
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dynamic Fields Configuration */}
      <DynamicFieldsManager />
    </div>
  );
}

