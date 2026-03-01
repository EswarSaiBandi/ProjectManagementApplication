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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { Plus, Package, ClipboardList, TrendingUp, Bell, Check, X, Edit } from 'lucide-react';
import { toast } from 'sonner';

interface Material {
  material_id: number;
  material_name: string;
  metric: string;
}

interface Variant {
  variant_id: number;
  material_id: number;
  variant_name: string;
  quantity_per_unit: number;
}

interface StoreInventory {
  inventory_id: number;
  material_id: number;
  variant_id: number;
  number_of_units: number;
  total_quantity: number;
  location: string | null;
  notes: string | null;
  last_updated: string;
  material_name?: string;
  variant_name?: string;
  quantity_per_unit?: number;
  metric?: string;
}

interface MaterialRequest {
  request_id: number;
  request_number: string;
  project_id: number;
  material_id: number;
  requested_quantity: number;
  request_source: string;
  priority: string;
  required_by: string | null;
  purpose: string | null;
  status: string;
  created_at: string;
  project_name?: string;
  material_name?: string;
  metric?: string;
}

interface MaterialReturn {
  return_id: number;
  return_number: string;
  project_id: number;
  material_id: number;
  variant_id: number | null;
  returned_quantity: number;
  number_of_units: number | null;
  condition: string;
  reason: string | null;
  status: string;
  created_at: string;
  project_name?: string;
  material_name?: string;
  variant_name?: string;
}

