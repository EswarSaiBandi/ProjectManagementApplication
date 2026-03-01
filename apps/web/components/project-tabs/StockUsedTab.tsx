'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Box, Plus, Edit, Trash2, Search, Package } from 'lucide-react';

type StockUsedItem = {
  id: number;
  material_name: string;
  variant_name: string;
  quantity_used: number;
  metric: string;
  used_date: string;
  notes: string | null;
  recorded_by: string | null;
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
  allocated_units: number;
  used_units: number;
  returned_units: number;
  available_units: number;
};

export default function StockUsedTab({ projectId }: { projectId: string }) {
  const [stockUsed, setStockUsed] = useState<StockUsedItem[]>([]);
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
    units_used: '',
    notes: '',
    used_date: new Date().toISOString().split('T')[0]
  });
  
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);

  useEffect(() => {
    fetchStockUsed();
    fetchMaterials();
    fetchVariants();
    fetchProjectInventory();
  }, [projectId]);

  const fetchStockUsed = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('project_stock_used')
        .select(`
          *,
          material_variants!inner(variant_name, materials_master!inner(material_name, metric))
        `)
        .eq('project_id', projectId)
        .order('used_date', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((item: any) => ({
        id: item.id,
        material_name: item.material_variants?.materials_master?.material_name || 'Unknown',
        variant_name: item.material_variants?.variant_name || 'Unknown',
        quantity_used: item.quantity_used,
        metric: item.material_variants?.materials_master?.metric || '',
        used_date: item.used_date,
        notes: item.notes,
        recorded_by: item.recorded_by
      }));

      setStockUsed(formatted);
    } catch (error: any) {
      console.error('Error fetching stock used:', error);
      toast.error('Failed to load stock used data');
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

  const fetchProjectInventory = async () => {
    try {
      const { data, error } = await supabase
        .from('project_inventory')
        .select('variant_id, allocated_units, used_units, returned_units, available_units')
        .eq('project_id', projectId);

      if (!error) setProjectInventory(data || []);
    } catch (error: any) {
      console.error('Error fetching project inventory:', error);
    }
  };

  const handleMaterialChange = (materialId: string) => {
    setForm({ ...form, material_id: materialId, variant_id: '', units_used: '' });
    setSelectedVariant(null);
    // Only show variants that have inventory in this project
    const filtered = variants.filter(v => {
      if (v.material_id !== parseInt(materialId)) return false;
      const inv = projectInventory.find(pi => pi.variant_id === v.variant_id);
      return inv && inv.available_units > 0;
    });
    setFilteredVariants(filtered);
  };

  const handleVariantChange = (variantId: string) => {
    const variant = variants.find(v => v.variant_id === parseInt(variantId));
    setSelectedVariant(variant || null);
    setForm({ ...form, variant_id: variantId, units_used: '' });
  };

  const getCalculatedQuantity = () => {
    if (!form.units_used || !selectedVariant) return 0;
    const units = parseFloat(form.units_used);
    if (isNaN(units)) return 0;
    return units * selectedVariant.quantity_per_unit;
  };

  const getAvailableUnits = (variantId: number) => {
    const inv = projectInventory.find(pi => pi.variant_id === variantId);
    return inv ? inv.available_units : 0;
  };

  const handleSave = async () => {
    try {
      if (!form.material_id || !form.variant_id || !form.units_used) {
        toast.error('Please fill all required fields');
        return;
      }

      const units = parseFloat(form.units_used);
      if (isNaN(units) || units <= 0) {
        toast.error('Please enter valid number of units');
        return;
      }

      if (!selectedVariant) {
        toast.error('Please select a variant');
        return;
      }

      // Check against available inventory
      const available = getAvailableUnits(selectedVariant.variant_id);
      if (units > available) {
        toast.error(`Only ${available.toFixed(2)} units available in project inventory. You're trying to use ${units} units.`);
        return;
      }

      const calculatedQuantity = units * selectedVariant.quantity_per_unit;

      // Get current user
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id || null;

      const payload = {
        project_id: parseInt(projectId),
        variant_id: parseInt(form.variant_id),
        quantity_used: calculatedQuantity,
        used_date: form.used_date,
        notes: form.notes.trim() || null,
        recorded_by: userId
      };

      const { error } = await supabase
        .from('project_stock_used')
        .insert(payload);

      if (error) throw error;

      toast.success(`Stock usage recorded: ${units} units = ${calculatedQuantity.toFixed(2)} ${materials.find(m => m.material_id === selectedVariant.material_id)?.metric}`);
      setIsDialogOpen(false);
      resetForm();
      fetchStockUsed();
      fetchProjectInventory(); // Refresh inventory
    } catch (error: any) {
      console.error('Error saving stock used:', error);
      toast.error('Failed to record stock usage: ' + error.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this record?')) return;

    try {
      const { error } = await supabase
        .from('project_stock_used')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Record deleted successfully');
      fetchStockUsed();
    } catch (error: any) {
      console.error('Error deleting record:', error);
      toast.error('Failed to delete record');
    }
  };

  const resetForm = () => {
    setForm({
      material_id: '',
      variant_id: '',
      units_used: '',
      notes: '',
      used_date: new Date().toISOString().split('T')[0]
    });
    setFilteredVariants([]);
    setSelectedVariant(null);
  };

  const filteredStockUsed = stockUsed.filter(item =>
    item.material_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.variant_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalQuantityUsed = stockUsed.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Box className="h-5 w-5 text-slate-500" />
                Stock Used - Materials Consumed
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">
                Track materials that have been actually used/consumed in this project (supports decimal quantities)
              </p>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Record Usage
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-md">
                <DialogHeader>
                  <DialogTitle>Record Material Usage</DialogTitle>
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
                      onValueChange={handleVariantChange}
                      disabled={!form.material_id}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select variant" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {filteredVariants.length === 0 ? (
                          <div className="p-2 text-sm text-slate-500">No variants available in project inventory</div>
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
                    <Label>Number of Units Used * (e.g., 0.5 = half unit, 2.75 = 2.75 units)</Label>
                    {selectedVariant && (
                      <div className="text-xs text-slate-600 bg-green-50 border border-green-200 rounded px-2 py-1 mb-2">
                        Available: <span className="font-bold text-green-700">{getAvailableUnits(selectedVariant.variant_id).toFixed(2)} units</span> in project inventory
                      </div>
                    )}
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={selectedVariant ? getAvailableUnits(selectedVariant.variant_id) : undefined}
                      value={form.units_used}
                      onChange={(e) => setForm({ ...form, units_used: e.target.value })}
                      placeholder="e.g., 0.5, 1, 2.75"
                      className="bg-white"
                    />
                    {selectedVariant && form.units_used && (
                      <div className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded p-2">
                        <strong>Calculated:</strong> {form.units_used} × {selectedVariant.quantity_per_unit} {materials.find(m => m.material_id === selectedVariant.material_id)?.metric} = {' '}
                        <span className="font-bold text-blue-700">{getCalculatedQuantity().toFixed(2)} {materials.find(m => m.material_id === selectedVariant.material_id)?.metric}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Date Used *</Label>
                    <Input
                      type="date"
                      value={form.used_date}
                      onChange={(e) => setForm({ ...form, used_date: e.target.value })}
                      className="bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Notes (Optional)</Label>
                    <Input
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="e.g., Used for painting walls"
                      className="bg-white"
                    />
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button onClick={handleSave} className="flex-1 bg-blue-600 hover:bg-blue-700">
                      Record Usage
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
          <div className="mb-4 flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search materials..."
                className="pl-10 bg-white"
              />
            </div>
            <Badge variant="secondary" className="px-4 py-2">
              <Package className="h-4 w-4 mr-2" />
              {totalQuantityUsed} entries
            </Badge>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading stock usage data...</div>
          ) : filteredStockUsed.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Box className="h-10 w-10 mx-auto mb-3 opacity-50" />
              {stockUsed.length === 0 ? 'No stock usage recorded yet.' : 'No materials match your search.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead className="text-center">Quantity Used</TableHead>
                    <TableHead>Date Used</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStockUsed.map((item) => (
                    <TableRow key={item.id} className="hover:bg-slate-50">
                      <TableCell className="font-medium">{item.material_name}</TableCell>
                      <TableCell>{item.variant_name}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">
                          {item.quantity_used} {item.metric}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {new Date(item.used_date).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {item.notes || '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(item.id)}
                          className="h-8 w-8 p-0"
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
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
