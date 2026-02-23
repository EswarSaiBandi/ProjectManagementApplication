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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Package, Plus, CheckCircle, AlertCircle, TrendingDown, Search, Store, ShoppingCart } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

type MaterialAllocation = {
  allocation_id: number;
  material_id: number;
  project_id: number;
  allocated_quantity: number;
  allocation_date: string;
  required_by_date: string | null;
  status: string;
  issued_quantity: number;
  returned_quantity: number;
  notes: string | null;
  created_at: string;
  material_name?: string;
  material_unit?: string;
  material_stock?: number;
};

type Material = {
  material_id: number;
  name: string;
  category: string | null;
  unit: string | null;
  quantity: number;
};

export default function StockAllocationTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [allocations, setAllocations] = useState<MaterialAllocation[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedAllocation, setSelectedAllocation] = useState<MaterialAllocation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [form, setForm] = useState({
    material_id: '',
    source_type: 'In-Store',
    allocated_quantity: '',
    allocation_date: new Date().toISOString().split('T')[0],
    required_by_date: '',
    notes: '',
  });

  const [issueForm, setIssueForm] = useState({
    issued_quantity: '',
    notes: '',
  });

  const fetchAllocations = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    
    const { data, error } = await supabase
      .from('material_allocations')
      .select(`
        *,
        material_master!inner(name, unit, quantity)
      `)
      .eq('project_id', numericProjectId)
      .order('allocation_date', { ascending: false });

    if (error) {
      console.error('Fetch allocations error:', error);
      toast.error('Failed to load allocations');
      setAllocations([]);
    } else {
      const mapped = (data || []).map((a: any) => ({
        ...a,
        material_name: a.material_master?.name,
        material_unit: a.material_master?.unit,
        material_stock: a.material_master?.quantity,
      }));
      setAllocations(mapped as MaterialAllocation[]);
    }
    setLoading(false);
  };

  const fetchMaterials = async () => {
    const { data, error } = await supabase
      .from('material_master')
      .select('material_id, name, category, unit, quantity')
      .gt('quantity', 0)
      .order('name');

    if (!error && data) {
      setMaterials(data as Material[]);
    }
  };

  useEffect(() => {
    fetchAllocations();
    fetchMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const resetForm = () => {
    setForm({
      material_id: '',
      source_type: 'In-Store',
      allocated_quantity: '',
      allocation_date: new Date().toISOString().split('T')[0],
      required_by_date: '',
      notes: '',
    });
  };

  const openNew = () => {
    resetForm();
    setIsOpen(true);
  };

  const openIssue = (allocation: MaterialAllocation) => {
    setSelectedAllocation(allocation);
    setIssueForm({
      issued_quantity: String(allocation.allocated_quantity - allocation.issued_quantity - allocation.returned_quantity),
      notes: '',
    });
    setIsIssueOpen(true);
  };

  const checkAvailableStock = async (materialId: number, requestedQty: number): Promise<boolean> => {
    const { data, error } = await supabase.rpc('check_available_stock', {
      p_material_id: materialId,
      p_requested_quantity: requestedQty,
    });

    if (error) {
      console.error('Stock check error:', error);
      return false;
    }

    return data === true;
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!Number.isFinite(numericProjectId)) {
      toast.error('Invalid project');
      return;
    }

    if (!form.material_id) {
      toast.error('Please select a material');
      return;
    }

    const quantity = Number(form.allocated_quantity);
    if (!quantity || quantity <= 0) {
      toast.error('Quantity must be greater than 0');
      return;
    }

    setIsSaving(true);

    // Check available stock
    const isAvailable = await checkAvailableStock(Number(form.material_id), quantity);
    if (!isAvailable) {
      toast.error('Insufficient stock available for allocation');
      setIsSaving(false);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload = {
      material_id: Number(form.material_id),
      project_id: numericProjectId,
      source_type: form.source_type,
      allocated_quantity: quantity,
      allocation_date: form.allocation_date,
      required_by_date: form.required_by_date || null,
      status: 'Reserved',
      notes: form.notes.trim() || null,
      allocated_by: userId,
    };

    const { error } = await supabase.from('material_allocations').insert([payload]);
    if (error) {
      console.error('Insert allocation error:', error);
      toast.error(error.message || 'Failed to allocate material');
      setIsSaving(false);
      return;
    }

    toast.success('Material allocated successfully');
    setIsOpen(false);
    resetForm();
    await fetchAllocations();
    await fetchMaterials();
    setIsSaving(false);
  };

  const handleIssue = async () => {
    if (!selectedAllocation) return;

    const issuedQty = Number(issueForm.issued_quantity);
    if (!issuedQty || issuedQty <= 0) {
      toast.error('Issued quantity must be greater than 0');
      return;
    }

    const remainingToIssue = selectedAllocation.allocated_quantity - selectedAllocation.issued_quantity - selectedAllocation.returned_quantity;
    if (issuedQty > remainingToIssue) {
      toast.error(`Cannot issue more than ${remainingToIssue} ${selectedAllocation.material_unit}`);
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const newIssuedTotal = selectedAllocation.issued_quantity + issuedQty;
    const newStatus = newIssuedTotal >= selectedAllocation.allocated_quantity ? 'Issued' : 'Partially Issued';

    const { error } = await supabase
      .from('material_allocations')
      .update({
        issued_quantity: newIssuedTotal,
        status: newStatus,
        issued_by: userId,
        issued_at: new Date().toISOString(),
        notes: selectedAllocation.notes ? `${selectedAllocation.notes}\n\n${issueForm.notes}` : issueForm.notes,
      })
      .eq('allocation_id', selectedAllocation.allocation_id);

    if (error) {
      console.error('Issue material error:', error);
      toast.error(error.message || 'Failed to issue material');
      setIsSaving(false);
      return;
    }

    toast.success('Material issued successfully');
    setIsIssueOpen(false);
    setSelectedAllocation(null);
    await fetchAllocations();
    await fetchMaterials();
    setIsSaving(false);
  };

  const handleCancel = async (allocation: MaterialAllocation) => {
    if (!confirm('Cancel this allocation? Reserved stock will be released.')) return;

    const { error } = await supabase
      .from('material_allocations')
      .update({ status: 'Cancelled' })
      .eq('allocation_id', allocation.allocation_id);

    if (error) {
      console.error('Cancel allocation error:', error);
      toast.error(error.message || 'Failed to cancel allocation');
      return;
    }

    toast.success('Allocation cancelled');
    await fetchAllocations();
    await fetchMaterials();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Reserved': return 'bg-blue-100 text-blue-800';
      case 'Issued': return 'bg-green-100 text-green-800';
      case 'Partially Issued': return 'bg-yellow-100 text-yellow-800';
      case 'Returned': return 'bg-purple-100 text-purple-800';
      case 'Cancelled': return 'bg-gray-100 text-gray-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const filteredAllocations = allocations.filter(a =>
    (a.material_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="h-5 w-5 text-slate-500" />
                Stock Allocation & Tracking
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">Real-time material allocation with stock availability checking</p>
            </div>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                  <Plus className="h-4 w-4 mr-2" /> Allocate Material
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-xl">
                <DialogHeader>
                  <DialogTitle>Allocate Material to Project</DialogTitle>
                  <DialogDescription>Reserve materials from stock for this project</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Material *</Label>
                      <Select value={form.material_id} onValueChange={(v) => setForm({ ...form, material_id: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                        <SelectContent className="bg-white max-h-60">
                          {materials.map(m => (
                            <SelectItem key={m.material_id} value={String(m.material_id)}>
                              {m.name} - Available: {m.quantity} {m.unit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Source Type *</Label>
                      <Select value={form.source_type} onValueChange={(v) => setForm({ ...form, source_type: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="In-Store">
                            <div className="flex items-center gap-2">
                              <Store className="h-4 w-4 text-blue-600" />
                              In-Store
                            </div>
                          </SelectItem>
                          <SelectItem value="Market Purchase">
                            <div className="flex items-center gap-2">
                              <ShoppingCart className="h-4 w-4 text-green-600" />
                              Market Purchase
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Quantity to Allocate *</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        value={form.allocated_quantity}
                        onChange={(e) => setForm({ ...form, allocated_quantity: e.target.value })}
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Allocation Date</Label>
                      <Input
                        type="date"
                        value={form.allocation_date}
                        onChange={(e) => setForm({ ...form, allocation_date: e.target.value })}
                        className="bg-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Required By Date</Label>
                    <Input
                      type="date"
                      value={form.required_by_date}
                      onChange={(e) => setForm({ ...form, required_by_date: e.target.value })}
                      className="bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      className="bg-white"
                      rows={2}
                      placeholder="Optional notes"
                    />
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                    <p className="text-sm text-blue-800">
                      <AlertCircle className="inline h-4 w-4 mr-1" />
                      Stock availability will be checked before allocation to prevent double-allocation.
                    </p>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                  <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                    {isSaving ? 'Allocating...' : 'Allocate Material'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
          {/* Search */}
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search materials..."
              className="pl-10 bg-white"
            />
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading allocations...</div>
          ) : filteredAllocations.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No material allocations yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="w-[120px]">Allocated</TableHead>
                  <TableHead className="w-[120px]">Issued</TableHead>
                  <TableHead className="w-[120px]">Remaining</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[120px]">Required By</TableHead>
                  <TableHead className="w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAllocations.map((allocation) => {
                  const remaining = allocation.allocated_quantity - allocation.issued_quantity - allocation.returned_quantity;
                  return (
                    <TableRow key={allocation.allocation_id} className="hover:bg-slate-50">
                      <TableCell>
                        <div>
                          <div className="font-medium">{allocation.material_name}</div>
                          <div className="text-xs text-slate-500">
                            Current Stock: {allocation.material_stock} {allocation.material_unit}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold">
                        {allocation.allocated_quantity} {allocation.material_unit}
                      </TableCell>
                      <TableCell className="text-green-600">
                        {allocation.issued_quantity} {allocation.material_unit}
                      </TableCell>
                      <TableCell className={remaining > 0 ? 'text-blue-600 font-semibold' : 'text-slate-400'}>
                        {remaining} {allocation.material_unit}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(allocation.status)}>
                          {allocation.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {allocation.required_by_date ? new Date(allocation.required_by_date).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {allocation.status === 'Reserved' && remaining > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openIssue(allocation)}
                              className="text-green-600 border-green-300 hover:bg-green-50"
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Issue
                            </Button>
                          )}
                          {['Reserved', 'Partially Issued'].includes(allocation.status) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancel(allocation)}
                              className="text-red-600"
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Issue Material Dialog */}
      <Dialog open={isIssueOpen} onOpenChange={setIsIssueOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Issue Material</DialogTitle>
            <DialogDescription>
              Material: {selectedAllocation?.material_name}
            </DialogDescription>
          </DialogHeader>

          {selectedAllocation && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-50 p-3 rounded">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Allocated: <span className="font-semibold">{selectedAllocation.allocated_quantity} {selectedAllocation.material_unit}</span></div>
                  <div>Already Issued: <span className="font-semibold">{selectedAllocation.issued_quantity} {selectedAllocation.material_unit}</span></div>
                  <div className="col-span-2">
                    Remaining to Issue: <span className="font-semibold text-blue-600">
                      {selectedAllocation.allocated_quantity - selectedAllocation.issued_quantity - selectedAllocation.returned_quantity} {selectedAllocation.material_unit}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Quantity to Issue Now *</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={issueForm.issued_quantity}
                  onChange={(e) => setIssueForm({ ...issueForm, issued_quantity: e.target.value })}
                  className="bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={issueForm.notes}
                  onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })}
                  className="bg-white"
                  rows={2}
                  placeholder="Issued to which location/worker"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsIssueOpen(false)}>Cancel</Button>
            <Button onClick={handleIssue} disabled={isSaving} className="bg-green-600 text-white hover:bg-green-700">
              {isSaving ? 'Issuing...' : 'Issue Material'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
