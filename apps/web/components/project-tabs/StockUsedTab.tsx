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
  variant_id: number;
  material_id: number;
  material_name: string;
  variant_name: string;
  quantity_used: number;
  cost_per_unit: number | null;
  quantity_per_unit: number;
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
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StockUsedItem | null>(null);

  const [form, setForm] = useState({
    material_id: '',
    variant_id: '',
    units_used: '',
    cost_per_unit: '',
    notes: '',
    used_date: new Date().toISOString().split('T')[0]
  });

  const [editForm, setEditForm] = useState({
    units_used: '',
    cost_per_unit: '',
    notes: '',
    used_date: ''
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
          material_variants!inner(variant_name, quantity_per_unit, materials_master!inner(material_id, material_name, metric))
        `)
        .eq('project_id', projectId)
        .order('used_date', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((item: any) => ({
        id: item.id,
        variant_id: item.variant_id,
        material_id: item.material_variants?.materials_master?.material_id ?? 0,
        material_name: item.material_variants?.materials_master?.material_name || 'Unknown',
        variant_name: item.material_variants?.variant_name || 'Unknown',
        quantity_used: item.quantity_used,
        cost_per_unit: item.cost_per_unit ?? 0,
        quantity_per_unit: item.material_variants?.quantity_per_unit ?? 1,
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

  const getInventoryRow = (variantId: number) =>
    projectInventory.find(pi => pi.variant_id === variantId);

  const getAvailableUnits = (variantId: number) => {
    const inv = getInventoryRow(variantId);
    return inv ? inv.available_units : 0;
  };

  const getFreshInventoryRow = async (variantId: number) => {
    const { data, error } = await supabase
      .from('project_inventory')
      .select('used_units, available_units')
      .eq('project_id', parseInt(projectId))
      .eq('variant_id', variantId)
      .single();
    if (error || !data) throw new Error('Unable to fetch latest project inventory');
    return data;
  };

  const handleMaterialChange = (materialId: string) => {
    setForm({ ...form, material_id: materialId, variant_id: '', units_used: '' });
    setSelectedVariant(null);
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

  // ─── helpers to sync project_inventory ───────────────────────────────────────

  const notifyInventoryUpdated = () => {
    window.dispatchEvent(
      new CustomEvent('inventory-updated', { detail: { projectId } })
    );
  };

  const notifyMovementUpdated = () => {
    window.dispatchEvent(
      new CustomEvent('material-movements-updated', { detail: { projectId } })
    );
  };

  const adjustInventory = async (
    variantId: number,
    deltaUnits: number  // positive = more used, negative = restoring
  ) => {
    // Always fetch fresh from DB — never rely on potentially stale React state
    const { data: fresh, error: fetchErr } = await supabase
      .from('project_inventory')
      .select('used_units, available_units')
      .eq('project_id', parseInt(projectId))
      .eq('variant_id', variantId)
      .single();

    if (fetchErr || !fresh) {
      console.error('adjustInventory: row not found for variant', variantId, fetchErr);
      throw new Error('Project inventory row not found for selected variant');
    }

    const newUsed      = Number(fresh.used_units)      + deltaUnits;
    const newAvailable = Number(fresh.available_units) - deltaUnits;
    if (newUsed < -0.0001 || newAvailable < -0.0001) {
      throw new Error('Inventory update would result in negative units');
    }

    const { error } = await supabase
      .from('project_inventory')
      .update({
        used_units:      newUsed,
      })
      .eq('project_id', parseInt(projectId))
      .eq('variant_id', variantId);

    if (error) {
      console.error('Inventory sync error:', error);
      throw error;
    }
    notifyInventoryUpdated();
  };

  const logMovement = async (
    materialId: number,
    variantId: number,
    movementType: 'Project Out' | 'Project In',
    quantityMetric: number,
    numUnits: number,
    notes: string,
    userId: string | null
  ) => {
    const { error } = await supabase.from('material_movement_logs').insert({
      material_id: materialId,
      variant_id: variantId,
      movement_type: movementType,
      project_id: parseInt(projectId),
      quantity: quantityMetric,
      number_of_units: numUnits,
      reference_type: 'Manual Adjustment',
      notes,
      created_by: userId,
    });
    if (error) {
      console.error('Movement log error:', error);
      throw error;
    }
    notifyMovementUpdated();
  };

  // ─── Insert ───────────────────────────────────────────────────────────────────

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
      const costPerUnit = parseFloat(form.cost_per_unit);
      if (isNaN(costPerUnit) || costPerUnit < 0) {
        toast.error('Please enter valid cost per unit');
        return;
      }

      if (!selectedVariant) {
        toast.error('Please select a variant');
        return;
      }

      const fresh = await getFreshInventoryRow(selectedVariant.variant_id);
      const available = Number(fresh.available_units);
      if (units > available + 0.0001) {
        toast.error(`Only ${available.toFixed(2)} units available. You are trying to use ${units} units.`);
        return;
      }

      const calculatedQuantity = units * selectedVariant.quantity_per_unit;
      const matName = materials.find(m => m.material_id === selectedVariant.material_id);

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id || null;

      const { data: inserted, error } = await supabase.from('project_stock_used').insert({
        project_id: parseInt(projectId),
        variant_id: parseInt(form.variant_id),
        quantity_used: calculatedQuantity,
        cost_per_unit: costPerUnit,
        used_date: form.used_date,
        notes: form.notes.trim() || null,
        recorded_by: userId,
      }).select('id').single();

      if (error) {
        throw error;
      }

      toast.success(`Stock usage recorded: ${units} units = ${calculatedQuantity.toFixed(2)} ${matName?.metric ?? ''}`);
      setIsDialogOpen(false);
      resetForm();
      fetchStockUsed();
      fetchProjectInventory();
    } catch (error: any) {
      console.error('Error saving stock used:', error);
      toast.error('Failed to record stock usage: ' + error.message);
    }
  };

  // ─── Edit ─────────────────────────────────────────────────────────────────────

  const openEdit = (item: StockUsedItem) => {
    setEditing(item);
    const currentUnits = item.quantity_per_unit > 0
      ? item.quantity_used / item.quantity_per_unit
      : item.quantity_used;
    setEditForm({
      units_used: currentUnits.toString(),
      cost_per_unit: (item.cost_per_unit ?? 0).toString(),
      notes: item.notes || '',
      used_date: item.used_date,
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdate = async () => {
    if (!editing) return;
    try {
      const newUnits = parseFloat(editForm.units_used);
      if (isNaN(newUnits) || newUnits <= 0) {
        toast.error('Please enter valid number of units');
        return;
      }
      const costPerUnit = parseFloat(editForm.cost_per_unit);
      if (isNaN(costPerUnit) || costPerUnit < 0) {
        toast.error('Please enter valid cost per unit');
        return;
      }

      const oldUnits = editing.quantity_per_unit > 0
        ? editing.quantity_used / editing.quantity_per_unit
        : editing.quantity_used;

      const deltaUnits = newUnits - oldUnits;

      // Fresh inventory cross-check before saving (prevents stale UI race)
      if (deltaUnits > 0) {
        const fresh = await getFreshInventoryRow(editing.variant_id);
        const available = Number(fresh.available_units);
        if (deltaUnits > available + 0.0001) {
          toast.error(`Only ${available.toFixed(2)} additional units available in project inventory.`);
          return;
        }
      }

      const newQuantityMetric = newUnits * editing.quantity_per_unit;

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id || null;

      if (Math.abs(deltaUnits) > 0.0001) {
        await adjustInventory(editing.variant_id, deltaUnits);
      }

      // Update the stock used record
      const { error } = await supabase
        .from('project_stock_used')
        .update({
          quantity_used: newQuantityMetric,
          cost_per_unit: costPerUnit,
          used_date: editForm.used_date,
          notes: editForm.notes.trim() || null,
        })
        .eq('id', editing.id);

      if (error) {
        if (Math.abs(deltaUnits) > 0.0001) {
          await adjustInventory(editing.variant_id, -deltaUnits);
        }
        throw error;
      }

      // Log movement if quantity changed
      if (Math.abs(deltaUnits) > 0.0001) {
        const deltaQty = newQuantityMetric - editing.quantity_used;
        await logMovement(
          editing.material_id,
          editing.variant_id,
          deltaUnits > 0 ? 'Project Out' : 'Project In',
          Math.abs(deltaQty),
          Math.abs(deltaUnits),
          `Stock usage updated: ${deltaUnits > 0 ? '+' : ''}${deltaUnits.toFixed(3)} units (${deltaQty > 0 ? '+' : ''}${deltaQty.toFixed(2)} ${editing.metric})`,
          userId
        );
      }

      toast.success('Stock usage updated');
      setIsEditDialogOpen(false);
      setEditing(null);
      fetchStockUsed();
      fetchProjectInventory();
    } catch (error: any) {
      console.error('Error updating stock used:', error);
      toast.error('Failed to update: ' + error.message);
    }
  };

  // ─── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = async (item: StockUsedItem) => {
    if (!confirm(`Delete usage of ${item.quantity_used} ${item.metric} (${item.material_name} - ${item.variant_name})? This will restore the quantity to project inventory.`)) return;

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id || null;

      const unitsToRestore = item.quantity_per_unit > 0
        ? item.quantity_used / item.quantity_per_unit
        : item.quantity_used;

      await adjustInventory(item.variant_id, -unitsToRestore);

      const { error } = await supabase
        .from('project_stock_used')
        .delete()
        .eq('id', item.id);

      if (error) {
        await adjustInventory(item.variant_id, unitsToRestore);
        throw error;
      }

      // Log the reversal as inward movement
      await logMovement(
        item.material_id,
        item.variant_id,
        'Project In',
        item.quantity_used,
        unitsToRestore,
        `Stock usage record deleted — ${item.quantity_used} ${item.metric} restored to project inventory`,
        userId
      );

      toast.success('Record deleted and inventory restored');
      fetchStockUsed();
      fetchProjectInventory();
    } catch (error: any) {
      console.error('Error deleting record:', error);
      toast.error('Failed to delete record: ' + error.message);
    }
  };

  const resetForm = () => {
    setForm({
      material_id: '',
      variant_id: '',
      units_used: '',
      cost_per_unit: '',
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
                Track materials consumed in this project. Changes automatically sync project inventory and movement logs.
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
                              {' — '}Available: {getAvailableUnits(v.variant_id).toFixed(2)} units
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Units Used * (e.g., 0.5 = half unit)</Label>
                    {selectedVariant && (
                      <div className="text-xs text-slate-600 bg-green-50 border border-green-200 rounded px-2 py-1 mb-2">
                        Available: <span className="font-bold text-green-700">{getAvailableUnits(selectedVariant.variant_id).toFixed(2)} units</span>
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
                        <strong>Calculated:</strong> {form.units_used} × {selectedVariant.quantity_per_unit} {materials.find(m => m.material_id === selectedVariant.material_id)?.metric} ={' '}
                        <span className="font-bold text-blue-700">
                          {getCalculatedQuantity().toFixed(2)} {materials.find(m => m.material_id === selectedVariant.material_id)?.metric}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Cost Per Unit *</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cost_per_unit}
                      onChange={(e) => setForm({ ...form, cost_per_unit: e.target.value })}
                      placeholder="e.g., 250.00"
                      className="bg-white"
                    />
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
                      onClick={() => { setIsDialogOpen(false); resetForm(); }}
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
                    <TableHead className="text-center w-[90px]">Units Used</TableHead>
                    <TableHead className="text-center">Qty Used</TableHead>
                    <TableHead className="text-right">Cost/Unit</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead>Date Used</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-center w-[90px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStockUsed.map((item) => {
                    const unitsUsed = item.quantity_per_unit > 0
                      ? item.quantity_used / item.quantity_per_unit
                      : item.quantity_used;
                    return (
                    <TableRow key={item.id} className="hover:bg-slate-50">
                      <TableCell className="font-medium">{item.material_name}</TableCell>
                      <TableCell>{item.variant_name}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-blue-700 border-blue-300">
                          {unitsUsed % 1 === 0 ? unitsUsed : unitsUsed.toFixed(3)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{item.quantity_used} {item.metric}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ₹{Number(item.cost_per_unit ?? 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        ₹{(unitsUsed * Number(item.cost_per_unit ?? 0)).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {new Date(item.used_date).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{item.notes || '—'}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(item)}
                            className="h-8 w-8 p-0"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(item)}
                            className="h-8 w-8 p-0"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => { setIsEditDialogOpen(open); if (!open) setEditing(null); }}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Stock Usage</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-700">
                <div className="font-medium">{editing.material_name} — {editing.variant_name}</div>
                <div className="text-xs text-slate-500 mt-1">
                  1 unit = {editing.quantity_per_unit} {editing.metric} &nbsp;|&nbsp;
                  Currently: {editing.quantity_used} {editing.metric}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Units Used *</Label>
                {(() => {
                  const inv = getInventoryRow(editing.variant_id);
                  const currentUnits = editing.quantity_per_unit > 0
                    ? editing.quantity_used / editing.quantity_per_unit
                    : editing.quantity_used;
                  const maxAllowed = currentUnits + (inv ? inv.available_units : 0);
                  return (
                    <>
                      <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                        Can increase by up to <strong>{inv ? inv.available_units.toFixed(2) : '0'}</strong> more units (currently using {currentUnits.toFixed(3)})
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={maxAllowed}
                        value={editForm.units_used}
                        onChange={(e) => setEditForm({ ...editForm, units_used: e.target.value })}
                        className="bg-white"
                      />
                      {editForm.units_used && !isNaN(parseFloat(editForm.units_used)) && (
                        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                          New quantity: {(parseFloat(editForm.units_used) * editing.quantity_per_unit).toFixed(2)} {editing.metric}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="space-y-2">
                <Label>Cost Per Unit *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.cost_per_unit}
                  onChange={(e) => setEditForm({ ...editForm, cost_per_unit: e.target.value })}
                  className="bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label>Date Used *</Label>
                <Input
                  type="date"
                  value={editForm.used_date}
                  onChange={(e) => setEditForm({ ...editForm, used_date: e.target.value })}
                  className="bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  placeholder="e.g., Used for painting walls"
                  className="bg-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleUpdate} className="flex-1 bg-blue-600 hover:bg-blue-700">
                  Save Changes
                </Button>
                <Button
                  onClick={() => { setIsEditDialogOpen(false); setEditing(null); }}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
