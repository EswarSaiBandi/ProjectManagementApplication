'use client';

import { useEffect, useState } from 'react';
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
import { 
  Target, Plus, Pencil, Trash, Phone, Mail, Calendar, TrendingUp, 
  AlertCircle, CheckCircle, Clock, XCircle, ArrowRight, Search, Calculator, Upload, Download 
} from 'lucide-react';
import EstimateDialog from '@/components/leads/EstimateDialog';

type Lead = {
  lead_id: number;
  lead_number: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  client_address: string | null;
  project_type: string | null;
  estimated_value: number | null;
  estimated_duration_days: number | null;
  source: string | null;
  status: string;
  priority: string;
  description: string | null;
  requirements: string | null;
  notes: string | null;
  assigned_to: string | null;
  contacted_date: string | null;
  follow_up_date: string | null;
  converted_to_order_id: number | null;
  converted_at: string | null;
  lost_reason: string | null;
  created_at: string;
  created_by: string | null;
};

const STATUS_OPTIONS = ['New', 'Contacted', 'In Progress', 'Qualified', 'Proposal Sent', 'Negotiation', 'Realized', 'Unrealized', 'Won', 'Lost'] as const;
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High', 'Urgent'] as const;

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [isOpen, setIsOpen] = useState(false);
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [isEstimateOpen, setIsEstimateOpen] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [estimatingLead, setEstimatingLead] = useState<Lead | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [form, setForm] = useState({
    client_name: '',
    client_email: '',
    client_phone: '',
    client_address: '',
    project_type: '',
    estimated_value: '',
    estimated_duration_days: '',
    source: '',
    status: 'New',
    priority: 'Medium',
    description: '',
    requirements: '',
    notes: '',
    contacted_date: '',
    follow_up_date: '',
  });

  const [convertForm, setConvertForm] = useState({
    project_name: '',
    start_date: '',
    budget: '',
  });

  const fetchSourceOptions = async () => {
    const { data, error } = await supabase
      .from('dynamic_field_options')
      .select('option_value')
      .eq('field_type', 'lead_source')
      .eq('is_active', true)
      .order('display_order');

    if (!error && data) {
      setSourceOptions(data.map(d => d.option_value));
    } else {
      setSourceOptions(['Referral', 'Website', 'Cold Call', 'Social Media', 'Advertisement', 'Walk-in', 'Other']);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch leads error:', error);
      toast.error('Failed to load leads');
      setLeads([]);
    } else {
      setLeads((data || []) as Lead[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLeads();
    fetchSourceOptions();
  }, []);

  const resetForm = () => {
    setForm({
      client_name: '',
      client_email: '',
      client_phone: '',
      client_address: '',
      project_type: '',
      estimated_value: '',
      estimated_duration_days: '',
      source: '',
      status: 'New',
      priority: 'Medium',
      description: '',
      requirements: '',
      notes: '',
      contacted_date: '',
      follow_up_date: '',
    });
  };

  const openNew = () => {
    setEditing(null);
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (lead: Lead) => {
    setEditing(lead);
    setForm({
      client_name: lead.client_name || '',
      client_email: lead.client_email || '',
      client_phone: lead.client_phone || '',
      client_address: lead.client_address || '',
      project_type: lead.project_type || '',
      estimated_value: lead.estimated_value != null ? String(lead.estimated_value) : '',
      estimated_duration_days: lead.estimated_duration_days != null ? String(lead.estimated_duration_days) : '',
      source: lead.source || '',
      status: lead.status || 'New',
      priority: lead.priority || 'Medium',
      description: lead.description || '',
      requirements: lead.requirements || '',
      notes: lead.notes || '',
      contacted_date: lead.contacted_date || '',
      follow_up_date: lead.follow_up_date || '',
    });
    setIsOpen(true);
  };

  const openEstimate = (lead: Lead) => {
    setEstimatingLead(lead);
    setIsEstimateOpen(true);
  };

  const handleDownloadTemplate = () => {
    window.open('/api/leads/template', '_blank');
  };

  const handleBulkUpload = async () => {
    if (!uploadFile) {
      toast.error('Please select a CSV file');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      const response = await fetch('/api/leads/bulk-upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || 'Upload failed');
        setIsUploading(false);
        return;
      }

      toast.success(result.message || `${result.count} leads uploaded successfully`);
      setIsBulkUploadOpen(false);
      setUploadFile(null);
      await fetchLeads();
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload leads');
    }

    setIsUploading(false);
  };

  const openConvert = (lead: Lead) => {
    setConverting(lead);
    setConvertForm({
      project_name: lead.client_name + ' - ' + (lead.project_type || 'Project'),
      start_date: new Date().toISOString().split('T')[0],
      budget: lead.estimated_value != null ? String(lead.estimated_value) : '',
    });
    setIsConvertOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;

    if (!form.client_name.trim()) {
      toast.error('Client name is required');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload: any = {
      client_name: form.client_name.trim(),
      client_email: form.client_email.trim() || null,
      client_phone: form.client_phone.trim() || null,
      client_address: form.client_address.trim() || null,
      project_type: form.project_type.trim() || null,
      estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
      estimated_duration_days: form.estimated_duration_days ? Number(form.estimated_duration_days) : null,
      source: form.source || null,
      status: form.status,
      priority: form.priority,
      description: form.description.trim() || null,
      requirements: form.requirements.trim() || null,
      notes: form.notes.trim() || null,
      contacted_date: form.contacted_date || null,
      follow_up_date: form.follow_up_date || null,
      created_by: userId,
    };

    if (editing) {
      const { error } = await supabase.from('leads').update(payload).eq('lead_id', editing.lead_id);
      if (error) {
        console.error('Update lead error:', error);
        toast.error(error.message || 'Failed to update');
        setIsSaving(false);
        return;
      }
      toast.success('Lead updated');
    } else {
      const { error } = await supabase.from('leads').insert([payload]);
      if (error) {
        console.error('Insert lead error:', error);
        toast.error(error.message || 'Failed to create');
        setIsSaving(false);
        return;
      }
      toast.success('Lead created');
    }

    setIsOpen(false);
    setEditing(null);
    resetForm();
    await fetchLeads();
    setIsSaving(false);
  };

  const handleConvert = async () => {
    if (!converting) return;
    if (!convertForm.project_name.trim()) {
      toast.error('Project name is required');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    // Create order in project_orders
    const orderPayload = {
      project_id: null, // Will be linked to project after creation
      order_number: converting.lead_number.replace('LEAD', 'ORD'),
      order_date: convertForm.start_date || new Date().toISOString().split('T')[0],
      total_amount: convertForm.budget ? Number(convertForm.budget) : null,
      notes: `Converted from Lead: ${converting.lead_number}\n\nClient: ${converting.client_name}\n${converting.description || ''}`,
      created_by: userId,
    };

    const { data: orderData, error: orderError } = await supabase
      .from('project_orders')
      .insert([orderPayload])
      .select()
      .limit(1);

    if (orderError) {
      console.error('Order creation error:', orderError);
      toast.error('Failed to create order');
      setIsSaving(false);
      return;
    }

    const orderId = orderData?.[0]?.id;

    // Update lead status to Won and link to order
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        status: 'Won',
        converted_to_order_id: orderId,
        converted_at: new Date().toISOString(),
      })
      .eq('lead_id', converting.lead_id);

    if (updateError) {
      console.error('Lead update error:', updateError);
      toast.error('Failed to update lead status');
      setIsSaving(false);
      return;
    }

    toast.success('Lead converted to Order successfully!');
    setIsConvertOpen(false);
    setConverting(null);
    await fetchLeads();
    setIsSaving(false);
  };

  const handleDelete = async (lead: Lead) => {
    if (!confirm(`Delete lead "${lead.client_name}"?`)) return;
    const { error } = await supabase.from('leads').delete().eq('lead_id', lead.lead_id);
    if (error) {
      console.error('Delete lead error:', error);
      toast.error(error.message || 'Failed to delete');
      return;
    }
    toast.success('Lead deleted');
    fetchLeads();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'New': return <AlertCircle className="h-4 w-4" />;
      case 'Contacted': return <Phone className="h-4 w-4" />;
      case 'Qualified': return <CheckCircle className="h-4 w-4" />;
      case 'Proposal Sent': return <Mail className="h-4 w-4" />;
      case 'Negotiation': return <TrendingUp className="h-4 w-4" />;
      case 'Won': return <CheckCircle className="h-4 w-4" />;
      case 'Lost': return <XCircle className="h-4 w-4" />;
      case 'On Hold': return <Clock className="h-4 w-4" />;
      default: return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'New': return 'bg-blue-100 text-blue-800';
      case 'Contacted': return 'bg-purple-100 text-purple-800';
      case 'Qualified': return 'bg-cyan-100 text-cyan-800';
      case 'Proposal Sent': return 'bg-indigo-100 text-indigo-800';
      case 'Negotiation': return 'bg-yellow-100 text-yellow-800';
      case 'Won': return 'bg-green-100 text-green-800';
      case 'Lost': return 'bg-red-100 text-red-800';
      case 'On Hold': return 'bg-gray-100 text-gray-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Urgent': return 'bg-red-100 text-red-800 border-red-300';
      case 'High': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'Medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'Low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = 
      lead.client_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.lead_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lead.client_email && lead.client_email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (lead.client_phone && lead.client_phone.includes(searchQuery));
    
    const matchesStatus = statusFilter === 'All' || lead.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const activeLeads = filteredLeads.filter(l => !['Won', 'Lost'].includes(l.status));
  const wonLeads = filteredLeads.filter(l => l.status === 'Won');
  const lostLeads = filteredLeads.filter(l => l.status === 'Lost');

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Target className="h-6 w-6 text-blue-600" />
                Leads Management
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">Track potential projects from inquiry to conversion</p>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleDownloadTemplate}
                variant="outline"
                className="border-blue-600 text-blue-600 hover:bg-blue-50"
              >
                <Download className="h-4 w-4 mr-2" /> Download Template
              </Button>
              <Dialog open={isBulkUploadOpen} onOpenChange={setIsBulkUploadOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="border-green-600 text-green-600 hover:bg-green-50">
                    <Upload className="h-4 w-4 mr-2" /> Bulk Upload
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-white max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Bulk Upload Leads</DialogTitle>
                    <DialogDescription>Upload multiple leads at once using a CSV file</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Select CSV File *</Label>
                      <Input
                        type="file"
                        accept=".csv"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        className="bg-white"
                      />
                      {uploadFile && (
                        <p className="text-sm text-green-600">Selected: {uploadFile.name}</p>
                      )}
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                      <p className="text-sm font-semibold text-blue-800">Instructions:</p>
                      <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                        <li>Download the template using the "Download Template" button</li>
                        <li>Fill in your lead data (delete sample rows)</li>
                        <li>Save as CSV and upload here</li>
                        <li>All leads will be auto-saved with lead numbers</li>
                      </ol>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => {
                      setIsBulkUploadOpen(false);
                      setUploadFile(null);
                    }}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleBulkUpload}
                      disabled={isUploading || !uploadFile}
                      className="bg-green-600 text-white hover:bg-green-700"
                    >
                      {isUploading ? 'Uploading...' : 'Upload Leads'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger asChild>
                  <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" /> New Lead
                  </Button>
                </DialogTrigger>
              <DialogContent className="bg-white max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editing ? 'Edit Lead' : 'New Lead'}</DialogTitle>
                  <DialogDescription>Capture lead details and track progress</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client Name *</Label>
                      <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} className="bg-white" />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input value={form.client_phone} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} className="bg-white" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input type="email" value={form.client_email} onChange={(e) => setForm({ ...form, client_email: e.target.value })} className="bg-white" />
                    </div>
                    <div className="space-y-2">
                      <Label>Project Type</Label>
                      <Input value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })} className="bg-white" placeholder="e.g. Residential / Commercial" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Client Address</Label>
                    <Textarea value={form.client_address} onChange={(e) => setForm({ ...form, client_address: e.target.value })} className="bg-white" rows={2} />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Estimated Value (₹)</Label>
                      <Input type="number" min={0} value={form.estimated_value} onChange={(e) => setForm({ ...form, estimated_value: e.target.value })} className="bg-white" />
                    </div>
                    <div className="space-y-2">
                      <Label>Duration (days)</Label>
                      <Input type="number" min={0} value={form.estimated_duration_days} onChange={(e) => setForm({ ...form, estimated_duration_days: e.target.value })} className="bg-white" />
                    </div>
                    <div className="space-y-2">
                      <Label>Source</Label>
                      <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {sourceOptions.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {STATUS_OPTIONS.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {PRIORITY_OPTIONS.map(p => (
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Contacted Date</Label>
                      <Input type="date" value={form.contacted_date} onChange={(e) => setForm({ ...form, contacted_date: e.target.value })} className="bg-white" />
                    </div>
                    <div className="space-y-2">
                      <Label>Follow-up Date</Label>
                      <Input type="date" value={form.follow_up_date} onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })} className="bg-white" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-white" rows={3} placeholder="Brief project description" />
                  </div>

                  <div className="space-y-2">
                    <Label>Requirements</Label>
                    <Textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} className="bg-white" rows={2} placeholder="Client requirements" />
                  </div>

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-white" rows={2} placeholder="Internal notes" />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                  <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                    {isSaving ? 'Saving...' : 'Save Lead'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-slate-500 mb-1">Active Leads</div>
                <div className="text-2xl font-bold">{activeLeads.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-slate-500 mb-1">Won (Converted)</div>
                <div className="text-2xl font-bold text-green-600">{wonLeads.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-slate-500 mb-1">Lost</div>
                <div className="text-2xl font-bold text-red-600">{lostLeads.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-slate-500 mb-1">Total Value</div>
                <div className="text-2xl font-bold text-blue-600">
                  ₹{activeLeads.reduce((sum, l) => sum + (l.estimated_value || 0), 0).toLocaleString('en-IN')}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex gap-4 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by client, lead number, email, or phone..."
                className="pl-10 bg-white"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white">
                <SelectItem value="All">All Statuses</SelectItem>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Leads Table */}
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading leads...</div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-3 opacity-50" />
              {searchQuery || statusFilter !== 'All' ? 'No leads match your filters' : 'No leads yet. Create your first lead!'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead #</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Project Type</TableHead>
                  <TableHead className="w-[120px]">Value</TableHead>
                  <TableHead className="w-[100px]">Priority</TableHead>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="w-[120px]">Follow-up</TableHead>
                  <TableHead className="w-[180px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.map((lead) => (
                  <TableRow key={lead.lead_id} className="hover:bg-slate-50">
                    <TableCell className="font-mono text-xs">{lead.lead_number}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{lead.client_name}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
                          {lead.client_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.client_phone}</span>}
                          {lead.client_email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{lead.client_email}</span>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{lead.project_type || '—'}</TableCell>
                    <TableCell className="font-semibold">
                      {lead.estimated_value ? `₹${Number(lead.estimated_value).toLocaleString('en-IN')}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getPriorityColor(lead.priority)}>
                        {lead.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(lead.status)}>
                        <span className="flex items-center gap-1">
                          {getStatusIcon(lead.status)}
                          {lead.status}
                        </span>
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {lead.follow_up_date ? (
                        <span className={new Date(lead.follow_up_date) < new Date() ? 'text-red-600 font-semibold' : ''}>
                          {new Date(lead.follow_up_date).toLocaleDateString()}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {!['Won', 'Lost'].includes(lead.status) && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => openConvert(lead)}
                            className="text-green-600 border-green-300 hover:bg-green-50"
                          >
                            <ArrowRight className="h-4 w-4 mr-1" />
                            Convert
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => openEstimate(lead)}
                          className="bg-blue-50 hover:bg-blue-100"
                        >
                          <Calculator className="h-4 w-4 text-blue-600" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEdit(lead)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(lead)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Convert to Order Dialog */}
      <Dialog open={isConvertOpen} onOpenChange={setIsConvertOpen}>
        <DialogContent className="bg-white max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRight className="h-5 w-5 text-green-600" />
              Convert Lead to Order
            </DialogTitle>
            <DialogDescription>
              Converting: {converting?.lead_number} - {converting?.client_name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Project Name *</Label>
              <Input 
                value={convertForm.project_name} 
                onChange={(e) => setConvertForm({ ...convertForm, project_name: e.target.value })} 
                className="bg-white" 
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input 
                  type="date" 
                  value={convertForm.start_date} 
                  onChange={(e) => setConvertForm({ ...convertForm, start_date: e.target.value })} 
                  className="bg-white" 
                />
              </div>
              <div className="space-y-2">
                <Label>Budget (₹)</Label>
                <Input 
                  type="number" 
                  min={0} 
                  value={convertForm.budget} 
                  onChange={(e) => setConvertForm({ ...convertForm, budget: e.target.value })} 
                  className="bg-white" 
                />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <p className="text-sm text-blue-800">
                This will create an order record and mark the lead as "Won". The order will be available in the Orders section.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConvertOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleConvert} 
              disabled={isSaving} 
              className="bg-green-600 text-white hover:bg-green-700"
            >
              {isSaving ? 'Converting...' : 'Convert to Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Estimate Dialog */}
      {estimatingLead && (
        <EstimateDialog
          leadId={estimatingLead.lead_id}
          leadName={estimatingLead.client_name}
          isOpen={isEstimateOpen}
          onClose={() => {
            setIsEstimateOpen(false);
            setEstimatingLead(null);
          }}
          onEstimateApproved={() => {
            fetchLeads();
          }}
        />
      )}
    </div>
  );
}
