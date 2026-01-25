'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Info, Save } from 'lucide-react';

const PROJECT_STATUS_OPTIONS = ['Planning', 'Execution', 'Handover', 'Completed'] as const;

type ProjectRow = {
  project_id: number;
  project_name: string;
  status: string | null;
  start_date: string | null;
  location?: string | null;
  client_id?: string | null;
  created_at?: string | null;
};

export default function DetailsTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(null);

  const [form, setForm] = useState({
    project_name: '',
    status: 'Planning',
    start_date: '',
    location: '',
  });

  const fetchProject = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('projects')
      .select('project_id, project_name, status, start_date, location, client_id, created_at')
      .eq('project_id', numericProjectId)
      .single();

    if (error) {
      console.error('Fetch project error:', error);
      toast.error(error.message || 'Failed to load project details');
      setProject(null);
      setLoading(false);
      return;
    }

    const row = data as ProjectRow;
    setProject(row);
    setForm({
      project_name: row.project_name || '',
      status: (row.status as any) || 'Planning',
      start_date: row.start_date ? new Date(row.start_date).toISOString().split('T')[0] : '',
      location: (row.location || '') as string,
    });
    setLoading(false);
  };

  useEffect(() => {
    fetchProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const handleSave = async () => {
    if (isSaving) return;
    if (!project) return;
    const name = form.project_name.trim();
    if (!name) {
      toast.error('Project name is required');
      return;
    }

    setIsSaving(true);
    const payload: any = {
      project_name: name,
      status: form.status,
      start_date: form.start_date || null,
      location: form.location.trim() ? form.location.trim() : null,
    };

    const { error } = await supabase.from('projects').update(payload).eq('project_id', project.project_id);
    if (error) {
      console.error('Update project error:', error);
      toast.error(error.message || 'Failed to save project details');
      setIsSaving(false);
      return;
    }

    toast.success('Saved');
    await fetchProject();
    setIsSaving(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Info className="h-5 w-5 text-slate-500" /> Project Details
          </CardTitle>
          <Button onClick={handleSave} disabled={isSaving || loading || !project} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading project details...</div>
          ) : !project ? (
            <div className="text-center py-10 text-muted-foreground">Project not found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Project name</Label>
                <Input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} className="bg-white" />
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-slate-200 shadow-lg">
                    {PROJECT_STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="bg-white hover:bg-slate-50">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Start date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="bg-white" />
              </div>

              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="bg-white" placeholder="Optional" />
              </div>

              <div className="space-y-2">
                <Label>Project ID</Label>
                <Input value={String(project.project_id)} disabled className="bg-white" />
              </div>

              <div className="space-y-2">
                <Label>Client ID</Label>
                <Input value={project.client_id || '—'} disabled className="bg-white" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

