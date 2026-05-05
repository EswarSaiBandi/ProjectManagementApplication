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
import { QUANTITY_STEP, parseQuarterQty } from '@/lib/quantity';
import { Plus, Package, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
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

export default function MaterialRequestTab({ projectId }: { projectId: string }) {

  const [materials, setMaterials] = useState<Material[]>([]);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);

  const [requestForm, setRequestForm] = useState({
    material_id: null as number | null,
    requested_quantity: '',
    request_source: 'Store',
    priority: 'Normal',
    required_by: '',
    purpose: ''
  });

  useEffect(() => {
    fetchAll();
  }, [projectId]);

  const fetchAll = async () => {
    await Promise.all([
      fetchMaterials(),
      fetchRequests()
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
      metric: req.materials_master?.metric,
    }));
    
    setRequests(requestsWithDetails);
  };

  const handleSubmitRequest = async () => {
    try {
      if (!requestForm.material_id) {
        toast.error('Please select a material');
        return;
      }
      const parsedQty = parseQuarterQty(requestForm.requested_quantity, { label: 'Quantity' });
      if (!parsedQty.ok) { toast.error(parsedQty.error); return; }
      const qty = parsedQty.value;

      const { data: inserted, error } = await supabase
        .from('material_requests')
        .insert({
          project_id: projectId,
          material_id: requestForm.material_id,
          requested_quantity: qty,
          request_source: requestForm.request_source,
          priority: requestForm.priority,
          required_by: requestForm.required_by || null,
          purpose: requestForm.purpose.trim() || null,
          status: 'Pending'
        })
        .select('request_id, request_number')
        .single();

      if (error) throw error;

      // Audit-log the workflow event
      const { data: userRes } = await supabase.auth.getUser();
      await supabase.from('material_movement_logs').insert({
        material_id: requestForm.material_id,
        project_id: Number(projectId),
        movement_type: 'Request Raised',
        reference_type: 'Material Request',
        reference_id: inserted?.request_id ?? null,
        quantity: qty,
        notes:
          'REQUEST RAISED: ' + qty + ' units requested'
          + ' | request#=' + (inserted?.request_number ?? 'N/A')
          + ' | priority=' + requestForm.priority
          + ' | source=' + requestForm.request_source
          + (requestForm.required_by ? ' | required_by=' + requestForm.required_by : '')
          + (requestForm.purpose.trim() ? ' | purpose="' + requestForm.purpose.trim() + '"' : '')
          + ' | at=' + new Date().toISOString(),
        created_by: userRes?.user?.id ?? null,
      });

      toast.success('Material request submitted successfully');
      setIsRequestDialogOpen(false);
      resetRequestForm();
      fetchRequests();
    } catch (error: any) {
      toast.error('Failed to submit request: ' + error.message);
    }
  };

  const handleCancelRequest = async (requestId: number) => {
    if (!confirm('Are you sure you want to cancel this request?')) return;

    try {
      // Fetch current request details for the log
      const { data: req } = await supabase
        .from('material_requests')
        .select('material_id, requested_quantity, request_number')
        .eq('request_id', requestId)
        .single();

      const { error } = await supabase
        .from('material_requests')
        .update({ status: 'Cancelled' })
        .eq('request_id', requestId);

      if (error) throw error;

      if (req) {
        const { data: userRes } = await supabase.auth.getUser();
        await supabase.from('material_movement_logs').insert({
          material_id: req.material_id,
          project_id: Number(projectId),
          movement_type: 'Request Cancelled',
          reference_type: 'Material Request',
          reference_id: requestId,
          quantity: Number(req.requested_quantity || 0),
          notes:
            'REQUEST CANCELLED by project'
            + ' | request#=' + (req.request_number ?? 'N/A')
            + ' | qty=' + Number(req.requested_quantity || 0)
            + ' | at=' + new Date().toISOString(),
          created_by: userRes?.user?.id ?? null,
        });
      }

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

  const openNewRequest = () => {
    resetRequestForm();
    setIsRequestDialogOpen(true);
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
      <div className="space-y-4">
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
                  <div className="space-y-4 py-4 overflow-y-auto max-h-[70vh] pr-1">

                      {/* 1 — Material */}
                      <div className="space-y-2">
                        <Label>Material *</Label>
                        <Select
                          value={requestForm.material_id?.toString()}
                          onValueChange={(v) => {
                            setRequestForm({ ...requestForm, material_id: parseInt(v) });
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

                      {/* 2 — Request Source (before stock panel so it drives what panel shows) */}
                      <div className="space-y-2">
                        <Label>Request Source *</Label>
                        <Select
                          value={requestForm.request_source}
                          onValueChange={(v) => setRequestForm({ ...requestForm, request_source: v })}
                        >
                          <SelectTrigger className="bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            <SelectItem value="Store">Store (From Inventory)</SelectItem>
                            <SelectItem value="Local Procurement">Local Procurement (Buy from Market)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>


                      {/* 4 — Quantity */}
                      <div className="space-y-2">
                        <Label>Quantity *</Label>
                        <Input
                          type="number"
                          step={QUANTITY_STEP}
                          min={QUANTITY_STEP}
                          value={requestForm.requested_quantity}
                          onChange={(e) => setRequestForm({ ...requestForm, requested_quantity: e.target.value })}
                          placeholder={`Enter quantity (multiples of ${QUANTITY_STEP})`}
                          className="bg-white"
                        />
                        {requestForm.material_id && (
                          <p className="text-xs text-slate-500">
                            Unit: {materials.find(m => m.material_id === requestForm.material_id)?.metric}
                          </p>
                        )}
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
      </div>
    </div>
  );
}
