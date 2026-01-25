'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, Plus, Pencil, Trash } from 'lucide-react';

type ChecklistRow = {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  created_at: string;
};

const STATUS_OPTIONS = ['Pending', 'In Progress', 'Done'] as const;

function statusBadgeClass(status: string) {
  const s = (status || '').toLowerCase();
  if (s.includes('done')) return 'bg-green-100 text-green-800';
  if (s.includes('progress')) return 'bg-blue-100 text-blue-800';
  return 'bg-yellow-100 text-yellow-800';
}

export default function ChecklistsTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ChecklistRow | null>(null);

  const [form, setForm] = useState({ title: '', description: '', status: 'Pending', due_date: '' });

  const fetchRows = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('project_checklist_items')
      .select('*')
      .eq('project_id', numericProjectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch checklist error:', error);
      toast.error(error.message || 'Failed to load checklist');
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((data || []) as ChecklistRow[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const resetForm = () => setForm({ title: '', description: '', status: 'Pending', due_date: '' });

  const openNew = () => {
    setEditing(null);
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (r: ChecklistRow) => {
    setEditing(r);
    setForm({
      title: r.title || '',
      description: r.description || '',
      status: r.status || 'Pending',
      due_date: r.due_date ? new Date(r.due_date).toISOString().split('T')[0] : '',
    });
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!Number.isFinite(numericProjectId)) {
      toast.error('Invalid project');
      return;
    }
    const title = form.title.trim();
    if (!title) {
      toast.error('Title is required');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload: any = {
      project_id: numericProjectId,
      title,
      description: form.description.trim() ? form.description.trim() : null,
      status: form.status,
      due_date: form.due_date || null,
      created_by: userId,
    };

    if (editing) {
      const { error } = await supabase.from('project_checklist_items').update(payload).eq('id', editing.id);
      if (error) {
        console.error('Update checklist error:', error);
        toast.error(error.message || 'Failed to update');
        setIsSaving(false);
        return;
      }
      toast.success('Updated');
    } else {
      const { error } = await supabase.from('project_checklist_items').insert([payload]);
      if (error) {
        console.error('Insert checklist error:', error);
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

  const handleDelete = async (r: ChecklistRow) => {
    if (!confirm(`Delete checklist item "${r.title}"?`)) return;
    const { error } = await supabase.from('project_checklist_items').delete().eq('id', r.id);
    if (error) {
      console.error('Delete checklist error:', error);
      toast.error(error.message || 'Failed to delete');
      return;
    }
    toast.success('Deleted');
    fetchRows();
  };

  const quickSetStatus = async (r: ChecklistRow, status: (typeof STATUS_OPTIONS)[number]) => {
    const { error } = await supabase.from('project_checklist_items').update({ status }).eq('id', r.id);
    if (error) {
      console.error('Quick status error:', error);
      toast.error(error.message || 'Failed to update status');
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-slate-500" /> Checklists
          </CardTitle>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white max-w-xl">
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Checklist Item' : 'Add Checklist Item'}</DialogTitle>
                <DialogDescription>Create and track project checklist items.</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Title *</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-white" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-slate-200 shadow-lg">
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s} className="bg-white hover:bg-slate-50">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Due date</Label>
                    <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="bg-white" />
                  </div>
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
            <div className="text-center py-8 text-muted-foreground">Loading checklist...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No checklist items yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-[160px]">Due</TableHead>
                  <TableHead className="w-[160px]">Status</TableHead>
                  <TableHead className="w-[240px]">Quick</TableHead>
                  <TableHead className="w-[140px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50">
                    <TableCell>
                      <div className="font-medium">{r.title}</div>
                      {r.description ? <div className="text-xs text-slate-500">{r.description}</div> : null}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{r.due_date ? new Date(r.due_date).toLocaleDateString() : '—'}</TableCell>
                    <TableCell>
                      <Badge className={statusBadgeClass(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {STATUS_OPTIONS.map((s) => (
                          <Button key={s} variant="outline" size="sm" onClick={() => quickSetStatus(r, s)} className="h-8">
                            {s}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
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