export default function StorePage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [inventory, setInventory] = useState<StoreInventory[]>([]);
  const [pendingRequests, setPendingRequests] = useState<MaterialRequest[]>([]);
  const [pendingReturns, setPendingReturns] = useState<MaterialReturn[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isInventoryDialogOpen, setIsInventoryDialogOpen] = useState(false);
  const [isFulfillDialogOpen, setIsFulfillDialogOpen] = useState(false);
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
  
  const [inventoryForm, setInventoryForm] = useState({
    inventory_id: null as number | null,
    material_id: null as number | null,
    variant_id: null as number | null,
    number_of_units: '',
    location: '',
    notes: ''
  });
  
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | null>(null);
  const [fulfillmentUnits, setFulfillmentUnits] = useState<Array<{ variant_id: number; units: number }>>([]);
  const [approvalNotes, setApprovalNotes] = useState('');
  
  const [selectedReturn, setSelectedReturn] = useState<MaterialReturn | null>(null);
  const [returnReviewNotes, setReturnReviewNotes] = useState('');

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    await Promise.all([
      fetchMaterials(),
      fetchVariants(),
      fetchInventory(),
      fetchPendingRequests(),
      fetchPendingReturns()
    ]);
    setLoading(false);
  };

  const fetchMaterials = async () => {
    const { data } = await supabase
      .from('materials_master')
      .select('material_id, material_name, metric')
      .eq('is_active', true)
      .order('material_name');
    setMaterials(data || []);
  };

  const fetchVariants = async () => {
    const { data } = await supabase
      .from('material_variants')
      .select('*')
      .eq('is_active', true)
      .order('material_id')
      .order('quantity_per_unit', { ascending: false });
    setVariants(data || []);
  };

  const fetchInventory = async () => {
    const { data, error } = await supabase
      .from('store_inventory')
      .select(`
        *,
        materials_master!inner(material_name, metric),
        material_variants!inner(variant_name, quantity_per_unit)
      `)
      .order('material_id');
    
    if (error) {
      toast.error('Failed to load inventory: ' + error.message);
      return;
    }
    
    const inventoryWithDetails = (data || []).map((item: any) => ({
      ...item,
      material_name: item.materials_master?.material_name,
      metric: item.materials_master?.metric,
      variant_name: item.material_variants?.variant_name,
      quantity_per_unit: item.material_variants?.quantity_per_unit
    }));
    
    setInventory(inventoryWithDetails);
  };

  const fetchPendingRequests = async () => {
    const { data, error } = await supabase
      .from('material_requests')
      .select(`
        *,
        projects!inner(project_name),
        materials_master!inner(material_name, metric)
      `)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false });
    
    if (error) {
      toast.error('Failed to load requests: ' + error.message);
      return;
    }
    
    const requestsWithDetails = (data || []).map((req: any) => ({
      ...req,
      project_name: req.projects?.project_name,
      material_name: req.materials_master?.material_name,
      metric: req.materials_master?.metric
    }));
    
    setPendingRequests(requestsWithDetails);
  };

  const fetchPendingReturns = async () => {
    const { data, error } = await supabase
      .from('material_returns')
      .select(`
        *,
        projects!inner(project_name),
        materials_master!inner(material_name),
        material_variants(variant_name)
      `)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false });
    
    if (error) {
      toast.error('Failed to load returns: ' + error.message);
      return;
    }
    
    const returnsWithDetails = (data || []).map((ret: any) => ({
      ...ret,
      project_name: ret.projects?.project_name,
      material_name: ret.materials_master?.material_name,
      variant_name: ret.material_variants?.variant_name
    }));
    
    setPendingReturns(returnsWithDetails);
  };

  const handleSaveInventory = async () => {
    try {
      if (!inventoryForm.material_id || !inventoryForm.variant_id) {
        toast.error('Please select material and variant');
        return;
      }
      if (!inventoryForm.number_of_units || parseFloat(inventoryForm.number_of_units) <= 0) {
        toast.error('Please enter valid number of units');
        return;
      }

      const variant = variants.find(v => v.variant_id === inventoryForm.variant_id);
      const units = parseFloat(inventoryForm.number_of_units);
      const totalQuantity = variant ? units * variant.quantity_per_unit : 0;

      const payload = {
        material_id: inventoryForm.material_id,
        variant_id: inventoryForm.variant_id,
        number_of_units: units,
        total_quantity: totalQuantity,
        location: inventoryForm.location.trim() || null,
        notes: inventoryForm.notes.trim() || null,
        last_updated: new Date().toISOString()
      };

      if (inventoryForm.inventory_id) {
        const { error } = await supabase
          .from('store_inventory')
          .update(payload)
          .eq('inventory_id', inventoryForm.inventory_id);
        
        if (error) throw error;
        toast.success('Inventory updated successfully');
      } else {
        const { error } = await supabase
          .from('store_inventory')
          .upsert([payload], {
            onConflict: 'material_id,variant_id'
          });
        
        if (error) throw error;
        toast.success('Inventory added successfully');
      }

      setIsInventoryDialogOpen(false);
      resetInventoryForm();
      fetchInventory();
    } catch (error: any) {
      toast.error('Failed to save inventory: ' + error.message);
    }
  };

  const openFulfillDialog = (request: MaterialRequest) => {
    setSelectedRequest(request);
    setApprovalNotes('');
    
    const availableVariants = inventory.filter(inv => inv.material_id === request.material_id);
    setFulfillmentUnits(availableVariants.map(inv => ({ variant_id: inv.variant_id, units: 0 })));
    
    setIsFulfillDialogOpen(true);
  };

  const handleApproveRequest = async () => {
    if (!selectedRequest) return;
    
    try {
      const totalFulfilled = fulfillmentUnits.reduce((sum, fu) => {
        const inv = inventory.find(i => i.variant_id === fu.variant_id);
        return sum + (inv ? fu.units * inv.quantity_per_unit! : 0);
      }, 0);

      if (totalFulfilled === 0) {
        toast.error('Please allocate at least some units');
        return;
      }

      const { error: reqError } = await supabase
        .from('material_requests')
        .update({
          status: 'Approved',
          approved_at: new Date().toISOString(),
          approval_notes: approvalNotes.trim() || null,
          fulfilled_quantity: totalFulfilled
        })
        .eq('request_id', selectedRequest.request_id);
      
      if (reqError) throw reqError;

      for (const fu of fulfillmentUnits) {
        if (fu.units > 0) {
          const inv = inventory.find(i => i.variant_id === fu.variant_id);
          if (!inv) continue;
          
          await supabase
            .from('request_fulfillment_items')
            .insert({
              request_id: selectedRequest.request_id,
              variant_id: fu.variant_id,
              units_issued: fu.units,
              quantity_issued: fu.units * inv.quantity_per_unit!
            });

          await supabase
            .from('store_inventory')
            .update({
              number_of_units: inv.number_of_units - fu.units,
              total_quantity: inv.total_quantity - (fu.units * inv.quantity_per_unit!),
              last_updated: new Date().toISOString()
            })
            .eq('inventory_id', inv.inventory_id);
        }
      }

      await supabase
        .from('material_requests')
        .update({
          status: 'Fulfilled',
          fulfilled_at: new Date().toISOString()
        })
        .eq('request_id', selectedRequest.request_id);

      toast.success('Request approved and fulfilled');
      setIsFulfillDialogOpen(false);
      fetchAll();
    } catch (error: any) {
      toast.error('Failed to approve request: ' + error.message);
    }
  };

  const handleRejectRequest = async () => {
    if (!selectedRequest) return;
    
    try {
      const { error } = await supabase
        .from('material_requests')
        .update({
          status: 'Rejected',
          approved_at: new Date().toISOString(),
          approval_notes: approvalNotes.trim() || 'Rejected by store'
        })
        .eq('request_id', selectedRequest.request_id);
      
      if (error) throw error;
      
      toast.success('Request rejected');
      setIsFulfillDialogOpen(false);
      fetchPendingRequests();
    } catch (error: any) {
      toast.error('Failed to reject request: ' + error.message);
    }
  };

  const openReturnDialog = (returnItem: MaterialReturn) => {
    setSelectedReturn(returnItem);
    setReturnReviewNotes('');
    setIsReturnDialogOpen(true);
  };

  const handleAcceptReturn = async () => {
    if (!selectedReturn) return;
    
    try {
      const { error } = await supabase
        .from('material_returns')
        .update({
          status: 'Accepted',
          reviewed_at: new Date().toISOString(),
          review_notes: returnReviewNotes.trim() || 'Accepted by store'
        })
        .eq('return_id', selectedReturn.return_id);
      
      if (error) throw error;
      
      toast.success('Return accepted and added to inventory');
      setIsReturnDialogOpen(false);
      fetchAll();
    } catch (error: any) {
      toast.error('Failed to accept return: ' + error.message);
    }
  };

  const handleRejectReturn = async () => {
    if (!selectedReturn) return;
    
    try {
      const { error } = await supabase
        .from('material_returns')
        .update({
          status: 'Rejected',
          reviewed_at: new Date().toISOString(),
          review_notes: returnReviewNotes.trim() || 'Rejected by store'
        })
        .eq('return_id', selectedReturn.return_id);
      
      if (error) throw error;
      
      toast.success('Return rejected');
      setIsReturnDialogOpen(false);
      fetchPendingReturns();
    } catch (error: any) {
      toast.error('Failed to reject return: ' + error.message);
    }
  };

  const resetInventoryForm = () => {
    setInventoryForm({
      inventory_id: null,
      material_id: null,
      variant_id: null,
      number_of_units: '',
      location: '',
      notes: ''
    });
  };

  const openNewInventory = () => {
    resetInventoryForm();
    setIsInventoryDialogOpen(true);
  };

  const handleEditInventory = (item: StoreInventory) => {
    setInventoryForm({
      inventory_id: item.inventory_id,
      material_id: item.material_id,
      variant_id: item.variant_id,
      number_of_units: item.number_of_units.toString(),
      location: item.location || '',
      notes: item.notes || ''
    });
    setIsInventoryDialogOpen(true);
  };

  const getVariantsForMaterial = (materialId: number | null) => {
    if (!materialId) return [];
    return variants.filter(v => v.material_id === materialId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-slate-500">Loading store inventory...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Store Inventory</h1>
            <p className="text-slate-600 mt-1">Global inventory management & material requests</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="px-3 py-1">
              <Bell className="h-4 w-4 mr-1" />
              {pendingRequests.length} Pending Requests
            </Badge>
            <Badge variant="outline" className="px-3 py-1">
              <TrendingUp className="h-4 w-4 mr-1" />
              {pendingReturns.length} Pending Returns
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="inventory" className="space-y-6">
          <TabsList className="bg-white border">
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="requests">Material Requests</TabsTrigger>
            <TabsTrigger value="returns">Material Returns</TabsTrigger>
          </TabsList>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="space-y-4">
            <Card className="bg-white shadow-sm">
              <CardHeader className="border-b bg-slate-50">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-blue-600" />
                    Store Inventory
                  </CardTitle>
                  <Dialog open={isInventoryDialogOpen} onOpenChange={setIsInventoryDialogOpen}>
                    <DialogTrigger asChild>
                      <Button onClick={openNewInventory} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="h-4 w-4 mr-2" /> Add Stock
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-white max-w-md">
                      <DialogHeader>
                        <DialogTitle>
                          {inventoryForm.inventory_id ? 'Update Inventory' : 'Add Stock to Inventory'}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Material *</Label>
                          <Select
                            value={inventoryForm.material_id?.toString()}
                            onValueChange={(v) => {
                              const materialId = parseInt(v);
                              setInventoryForm({ ...inventoryForm, material_id: materialId, variant_id: null });
                            }}
                          >
                            <SelectTrigger className="bg-white">
                              <SelectValue placeholder="Select material" />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              {materials.map((m) => (
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
                            value={inventoryForm.variant_id?.toString()}
                            onValueChange={(v) => setInventoryForm({ ...inventoryForm, variant_id: parseInt(v) })}
                            disabled={!inventoryForm.material_id}
                          >
                            <SelectTrigger className="bg-white">
                              <SelectValue placeholder="Select variant" />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              {getVariantsForMaterial(inventoryForm.material_id).map((v) => (
                                <SelectItem key={v.variant_id} value={v.variant_id.toString()}>
                                  {v.variant_name} ({v.quantity_per_unit} {materials.find(m => m.material_id === v.material_id)?.metric})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Number of Units * (decimal supported, e.g., 0.5, 2.75)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={inventoryForm.number_of_units}
                            onChange={(e) => setInventoryForm({ ...inventoryForm, number_of_units: e.target.value })}
                            placeholder="e.g., 10 or 5.5"
                            className="bg-white"
                          />
                          {inventoryForm.variant_id && inventoryForm.number_of_units && (
                            <div className="text-sm bg-blue-50 border border-blue-200 rounded p-2">
                              <strong>Total Quantity:</strong> {' '}
                              <span className="font-bold text-blue-700">
                                {(parseFloat(inventoryForm.number_of_units) * (variants.find(v => v.variant_id === inventoryForm.variant_id)?.quantity_per_unit || 0)).toFixed(2)} {materials.find(m => m.material_id === inventoryForm.material_id)?.metric}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label>Location</Label>
                          <Input
                            value={inventoryForm.location}
                            onChange={(e) => setInventoryForm({ ...inventoryForm, location: e.target.value })}
                            placeholder="e.g., Warehouse A, Shelf 3"
                            className="bg-white"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Notes</Label>
                          <Textarea
                            value={inventoryForm.notes}
                            onChange={(e) => setInventoryForm({ ...inventoryForm, notes: e.target.value })}
                            placeholder="Additional information"
                            className="bg-white"
                            rows={3}
                          />
                        </div>

                        <div className="flex gap-2 pt-4">
                          <Button onClick={handleSaveInventory} className="flex-1 bg-blue-600 hover:bg-blue-700">
                            {inventoryForm.inventory_id ? 'Update' : 'Add'}
                          </Button>
                          <Button
                            onClick={() => setIsInventoryDialogOpen(false)}
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
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Material</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Variant</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">Units</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">Total Quantity</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Location</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {inventory.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                            No inventory yet. Add stock to get started.
                          </td>
                        </tr>
                      ) : (
                        inventory.map((item) => (
                          <tr key={item.inventory_id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-sm font-medium text-slate-900">{item.material_name}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">{item.variant_name}</td>
                            <td className="px-4 py-3 text-sm text-right text-slate-900 font-medium">{item.number_of_units}</td>
                            <td className="px-4 py-3 text-sm text-right">
                              <span className="font-semibold text-slate-900">{item.total_quantity}</span>
                              <span className="text-slate-500 ml-1">{item.metric}</span>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{item.location || '-'}</td>
                            <td className="px-4 py-3 text-center">
                              <Button
                                onClick={() => handleEditInventory(item)}
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2"
                              >
                                <Edit className="h-4 w-4 text-blue-600" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Material Requests Tab */}
          <TabsContent value="requests" className="space-y-4">
            <Card className="bg-white shadow-sm">
              <CardHeader className="border-b bg-slate-50">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-orange-600" />
                  Pending Material Requests ({pendingRequests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {pendingRequests.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      No pending requests
                    </div>
                  ) : (
                    pendingRequests.map((req) => (
                      <div key={req.request_id} className="p-4 hover:bg-slate-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono">{req.request_number}</Badge>
                              <Badge className={
                                req.request_source === 'Store' ? 'bg-blue-100 text-blue-700' : 'bg-teal-100 text-teal-700'
                              }>
                                {req.request_source}
                              </Badge>
                              <Badge className={
                                req.priority === 'Urgent' ? 'bg-red-100 text-red-700' :
                                req.priority === 'High' ? 'bg-orange-100 text-orange-700' :
                                'bg-slate-100 text-slate-700'
                              }>
                                {req.priority}
                              </Badge>
                            </div>
                            <h3 className="font-semibold text-slate-900 mt-2">{req.project_name}</h3>
                            <p className="text-sm text-slate-600 mt-1">
                              Material: <span className="font-medium">{req.material_name}</span>
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-slate-600">
                              <span>Requested: <span className="font-semibold text-slate-900">{req.requested_quantity} {req.metric}</span></span>
                              {req.required_by && <span>Required by: {new Date(req.required_by).toLocaleDateString()}</span>}
                            </div>
                            {req.purpose && (
                              <p className="text-sm text-slate-600 mt-2">Purpose: {req.purpose}</p>
                            )}
                          </div>
                          <Button
                            onClick={() => openFulfillDialog(req)}
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {req.request_source === 'Store' ? 'Review & Fulfill' : 'Acknowledge'}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Material Returns Tab */}
          <TabsContent value="returns" className="space-y-4">
            <Card className="bg-white shadow-sm">
              <CardHeader className="border-b bg-slate-50">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Pending Material Returns ({pendingReturns.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {pendingReturns.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      No pending returns
                    </div>
                  ) : (
                    pendingReturns.map((ret) => (
                      <div key={ret.return_id} className="p-4 hover:bg-slate-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono">{ret.return_number}</Badge>
                              <Badge className={
                                ret.condition === 'Excellent' || ret.condition === 'Good' ? 'bg-green-100 text-green-700' :
                                ret.condition === 'Fair' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }>
                                {ret.condition}
                              </Badge>
                            </div>
                            <h3 className="font-semibold text-slate-900 mt-2">{ret.project_name}</h3>
                            <p className="text-sm text-slate-600 mt-1">
                              Material: <span className="font-medium">{ret.material_name}</span>
                              {ret.variant_name && <span> - {ret.variant_name}</span>}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-slate-600">
                              <span>Quantity: <span className="font-semibold text-slate-900">{ret.returned_quantity}</span></span>
                              {ret.number_of_units && <span>Units: <span className="font-semibold">{ret.number_of_units}</span></span>}
                            </div>
                            {ret.reason && (
                              <p className="text-sm text-slate-600 mt-2">Reason: {ret.reason}</p>
                            )}
                          </div>
                          <Button
                            onClick={() => openReturnDialog(ret)}
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            Review Return
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Fulfill Request Dialog */}
      <Dialog open={isFulfillDialogOpen} onOpenChange={setIsFulfillDialogOpen}>
        <DialogContent className="bg-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fulfill Material Request</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4 py-4">
              <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                <p><span className="font-semibold">Request:</span> {selectedRequest.request_number}</p>
                <p><span className="font-semibold">Project:</span> {selectedRequest.project_name}</p>
                <p><span className="font-semibold">Material:</span> {selectedRequest.material_name}</p>
                <p><span className="font-semibold">Requested Quantity:</span> {selectedRequest.requested_quantity} {selectedRequest.metric}</p>
              </div>

              <div className="space-y-2">
                <Label>Available Units (Select quantity to fulfill)</Label>
                <div className="border rounded-lg divide-y">
                  {inventory.filter(inv => inv.material_id === selectedRequest.material_id).map((inv) => {
                    const currentFulfillment = fulfillmentUnits.find(fu => fu.variant_id === inv.variant_id);
                    return (
                      <div key={inv.variant_id} className="p-3 flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{inv.variant_name}</p>
                          <p className="text-xs text-slate-600">Available: {inv.number_of_units} units ({inv.total_quantity} {inv.metric})</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max={inv.number_of_units}
                            value={currentFulfillment?.units || ''}
                            onChange={(e) => {
                              const newUnits = parseFloat(e.target.value) || 0;
                              setFulfillmentUnits(prev =>
                                prev.map(fu =>
                                  fu.variant_id === inv.variant_id
                                    ? { ...fu, units: Math.min(newUnits, inv.number_of_units) }
                                    : fu
                                )
                              );
                            }}
                            className="w-24 bg-white"
                            placeholder="0.5"
                          />
                          <span className="text-sm text-slate-600">units</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm font-semibold text-blue-900">
                    Total to fulfill: {fulfillmentUnits.reduce((sum, fu) => {
                      const inv = inventory.find(i => i.variant_id === fu.variant_id);
                      return sum + (inv ? fu.units * inv.quantity_per_unit! : 0);
                    }, 0).toFixed(2)} {selectedRequest.metric}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Approval Notes</Label>
                <Textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Optional notes about this fulfillment"
                  className="bg-white"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleApproveRequest} className="flex-1 bg-green-600 hover:bg-green-700">
                  <Check className="h-4 w-4 mr-2" /> Approve & Fulfill
                </Button>
                <Button onClick={handleRejectRequest} variant="destructive" className="flex-1">
                  <X className="h-4 w-4 mr-2" /> Reject Request
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Return Review Dialog */}
      <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Review Material Return</DialogTitle>
          </DialogHeader>
          {selectedReturn && (
            <div className="space-y-4 py-4">
              <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                <p><span className="font-semibold">Return:</span> {selectedReturn.return_number}</p>
                <p><span className="font-semibold">Project:</span> {selectedReturn.project_name}</p>
                <p><span className="font-semibold">Material:</span> {selectedReturn.material_name}</p>
                <p><span className="font-semibold">Variant:</span> {selectedReturn.variant_name || 'Not specified'}</p>
                <p><span className="font-semibold">Quantity:</span> {selectedReturn.returned_quantity}</p>
                {selectedReturn.number_of_units && (
                  <p><span className="font-semibold">Units:</span> {selectedReturn.number_of_units}</p>
                )}
                <p><span className="font-semibold">Condition:</span> <Badge className={
                  selectedReturn.condition === 'Excellent' || selectedReturn.condition === 'Good' ? 'bg-green-100 text-green-700' :
                  selectedReturn.condition === 'Fair' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }>{selectedReturn.condition}</Badge></p>
                {selectedReturn.reason && (
                  <p><span className="font-semibold">Reason:</span> {selectedReturn.reason}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Review Notes</Label>
                <Textarea
                  value={returnReviewNotes}
                  onChange={(e) => setReturnReviewNotes(e.target.value)}
                  placeholder="Notes about accepting or rejecting this return"
                  className="bg-white"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleAcceptReturn} className="flex-1 bg-green-600 hover:bg-green-700">
                  <Check className="h-4 w-4 mr-2" /> Accept Return
                </Button>
                <Button onClick={handleRejectReturn} variant="destructive" className="flex-1">
                  <X className="h-4 w-4 mr-2" /> Reject Return
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
