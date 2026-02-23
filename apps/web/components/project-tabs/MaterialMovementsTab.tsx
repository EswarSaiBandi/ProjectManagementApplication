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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowDown, ArrowUp, Plus, TrendingUp, TrendingDown, Search, ShoppingCart, Store } from 'lucide-react';

type MaterialMovement = {
  movement_id: number;
  movement_type: 'Inward' | 'Outward';
  sub_type: string;
  material_id: number;
  project_id: number | null;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  movement_date: string;
  reference_type: string | null;
  supplier_name: string | null;
  invoice_number: string | null;
  notes: string | null;
  created_at: string;
  material_name?: string;
  material_unit?: string;
  project_name?: string;
};

type Material = {
  material_id: number;
  name: string;
  unit: string | null;
  quantity: number;
};

export default function MaterialMovementsTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [movements, setMovements] = useState<MaterialMovement[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'inward' | 'outward'>('inward');

  const [form, setForm] = useState({
    movement_type: 'Inward' as 'Inward' | 'Outward',
    sub_type: 'Purchase',
    source_type: 'In-Store',
    material_id: '',
    quantity: '',
    unit_cost: '',
    movement_date: new Date().toISOString().split('T')[0],
    supplier_name: '',
    invoice_number: '',
    notes: '',
  });

  const fetchMovements = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('material_movements')
      .select(`
        *,
        material_master!inner(name, unit)
      `)
      .eq('project_id', numericProjectId)
      .order('movement_date', { ascending: false });

    if (error) {
      console.error('Fetch movements error:', error);
      toast.error('Failed to load material movements');
      setMovements([]);
    } else {
      const mapped = (data || []).map((m: any) => ({
        ...m,
        material_name: m.material_master?.name,
        material_unit: m.material_master?.unit,
      }));
      setMovements(mapped as MaterialMovement[]);
    }
    setLoading(false);
  };

  const fetchMaterials = async () => {
    const { data, error } = await supabase
      .from('material_master')
      .select('material_id, name, unit, quantity')
      .order('name');

    if (!error && data) {
      setMaterials(data as Material[]);
    }
  };

  useEffect(() => {
    fetchMovements();
    fetchMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const resetForm = () => {
    setForm({
      movement_type: activeTab === 'inward' ? 'Inward' : 'Outward',
      sub_type: activeTab === 'inward' ? 'Purchase' : 'Utilization',
      source_type: 'In-Store',
      material_id: '',
      quantity: '',
      unit_cost: '',
      movement_date: new Date().toISOString().split('T')[0],
      supplier_name: '',
      invoice_number: '',
      notes: '',
    });
  };

  const openNew = () => {
    resetForm();
    setIsOpen(true);
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

    const quantity = Number(form.quantity);
    if (!quantity || quantity <= 0) {
      toast.error('Quantity must be greater than 0');
      return;
    }

    const unitCost = form.unit_cost ? Number(form.unit_cost) : null;
    if (unitCost !== null && unitCost < 0) {
      toast.error('Unit cost cannot be negative');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload = {
      movement_type: form.movement_type,
      sub_type: form.sub_type,
      source_type: form.source_type,
      material_id: Number(form.material_id),
      project_id: numericProjectId,
      quantity: quantity,
      unit_cost: unitCost,
      movement_date: form.movement_date,
      reference_type: 'Manual',
      supplier_name: form.supplier_name.trim() || null,
      invoice_number: form.invoice_number.trim() || null,
      notes: form.notes.trim() || null,
      created_by: userId,
    };

    const { error } = await supabase.from('material_movements').insert([payload]);
    if (error) {
      console.error('Insert movement error:', error);
      toast.error(error.message || 'Failed to record movement');
      setIsSaving(false);
      return;
    }

    // Update material stock manually for manual entries
    if (form.movement_type === 'Inward') {
      const { error: updateError } = await supabase.rpc('increment', {
        table_name: 'material_master',
        id_column: 'material_id',
        id_value: Number(form.material_id),
        amount_column: 'quantity',
        amount: quantity
      });
    } else {
      const { error: updateError } = await supabase.rpc('decrement', {
        table_name: 'material_master',
        id_column: 'material_id',
        id_value: Number(form.material_id),
        amount_column: 'quantity',
        amount: quantity
      });
    }

    toast.success('Material movement recorded');
    setIsOpen(false);
    resetForm();
    await fetchMovements();
    await fetchMaterials();
    setIsSaving(false);
  };

  const inwardMovements = movements.filter(m => m.movement_type === 'Inward');
  const outwardMovements = movements.filter(m => m.movement_type === 'Outward');

  const inwardTotal = inwardMovements.reduce((sum, m) => sum + (m.total_cost || 0), 0);
  const outwardTotal = outwardMovements.reduce((sum, m) => sum + (m.total_cost || 0), 0);

  const filteredMovements = (activeTab === 'inward' ? inwardMovements : outwardMovements).filter(m =>
    (m.material_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.supplier_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.invoice_number || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSubTypeColor = (subType: string) => {
    switch (subType) {
      case 'Purchase': return 'bg-green-100 text-green-800';
      case 'Purchase Return': return 'bg-red-100 text-red-800';
      case 'Issue': return 'bg-blue-100 text-blue-800';
      case 'Utilization': return 'bg-purple-100 text-purple-800';
      case 'Excess Return': return 'bg-yellow-100 text-yellow-800';
      case 'Adjustment': return 'bg-gray-100 text-gray-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-slate-500" />
                Material Movements (Inward & Outward)
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">Track purchases, returns, issues, and utilization with costs</p>
            </div>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                  <Plus className="h-4 w-4 mr-2" /> Record Movement
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-xl">
                <DialogHeader>
                  <DialogTitle>Record Material Movement</DialogTitle>
                  <DialogDescription>Log inward (purchase/return) or outward (issue/utilization) with costs</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Movement Type *</Label>
                      <Select value={form.movement_type} onValueChange={(v: 'Inward' | 'Outward') => {
                        setForm({ 
                          ...form, 
                          movement_type: v,
                          sub_type: v === 'Inward' ? 'Purchase' : 'Utilization'
                        });
                      }}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="Inward">Inward (Purchase/Return)</SelectItem>
                          <SelectItem value="Outward">Outward (Issue/Use)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Sub Type *</Label>
                      <Select value={form.sub_type} onValueChange={(v) => setForm({ ...form, sub_type: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {form.movement_type === 'Inward' ? (
                            <>
                              <SelectItem value="Purchase">Purchase</SelectItem>
                              <SelectItem value="Purchase Return">Purchase Return</SelectItem>
                              <SelectItem value="Adjustment">Adjustment</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value="Issue">Issue</SelectItem>
                              <SelectItem value="Utilization">Utilization</SelectItem>
                              <SelectItem value="Adjustment">Adjustment</SelectItem>
                            </>
                          )}
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

                  <div className="space-y-2">
                    <Label>Material *</Label>
                    <Select value={form.material_id} onValueChange={(v) => setForm({ ...form, material_id: v })}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select material" />
                      </SelectTrigger>
                      <SelectContent className="bg-white max-h-60">
                        {materials.map(m => (
                          <SelectItem key={m.material_id} value={String(m.material_id)}>
                            {m.name} - Stock: {m.quantity} {m.unit}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Quantity *</Label>
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
                      <Label>Unit Cost (₹)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.unit_cost}
                        onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Total Cost</Label>
                      <Input
                        value={form.quantity && form.unit_cost ? `₹${(Number(form.quantity) * Number(form.unit_cost)).toFixed(2)}` : '₹0.00'}
                        disabled
                        className="bg-slate-100"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Movement Date</Label>
                    <Input
                      type="date"
                      value={form.movement_date}
                      onChange={(e) => setForm({ ...form, movement_date: e.target.value })}
                      className="bg-white"
                    />
                  </div>

                  {form.movement_type === 'Inward' && form.sub_type === 'Purchase' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Supplier Name</Label>
                          <Input
                            value={form.supplier_name}
                            onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                            className="bg-white"
                            placeholder="Vendor/Supplier"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Invoice Number</Label>
                          <Input
                            value={form.invoice_number}
                            onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                            className="bg-white"
                            placeholder="INV-0001"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      className="bg-white"
                      rows={2}
                      placeholder="Purpose, location, or additional details"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                  <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                    {isSaving ? 'Recording...' : 'Record Movement'}
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
                    <div className="text-xs text-green-600 mb-1">Total Inward Cost</div>
                    <div className="text-2xl font-bold text-green-700">₹{inwardTotal.toLocaleString('en-IN')}</div>
                    <div className="text-xs text-slate-500 mt-1">{inwardMovements.length} transactions</div>
                  </div>
                  <ArrowDown className="h-8 w-8 text-green-400" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-red-50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-red-600 mb-1">Total Outward Cost</div>
                    <div className="text-2xl font-bold text-red-700">₹{outwardTotal.toLocaleString('en-IN')}</div>
                    <div className="text-xs text-slate-500 mt-1">{outwardMovements.length} transactions</div>
                  </div>
                  <ArrowUp className="h-8 w-8 text-red-400" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-blue-50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-blue-600 mb-1">Net Movement</div>
                    <div className="text-2xl font-bold text-blue-700">
                      ₹{(inwardTotal - outwardTotal).toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {inwardTotal > outwardTotal ? 'Surplus' : 'Deficit'}
                    </div>
                  </div>
                  {inwardTotal > outwardTotal ? (
                    <TrendingUp className="h-8 w-8 text-blue-400" />
                  ) : (
                    <TrendingDown className="h-8 w-8 text-blue-400" />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'inward' | 'outward')}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="inward" className="flex items-center gap-2">
                <ArrowDown className="h-4 w-4" />
                Inward ({inwardMovements.length})
              </TabsTrigger>
              <TabsTrigger value="outward" className="flex items-center gap-2">
                <ArrowUp className="h-4 w-4" />
                Outward ({outwardMovements.length})
              </TabsTrigger>
            </TabsList>

            {/* Search */}
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search materials, suppliers, invoices..."
                className="pl-10 bg-white"
              />
            </div>

            <TabsContent value="inward">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : filteredMovements.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <ArrowDown className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  No inward movements yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="w-[100px]">Quantity</TableHead>
                      <TableHead className="w-[120px]">Unit Cost</TableHead>
                      <TableHead className="w-[140px]">Total Cost</TableHead>
                      <TableHead>Supplier/Invoice</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMovements.map((m) => (
                      <TableRow key={m.movement_id} className="hover:bg-slate-50">
                        <TableCell className="text-sm">{new Date(m.movement_date).toLocaleDateString()}</TableCell>
                        <TableCell className="font-medium">{m.material_name}</TableCell>
                        <TableCell>
                          <Badge className={getSubTypeColor(m.sub_type)}>{m.sub_type}</Badge>
                        </TableCell>
                        <TableCell>{m.quantity} {m.material_unit}</TableCell>
                        <TableCell>{m.unit_cost ? `₹${m.unit_cost}` : '—'}</TableCell>
                        <TableCell className="font-semibold">₹{(m.total_cost || 0).toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {m.supplier_name && <div>{m.supplier_name}</div>}
                          {m.invoice_number && <div className="text-xs">{m.invoice_number}</div>}
                          {!m.supplier_name && !m.invoice_number && '—'}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{m.notes || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="outward">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : filteredMovements.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <ArrowUp className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  No outward movements yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="w-[100px]">Quantity</TableHead>
                      <TableHead className="w-[120px]">Unit Cost</TableHead>
                      <TableHead className="w-[140px]">Total Cost</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMovements.map((m) => (
                      <TableRow key={m.movement_id} className="hover:bg-slate-50">
                        <TableCell className="text-sm">{new Date(m.movement_date).toLocaleDateString()}</TableCell>
                        <TableCell className="font-medium">{m.material_name}</TableCell>
                        <TableCell>
                          <Badge className={getSubTypeColor(m.sub_type)}>{m.sub_type}</Badge>
                        </TableCell>
                        <TableCell>{m.quantity} {m.material_unit}</TableCell>
                        <TableCell>{m.unit_cost ? `₹${m.unit_cost}` : '—'}</TableCell>
                        <TableCell className="font-semibold">₹{(m.total_cost || 0).toLocaleString('en-IN')}</TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {m.reference_type || '—'}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{m.notes || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
