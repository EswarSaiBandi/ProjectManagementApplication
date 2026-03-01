'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { Plus, Edit, Trash2, Package, Layers, Search, Filter } from 'lucide-react';
import { toast } from 'sonner';

interface Material {
  material_id: number;
  material_name: string;
  description: string | null;
  metric: string;
  is_active: boolean;
  created_at: string;
}

interface Variant {
  variant_id: number;
  material_id: number;
  variant_name: string;
  quantity_per_unit: number;
  is_active: boolean;
  material_name?: string;
}

const METRICS = ['Litres', 'Kgs', 'Tonnes', 'Sqft', 'Metres', 'Units', 'Pieces', 'Boxes', 'Bags'];

export default function MaterialsManagementPage() {
  
  const [materials, setMaterials] = useState<Material[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [metricFilter, setMetricFilter] = useState('All');
  const [materialFilter, setMaterialFilter] = useState('All');
  const [activeFilter, setActiveFilter] = useState('All');
  
  const [isMaterialDialogOpen, setIsMaterialDialogOpen] = useState(false);
  const [isVariantDialogOpen, setIsVariantDialogOpen] = useState(false);
  
  const [materialForm, setMaterialForm] = useState({
    material_id: null as number | null,
    material_name: '',
    description: '',
    metric: 'Litres'
  });
  
  const [variantForm, setVariantForm] = useState({
    variant_id: null as number | null,
    material_id: null as number | null,
    variant_name: '',
    quantity_per_unit: ''
  });

  useEffect(() => {
    fetchMaterials();
    fetchVariants();
  }, []);

  const fetchMaterials = async () => {
    try {
      if (!supabase) {
        throw new Error('Supabase client not initialized. Please check your environment variables.');
      }
      
      const { data, error } = await supabase
        .from('materials_master')
        .select('*')
        .order('material_name');
      
      if (error) throw error;
      setMaterials(data || []);
    } catch (error: any) {
      toast.error('Failed to load materials: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchVariants = async () => {
    try {
      if (!supabase) {
        throw new Error('Supabase client not initialized. Please check your environment variables.');
      }
      
      const { data, error } = await supabase
        .from('material_variants')
        .select(`
          *,
          materials_master!inner(material_name)
        `)
        .order('material_id')
        .order('quantity_per_unit', { ascending: false });
      
      if (error) throw error;
      
      const variantsWithNames = (data || []).map((v: any) => ({
        ...v,
        material_name: v.materials_master?.material_name
      }));
      
      setVariants(variantsWithNames);
    } catch (error: any) {
      toast.error('Failed to load variants: ' + error.message);
    }
  };

  const handleSaveMaterial = async () => {
    try {
      if (!materialForm.material_name.trim()) {
        toast.error('Material name is required');
        return;
      }

      const payload = {
        material_name: materialForm.material_name.trim(),
        description: materialForm.description.trim() || null,
        metric: materialForm.metric,
        is_active: true
      };

      if (materialForm.material_id) {
        // Update
        const { error } = await supabase
          .from('materials_master')
          .update(payload)
          .eq('material_id', materialForm.material_id);
        
        if (error) throw error;
        toast.success('Material updated successfully');
      } else {
        // Insert
        const { error } = await supabase
          .from('materials_master')
          .insert(payload);
        
        if (error) throw error;
        toast.success('Material created successfully');
      }

      setIsMaterialDialogOpen(false);
      resetMaterialForm();
      fetchMaterials();
    } catch (error: any) {
      toast.error('Failed to save material: ' + error.message);
    }
  };

  const handleSaveVariant = async () => {
    try {
      if (!variantForm.material_id) {
        toast.error('Please select a material');
        return;
      }
      if (!variantForm.variant_name.trim()) {
        toast.error('Variant name is required');
        return;
      }
      if (!variantForm.quantity_per_unit || parseFloat(variantForm.quantity_per_unit) <= 0) {
        toast.error('Valid quantity is required');
        return;
      }

      const payload = {
        material_id: variantForm.material_id,
        variant_name: variantForm.variant_name.trim(),
        quantity_per_unit: parseFloat(variantForm.quantity_per_unit),
        is_active: true
      };

      if (variantForm.variant_id) {
        // Update
        const { error } = await supabase
          .from('material_variants')
          .update(payload)
          .eq('variant_id', variantForm.variant_id);
        
        if (error) throw error;
        toast.success('Variant updated successfully');
      } else {
        // Insert
        const { error } = await supabase
          .from('material_variants')
          .insert(payload);
        
        if (error) throw error;
        toast.success('Variant created successfully');
      }

      setIsVariantDialogOpen(false);
      resetVariantForm();
      fetchVariants();
    } catch (error: any) {
      toast.error('Failed to save variant: ' + error.message);
    }
  };

  const handleEditMaterial = (material: Material) => {
    setMaterialForm({
      material_id: material.material_id,
      material_name: material.material_name,
      description: material.description || '',
      metric: material.metric
    });
    setIsMaterialDialogOpen(true);
  };

  const handleEditVariant = (variant: Variant) => {
    setVariantForm({
      variant_id: variant.variant_id,
      material_id: variant.material_id,
      variant_name: variant.variant_name,
      quantity_per_unit: variant.quantity_per_unit.toString()
    });
    setIsVariantDialogOpen(true);
  };

  const handleDeleteMaterial = async (materialId: number) => {
    if (!confirm('Are you sure? This will delete all variants of this material.')) return;
    
    try {
      const { error } = await supabase
        .from('materials_master')
        .delete()
        .eq('material_id', materialId);
      
      if (error) throw error;
      toast.success('Material deleted successfully');
      fetchMaterials();
      fetchVariants();
    } catch (error: any) {
      toast.error('Failed to delete material: ' + error.message);
    }
  };

  const handleDeleteVariant = async (variantId: number) => {
    if (!confirm('Are you sure you want to delete this variant?')) return;
    
    try {
      const { error } = await supabase
        .from('material_variants')
        .delete()
        .eq('variant_id', variantId);
      
      if (error) throw error;
      toast.success('Variant deleted successfully');
      fetchVariants();
    } catch (error: any) {
      toast.error('Failed to delete variant: ' + error.message);
    }
  };

  const toggleMaterialStatus = async (materialId: number, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('materials_master')
        .update({ is_active: !currentStatus })
        .eq('material_id', materialId);
      
      if (error) throw error;
      toast.success(`Material ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      fetchMaterials();
    } catch (error: any) {
      toast.error('Failed to update material status: ' + error.message);
    }
  };

  const toggleVariantStatus = async (variantId: number, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('material_variants')
        .update({ is_active: !currentStatus })
        .eq('variant_id', variantId);
      
      if (error) throw error;
      toast.success(`Variant ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      fetchVariants();
    } catch (error: any) {
      toast.error('Failed to update variant status: ' + error.message);
    }
  };

  const resetMaterialForm = () => {
    setMaterialForm({
      material_id: null,
      material_name: '',
      description: '',
      metric: 'Litres'
    });
  };

  const resetVariantForm = () => {
    setVariantForm({
      variant_id: null,
      material_id: null,
      variant_name: '',
      quantity_per_unit: ''
    });
  };

  const openNewMaterial = () => {
    resetMaterialForm();
    setIsMaterialDialogOpen(true);
  };

  const openNewVariant = () => {
    resetVariantForm();
    setIsVariantDialogOpen(true);
  };

  const filteredMaterials = materials.filter(material => {
    const matchesSearch = material.material_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (material.description && material.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesMetric = metricFilter === 'All' || material.metric === metricFilter;
    const matchesActive = activeFilter === 'All' || 
                         (activeFilter === 'Active' && material.is_active) ||
                         (activeFilter === 'Inactive' && !material.is_active);
    
    return matchesSearch && matchesMetric && matchesActive;
  });

  const filteredVariants = variants.filter(variant => {
    const matchesSearch = variant.variant_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMaterial = materialFilter === 'All' || variant.material_id === parseInt(materialFilter);
    const matchesActive = activeFilter === 'All' || 
                         (activeFilter === 'Active' && variant.is_active) ||
                         (activeFilter === 'Inactive' && !variant.is_active);
    
    return matchesSearch && matchesMaterial && matchesActive;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-slate-500">Loading materials...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Material Master</h1>
            <p className="text-slate-600 mt-1">Manage materials and their quantity variants</p>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-white shadow-sm">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search materials or variants..."
                    className="pl-9 bg-white"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-sm font-medium">Metric</Label>
                <Select value={metricFilter} onValueChange={setMetricFilter}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="All">All Metrics</SelectItem>
                    {METRICS.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Material (Variants)</Label>
                <Select value={materialFilter} onValueChange={setMaterialFilter}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="All">All Materials</SelectItem>
                    {materials.map(m => (
                      <SelectItem key={m.material_id} value={m.material_id.toString()}>
                        {m.material_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Status</Label>
                <Select value={activeFilter} onValueChange={setActiveFilter}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="All">All Status</SelectItem>
                    <SelectItem value="Active">Active Only</SelectItem>
                    <SelectItem value="Inactive">Inactive Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <div className="text-sm text-slate-600">
                Showing <span className="font-semibold">{filteredMaterials.length}</span> materials, 
                <span className="font-semibold ml-1">{filteredVariants.length}</span> variants
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setMetricFilter('All');
                  setMaterialFilter('All');
                  setActiveFilter('All');
                }}
                className="text-blue-600 hover:text-blue-700"
              >
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Materials Card */}
          <Card className="bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-blue-600" />
                  <CardTitle className="text-lg">Materials</CardTitle>
                </div>
                <Dialog open={isMaterialDialogOpen} onOpenChange={setIsMaterialDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openNewMaterial} size="sm" className="bg-blue-600 hover:bg-blue-700">
                      <Plus className="h-4 w-4 mr-1" /> Add Material
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-white max-w-md">
                    <DialogHeader>
                      <DialogTitle>
                        {materialForm.material_id ? 'Edit Material' : 'New Material'}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Material Name *</Label>
                        <Input
                          value={materialForm.material_name}
                          onChange={(e) => setMaterialForm({ ...materialForm, material_name: e.target.value })}
                          placeholder="e.g., Paint, Cement, Steel"
                          className="bg-white"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Metric *</Label>
                        <Select value={materialForm.metric} onValueChange={(v) => setMaterialForm({ ...materialForm, metric: v })}>
                          <SelectTrigger className="bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            {METRICS.map((m) => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          value={materialForm.description}
                          onChange={(e) => setMaterialForm({ ...materialForm, description: e.target.value })}
                          placeholder="Optional details about this material"
                          className="bg-white"
                          rows={3}
                        />
                      </div>

                      <div className="flex gap-2 pt-4">
                        <Button onClick={handleSaveMaterial} className="flex-1 bg-blue-600 hover:bg-blue-700">
                          {materialForm.material_id ? 'Update' : 'Create'}
                        </Button>
                        <Button
                          onClick={() => setIsMaterialDialogOpen(false)}
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
            <CardContent className="p-0">
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {filteredMaterials.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    {materials.length === 0 ? 'No materials yet. Create one to get started.' : 'No materials match your filters.'}
                  </div>
                ) : (
                  filteredMaterials.map((material) => (
                    <div key={material.material_id} className="p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-slate-900">{material.material_name}</h3>
                            <Badge variant="outline" className="text-xs">{material.metric}</Badge>
                            <Badge 
                              variant={material.is_active ? "default" : "secondary"} 
                              className={`text-xs ${material.is_active ? 'bg-green-100 text-green-700 border-green-300' : 'bg-gray-100 text-gray-600 border-gray-300'}`}
                            >
                              {material.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          {material.description && (
                            <p className="text-sm text-slate-600 mt-1">{material.description}</p>
                          )}
                          <div className="text-xs text-slate-500 mt-2">
                            Variants: {variants.filter(v => v.material_id === material.material_id).length}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            onClick={() => toggleMaterialStatus(material.material_id, material.is_active)}
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            title={material.is_active ? 'Deactivate material' : 'Activate material'}
                          >
                            {material.is_active ? 
                              <span className="text-orange-600">⏸</span> : 
                              <span className="text-green-600">▶</span>
                            }
                          </Button>
                          <Button
                            onClick={() => handleEditMaterial(material)}
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                          >
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button
                            onClick={() => handleDeleteMaterial(material.material_id)}
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Variants Card */}
          <Card className="bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-green-600" />
                  <CardTitle className="text-lg">Quantity Variants</CardTitle>
                </div>
                <Dialog open={isVariantDialogOpen} onOpenChange={setIsVariantDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openNewVariant} size="sm" className="bg-green-600 hover:bg-green-700">
                      <Plus className="h-4 w-4 mr-1" /> Add Variant
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-white max-w-md">
                    <DialogHeader>
                      <DialogTitle>
                        {variantForm.variant_id ? 'Edit Variant' : 'New Quantity Variant'}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Material *</Label>
                        <Select
                          value={variantForm.material_id?.toString()}
                          onValueChange={(v) => setVariantForm({ ...variantForm, material_id: parseInt(v) })}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select material" />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            {materials.filter(m => m.is_active).map((material) => (
                              <SelectItem key={material.material_id} value={material.material_id.toString()}>
                                {material.material_name} ({material.metric})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Variant Name *</Label>
                        <Input
                          value={variantForm.variant_name}
                          onChange={(e) => setVariantForm({ ...variantForm, variant_name: e.target.value })}
                          placeholder="e.g., 20L Can, 50Kg Bag"
                          className="bg-white"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Quantity per Unit *</Label>
                        <Input
                          type="number"
                          step="0.001"
                          value={variantForm.quantity_per_unit}
                          onChange={(e) => setVariantForm({ ...variantForm, quantity_per_unit: e.target.value })}
                          placeholder="e.g., 20, 50, 100"
                          className="bg-white"
                        />
                        <p className="text-xs text-slate-500">
                          {variantForm.material_id && materials.find(m => m.material_id === variantForm.material_id)?.metric}
                        </p>
                      </div>

                      <div className="flex gap-2 pt-4">
                        <Button onClick={handleSaveVariant} className="flex-1 bg-green-600 hover:bg-green-700">
                          {variantForm.variant_id ? 'Update' : 'Create'}
                        </Button>
                        <Button
                          onClick={() => setIsVariantDialogOpen(false)}
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
            <CardContent className="p-0">
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {filteredVariants.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    {variants.length === 0 ? 'No variants yet. Create variants for your materials.' : 'No variants match your filters.'}
                  </div>
                ) : (
                  filteredVariants.map((variant) => (
                    <div key={variant.variant_id} className="p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-900">{variant.variant_name}</h3>
                          <p className="text-sm text-slate-600 mt-1">
                            Material: <span className="font-medium">{variant.material_name}</span>
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="secondary" className="text-xs">
                              {variant.quantity_per_unit} {materials.find(m => m.material_id === variant.material_id)?.metric}
                            </Badge>
                            <Badge 
                              variant={variant.is_active ? "default" : "secondary"} 
                              className={`text-xs ${variant.is_active ? 'bg-green-100 text-green-700 border-green-300' : 'bg-gray-100 text-gray-600 border-gray-300'}`}
                            >
                              {variant.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            onClick={() => toggleVariantStatus(variant.variant_id, variant.is_active)}
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            title={variant.is_active ? 'Deactivate variant' : 'Activate variant'}
                          >
                            {variant.is_active ? 
                              <span className="text-orange-600">⏸</span> : 
                              <span className="text-green-600">▶</span>
                            }
                          </Button>
                          <Button
                            onClick={() => handleEditVariant(variant)}
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                          >
                            <Edit className="h-4 w-4 text-blue-600" />
                          </Button>
                          <Button
                            onClick={() => handleDeleteVariant(variant.variant_id)}
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
