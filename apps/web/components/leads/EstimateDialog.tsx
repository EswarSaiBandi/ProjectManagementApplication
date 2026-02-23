'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText, Plus, Trash, CheckCircle, XCircle, Edit, Send, AlertCircle,
  Calculator, Calendar, DollarSign
} from 'lucide-react';

type Estimate = {
  estimate_id: number;
  estimate_number: string;
  estimate_name: string;
  revision_number: number;
  status: string;
  subtotal: number;
  tax_percentage: number;
  tax_amount: number;
  discount_percentage: number;
  discount_amount: number;
  total_amount: number;
  estimate_date: string;
  valid_until: string | null;
  approved_date: string | null;
  created_at: string;
};

type EstimateItem = {
  item_id: number;
  item_number: number;
  description: string;
  category: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  line_total: number;
  notes: string | null;
};

interface EstimateDialogProps {
  leadId: number;
  leadName: string;
  isOpen: boolean;
  onClose: () => void;
  onEstimateApproved?: () => void;
}

export default function EstimateDialog({
  leadId,
  leadName,
  isOpen,
  onClose,
  onEstimateApproved
}: EstimateDialogProps) {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [activeEstimate, setActiveEstimate] = useState<Estimate | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'create' | 'edit'>('list');

  const [form, setForm] = useState({
    estimate_name: '',
    estimate_date: new Date().toISOString().split('T')[0],
    valid_until: '',
    tax_percentage: '0',
    discount_percentage: '0',
    terms_and_conditions: '',
    client_notes: '',
  });

  const [itemForm, setItemForm] = useState({
    description: '',
    category: '',
    quantity: '1',
    unit: 'units',
    unit_price: '0',
    notes: '',
  });

  const fetchEstimates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('estimates')
      .select('*')
      .eq('lead_id', leadId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setEstimates(data as Estimate[]);
    }
    setLoading(false);
  };

  const fetchEstimateItems = async (estimateId: number) => {
    const { data, error } = await supabase
      .from('estimate_items')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('item_number');

    if (!error && data) {
      setItems(data as EstimateItem[]);
    }
  };

  useEffect(() => {
    if (isOpen && leadId) {
      fetchEstimates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, leadId]);

  const resetForm = () => {
    setForm({
      estimate_name: '',
      estimate_date: new Date().toISOString().split('T')[0],
      valid_until: '',
      tax_percentage: '0',
      discount_percentage: '0',
      terms_and_conditions: '',
      client_notes: '',
    });
    setItems([]);
  };

  const resetItemForm = () => {
    setItemForm({
      description: '',
      category: '',
      quantity: '1',
      unit: 'units',
      unit_price: '0',
      notes: '',
    });
  };

  const handleCreateEstimate = async () => {
    if (!form.estimate_name.trim()) {
      toast.error('Estimate name is required');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();

    const payload = {
      lead_id: leadId,
      estimate_name: form.estimate_name,
      estimate_date: form.estimate_date,
      valid_until: form.valid_until || null,
      tax_percentage: Number(form.tax_percentage),
      discount_percentage: Number(form.discount_percentage),
      terms_and_conditions: form.terms_and_conditions.trim() || null,
      client_notes: form.client_notes.trim() || null,
      status: 'Draft',
      created_by: userData.user?.id,
    };

    const { data, error } = await supabase
      .from('estimates')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('Create estimate error:', error);
      toast.error('Failed to create estimate');
      setIsSaving(false);
      return;
    }

    toast.success('Estimate created');
    setActiveEstimate(data as Estimate);
    setActiveTab('edit');
    await fetchEstimates();
    setIsSaving(false);
  };

  const handleAddItem = async () => {
    if (!activeEstimate) return;
    if (!itemForm.description.trim()) {
      toast.error('Item description is required');
      return;
    }

    const quantity = Number(itemForm.quantity);
    const unitPrice = Number(itemForm.unit_price);

    if (quantity <= 0 || unitPrice < 0) {
      toast.error('Invalid quantity or price');
      return;
    }

    const nextItemNumber = items.length + 1;

    const payload = {
      estimate_id: activeEstimate.estimate_id,
      item_number: nextItemNumber,
      description: itemForm.description,
      category: itemForm.category.trim() || null,
      quantity: quantity,
      unit: itemForm.unit,
      unit_price: unitPrice,
      notes: itemForm.notes.trim() || null,
    };

    const { error } = await supabase.from('estimate_items').insert([payload]);

    if (error) {
      console.error('Add item error:', error);
      toast.error('Failed to add item');
      return;
    }

    toast.success('Item added');
    resetItemForm();
    await fetchEstimateItems(activeEstimate.estimate_id);
    await fetchEstimates();
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!confirm('Delete this item?')) return;

    const { error } = await supabase
      .from('estimate_items')
      .delete()
      .eq('item_id', itemId);

    if (error) {
      console.error('Delete item error:', error);
      toast.error('Failed to delete item');
      return;
    }

    toast.success('Item deleted');
    if (activeEstimate) {
      await fetchEstimateItems(activeEstimate.estimate_id);
      await fetchEstimates();
    }
  };

  const handleApproveEstimate = async () => {
    if (!activeEstimate) return;
    if (!confirm('Approve this estimate? This will automatically create a Project Order and Quotation.')) return;

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('estimates')
      .update({
        status: 'Approved',
        approved_date: new Date().toISOString().split('T')[0],
        approved_by: userData.user?.id,
        approval_notes: 'Approved via Estimate Dialog',
      })
      .eq('estimate_id', activeEstimate.estimate_id);

    if (error) {
      console.error('Approve estimate error:', error);
      toast.error('Failed to approve estimate');
      setIsSaving(false);
      return;
    }

    toast.success('Estimate approved! Project Order and Quotation created automatically.');
    await fetchEstimates();
    if (onEstimateApproved) {
      onEstimateApproved();
    }
    setIsSaving(false);
    setActiveTab('list');
  };

  const handleUpdateEstimateStatus = async (estimateId: number, newStatus: string) => {
    const { error } = await supabase
      .from('estimates')
      .update({ status: newStatus })
      .eq('estimate_id', estimateId);

    if (error) {
      console.error('Update status error:', error);
      toast.error('Failed to update status');
      return;
    }

    toast.success(`Status updated to ${newStatus}`);
    await fetchEstimates();
  };

  const handleViewEstimate = (estimate: Estimate) => {
    setActiveEstimate(estimate);
    fetchEstimateItems(estimate.estimate_id);
    setActiveTab('edit');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Draft': return 'bg-gray-100 text-gray-800';
      case 'Under Review': return 'bg-blue-100 text-blue-800';
      case 'Sent to Client': return 'bg-purple-100 text-purple-800';
      case 'Approved': return 'bg-green-100 text-green-800';
      case 'Rejected': return 'bg-red-100 text-red-800';
      case 'Revised': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-white max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-blue-600" />
            Estimates for {leadName}
          </DialogTitle>
          <DialogDescription>
            Create and manage revisable estimates. Approval auto-creates Project Order & Quotation.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="list">Estimates List</TabsTrigger>
            <TabsTrigger value="create">Create New</TabsTrigger>
            <TabsTrigger value="edit" disabled={!activeEstimate}>Edit Estimate</TabsTrigger>
          </TabsList>

          {/* Estimates List */}
          <TabsContent value="list" className="space-y-4">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : estimates.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
                No estimates yet. Create one to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {estimates.map((est) => (
                  <Card key={est.estimate_id} className="hover:bg-slate-50 cursor-pointer">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h4 className="font-semibold text-lg">{est.estimate_name}</h4>
                            <Badge className={getStatusColor(est.status)}>{est.status}</Badge>
                            <span className="text-xs text-slate-500">Rev. {est.revision_number}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <span className="text-slate-600">Number:</span>
                              <div className="font-medium">{est.estimate_number}</div>
                            </div>
                            <div>
                              <span className="text-slate-600">Date:</span>
                              <div className="font-medium">{new Date(est.estimate_date).toLocaleDateString()}</div>
                            </div>
                            <div>
                              <span className="text-slate-600">Total:</span>
                              <div className="font-bold text-green-600">₹{est.total_amount.toLocaleString('en-IN')}</div>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleViewEstimate(est)}>
                            <Edit className="h-4 w-4 mr-1" />
                            View/Edit
                          </Button>
                          {est.status === 'Sent to Client' && (
                            <Button 
                              size="sm" 
                              className="bg-green-600 text-white hover:bg-green-700"
                              onClick={() => handleUpdateEstimateStatus(est.estimate_id, 'Approved')}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Create New Estimate */}
          <TabsContent value="create" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Estimate Name *</Label>
                <Input
                  value={form.estimate_name}
                  onChange={(e) => setForm({ ...form, estimate_name: e.target.value })}
                  placeholder="Q1 2026 - Residential Interior"
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label>Estimate Date</Label>
                <Input
                  type="date"
                  value={form.estimate_date}
                  onChange={(e) => setForm({ ...form, estimate_date: e.target.value })}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label>Valid Until</Label>
                <Input
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                  className="bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Tax %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.tax_percentage}
                    onChange={(e) => setForm({ ...form, tax_percentage: e.target.value })}
                    className="bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Discount %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.discount_percentage}
                    onChange={(e) => setForm({ ...form, discount_percentage: e.target.value })}
                    className="bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Terms & Conditions</Label>
              <Textarea
                value={form.terms_and_conditions}
                onChange={(e) => setForm({ ...form, terms_and_conditions: e.target.value })}
                rows={3}
                className="bg-white"
              />
            </div>

            <div className="space-y-2">
              <Label>Client Notes</Label>
              <Textarea
                value={form.client_notes}
                onChange={(e) => setForm({ ...form, client_notes: e.target.value })}
                rows={2}
                className="bg-white"
              />
            </div>

            <Button onClick={handleCreateEstimate} disabled={isSaving} className="w-full bg-blue-600 text-white hover:bg-blue-700">
              {isSaving ? 'Creating...' : 'Create Estimate'}
            </Button>
          </TabsContent>

          {/* Edit Estimate */}
          <TabsContent value="edit" className="space-y-4">
            {activeEstimate && (
              <>
                {/* Estimate Header */}
                <Card className="bg-gradient-to-r from-blue-50 to-purple-50">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-xl font-bold">{activeEstimate.estimate_name}</h3>
                        <p className="text-sm text-slate-600">{activeEstimate.estimate_number}</p>
                      </div>
                      <Badge className={`${getStatusColor(activeEstimate.status)} text-lg px-3 py-1`}>
                        {activeEstimate.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-slate-600">Subtotal:</span>
                        <div className="font-semibold">₹{activeEstimate.subtotal.toLocaleString('en-IN')}</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Tax ({activeEstimate.tax_percentage}%):</span>
                        <div className="font-semibold">₹{activeEstimate.tax_amount.toLocaleString('en-IN')}</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Discount ({activeEstimate.discount_percentage}%):</span>
                        <div className="font-semibold text-red-600">-₹{activeEstimate.discount_amount.toLocaleString('en-IN')}</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Total:</span>
                        <div className="font-bold text-xl text-green-600">₹{activeEstimate.total_amount.toLocaleString('en-IN')}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Add Item Form */}
                {activeEstimate.status !== 'Approved' && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Add Line Item</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-6 gap-3">
                        <div className="col-span-2">
                          <Input
                            placeholder="Description *"
                            value={itemForm.description}
                            onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                            className="bg-white"
                          />
                        </div>
                        <div>
                          <Input
                            placeholder="Category"
                            value={itemForm.category}
                            onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                            className="bg-white"
                          />
                        </div>
                        <div>
                          <Input
                            type="number"
                            placeholder="Qty"
                            min={0}
                            value={itemForm.quantity}
                            onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
                            className="bg-white"
                          />
                        </div>
                        <div>
                          <Input
                            type="number"
                            placeholder="Price"
                            min={0}
                            value={itemForm.unit_price}
                            onChange={(e) => setItemForm({ ...itemForm, unit_price: e.target.value })}
                            className="bg-white"
                          />
                        </div>
                        <div>
                          <Button onClick={handleAddItem} className="w-full bg-blue-600 text-white hover:bg-blue-700">
                            <Plus className="h-4 w-4 mr-1" />
                            Add
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Items Table */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Line Items ({items.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {items.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        No items yet. Add items above.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[50px]">#</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            {activeEstimate.status !== 'Approved' && <TableHead className="w-[60px]"></TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item) => (
                            <TableRow key={item.item_id}>
                              <TableCell className="font-medium">{item.item_number}</TableCell>
                              <TableCell>{item.description}</TableCell>
                              <TableCell className="text-sm text-slate-600">{item.category || '—'}</TableCell>
                              <TableCell className="text-right">{item.quantity} {item.unit}</TableCell>
                              <TableCell className="text-right">₹{item.unit_price}</TableCell>
                              <TableCell className="text-right font-semibold">₹{item.line_total.toLocaleString('en-IN')}</TableCell>
                              {activeEstimate.status !== 'Approved' && (
                                <TableCell>
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    onClick={() => handleDeleteItem(item.item_id)}
                                  >
                                    <Trash className="h-4 w-4 text-red-600" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                {/* Actions */}
                <div className="flex gap-3">
                  {activeEstimate.status === 'Draft' && (
                    <Button 
                      onClick={() => handleUpdateEstimateStatus(activeEstimate.estimate_id, 'Sent to Client')}
                      className="bg-purple-600 text-white hover:bg-purple-700"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send to Client
                    </Button>
                  )}
                  {(activeEstimate.status === 'Draft' || activeEstimate.status === 'Sent to Client') && (
                    <Button 
                      onClick={handleApproveEstimate}
                      disabled={isSaving || items.length === 0}
                      className="bg-green-600 text-white hover:bg-green-700"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Approve & Convert to Order
                    </Button>
                  )}
                  {activeEstimate.status === 'Approved' && (
                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg flex-1">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <div className="text-sm">
                        <div className="font-semibold text-green-700">Estimate Approved</div>
                        <div className="text-green-600">Project Order and Quotation created automatically</div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
