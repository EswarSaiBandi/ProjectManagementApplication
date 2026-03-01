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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Plus, Pencil, Trash, Building2, UserCheck, DollarSign, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type ManpowerRow = {
  id: number;
  project_id: number;
  labor_type: 'In-House' | 'Outsourced';
  role: string;
  headcount: number;
  start_date: string | null;
  end_date: string | null;
  rate_per_day: string | number | null;
  vendor_name: string | null;
  contract_number: string | null;
  contract_amount: string | number | null;
  team_member_id: string | null;
  notes: string | null;
  created_at: string;
};

type OutsourcedPayment = {
  payment_id: number;
  manpower_id: number;
  payment_type: 'Advance' | 'Settlement' | 'Partial';
  payment_date: string;
  amount: number;
  payment_method: string | null;
  reference_number: string | null;
  status: 'Pending' | 'Approved' | 'Paid' | 'Rejected';
  notes: string | null;
};

type TeamMember = {
  user_id: string;
  full_name: string | null;
};

export default function ManpowerTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [activeTab, setActiveTab] = useState<'in-house' | 'outsourced'>('in-house');
  const [rows, setRows] = useState<ManpowerRow[]>([]);
  const [payments, setPayments] = useState<OutsourcedPayment[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ManpowerRow | null>(null);
  const [selectedManpower, setSelectedManpower] = useState<ManpowerRow | null>(null);

  const [form, setForm] = useState({
    labor_type: 'In-House' as 'In-House' | 'Outsourced',
    role: '',
    headcount: '1',
    start_date: '',
    end_date: '',
    rate_per_day: '',
    vendor_name: '',
    contract_number: '',
    contract_amount: '',
    team_member_id: '',
    notes: '',
  });

  const [paymentForm, setPaymentForm] = useState({
    payment_type: 'Advance' as 'Advance' | 'Settlement' | 'Partial',
    payment_date: new Date().toISOString().split('T')[0],
    amount: '',
    payment_method: '',
    reference_number: '',
    notes: '',
  });

  const fetchRows = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('project_manpower')
      .select('*')
      .eq('project_id', numericProjectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch manpower error:', error);
      toast.error(error.message || 'Failed to load manpower');
      setRows([]);
    } else {
      setRows((data || []) as ManpowerRow[]);
    }
    setLoading(false);
  };

  const fetchTeamMembers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .order('full_name');
    
    if (!error && data) {
      setTeamMembers(data as TeamMember[]);
    }
  };

  const fetchPayments = async (manpowerId: number) => {
    const { data, error } = await supabase
      .from('outsourced_payments')
      .select('*')
      .eq('manpower_id', manpowerId)
      .order('payment_date', { ascending: false });
    
    if (!error && data) {
      setPayments(data as OutsourcedPayment[]);
    }
  };

  useEffect(() => {
    fetchRows();
    fetchTeamMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const resetForm = () => {
    setForm({ 
      labor_type: activeTab === 'in-house' ? 'In-House' : 'Outsourced',
      role: '', 
      headcount: '1', 
      start_date: '', 
      end_date: '', 
      rate_per_day: '', 
      vendor_name: '',
      contract_number: '',
      contract_amount: '',
      team_member_id: '',
      notes: '' 
    });
  };

  const openNew = () => {
    setEditing(null);
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (r: ManpowerRow) => {
    setEditing(r);
    setForm({
      labor_type: r.labor_type || 'In-House',
      role: r.role || '',
      headcount: String(r.headcount ?? 1),
      start_date: r.start_date ? new Date(r.start_date).toISOString().split('T')[0] : '',
      end_date: r.end_date ? new Date(r.end_date).toISOString().split('T')[0] : '',
      rate_per_day: r.rate_per_day != null ? String(r.rate_per_day) : '',
      vendor_name: r.vendor_name || '',
      contract_number: r.contract_number || '',
      contract_amount: r.contract_amount != null ? String(r.contract_amount) : '',
      team_member_id: r.team_member_id || '',
      notes: r.notes || '',
    });
    setIsOpen(true);
  };

  const openPaymentDialog = (manpower: ManpowerRow) => {
    setSelectedManpower(manpower);
    fetchPayments(manpower.id);
    setPaymentForm({
      payment_type: 'Advance',
      payment_date: new Date().toISOString().split('T')[0],
      amount: '',
      payment_method: '',
      reference_number: '',
      notes: '',
    });
    setIsPaymentOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!Number.isFinite(numericProjectId)) {
      toast.error('Invalid project');
      return;
    }

    const role = form.role.trim();
    if (!role) {
      toast.error('Role is required');
      return;
    }
    const headcount = Number(form.headcount);
    if (!Number.isFinite(headcount) || headcount <= 0) {
      toast.error('Headcount must be a positive number');
      return;
    }
    if (form.start_date && form.end_date && new Date(form.start_date) > new Date(form.end_date)) {
      toast.error('End date must be on or after start date');
      return;
    }

    if (form.labor_type === 'Outsourced' && !form.vendor_name.trim()) {
      toast.error('Vendor name is required for outsourced labor');
      return;
    }

    const rateVal = form.rate_per_day.trim() === '' ? null : Number(form.rate_per_day);
    if (rateVal !== null && (!Number.isFinite(rateVal) || rateVal < 0)) {
      toast.error('Rate/day must be a valid non-negative number (or blank)');
      return;
    }

    const contractVal = form.contract_amount.trim() === '' ? null : Number(form.contract_amount);
    if (contractVal !== null && (!Number.isFinite(contractVal) || contractVal < 0)) {
      toast.error('Contract amount must be a valid non-negative number (or blank)');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload: any = {
      project_id: numericProjectId,
      labor_type: form.labor_type,
      role,
      headcount,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      rate_per_day: rateVal,
      vendor_name: form.labor_type === 'Outsourced' ? form.vendor_name.trim() : null,
      contract_number: form.labor_type === 'Outsourced' ? form.contract_number.trim() || null : null,
      contract_amount: form.labor_type === 'Outsourced' ? contractVal : null,
      team_member_id: form.labor_type === 'In-House' && form.team_member_id ? form.team_member_id : null,
      notes: form.notes.trim() ? form.notes.trim() : null,
      created_by: userId,
    };

    if (editing) {
      const { error } = await supabase.from('project_manpower').update(payload).eq('id', editing.id);
      if (error) {
        console.error('Update manpower error:', error);
        toast.error(error.message || 'Failed to update');
        setIsSaving(false);
        return;
      }
      toast.success('Updated');
    } else {
      const { error } = await supabase.from('project_manpower').insert([payload]);
      if (error) {
        console.error('Insert manpower error:', error);
        toast.error(error.message || 'Failed to add');
        setIsSaving(false);
        return;
      }
      toast.success('Added');
    }

    setIsOpen(false);
    setEditing(null);
    resetForm();
    await fetchRows();
    setIsSaving(false);
  };

  const handlePaymentSave = async () => {
    if (!selectedManpower) return;
    
    if (!paymentForm.payment_date) {
      toast.error('Payment date is required');
      return;
    }
    
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) {
      toast.error('Amount must be greater than 0');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload = {
      manpower_id: selectedManpower.id,
      project_id: numericProjectId,
      payment_type: paymentForm.payment_type,
      payment_date: paymentForm.payment_date,
      amount,
      payment_method: paymentForm.payment_method.trim() || null,
      reference_number: paymentForm.reference_number.trim() || null,
      notes: paymentForm.notes.trim() || null,
      status: 'Pending',
      created_by: userId,
    };

    const { error } = await supabase.from('outsourced_payments').insert([payload]);
    if (error) {
      console.error('Payment insert error:', error);
      toast.error(error.message || 'Failed to add payment');
      setIsSaving(false);
      return;
    }

    toast.success('Payment recorded');
    await fetchPayments(selectedManpower.id);
    setPaymentForm({
      payment_type: 'Advance',
      payment_date: new Date().toISOString().split('T')[0],
      amount: '',
      payment_method: '',
      reference_number: '',
      notes: '',
    });
    setIsSaving(false);
  };

  const handleDelete = async (r: ManpowerRow) => {
    if (!confirm(`Delete manpower entry "${r.role}"?`)) return;
    const { error } = await supabase.from('project_manpower').delete().eq('id', r.id);
    if (error) {
      console.error('Delete manpower error:', error);
      toast.error(error.message || 'Failed to delete');
      return;
    }
    toast.success('Deleted');
    fetchRows();
  };

  const inHouseRows = rows.filter(r => r.labor_type === 'In-House');
  const outsourcedRows = rows.filter(r => r.labor_type === 'Outsourced');

  const calculatePaymentSummary = (manpowerId: number) => {
    const manpowerPayments = payments.filter(p => p.manpower_id === manpowerId && p.status !== 'Rejected');
    const advance = manpowerPayments.filter(p => p.payment_type === 'Advance').reduce((sum, p) => sum + Number(p.amount), 0);
    const partial = manpowerPayments.filter(p => p.payment_type === 'Partial').reduce((sum, p) => sum + Number(p.amount), 0);
    const settlement = manpowerPayments.filter(p => p.payment_type === 'Settlement').reduce((sum, p) => sum + Number(p.amount), 0);
    return { advance, partial, settlement, total: advance + partial + settlement };
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-slate-500" /> Manpower & Labor Management
            </CardTitle>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                  <Plus className="h-4 w-4 mr-2" /> Add Labor
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editing ? 'Edit Labor Entry' : 'Add Labor Entry'}</DialogTitle>
                  <DialogDescription>Track in-house team members or outsourced labor contractors.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>Labor Type *</Label>
                    <Select value={form.labor_type} onValueChange={(v: 'In-House' | 'Outsourced') => setForm({ ...form, labor_type: v })}>
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value="In-House">In-House</SelectItem>
                        <SelectItem value="Outsourced">Outsourced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Role *</Label>
                    <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="bg-white" placeholder="e.g. Mason / Carpenter / Supervisor" />
                  </div>

                  {form.labor_type === 'In-House' && (
                    <div className="space-y-2">
                      <Label>Team Member (Optional)</Label>
                      <Select value={form.team_member_id} onValueChange={(v) => setForm({ ...form, team_member_id: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder="Select team member" />
                        </SelectTrigger>
                        <SelectContent className="bg-white max-h-60">
                          <SelectItem value="">None</SelectItem>
                          {teamMembers.map(tm => (
                            <SelectItem key={tm.user_id} value={tm.user_id}>
                              {tm.full_name || tm.user_id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {form.labor_type === 'Outsourced' && (
                    <>
                      <div className="space-y-2">
                        <Label>Vendor/Contractor Name *</Label>
                        <Input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} className="bg-white" placeholder="Contractor company or person name" />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Contract Number</Label>
                          <Input value={form.contract_number} onChange={(e) => setForm({ ...form, contract_number: e.target.value })} className="bg-white" placeholder="Optional" />
                        </div>
                        <div className="space-y-2">
                          <Label>Contract Amount</Label>
                          <Input type="number" min={0} value={form.contract_amount} onChange={(e) => setForm({ ...form, contract_amount: e.target.value })} className="bg-white" placeholder="Total contract value" />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Headcount *</Label>
                      <Input type="number" min={1} value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} className="bg-white" />
                    </div>
                    <div className="space-y-2">
                      <Label>Rate/day (optional)</Label>
                      <Input type="number" min={0} value={form.rate_per_day} onChange={(e) => setForm({ ...form, rate_per_day: e.target.value })} className="bg-white" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Start date</Label>
                      <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="bg-white" />
                    </div>
                    <div className="space-y-2">
                      <Label>End date</Label>
                      <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="bg-white" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-white" placeholder="Optional" />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'in-house' | 'outsourced')}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="in-house" className="flex items-center gap-2">
                <UserCheck className="h-4 w-4" />
                In-House ({inHouseRows.length})
              </TabsTrigger>
              <TabsTrigger value="outsourced" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Outsourced ({outsourcedRows.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="in-house">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : inHouseRows.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">No in-house labor entries yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead className="w-[100px]">Headcount</TableHead>
                      <TableHead className="w-[160px]">Duration</TableHead>
                      <TableHead className="w-[100px]">Rate/day</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-[120px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inHouseRows.map((r) => (
                      <TableRow key={r.id} className="hover:bg-slate-50">
                        <TableCell className="font-medium">{r.role}</TableCell>
                        <TableCell>{r.headcount}</TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {(r.start_date ? new Date(r.start_date).toLocaleDateString() : '—')} → {(r.end_date ? new Date(r.end_date).toLocaleDateString() : '—')}
                        </TableCell>
                        <TableCell>{r.rate_per_day ? `₹${r.rate_per_day}` : '—'}</TableCell>
                        <TableCell className="text-sm text-slate-600">{r.notes || '—'}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleDelete(r)}>
                              <Trash className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="outsourced">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : outsourcedRows.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">No outsourced labor entries yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="w-[100px]">Headcount</TableHead>
                      <TableHead className="w-[140px]">Contract Amount</TableHead>
                      <TableHead className="w-[160px]">Duration</TableHead>
                      <TableHead className="w-[160px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outsourcedRows.map((r) => (
                      <TableRow key={r.id} className="hover:bg-slate-50">
                        <TableCell className="font-medium">{r.role}</TableCell>
                        <TableCell className="text-sm">{r.vendor_name || '—'}</TableCell>
                        <TableCell>{r.headcount}</TableCell>
                        <TableCell className="font-semibold">{r.contract_amount ? `₹${Number(r.contract_amount).toLocaleString('en-IN')}` : '—'}</TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {(r.start_date ? new Date(r.start_date).toLocaleDateString() : '—')} → {(r.end_date ? new Date(r.end_date).toLocaleDateString() : '—')}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openPaymentDialog(r)} title="Manage Payments">
                              <DollarSign className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleDelete(r)}>
                              <Trash className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Outsourced Payment Management Dialog */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="bg-white max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Payment Tracking: {selectedManpower?.vendor_name} - {selectedManpower?.role}
            </DialogTitle>
            <DialogDescription>
              Track advance payments and final settlements for outsourced labor.
            </DialogDescription>
          </DialogHeader>

          {selectedManpower && (
            <div className="space-y-4">
              {/* Payment Summary */}
              <div className="grid grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-xs text-slate-500 mb-1">Contract Amount</div>
                    <div className="text-lg font-bold">₹{Number(selectedManpower.contract_amount || 0).toLocaleString('en-IN')}</div>
                  </CardContent>
                </Card>
                {(() => {
                  const summary = calculatePaymentSummary(selectedManpower.id);
                  return (
                    <>
                      <Card>
                        <CardContent className="pt-4">
                          <div className="text-xs text-slate-500 mb-1">Advance Paid</div>
                          <div className="text-lg font-bold text-orange-600">₹{summary.advance.toLocaleString('en-IN')}</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <div className="text-xs text-slate-500 mb-1">Total Paid</div>
                          <div className="text-lg font-bold text-blue-600">₹{summary.total.toLocaleString('en-IN')}</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <div className="text-xs text-slate-500 mb-1">Balance Due</div>
                          <div className="text-lg font-bold text-green-600">
                            ₹{(Number(selectedManpower.contract_amount || 0) - summary.total).toLocaleString('en-IN')}
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  );
                })()}
              </div>

              {/* Add Payment Form */}
              <Card className="bg-slate-50">
                <CardHeader>
                  <CardTitle className="text-base">Record New Payment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Payment Type</Label>
                      <Select value={paymentForm.payment_type} onValueChange={(v: any) => setPaymentForm({ ...paymentForm, payment_type: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="Advance">Advance</SelectItem>
                          <SelectItem value="Partial">Partial Payment</SelectItem>
                          <SelectItem value="Settlement">Final Settlement</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Payment Date *</Label>
                      <Input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} className="bg-white" required />
                    </div>
                    <div className="space-y-2">
                      <Label>Amount *</Label>
                      <Input type="number" min={0} value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="bg-white" placeholder="₹" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Payment Method</Label>
                      <Input value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })} className="bg-white" placeholder="Cash / Cheque / Bank Transfer" />
                    </div>
                    <div className="space-y-2">
                      <Label>Reference Number</Label>
                      <Input value={paymentForm.reference_number} onChange={(e) => setPaymentForm({ ...paymentForm, reference_number: e.target.value })} className="bg-white" placeholder="Cheque / Transaction ID" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Input value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} className="bg-white" placeholder="Optional" />
                  </div>
                  <Button onClick={handlePaymentSave} disabled={isSaving} className="bg-green-600 text-white hover:bg-green-700">
                    {isSaving ? 'Recording...' : 'Record Payment'}
                  </Button>
                </CardContent>
              </Card>

              {/* Payment History */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Payment History</h3>
                {payments.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 text-sm">No payments recorded yet.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Date</TableHead>
                        <TableHead className="w-[120px]">Type</TableHead>
                        <TableHead className="w-[140px]">Amount</TableHead>
                        <TableHead className="w-[120px]">Status</TableHead>
                        <TableHead>Method / Ref</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p.payment_id}>
                          <TableCell className="text-sm">{new Date(p.payment_date).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{p.payment_type}</Badge>
                          </TableCell>
                          <TableCell className="font-semibold">₹{Number(p.amount).toLocaleString('en-IN')}</TableCell>
                          <TableCell>
                            <Badge className={
                              p.status === 'Paid' ? 'bg-green-100 text-green-800' :
                              p.status === 'Approved' ? 'bg-blue-100 text-blue-800' :
                              p.status === 'Rejected' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }>
                              {p.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {p.payment_method || '—'} {p.reference_number ? `/ ${p.reference_number}` : ''}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">{p.notes || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPaymentOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
