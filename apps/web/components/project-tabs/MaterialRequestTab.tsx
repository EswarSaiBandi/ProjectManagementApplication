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
import { createClient } from '@/lib/supabase/client';
import { Plus, Package, TrendingDown, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Material {
  material_id: number;
  material_name: string;
  metric: string;
}

interface MaterialRequest {
  request_id: number;
  request_number: string;
  material_id: number;
  requested_quantity: number;
  request_source: string;
  priority: string;
  required_by: string | null;
  purpose: string | null;
  status: string;
  created_at: string;
  approval_notes: string | null;
  fulfilled_quantity: number | null;
  material_name?: string;
  metric?: string;
}

interface MaterialReturn {
  return_id: number;
  return_number: string;
  material_id: number;
  variant_id: number | null;
  returned_quantity: number;
  number_of_units: number | null;
  condition: string;
  reason: string | null;
  status: string;
  created_at: string;
  review_notes: string | null;
  material_name?: string;
}

export default function MaterialRequestTab({ projectId }: { projectId: string }) {
  const supabase = createClient();
  
  const [materials, setMaterials] = useState<Material[]>([]);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [returns, setReturns] = useState<MaterialReturn[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
  
  const [requestForm, setRequestForm] = useState({
    material_id: null as number | null,
    requested_quantity: '',
    request_source: 'Store',
    priority: 'Normal',
    required_by: '',
    purpose: ''
  });
  
  const [returnForm, setReturnForm] = useState({
    material_id: null as number | null,
    returned_quantity: '',
    condition: 'Good',
    reason: ''
  });

  useEffect(() => {
    fetchAll();
  }, [projectId]);

  const fetchAll = async () => {
    await Promise.all([
      fetchMaterials(),
      fetchRequests(),
      fetchReturns()
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

  const fetchRequests = async () => {
    const { data, error } = await supabase
      .from('material_requests')
      .select(`
        *,
        materials_master!inner(material_name, metric)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    
    if (error) {
      toast.error('Failed to load requests: ' + error.message);
      return;
    }
    
    const requestsWithDetails = (data || []).map((req: any) => ({
      ...req,
      material_name: req.materials_master?.material_name,
      metric: req.materials_master?.metric
    }));
    
    setRequests(requestsWithDetails);
  };

  const fetchReturns = async () => {
    const { data, error } = await supabase
      .from('material_returns')
      .select(`
        *,
        materials_master!inner(material_name)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    
    if (error) {
      toast.error('Failed to load returns: ' + error.message);
      return;
    }
    
    const returnsWithDetails = (data || []).map((ret: any) => ({
      ...ret,
      material_name: ret.materials_master?.material_name
    }));
    
    setReturns(returnsWithDetails);
  };

  const handleSubmitRequest = async () => {
    try {
      if (!requestForm.material_id) {
        toast.error('Please select a material');
        return;
      }
      if (!requestForm.requested_quantity || parseFloat(requestForm.requested_quantity) <= 0) {
        toast.error('Please enter a valid quantity');
        return;
      }

      const { error } = await supabase
        .from('material_requests')
        .insert({
          project_id: projectId,
          material_id: requestForm.material_id,
          requested_quantity: parseFloat(requestForm.requested_quantity),
          request_source: requestForm.request_source,
          priority: requestForm.priority,
          required_by: requestForm.required_by || null,
          purpose: requestForm.purpose.trim() || null,
          status: 'Pending'
        });
      
      if (error) throw error;
      
      toast.success('Material request submitted successfully');
      setIsRequestDialogOpen(false);
      resetRequestForm();
      fetchRequests();
    } catch (error: any) {
      toast.error('Failed to submit request: ' + error.message);
    }
  };

  const handleSubmitReturn = async () => {
    try {
      if (!returnForm.material_id) {
        toast.error('Please select a material');
        return;
      }
      if (!returnForm.returned_quantity || parseFloat(returnForm.returned_quantity) <= 0) {
        toast.error('Please enter a valid quantity');
        return;
      }

      const { error } = await supabase
        .from('material_returns')
        .insert({
          project_id: projectId,
          material_id: returnForm.material_id,
          returned_quantity: parseFloat(returnForm.returned_quantity),
          condition: returnForm.condition,
          reason: returnForm.reason.trim() || null,
          status: 'Pending'
        });
      
      if (error) throw error;
      
      toast.success('Material return submitted successfully');
      setIsReturnDialogOpen(false);
      resetReturnForm();
      fetchReturns();
    } catch (error: any) {
      toast.error('Failed to submit return: ' + error.message);
    }
  };

  const handleCancelRequest = async (requestId: number) => {
    if (!confirm('Are you sure you want to cancel this request?')) return;
    
    try {
      const { error } = await supabase
        .from('material_requests')
        .update({ status: 'Cancelled' })
        .eq('request_id', requestId);
      
      if (error) throw error;
      
      toast.success('Request cancelled');
      fetchRequests();
    } catch (error: any) {
      toast.error('Failed to cancel request: ' + error.message);
    }
  };

  const resetRequestForm = () => {
    setRequestForm({
      material_id: null,
      requested_quantity: '',
      request_source: 'Store',
      priority: 'Normal',
      required_by: '',
      purpose: ''
    });
  };

  const resetReturnForm = () => {
    setReturnForm({
      material_id: null,
      returned_quantity: '',
      condition: 'Good',
      reason: ''
    });
  };

  const openNewRequest = () => {
    resetRequestForm();
    setIsRequestDialogOpen(true);
  };

  const openNewReturn = () => {
    resetReturnForm();
    setIsReturnDialogOpen(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Pending': return <Clock className="h-4 w-4" />;
      case 'Approved': return <CheckCircle className="h-4 w-4" />;
      case 'Fulfilled': return <CheckCircle className="h-4 w-4" />;
      case 'Rejected': return <XCircle className="h-4 w-4" />;
      case 'Cancelled': return <XCircle className="h-4 w-4" />;
      case 'Accepted': return <CheckCircle className="h-4 w-4" />;
      default: return <AlertCircle className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-100 text-yellow-700';
      case 'Approved': return 'bg-blue-100 text-blue-700';
      case 'Fulfilled': return 'bg-green-100 text-green-700';
      case 'Rejected': return 'bg-red-100 text-red-700';
      case 'Cancelled': return 'bg-slate-100 text-slate-700';
      case 'Accepted': return 'bg-green-100 text-green-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="text-slate-500">Loading material requests...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList className="bg-white border">
          <TabsTrigger value="requests">Material Requests</TabsTrigger>
          <TabsTrigger value="returns">Material Returns</TabsTrigger>
        </TabsList>

        {/* Material Requests Tab */}
        <TabsContent value="requests" className="space-y-4">
          <Card className="bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-blue-600" />
                  Material Requests
                </CardTitle>
                <Dialog open={isRequestDialogOpen} onOpenChange={setIsRequestDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openNewRequest} className="bg-blue-600 hover:bg-blue-700">
                      <Plus className="h-4 w-4 mr-2" /> New Request
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-white max-w-lg">
                    <DialogHeader>
                      <DialogTitle>New Material Request</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Material *</Label>
                        <Select
                          value={requestForm.material_id?.toString()}
                          onValueChange={(v) => setRequestForm({ ...requestForm, material_id: parseInt(v) })}
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
                        <Label>Quantity *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={requestForm.requested_quantity}
                          onChange={(e) => setRequestForm({ ...requestForm, requested_quantity: e.target.value })}
                          placeholder="Enter quantity"
                          className="bg-white"
                        />
                        {requestForm.material_id && (
                          <p className="text-xs text-slate-500">
                            Unit: {materials.find(m => m.material_id === requestForm.material_id)?.metric}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Request Source *</Label>
                        <Select value={requestForm.request_source} onValueChange={(v) => setRequestForm({ ...requestForm, request_source: v })}>
                          <SelectTrigger className="bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            <SelectItem value="Store">Store (From Inventory)</SelectItem>
                            <SelectItem value="Local Procurement">Local Procurement (Buy from Market)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Priority</Label>
                        <Select value={requestForm.priority} onValueChange={(v) => setRequestForm({ ...requestForm, priority: v })}>
                          <SelectTrigger className="bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            <SelectItem value="Urgent">Urgent</SelectItem>
                            <SelectItem value="High">High</SelectItem>
                            <SelectItem value="Normal">Normal</SelectItem>
                            <SelectItem value="Low">Low</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Required By</Label>
                        <Input
                          type="date"
                          value={requestForm.required_by}
                          onChange={(e) => setRequestForm({ ...requestForm, required_by: e.target.value })}
                          className="bg-white"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Purpose</Label>
                        <Textarea
                          value={requestForm.purpose}
                          onChange={(e) => setRequestForm({ ...requestForm, purpose: e.target.value })}
                          placeholder="What is this material needed for?"
                          className="bg-white"
                          rows={3}
                        />
                      </div>

                      <div className="flex gap-2 pt-4">
                        <Button onClick={handleSubmitRequest} className="flex-1 bg-blue-600 hover:bg-blue-700">
                          Submit Request
                        </Button>
                        <Button
                          onClick={() => setIsRequestDialogOpen(false)}
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
              <div className="divide-y">
                {requests.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    No material requests yet. Create one to get started.
                  </div>
                ) : (
                  requests.map((req) => (
                    <div key={req.request_id} className="p-4 hover:bg-slate-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="font-mono">{req.request_number}</Badge>
                            <Badge className={getStatusColor(req.status)}>
                              {getStatusIcon(req.status)}
                              <span className="ml-1">{req.status}</span>
                            </Badge>
                            <Badge className={
                              req.priority === 'Urgent' ? 'bg-red-100 text-red-700' :
                              req.priority === 'High' ? 'bg-orange-100 text-orange-700' :
                              'bg-slate-100 text-slate-700'
                            }>
                              {req.priority}
                            </Badge>
                            <Badge variant="outline">{req.request_source}</Badge>
                          </div>
                          
                          <div className="space-y-1">
                            <p className="text-sm">
                              <span className="font-semibold text-slate-900">Material:</span> {req.material_name}
                            </p>
                            <p className="text-sm">
                              <span className="font-semibold text-slate-900">Quantity:</span> {req.requested_quantity} {req.metric}
                              {req.fulfilled_quantity && (
                                <span className="text-green-600 ml-2">(Fulfilled: {req.fulfilled_quantity} {req.metric})</span>
                              )}
                            </p>
                            {req.required_by && (
                              <p className="text-sm text-slate-600">
                                Required by: {new Date(req.required_by).toLocaleDateString()}
                              </p>
                            )}
                            {req.purpose && (
                              <p className="text-sm text-slate-600">Purpose: {req.purpose}</p>
                            )}
                            {req.approval_notes && (
                              <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded mt-2">
                                <span className="font-semibold">Notes:</span> {req.approval_notes}
                              </p>
                            )}
                          </div>
                          
                          <p className="text-xs text-slate-500 mt-2">
                            Requested on {new Date(req.created_at).toLocaleString()}
                          </p>
                        </div>
                        
                        {req.status === 'Pending' && (
                          <Button
                            onClick={() => handleCancelRequest(req.request_id)}
                            size="sm"
                            variant="outline"
                            className="border-red-600 text-red-600 hover:bg-red-50"
                          >
                            Cancel
                          </Button>
                        )}
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
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-green-600" />
                  Material Returns
                </CardTitle>
                <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={openNewReturn} className="bg-green-600 hover:bg-green-700">
                      <Plus className="h-4 w-4 mr-2" /> New Return
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-white max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Return Material to Store</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Material *</Label>
                        <Select
                          value={returnForm.material_id?.toString()}
                          onValueChange={(v) => setReturnForm({ ...returnForm, material_id: parseInt(v) })}
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
                        <Label>Quantity *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={returnForm.returned_quantity}
                          onChange={(e) => setReturnForm({ ...returnForm, returned_quantity: e.target.value })}
                          placeholder="Enter quantity"
                          className="bg-white"
                        />
                        {returnForm.material_id && (
                          <p className="text-xs text-slate-500">
                            Unit: {materials.find(m => m.material_id === returnForm.material_id)?.metric}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Condition *</Label>
                        <Select value={returnForm.condition} onValueChange={(v) => setReturnForm({ ...returnForm, condition: v })}>
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
                        <Label>Reason for Return</Label>
                        <Textarea
                          value={returnForm.reason}
                          onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })}
                          placeholder="Why is this material being returned?"
                          className="bg-white"
                          rows={3}
                        />
                      </div>

                      <div className="flex gap-2 pt-4">
                        <Button onClick={handleSubmitReturn} className="flex-1 bg-green-600 hover:bg-green-700">
                          Submit Return
                        </Button>
                        <Button
                          onClick={() => setIsReturnDialogOpen(false)}
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
              <div className="divide-y">
                {returns.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    No material returns yet.
                  </div>
                ) : (
                  returns.map((ret) => (
                    <div key={ret.return_id} className="p-4 hover:bg-slate-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="font-mono">{ret.return_number}</Badge>
                            <Badge className={getStatusColor(ret.status)}>
                              {getStatusIcon(ret.status)}
                              <span className="ml-1">{ret.status}</span>
                            </Badge>
                            <Badge className={
                              ret.condition === 'Excellent' || ret.condition === 'Good' ? 'bg-green-100 text-green-700' :
                              ret.condition === 'Fair' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }>
                              {ret.condition}
                            </Badge>
                          </div>
                          
                          <div className="space-y-1">
                            <p className="text-sm">
                              <span className="font-semibold text-slate-900">Material:</span> {ret.material_name}
                            </p>
                            <p className="text-sm">
                              <span className="font-semibold text-slate-900">Quantity:</span> {ret.returned_quantity}
                              {ret.number_of_units && <span className="ml-2">({ret.number_of_units} units)</span>}
                            </p>
                            {ret.reason && (
                              <p className="text-sm text-slate-600">Reason: {ret.reason}</p>
                            )}
                            {ret.review_notes && (
                              <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded mt-2">
                                <span className="font-semibold">Review:</span> {ret.review_notes}
                              </p>
                            )}
                          </div>
                          
                          <p className="text-xs text-slate-500 mt-2">
                            Returned on {new Date(ret.created_at).toLocaleString()}
                          </p>
                        </div>
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
  );
}
