'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/supabase';
import { useRole } from '@/hooks/useRole';
import { Plus, Edit, Trash2, Pause, Play, Search, Store as StoreIcon, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface Vendor {
  vendor_id: number;
  vendor_name: string;
  proprietor_name: string;
  phone_number: string | null;
  address: string;
  gst_number: string | null;
  is_active: boolean;
  created_at: string;
}

interface VendorFormState {
  vendor_id: number | null;
  vendor_name: string;
  proprietor_name: string;
  phone_number: string;
  address: string;
  gst_number: string;
}

const EMPTY_FORM: VendorFormState = {
  vendor_id: null,
  vendor_name: '',
  proprietor_name: '',
  phone_number: '',
  address: '',
  gst_number: '',
};

export default function VendorsTab() {
  const { isAdmin, loading: roleLoading } = useRole();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<VendorFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('vendors')
      .select('vendor_id, vendor_name, proprietor_name, phone_number, address, gst_number, is_active, created_at')
      .order('vendor_name');

    if (error) {
      toast.error('Failed to load vendors: ' + error.message);
      setVendors([]);
    } else {
      setVendors((data as Vendor[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchVendors(); }, [fetchVendors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (!showInactive && !v.is_active) return false;
      if (!q) return true;
      return (
        v.vendor_name.toLowerCase().includes(q) ||
        v.proprietor_name.toLowerCase().includes(q) ||
        (v.phone_number ?? '').toLowerCase().includes(q) ||
        (v.gst_number ?? '').toLowerCase().includes(q) ||
        v.address.toLowerCase().includes(q)
      );
    });
  }, [vendors, search, showInactive]);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (v: Vendor) => {
    setForm({
      vendor_id: v.vendor_id,
      vendor_name: v.vendor_name,
      proprietor_name: v.proprietor_name,
      phone_number: v.phone_number ?? '',
      address: v.address,
      gst_number: v.gst_number ?? '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.vendor_name.trim())     { toast.error('Vendor name is required');      return; }
    if (!form.proprietor_name.trim()) { toast.error('Proprietor name is required');  return; }
    if (!form.address.trim())         { toast.error('Address is required');          return; }

    const payload = {
      vendor_name:     form.vendor_name.trim(),
      proprietor_name: form.proprietor_name.trim(),
      phone_number:    form.phone_number.trim() || null,
      address:         form.address.trim(),
      gst_number:      form.gst_number.trim() || null,
    };

    setSaving(true);
    try {
      if (form.vendor_id) {
        const { error } = await supabase
          .from('vendors')
          .update(payload)
          .eq('vendor_id', form.vendor_id);
        if (error) throw error;
        toast.success('Vendor updated');
      } else {
        const { error } = await supabase
          .from('vendors')
          .insert({ ...payload, is_active: true });
        if (error) throw error;
        toast.success('Vendor created');
      }
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      fetchVendors();
    } catch (error: any) {
      toast.error('Failed to save vendor: ' + (error.message || error));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (v: Vendor) => {
    const { error } = await supabase
      .from('vendors')
      .update({ is_active: !v.is_active })
      .eq('vendor_id', v.vendor_id);
    if (error) { toast.error(error.message); return; }
    toast.success(v.is_active ? 'Vendor deactivated' : 'Vendor activated');
    fetchVendors();
  };

  const handleDelete = async (v: Vendor) => {
    if (!confirm(`Delete vendor "${v.vendor_name}"?\n\nThis will fail if any stock batches reference this vendor. Deactivate instead to hide it from new stock entries.`)) {
      return;
    }
    const { error } = await supabase
      .from('vendors')
      .delete()
      .eq('vendor_id', v.vendor_id);
    if (error) {
      toast.error(error.message.includes('foreign key')
        ? 'Cannot delete — vendor is referenced by stock batches. Deactivate instead.'
        : error.message);
      return;
    }
    toast.success('Vendor deleted');
    fetchVendors();
  };

  if (roleLoading) {
    return <div className="p-8 text-center text-slate-500">Loading…</div>;
  }

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="border-b bg-slate-50 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <StoreIcon className="h-5 w-5 text-blue-600" />
            Vendors
            <span className="text-sm font-normal text-slate-500 ml-1">
              ({filtered.length} of {vendors.length})
            </span>
            {!isAdmin && (
              <Badge variant="outline" className="ml-2 text-xs">
                <Lock className="h-3 w-3 mr-1" /> Admin-only management
              </Badge>
            )}
          </CardTitle>

          <Dialog
            open={dialogOpen}
            onOpenChange={(o) => { setDialogOpen(o); if (!o) setForm(EMPTY_FORM); }}
          >
            <DialogTrigger asChild>
              <Button
                onClick={openNew}
                disabled={!isAdmin}
                className="bg-blue-600 hover:bg-blue-700"
                title={isAdmin ? 'Add a new vendor' : 'Only admins can add vendors'}
              >
                <Plus className="h-4 w-4 mr-2" /> New Vendor
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {form.vendor_id ? 'Edit Vendor' : 'New Vendor'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Vendor Name *</Label>
                  <Input
                    value={form.vendor_name}
                    onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                    placeholder="e.g., Sri Krishna Traders"
                    className="bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Proprietor Name *</Label>
                  <Input
                    value={form.proprietor_name}
                    onChange={(e) => setForm({ ...form, proprietor_name: e.target.value })}
                    placeholder="e.g., K. Ramesh"
                    className="bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Address *</Label>
                  <Textarea
                    rows={3}
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Full address"
                    className="bg-white"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Phone Number <span className="text-slate-400 font-normal">(optional)</span></Label>
                    <Input
                      value={form.phone_number}
                      onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                      placeholder="e.g., +91 98765 43210"
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>GST Number <span className="text-slate-400 font-normal">(optional)</span></Label>
                    <Input
                      value={form.gst_number}
                      onChange={(e) => setForm({ ...form, gst_number: e.target.value })}
                      placeholder="e.g., 36ABCDE1234F1Z5"
                      className="bg-white uppercase"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saving ? 'Saving…' : (form.vendor_id ? 'Update Vendor' : 'Create Vendor')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-[320px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name / proprietor / phone / GST / address"
              className="pl-8 bg-white"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
          {search && (
            <Button variant="outline" size="sm" onClick={() => setSearch('')}>
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading vendors…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {vendors.length === 0
              ? 'No vendors yet. Create your first vendor to start tagging stock entries.'
              : 'No vendors match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Proprietor</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>GST Number</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => (
                  <TableRow key={v.vendor_id} className="hover:bg-slate-50">
                    <TableCell className="font-semibold text-slate-900">{v.vendor_name}</TableCell>
                    <TableCell className="text-sm text-slate-700">{v.proprietor_name}</TableCell>
                    <TableCell className="text-sm text-slate-700">{v.phone_number || <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-sm text-slate-700 font-mono">{v.gst_number || <span className="text-slate-400 font-sans">—</span>}</TableCell>
                    <TableCell className="text-sm text-slate-600 max-w-xs whitespace-pre-wrap break-words">
                      {v.address}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={v.is_active
                          ? 'bg-green-100 text-green-700 border-green-300'
                          : 'bg-gray-100 text-gray-600 border-gray-300'}
                      >
                        {v.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => handleToggleActive(v)}
                          disabled={!isAdmin}
                          title={v.is_active ? 'Deactivate vendor' : 'Activate vendor'}
                        >
                          {v.is_active
                            ? <Pause className="h-4 w-4 text-orange-600" />
                            : <Play className="h-4 w-4 text-green-600" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(v)}
                          disabled={!isAdmin}
                          title="Edit vendor"
                        >
                          <Edit className="h-4 w-4 text-blue-600" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => handleDelete(v)}
                          disabled={!isAdmin}
                          title="Delete vendor"
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
