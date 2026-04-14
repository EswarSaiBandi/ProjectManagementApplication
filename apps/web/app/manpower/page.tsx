'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, UserCheck, Building2, Users, ToggleLeft, ToggleRight, HardHat, ClipboardList, FolderKanban } from 'lucide-react';
import ManpowerPayslipsPanel from '@/components/manpower/ManpowerPayslipsPanel';
import { normalizePhoneDigits } from '@/lib/phone';

type RegistryEntry = {
  id: number;
  name: string;
  labour_type: 'In-House' | 'Outsourced';
  designation: string | null;
  monthly_salary: number | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

type ProjectOption = {
  project_id: number;
  project_name: string;
};

const EMPTY_FORM = {
  name: '',
  labour_type: 'In-House' as 'In-House' | 'Outsourced',
  designation: '',
  monthly_salary: '',
  phone: '',
  notes: '',
};

export default function ManpowerPage() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<RegistryEntry | null>(null);
  const [mainTab, setMainTab] = useState<'registry' | 'payslips'>('registry');
  const [activeTab, setActiveTab] = useState<'in-house' | 'outsourced'>('in-house');
  const [form, setForm] = useState(EMPTY_FORM);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
  const [projectTarget, setProjectTarget] = useState<RegistryEntry | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [alreadyAssignedProjectIds, setAlreadyAssignedProjectIds] = useState<number[]>([]);
  const [savingProjects, setSavingProjects] = useState(false);
  const [labourHasLoginById, setLabourHasLoginById] = useState<Record<number, boolean>>({});

  const fetch = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('labour_master')
      .select('*')
      .order('name');
    if (error) { toast.error('Failed to load: ' + error.message); }
    else {
      const rows = (data || []) as RegistryEntry[];
      setEntries(rows);
      const labourIds = rows.map((r) => r.id);
      if (labourIds.length === 0) {
        setLabourHasLoginById({});
      } else {
        const [{ data: profiles }, { data: linkedPmRows }] = await Promise.all([
          supabase.from('profiles').select('phone'),
          supabase
            .from('project_manpower')
            .select('labour_id, team_member_id')
            .in('labour_id', labourIds)
            .not('team_member_id', 'is', null),
        ]);
        const profilePhones = new Set(
          (profiles || [])
            .map((p: { phone?: string | null }) => normalizePhoneDigits(p.phone || null))
            .filter(Boolean)
        );
        const linkedLabourIds = new Set(
          (linkedPmRows || [])
            .map((r: { labour_id?: number | null }) => r.labour_id)
            .filter((x): x is number => x != null && Number.isFinite(Number(x)))
        );
        const nextMap: Record<number, boolean> = {};
        rows.forEach((r) => {
          const norm = normalizePhoneDigits(r.phone || null);
          nextMap[r.id] = linkedLabourIds.has(r.id) || (!!norm && profilePhones.has(norm));
        });
        setLabourHasLoginById(nextMap);
      }
    }
    setLoading(false);
  };

  const fetchProjects = async (): Promise<ProjectOption[]> => {
    const { data, error } = await supabase
      .from('projects')
      .select('project_id, project_name')
      .order('project_name');
    if (error) {
      toast.error('Failed to load projects: ' + error.message);
      setProjects([]);
      return [];
    }
    const rows = (data || []) as ProjectOption[];
    setProjects(rows);
    return rows;
  };

  useEffect(() => {
    void fetch();
    void fetchProjects();
  }, []);

  const inHouse    = entries.filter(e => e.labour_type === 'In-House');
  const outsourced = entries.filter(e => e.labour_type === 'Outsourced');

  const stats = useMemo(() => ({
    total:            entries.length,
    activeInHouse:    inHouse.filter(e => e.is_active).length,
    activeOutsourced: outsourced.filter(e => e.is_active).length,
  }), [entries, inHouse, outsourced]);

  const resetForm = () => { setForm({ ...EMPTY_FORM, labour_type: activeTab === 'in-house' ? 'In-House' : 'Outsourced' }); };

  const openNew = () => {
    setEditing(null);
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (e: RegistryEntry) => {
    setEditing(e);
    setForm({
      name:           e.name,
      labour_type:    e.labour_type,
      designation:    e.designation || '',
      monthly_salary: e.monthly_salary != null ? String(e.monthly_salary) : '',
      phone:          e.phone || '',
      notes:          e.notes || '',
    });
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (form.labour_type === 'In-House') {
      if (!form.monthly_salary.trim()) { toast.error('Monthly salary is required for in-house employees'); return; }
      const sal = Number(form.monthly_salary);
      if (!Number.isFinite(sal) || sal <= 0) { toast.error('Monthly salary must be a positive number'); return; }
    }

    setIsSaving(true);
    const { data: ud } = await supabase.auth.getUser();

    const payload: Record<string, unknown> = {
      name:           form.name.trim(),
      labour_type:    form.labour_type,
      designation:    form.designation.trim() || null,
      monthly_salary: form.labour_type === 'In-House' && form.monthly_salary.trim() ? Number(form.monthly_salary) : null,
      phone:          form.phone.trim() || null,
      notes:          form.notes.trim() || null,
      created_by:     ud.user?.id ?? null,
    };

    if (editing) {
      const { error } = await supabase.from('labour_master').update(payload).eq('id', editing.id);
      if (error) { toast.error(error.message); setIsSaving(false); return; }
      toast.success('Updated');
    } else {
      const { error } = await supabase.from('labour_master').insert([{ ...payload, is_active: true }]);
      if (error) { toast.error(error.message); setIsSaving(false); return; }
      toast.success('Added');
    }

    setIsOpen(false);
    setEditing(null);
    resetForm();
    await fetch();
    setIsSaving(false);
  };

  const toggleActive = async (e: RegistryEntry) => {
    const { error } = await supabase
      .from('labour_master')
      .update({ is_active: !e.is_active })
      .eq('id', e.id);
    if (error) { toast.error(error.message); return; }
    toast.success(e.is_active ? 'Deactivated' : 'Activated');
    setEntries(prev => prev.map(r => r.id === e.id ? { ...r, is_active: !r.is_active } : r));
  };

  const openProjectAssignment = async (entry: RegistryEntry) => {
    if (labourHasLoginById[entry.id]) {
      toast.error('This manpower has login. Assign project from Team/Access Management.');
      return;
    }
    setProjectTarget(entry);
    setIsProjectDialogOpen(true);
    try {
      let availableProjects = projects;
      if (availableProjects.length === 0) {
        availableProjects = await fetchProjects();
      }
      const { data, error } = await supabase
        .from('project_manpower')
        .select('project_id')
        .eq('labour_id', entry.id);
      if (error) throw error;
      const uniqueProjectIds = Array.from(
        new Set(
          (data || [])
            .map((r: { project_id?: number | null }) => r.project_id)
            .filter((x): x is number => x != null && Number.isFinite(Number(x)))
        )
      );
      setAlreadyAssignedProjectIds(uniqueProjectIds);
      setSelectedProjectIds(uniqueProjectIds);
      if (availableProjects.length === 0 && uniqueProjectIds.length > 0) {
        // Fallback: keep currently assigned projects visible in the picker
        setProjects(uniqueProjectIds.map((id) => ({ project_id: id, project_name: `Project #${id}` })));
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load assigned projects');
      setAlreadyAssignedProjectIds([]);
      setSelectedProjectIds([]);
    }
  };

  const saveProjectAssignment = async () => {
    if (!projectTarget) return;
    setSavingProjects(true);
    try {
      const { data: existingRows, error: existingErr } = await supabase
        .from('project_manpower')
        .select('project_id')
        .eq('labour_id', projectTarget.id);
      if (existingErr) throw existingErr;

      const existingProjectIds = new Set(
        (existingRows || [])
          .map((r: { project_id?: number | null }) => r.project_id)
          .filter((x): x is number => x != null && Number.isFinite(Number(x)))
      );
      const toInsert = selectedProjectIds
        .filter((pid) => !existingProjectIds.has(pid))
        .map((pid) => ({
          project_id: pid,
          labour_id: projectTarget.id,
          labor_type: projectTarget.labour_type,
          labour_type: projectTarget.labour_type,
          role: projectTarget.designation || projectTarget.name || 'Field staff',
          headcount: 1,
        }));
      const toRemove = Array.from(existingProjectIds).filter((pid) => !selectedProjectIds.includes(pid));

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('project_manpower').insert(toInsert);
        if (insErr) throw insErr;
      }
      if (toRemove.length > 0) {
        const { error: delErr } = await supabase
          .from('project_manpower')
          .delete()
          .eq('labour_id', projectTarget.id)
          .in('project_id', toRemove);
        if (delErr) throw delErr;
      }
      toast.success(`Assignments updated: +${toInsert.length}, -${toRemove.length}`);
      setIsProjectDialogOpen(false);
      setProjectTarget(null);
      setSelectedProjectIds([]);
      setAlreadyAssignedProjectIds([]);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to assign projects');
    } finally {
      setSavingProjects(false);
    }
  };

  const RegistryTable = ({ rows }: { rows: RegistryEntry[] }) => (
    rows.length === 0 ? (
      <div className="py-12 text-center text-muted-foreground text-sm">
        No entries yet. Click &ldquo;Add to registry&rdquo; to get started.
      </div>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Designation</TableHead>
            {rows[0]?.labour_type === 'In-House' && <TableHead className="w-[160px]">Monthly Salary</TableHead>}
            <TableHead className="w-[120px]">Phone</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-[90px]">Status</TableHead>
            <TableHead className="w-[210px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(e => (
            <TableRow key={e.id} className={e.is_active ? '' : 'opacity-50'}>
              <TableCell className="font-medium">{e.name}</TableCell>
              <TableCell className="text-slate-600">{e.designation || '—'}</TableCell>
              {e.labour_type === 'In-House' && (
                <TableCell className="font-semibold text-blue-700">
                  {e.monthly_salary != null ? `₹${Number(e.monthly_salary).toLocaleString('en-IN')}` : '—'}
                </TableCell>
              )}
              <TableCell className="text-sm text-slate-600">{e.phone || '—'}</TableCell>
              <TableCell className="text-sm text-slate-600 max-w-[200px] truncate">{e.notes || '—'}</TableCell>
              <TableCell>
                <Badge className={e.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}>
                  {e.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openProjectAssignment(e)}
                    title={labourHasLoginById[e.id] ? 'Has login: use Team/Access Management' : 'Assign projects'}
                    disabled={labourHasLoginById[e.id]}
                  >
                    <FolderKanban className="h-3.5 w-3.5 mr-1" />
                    {labourHasLoginById[e.id] ? 'Team access' : 'Projects'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(e)} title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActive(e)}
                    title={e.is_active ? 'Deactivate' : 'Activate'}
                    className={e.is_active ? 'text-amber-600 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'}
                  >
                    {e.is_active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Manpower</h2>
          <p className="text-muted-foreground mt-1">
            Manpower registry, project assignments, payslip-style statements, and manpower-related overhead
          </p>
        </div>
        {mainTab === 'registry' && (
          <Button onClick={openNew} className="bg-blue-600 hover:bg-blue-700 text-white shrink-0">
            <Plus className="h-4 w-4 mr-2" /> Add to registry
          </Button>
        )}
      </div>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'registry' | 'payslips')}>
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-2">
          <TabsTrigger value="registry" className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Registry
          </TabsTrigger>
          <TabsTrigger value="payslips" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Work &amp; payslips
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payslips" className="mt-0">
          <ManpowerPayslipsPanel />
        </TabsContent>

        <TabsContent value="registry" className="space-y-6 mt-0">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total registered</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">{stats.activeInHouse + stats.activeOutsourced} active</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In-house (active)</CardTitle>
            <UserCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeInHouse}</div>
            <p className="text-xs text-muted-foreground mt-1">of {inHouse.length} total in-house</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outsourced (active)</CardTitle>
            <Building2 className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeOutsourced}</div>
            <p className="text-xs text-muted-foreground mt-1">of {outsourced.length} total outsourced</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'in-house' | 'outsourced')}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="in-house" className="flex items-center gap-2">
                <UserCheck className="h-4 w-4" /> In-House ({inHouse.length})
              </TabsTrigger>
              <TabsTrigger value="outsourced" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Outsourced ({outsourced.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="in-house">
              {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : <RegistryTable rows={inHouse} />}
            </TabsContent>
            <TabsContent value="outsourced">
              {loading ? <div className="py-8 text-center text-muted-foreground">Loading...</div> : <RegistryTable rows={outsourced} />}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={isProjectDialogOpen}
        onOpenChange={(open) => {
          setIsProjectDialogOpen(open);
          if (!open) {
            setProjectTarget(null);
            setSelectedProjectIds([]);
            setAlreadyAssignedProjectIds([]);
          }
        }}
      >
        <DialogContent className="bg-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5" />
              Assign Projects
            </DialogTitle>
            <DialogDescription>
              {projectTarget
                ? `Assign one or more projects to ${projectTarget.name}. A single person can be assigned to multiple projects.`
                : 'Select projects to assign.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedProjectIds(projects.map((p) => p.project_id))}>
                Select all
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedProjectIds([])}>
                Clear
              </Button>
              <span className="text-xs text-muted-foreground">Already assigned: {alreadyAssignedProjectIds.length}</span>
              <span className="text-xs text-muted-foreground">Selected: {selectedProjectIds.length}</span>
            </div>
            <div className="max-h-[360px] overflow-y-auto rounded-md border p-2 space-y-1">
              {projects.length === 0 ? (
                <div className="text-sm text-muted-foreground px-2 py-1">
                  No projects found. Refresh page once; if this persists, check project read access/policies for your role.
                </div>
              ) : (
                projects.map((p) => {
                  const isAlreadyAssigned = alreadyAssignedProjectIds.includes(p.project_id);
                  const checked = selectedProjectIds.includes(p.project_id);
                  return (
                    <label key={p.project_id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setSelectedProjectIds((prev) =>
                            isChecked ? [...prev, p.project_id] : prev.filter((x) => x !== p.project_id)
                          );
                        }}
                      />
                      <span className="text-sm">
                        {p.project_name}
                        {isAlreadyAssigned ? ' (already assigned)' : ''}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProjectDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveProjectAssignment} disabled={savingProjects}>
              {savingProjects ? 'Saving...' : 'Save assignments'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) { setEditing(null); resetForm(); } }}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardHat className="h-5 w-5" />
              {editing ? 'Edit registry entry' : 'Add to manpower registry'}
            </DialogTitle>
            <DialogDescription>
              {form.labour_type === 'In-House'
                ? 'In-house employees have a fixed monthly salary. Bandwidth allocation is set per project in the Manpower tab.'
                : 'Outsourced contractors have no fixed salary here. Daily wage is entered per project assignment.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Role type *</Label>
              <Select
                value={form.labour_type}
                onValueChange={(v: 'In-House' | 'Outsourced') => setForm({ ...form, labour_type: v, monthly_salary: '' })}
              >
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="In-House">In-house (employee)</SelectItem>
                  <SelectItem value="Outsourced">Outsourced (contractor)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-white" placeholder="Full name" />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} className="bg-white" placeholder="e.g. Mason, Electrician" />
              </div>
            </div>

            {form.labour_type === 'In-House' && (
              <div className="space-y-2">
                <Label>Monthly Salary (₹) *</Label>
                <Input
                  type="number" min={0}
                  value={form.monthly_salary}
                  onChange={e => setForm({ ...form, monthly_salary: e.target.value })}
                  className="bg-white"
                  placeholder="e.g. 25000"
                />
                {form.monthly_salary && Number(form.monthly_salary) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Rate/day = ₹{(Number(form.monthly_salary) / 24).toFixed(0)} (salary ÷ 24 working days)
                  </p>
                )}
              </div>
            )}

            {form.labour_type === 'Outsourced' && (
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
                Daily wage for outsourced contractors is entered per project assignment, not here.
              </div>
            )}

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="bg-white" placeholder="Optional contact number" />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-white" placeholder="Optional" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {isSaving ? 'Saving...' : editing ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
