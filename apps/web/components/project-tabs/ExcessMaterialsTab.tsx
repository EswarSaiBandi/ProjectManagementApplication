'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Recycle, Plus, TrendingUp, Search, AlertTriangle } from 'lucide-react';

type ExcessMaterial = {
  excess_id: number;
  material_id: number;
  source_project_id: number | null;
  quantity: number;
  condition: string;
  return_date: string;
  location: string | null;
  status: string;
  reused_in_project_id: number | null;
  reused_at: string | null;
  notes: string | null;
  created_at: string;
  material_name?: string;
  material_unit?: string;
  source_project_name?: string;
  reused_project_name?: string;
};

type Material = {
  material_id: number;
  name: string;
  unit: string | null;
};

type Project = {
  project_id: number;
  name: string;
};

export default function ExcessMaterialsTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [excessMaterials, setExcessMaterials] = useState<ExcessMaterial[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isReuseOpen, setIsReuseOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedExcess, setSelectedExcess] = useState<ExcessMaterial | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [form, setForm] = useState({
    material_id: '',
    quantity: '',
    condition: 'Good',
    return_date: new Date().toISOString().split('T')[0],
    location: '',
    notes: '',
  });

  const [reuseForm, setReuseForm] = useState({
    reused_in_project_id: '',
    notes: '',
  });

  const fetchExcessMaterials = async () => {
    setLoading(true);
    
    // Fetch all excess materials (for store view) or project-specific
    const query = supabase
      .from('excess_materials')
      .select(`
        *,
        material_master!inner(name, unit),
        source_project:projects!excess_materials_source_project_id_fkey(name),
        reused_project:projects!excess_materials_reused_in_project_id_fkey(name)
      `)
      .order('return_date', { ascending: false });

    // If we have a project ID, show materials from this project or available for reuse
    if (Number.isFinite(numericProjectId)) {
      query.or(`source_project_id.eq.${numericProjectId},status.eq.Available`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Fetch excess materials error:', error);
      toast.error('Failed to load excess materials');
      setExcessMaterials([]);
    } else {
      const mapped = (data || []).map((e: any) => ({
        ...e,
        material_name: e.material_master?.name,
        material_unit: e.material_master?.unit,
        source_project_name: e.source_project?.name,
        reused_project_name: e.reused_project?.name,
      }));
      setExcessMaterials(mapped as ExcessMaterial[]);
    }
    setLoading(false);
  };

  const fetchMaterials = async () => {
    const { data, error } = await supabase
      .from('material_master')
      .select('material_id, name, unit')
      .order('name');

    if (!error && data) {
      setMaterials(data as Material[]);
    }
  };

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('project_id, name')
      .eq('status', 'Active')
      .order('name');

    if (!error && data) {
      setProjects(data as Project[]);
    }
  };

  useEffect(() => {
    fetchExcessMaterials();
    fetchMaterials();
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const resetForm = () => {
    setForm({
      material_id: '',
      quantity: '',
      condition: 'Good',
      return_date: new Date().toISOString().split('T')[0],
      location: '',
      notes: '',
    });
  };

  const openNew = () => {
    resetForm();
    setIsOpen(true);
  };

  const openReuse = (excess: ExcessMaterial) => {
    setSelectedExcess(excess);
    setReuseForm({
      reused_in_project_id: '',
      notes: '',
    });
    setIsReuseOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;

    if (!form.material_id) {
      toast.error('Please select a material');
      return;
    }

    const quantity = Number(form.quantity);
    if (!quantity || quantity <= 0) {
      toast.error('Quantity must be greater than 0');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload = {
      material_id: Number(form.material_id),
      source_project_id: Number.isFinite(numericProjectId) ? numericProjectId : null,
      quantity: quantity,
      condition: form.condition,
      return_date: form.return_date,
      location: form.location.trim() || null,
      status: 'Available',
      notes: form.notes.trim() || null,
      returned_by: userId,
    };

    const { error } = await supabase.from('excess_materials').insert([payload]);
    if (error) {
      console.error('Insert excess material error:', error);
      toast.error(error.message || 'Failed to record excess material');
      setIsSaving(false);
      return;
    }

    toast.success('Excess material recorded and added to stock');
    setIsOpen(false);
    resetForm();
    await fetchExcessMaterials();
    setIsSaving(false);
  };

  const handleReuse = async () => {
    if (!selectedExcess) return;

    if (!reuseForm.reused_in_project_id) {
      toast.error('Please select a project');
      return;
    }

    setIsSaving(true);

    const { error } = await supabase
      .from('excess_materials')
      .update({
        status: 'Reused',
        reused_in_project_id: Number(reuseForm.reused_in_project_id),
        reused_at: new Date().toISOString(),
        notes: selectedExcess.notes ? `${selectedExcess.notes}\n\nReused: ${reuseForm.notes}` : `Reused: ${reuseForm.notes}`,
      })
      .eq('excess_id', selectedExcess.excess_id);

    if (error) {
      console.error('Reuse material error:', error);
      toast.error(error.message || 'Failed to mark as reused');
      setIsSaving(false);
      return;
    }

    toast.success('Material marked as reused');
    setIsReuseOpen(false);
    setSelectedExcess(null);
    await fetchExcessMaterials();
    setIsSaving(false);
  };

  const handleScrap = async (excess: ExcessMaterial) => {
    if (!confirm('Mark this material as scrapped? This cannot be undone.')) return;

    const { error } = await supabase
      .from('excess_materials')
      .update({ status: 'Scrapped' })
      .eq('excess_id', excess.excess_id);

    if (error) {
      console.error('Scrap material error:', error);
      toast.error(error.message || 'Failed to mark as scrapped');
      return;
    }

    toast.success('Material marked as scrapped');
    await fetchExcessMaterials();
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'Excellent': return 'bg-green-100 text-green-800';
      case 'Good': return 'bg-blue-100 text-blue-800';
      case 'Fair': return 'bg-yellow-100 text-yellow-800';
      case 'Damaged': return 'bg-red-100 text-red-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Available': return 'bg-green-100 text-green-800';
      case 'Reserved': return 'bg-blue-100 text-blue-800';
      case 'Reused': return 'bg-purple-100 text-purple-800';
      case 'Scrapped': return 'bg-gray-100 text-gray-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const filteredMaterials = excessMaterials.filter(e =>
    (e.material_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (e.location || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const availableMaterials = filteredMaterials.filter(e => e.status === 'Available');
  const reusedMaterials = filteredMaterials.filter(e => e.status === 'Reused');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Recycle className="h-5 w-5 text-green-600" />
                Excess Materials & Waste Reduction
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">Track surplus materials for reuse in other projects</p>
            </div>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="bg-green-600 text-white hover:bg-green-700 h-9">
                  <Plus className="h-4 w-4 mr-2" /> Return Excess
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-xl">
                <DialogHeader>
                  <DialogTitle>Return Excess Material to Store</DialogTitle>
                  <DialogDescription>Record surplus materials for reuse in future projects</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>Material *</Label>
                    <Select value={form.material_id} onValueChange={(v) => setForm({ ...form, material_id: v })}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select material" />
                      </SelectTrigger>
                      <SelectContent className="bg-white max-h-60">
                        {materials.map(m => (
                          <SelectItem key={m.material_id} value={String(m.material_id)}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Quantity Returned *</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        value={form.quantity}
                        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Condition *</Label>
                      <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="Excellent">Excellent</SelectItem>
                          <SelectItem value="Good">Good</SelectItem>
                          <SelectItem value="Fair">Fair</SelectItem>
                          <SelectItem value="Damaged">Damaged</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Return Date</Label>
                      <Input
                        type="date"
                        value={form.return_date}
                        onChange={(e) => setForm({ ...form, return_date: e.target.value })}
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Storage Location</Label>
                      <Input
                        value={form.location}
                        onChange={(e) => setForm({ ...form, location: e.target.value })}
                        className="bg-white"
                        placeholder="e.g., Store Room A"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      className="bg-white"
                      rows={2}
                      placeholder="Reason for excess, quality notes, etc."
                    />
                  </div>

                  <div className="bg-green-50 border border-green-200 rounded p-3">
                    <p className="text-sm text-green-800">
                      <Recycle className="inline h-4 w-4 mr-1" />
                      Material will be added back to available stock for use in other projects.
                    </p>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                  <Button onClick={handleSave} disabled={isSaving} className="bg-green-600 text-white hover:bg-green-700">
                    {isSaving ? 'Recording...' : 'Record Excess'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Card className="bg-green-50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-green-600 mb-1">Available for Reuse</div>
                    <div className="text-2xl font-bold text-green-700">{availableMaterials.length}</div>
                  </div>
                  <TrendingUp className="h-8 w-8 text-green-400" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-purple-50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-purple-600 mb-1">Successfully Reused</div>
                    <div className="text-2xl font-bold text-purple-700">{reusedMaterials.length}</div>
                  </div>
                  <Recycle className="h-8 w-8 text-purple-400" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-blue-50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-blue-600 mb-1">Waste Reduction Value</div>
                    <div className="text-2xl font-bold text-blue-700">
                      ₹{reusedMaterials.reduce((sum, m) => sum + (m.quantity * 100), 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Search */}
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search materials or locations..."
              className="pl-10 bg-white"
            />
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : filteredMaterials.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Recycle className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No excess materials recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="w-[100px]">Quantity</TableHead>
                  <TableHead className="w-[100px]">Condition</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-[140px]">Returned From</TableHead>
                  <TableHead className="w-[140px]">Return Date</TableHead>
                  <TableHead className="w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMaterials.map((excess) => (
                  <TableRow key={excess.excess_id} className="hover:bg-slate-50">
                    <TableCell>
                      <div className="font-medium">{excess.material_name}</div>
                      {excess.notes && <div className="text-xs text-slate-500 mt-1">{excess.notes}</div>}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {excess.quantity} {excess.material_unit}
                    </TableCell>
                    <TableCell>
                      <Badge className={getConditionColor(excess.condition)}>
                        {excess.condition}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(excess.status)}>
                        {excess.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {excess.location || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {excess.source_project_name || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {new Date(excess.return_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {excess.status === 'Available' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openReuse(excess)}
                              className="text-purple-600 border-purple-300 hover:bg-purple-50"
                            >
                              <Recycle className="h-4 w-4 mr-1" />
                              Reuse
                            </Button>
                            {excess.condition === 'Damaged' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleScrap(excess)}
                                className="text-red-600"
                              >
                                <AlertTriangle className="h-4 w-4 mr-1" />
                                Scrap
                              </Button>
                            )}
                          </>
                        )}
                        {excess.status === 'Reused' && (
                          <span className="text-sm text-slate-500">
                            Reused in: {excess.reused_project_name}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reuse Material Dialog */}
      <Dialog open={isReuseOpen} onOpenChange={setIsReuseOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Reuse Material in Project</DialogTitle>
            <DialogDescription>
              Material: {selectedExcess?.material_name} ({selectedExcess?.quantity} {selectedExcess?.material_unit})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Select Project *</Label>
              <Select value={reuseForm.reused_in_project_id} onValueChange={(v) => setReuseForm({ ...reuseForm, reused_in_project_id: v })}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Choose project" />
                </SelectTrigger>
                <SelectContent className="bg-white max-h-60">
                  {projects.map(p => (
                    <SelectItem key={p.project_id} value={String(p.project_id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={reuseForm.notes}
                onChange={(e) => setReuseForm({ ...reuseForm, notes: e.target.value })}
                className="bg-white"
                rows={2}
                placeholder="Usage details or location in new project"
              />
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded p-3">
              <p className="text-sm text-purple-800">
                <Recycle className="inline h-4 w-4 mr-1" />
                Material will be marked as reused and deducted from available stock.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReuseOpen(false)}>Cancel</Button>
            <Button onClick={handleReuse} disabled={isSaving} className="bg-purple-600 text-white hover:bg-purple-700">
              {isSaving ? 'Recording...' : 'Mark as Reused'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
