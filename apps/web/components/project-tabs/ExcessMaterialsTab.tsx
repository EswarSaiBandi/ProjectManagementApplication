'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Recycle, Plus, Search, AlertCircle } from 'lucide-react';

type MaterialReturn = {
  return_id: number;
  return_number: string;
  material_name: string;
  variant_name: string | null;
  returned_quantity: number;
  number_of_units: number | null;
  metric: string;
  condition: string;
  reason: string | null;
  status: string;
  created_at: string;
};

type Material = {
  material_id: number;
  material_name: string;
  metric: string;
};

type Variant = {
  variant_id: number;
  material_id: number;
  variant_name: string;
  quantity_per_unit: number;
};

type ProjectInventoryItem = {
  variant_id: number;
  available_units: number;
};

export default function ExcessMaterialsTab({ projectId }: { projectId: string }) {
  const [returns, setReturns] = useState<MaterialReturn[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [filteredVariants, setFilteredVariants] = useState<Variant[]>([]);
  const [projectInventory, setProjectInventory] = useState<ProjectInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const [form, setForm] = useState({
    material_id: '',
    variant_id: '',
    number_of_units: '',
    returned_quantity: '',
    condition: 'Good',
    reason: ''
  });

  useEffect(() => {
    fetchReturns();
    fetchMaterials();
    fetchVariants();
    fetchProjectInventory();
  }, [projectId]);

  const fetchProjectInventory = async () => {
    try {
      const { data, error } = await supabase
        .from('project_inventory')
        .select('variant_id, available_units')
        .eq('project_id', projectId);

      if (!error) setProjectInventory(data || []);
    } catch (error: any) {
      console.error('Error fetching project inventory:', error);
    }
  };

  const fetchReturns = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('material_returns')
        .select(`
          *,
          materials_master!inner(material_name, metric),
          material_variants(variant_name)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((item: any) => ({
        return_id: item.return_id,
        return_number: item.return_number,
        material_name: item.materials_master?.material_name || 'Unknown',
        variant_name: item.material_variants?.variant_name || null,
        returned_quantity: item.returned_quantity,
        number_of_units: item.number_of_units,
        metric: item.materials_master?.metric || '',
        condition: item.condition,
        reason: item.reason,
        status: item.status,
        created_at: item.created_at
      }));

      setReturns(formatted);
    } catch (error: any) {
      console.error('Error fetching returns:', error);
      toast.error('Failed to load material returns');
    } finally {
      setLoading(false);
    }
  };

  const fetchMaterials = async () => {
    try {
      const { data, error } = await supabase
        .from('materials_master')
        .select('material_id, material_name, metric')
        .eq('is_active', true)
        .order('material_name');

      if (!error) setMaterials(data || []);
    } catch (error: any) {
      console.error('Error fetching materials:', error);
    }
  };

  const fetchVariants = async () => {
    try {
      const { data, error } = await supabase
        .from('material_variants')
        .select('variant_id, material_id, variant_name, quantity_per_unit')
        .eq('is_active', true)
        .order('variant_name');

      if (!error) setVariants(data || []);
    } catch (error: any) {
      console.error('Error fetching variants:', error);
    }
  };

  const handleMaterialChange = (materialId: string) => {
    setForm({ ...form, material_id: materialId, variant_id: '', returned_quantity: '', number_of_units: '' });
    // Only show variants that have available inventory in this project
    const filtered = variants.filter(v => {
      if (v.material_id !== parseInt(materialId)) return false;
      const inv = projectInventory.find(pi => pi.variant_id === v.variant_id);
      return inv && inv.available_units > 0;
    });
    setFilteredVariants(filtered);
  };

  const getAvailableUnits = (variantId: number) => {
    const inv = projectInventory.find(pi => pi.variant_id === variantId);
    return inv ? inv.available_units : 0;
  };

  const handleSave = async () => {
    try {
      if (!form.material_id || !form.variant_id || !form.number_of_units) {
        toast.error('Please fill all required fields');
        return;
      }

      const units = parseFloat(form.number_of_units);
      if (isNaN(units) || units <= 0) {
        toast.error('Please enter valid number of units');
        return;
      }

      // Validate against available inventory
      const selectedVariant = variants.find(v => v.variant_id === parseInt(form.variant_id));
      if (!selectedVariant) {
        toast.error('Please select a variant');
        return;
      }

      const available = getAvailableUnits(selectedVariant.variant_id);
      if (units > available) {
        toast.error(`Only ${available.toFixed(2)} units available in project. You're trying to return ${units} units.`);
        return;
      }

      const quantity = units * selectedVariant.quantity_per_unit;

      const payload = {
        project_id: parseInt(projectId),
        material_id: parseInt(form.material_id),
        variant_id: parseInt(form.variant_id),
        returned_quantity: quantity,
        number_of_units: units,
        condition: form.condition,
        reason: form.reason.trim() || null,
        status: 'Pending'
      };

      const { error } = await supabase
        .from('material_returns')
        .insert(payload);

      if (error) throw error;

      toast.success(`Return submitted: ${units} units = ${quantity.toFixed(2)} ${selectedVariant ? materials.find(m => m.material_id === selectedVariant.material_id)?.metric : ''}`);
      setIsDialogOpen(false);
      resetForm();
      fetchReturns();
      fetchProjectInventory();
    } catch (error: any) {
      console.error('Error saving return:', error);
      toast.error('Failed to submit return: ' + error.message);
    }
  };

  const resetForm = () => {
    setForm({
      material_id: '',
      variant_id: '',
      number_of_units: '',
      returned_quantity: '',
      condition: 'Good',
      reason: ''
    });
    setFilteredVariants([]);
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'Excellent': return 'bg-green-100 text-green-700';
      case 'Good': return 'bg-blue-100 text-blue-700';
      case 'Fair': return 'bg-yellow-100 text-yellow-700';
      case 'Damaged': return 'bg-orange-100 text-orange-700';
      case 'Unusable': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-100 text-yellow-700';
      case 'Accepted': return 'bg-green-100 text-green-700';
      case 'Rejected': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  const filteredReturns = returns.filter(r =>
    r.material_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.variant_name && r.variant_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Recycle className="h-5 w-5 text-green-600" />
                Excess Materials - Return to Store
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">
                Return surplus materials to store inventory for reuse in other projects
              </p>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-green-600 hover:bg-green-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Return Material
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-md">
                <DialogHeader>
                  <DialogTitle>Return Excess Material to Store</DialogTitle>
                  <DialogDescription>
                    Submit materials for store approval and return to inventory
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Material *</Label>
                    <Select value={form.material_id} onValueChange={handleMaterialChange}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select material" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {materials.map(m => (
                          <SelectItem key={m.material_id} value={m.material_id.toString()}>
                            {m.material_name} ({m.metric})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Variant *</Label>
                    <Select 
                      value={form.variant_id} 
                      onValueChange={(val) => setForm({ ...form, variant_id: val })}
                      disabled={!form.material_id}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select variant" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {filteredVariants.length === 0 ? (
                          <div className="p-2 text-sm text-slate-500">No variants available to return</div>
                        ) : (
                          filteredVariants.map(v => (
                            <SelectItem key={v.variant_id} value={v.variant_id.toString()}>
                              {v.variant_name} ({v.quantity_per_unit} {materials.find(m => m.material_id === v.material_id)?.metric})
                              {' - '}Available: {getAvailableUnits(v.variant_id).toFixed(2)} units
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Number of Units to Return * (e.g., 0.5, 1, 2.75)</Label>
                    {form.variant_id && (
                      <div className="text-xs text-slate-600 bg-green-50 border border-green-200 rounded px-2 py-1 mb-2">
                        Available: <span className="font-bold text-green-700">
                          {getAvailableUnits(parseInt(form.variant_id)).toFixed(2)} units
                        </span> in project
                      </div>
                    )}
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={form.variant_id ? getAvailableUnits(parseInt(form.variant_id)) : undefined}
                      value={form.number_of_units}
                      onChange={(e) => {
                        const units = e.target.value;
                        const selectedVariant = variants.find(v => v.variant_id === parseInt(form.variant_id));
                        const calculatedQty = units && selectedVariant ? parseFloat(units) * selectedVariant.quantity_per_unit : '';
                        setForm({ 
                          ...form, 
                          number_of_units: units,
                          returned_quantity: calculatedQty.toString()
                        });
                      }}
                      placeholder="e.g., 0.5, 1, 2.75"
                      className="bg-white"
                    />
                    {form.number_of_units && form.variant_id && (
                      <div className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded p-2">
                        <strong>Calculated:</strong> {form.number_of_units} × {variants.find(v => v.variant_id === parseInt(form.variant_id))?.quantity_per_unit} {materials.find(m => m.material_id === parseInt(form.material_id))?.metric} = {' '}
                        <span className="font-bold text-blue-700">
                          {form.returned_quantity} {materials.find(m => m.material_id === parseInt(form.material_id))?.metric}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Condition *</Label>
                    <Select value={form.condition} onValueChange={(val) => setForm({ ...form, condition: val })}>
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value="Excellent">Excellent</SelectItem>
                        <SelectItem value="Good">Good</SelectItem>
                        <SelectItem value="Fair">Fair</SelectItem>
                        <SelectItem value="Damaged">Damaged</SelectItem>
                        <SelectItem value="Unusable">Unusable</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Reason for Return (optional)</Label>
                    <Textarea
                      value={form.reason}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })}
                      placeholder="e.g., Over-ordered, project completed early"
                      className="bg-white"
                      rows={2}
                    />
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                    <p className="text-sm text-blue-800 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      Store will review and approve/reject this return before adding back to inventory
                    </p>
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button onClick={handleSave} className="flex-1 bg-green-600 hover:bg-green-700">
                      Submit Return
                    </Button>
                    <Button
                      onClick={() => {
                        setIsDialogOpen(false);
                        resetForm();
                      }}
                      variant="outline"
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
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
            <div className="text-center py-8 text-muted-foreground">Loading returns...</div>
          ) : filteredReturns.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Recycle className="h-10 w-10 mx-auto mb-3 opacity-50" />
              {returns.length === 0 ? 'No material returns yet.' : 'No returns match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Return #</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead className="text-center">Quantity</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReturns.map((ret) => (
                    <TableRow key={ret.return_id} className="hover:bg-slate-50">
                      <TableCell className="font-mono text-sm">{ret.return_number}</TableCell>
                      <TableCell className="font-medium">{ret.material_name}</TableCell>
                      <TableCell className="text-sm">{ret.variant_name || '—'}</TableCell>
                      <TableCell className="text-center">
                        <div>
                          <Badge variant="secondary">
                            {ret.returned_quantity} {ret.metric}
                          </Badge>
                          {ret.number_of_units && (
                            <div className="text-xs text-slate-500 mt-1">
                              {ret.number_of_units} units
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getConditionColor(ret.condition)}>
                          {ret.condition}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(ret.status)}>
                          {ret.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 max-w-xs truncate">
                        {ret.reason || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {new Date(ret.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
