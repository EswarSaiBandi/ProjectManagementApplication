'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Plus, Pencil, Trash } from 'lucide-react';

type ManpowerRow = {
  id: number;
  project_id: number;
  role: string;
  headcount: number;
  start_date: string | null;
  end_date: string | null;
  rate_per_day: string | number | null;
  notes: string | null;
  created_at: string;
};

export default function ManpowerTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [rows, setRows] = useState<ManpowerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ManpowerRow | null>(null);

  const [form, setForm] = useState({
    role: '',
    headcount: '1',
    start_date: '',
    end_date: '',
    rate_per_day: '',
    notes: '',
  });

  const fetchRows = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('project_manpower')
      .select('*')
      .eq('project_id', numericProjectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch manpower error:', error);
      toast.error(error.message || 'Failed to load manpower');
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data || []) as ManpowerRow[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const resetForm = () => {
    setForm({ role: '', headcount: '1', start_date: '', end_date: '', rate_per_day: '', notes: '' });
  };

  const openNew = () => {
    setEditing(null);
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (r: ManpowerRow) => {
    setEditing(r);
    setForm({
      role: r.role || '',
      headcount: String(r.headcount ?? 1),
      start_date: r.start_date ? new Date(r.start_date).toISOString().split('T')[0] : '',
      end_date: r.end_date ? new Date(r.end_date).toISOString().split('T')[0] : '',
      rate_per_day: r.rate_per_day != null ? String(r.rate_per_day) : '',
      notes: r.notes || '',
    });
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!Number.isFinite(numericProjectId)) {
      toast.error('Invalid project');
      return;
    }

    const role = form.role.trim();
    if (!role) {
      toast.error('Role is required');
      return;
    }
    const headcount = Number(form.headcount);
    if (!Number.isFinite(headcount) || headcount <= 0) {
      toast.error('Headcount must be a positive number');
      return;
    }
    if (form.start_date && form.end_date && new Date(form.start_date) > new Date(form.end_date)) {
      toast.error('End date must be on or after start date');
      return;
    }

    const rateVal = form.rate_per_day.trim() === '' ? null : Number(form.rate_per_day);
    if (rateVal !== null && (!Number.isFinite(rateVal) || rateVal < 0)) {
      toast.error('Rate/day must be a valid non-negative number (or blank)');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload: any = {
      project_id: numericProjectId,
      role,
      headcount,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      rate_per_day: rateVal,
      notes: form.notes.trim() ? form.notes.trim() : null,
      created_by: userId,
    };

    if (editing) {
      const { error } = await supabase.from('project_manpower').update(payload).eq('id', editing.id);
      if (error) {
        console.error('Update manpower error:', error);
        toast.error(error.message || 'Failed to update');
        setIsSaving(false);
        return;
      }
      toast.success('Updated');
    } else {
      const { error } = await supabase.from('project_manpower').insert([payload]);
      if (error) {
        console.error('Insert manpower error:', error);
        toast.error(error.message || 'Failed to add');
        setIsSaving(false);
        return;
      }
      toast.success('Added');
    }

    setIsOpen(false);
    setEditing(null);
    resetForm();
    await fetchRows();
    setIsSaving(false);
  };

  const handleDelete = async (r: ManpowerRow) => {
    if (!confirm(`Delete manpower entry "${r.role}"?`)) return;
    const { error } = await supabase.from('project_manpower').delete().eq('id', r.id);
    if (error) {
      console.error('Delete manpower error:', error);
      toast.error(error.message || 'Failed to delete');
      return;
    }
    toast.success('Deleted');
    fetchRows();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-500" /> Manpower
          </CardTitle>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white max-w-xl">
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Manpower' : 'Add Manpower'}</DialogTitle>
                <DialogDescription>Track onsite manpower by role and headcount.</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Role *</Label>
                  <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="bg-white" placeholder="e.g. Mason / Carpenter" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Headcount *</Label>
                    <Input type="number" min={1} value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} className="bg-white" />
                  </div>
                  <div className="space-y-2">
                    <Label>Rate/day (optional)</Label>
                    <Input type="number" min={0} value={form.rate_per_day} onChange={(e) => setForm({ ...form, rate_per_day: e.target.value })} className="bg-white" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Start date</Label>
                    <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="bg-white" />
                  </div>
                  <div className="space-y-2">
                    <Label>End date</Label>
                    <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="bg-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-white" placeholder="Optional" />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading manpower...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No manpower entries yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-[120px] text-right">Headcount</TableHead>
                  <TableHead className="w-[160px]">Dates</TableHead>
                  <TableHead className="w-[140px] text-right">Rate/day</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[140px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">{r.role}</TableCell>
                    <TableCell className="text-right">{r.headcount}</TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {(r.start_date ? new Date(r.start_date).toLocaleDateString() : '—') +
                        ' → ' +
                        (r.end_date ? new Date(r.end_date).toLocaleDateString() : '—')}
                    </TableCell>
                    <TableCell className="text-right">{r.rate_per_day ?? '—'}</TableCell>
                    <TableCell className="text-sm text-slate-600">{r.notes || '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(r)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

