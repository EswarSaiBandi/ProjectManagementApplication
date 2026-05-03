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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/supabase';
import { Plus, Package, Pause, Play, Upload, IndianRupee, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface Material {
  material_id: number;
  material_name: string;
  metric: string;
}

interface VariantRow {
  material_id: number;
  material_name: string;
  metric: string | null;
  variant_id: number;
  variant_name: string;
  unit_price: number;
  is_active: boolean;
  batch_count: number;
  earliest_batch_date: string | null;
  latest_batch_date: string | null;
  quantity_received: number;
  quantity_available: number;
  stock_value: number;
}

interface BatchRow {
  batch_id: number;
  variant_id: number;
  batch_date: string;
  quantity_received: number;
  quantity_available: number;
  quantity_outflow: number;
  stock_value: number;
  invoice_number: string | null;
  bill_path: string | null;
  notes: string | null;
}

const BILL_BUCKET = 'material-invoices';

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export default function PriceVariantsTab() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    material_id: '',
    variant_name: '',
    unit_price: '',
    notes: '',
  });
  const [creating, setCreating] = useState(false);

  const [addStockOpen, setAddStockOpen] = useState(false);
  const [addStockForm, setAddStockForm] = useState({
    material_id: '',
    variant_id: '',
    quantity: '',
    invoice_number: '',
    notes: '',
  });
  const [addStockFile, setAddStockFile] = useState<File | null>(null);
  const [addingStock, setAddingStock] = useState(false);

  const [togglingId, setTogglingId] = useState<number | null>(null);

  const [reduceOpen, setReduceOpen] = useState(false);
  const [reduceForm, setReduceForm] = useState({ material_id: '', quantity: '', reason: '' });
  const [reducing, setReducing] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [matRes, rowRes, batchRes] = await Promise.all([
      supabase
        .from('materials_master')
        .select('material_id, material_name, metric')
        .eq('is_active', true)
        .order('material_name'),
      supabase
        .from('material_stock_variants_admin')
        .select('*')
        .order('material_name')
        .order('earliest_batch_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('material_stock_batches_admin')
        .select('batch_id, variant_id, batch_date, quantity_received, quantity_available, quantity_outflow, stock_value, invoice_number, bill_path, notes')
        .order('batch_date', { ascending: true })
        .order('batch_id', { ascending: true }),
    ]);

    if (matRes.error) toast.error('Failed to load materials: ' + matRes.error.message);
    else setMaterials(matRes.data || []);

    if (rowRes.error) toast.error('Failed to load price variants: ' + rowRes.error.message);
    else setRows((rowRes.data as VariantRow[]) || []);

    if (batchRes.error) toast.error('Failed to load batches: ' + batchRes.error.message);
    else setBatches((batchRes.data as BatchRow[]) || []);

    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ------------------------------------------------------------------ Grouping

  const groupedByMaterial = useMemo(() => {
    const map = new Map<number, { material_name: string; variants: VariantRow[] }>();
    for (const r of rows) {
      if (!map.has(r.material_id)) {
        map.set(r.material_id, { material_name: r.material_name, variants: [] });
      }
      map.get(r.material_id)!.variants.push(r);
    }
    return Array.from(map.entries()).map(([material_id, v]) => ({
      material_id,
      material_name: v.material_name,
      variants: v.variants,
      total_qty: v.variants.reduce((s, x) => s + Number(x.quantity_available || 0), 0),
      total_value: v.variants.reduce((s, x) => s + Number(x.stock_value || 0), 0),
    }));
  }, [rows]);

  const activeVariantsByMaterial = useMemo(() => {
    const map = new Map<number, VariantRow[]>();
    for (const r of rows) {
      if (!r.is_active) continue;
      if (!map.has(r.material_id)) map.set(r.material_id, []);
      map.get(r.material_id)!.push(r);
    }
    return map;
  }, [rows]);

  // ------------------------------------------------------------------ Actions

  const resetCreateForm = () => setCreateForm({
    material_id: '', variant_name: '', unit_price: '', notes: '',
  });

  const handleCreate = async () => {
    if (!createForm.material_id) { toast.error('Select a material'); return; }
    if (!createForm.variant_name.trim()) { toast.error('Variant name is required'); return; }
    const price = parseFloat(createForm.unit_price);
    if (!price || price <= 0) { toast.error('Unit price must be > 0'); return; }

    setCreating(true);
    const { error } = await supabase.rpc('create_price_variant', {
      p_material_id: parseInt(createForm.material_id),
      p_variant_name: createForm.variant_name.trim(),
      p_unit_price: price,
      p_notes: createForm.notes.trim() || null,
    });
    setCreating(false);

    if (error) { toast.error(error.message); return; }
    toast.success('Price variant created');
    setCreateOpen(false);
    resetCreateForm();
    fetchAll();
  };

  const resetAddStockForm = () => {
    setAddStockForm({
      material_id: '', variant_id: '', quantity: '',
      invoice_number: '', notes: '',
    });
    setAddStockFile(null);
  };

  const handleAddStock = async () => {
    if (!addStockForm.variant_id) { toast.error('Select a variant'); return; }
    const qty = parseFloat(addStockForm.quantity);
    if (!qty || qty <= 0) { toast.error('Quantity must be > 0'); return; }

    setAddingStock(true);
    let billPath: string | null = null;

    if (addStockFile) {
      const path = `bills/${Date.now()}-${safeFileName(addStockFile.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BILL_BUCKET)
        .upload(path, addStockFile, {
          contentType: addStockFile.type || undefined,
          upsert: false,
        });
      if (upErr) {
        setAddingStock(false);
        toast.error('Bill upload failed: ' + upErr.message);
        return;
      }
      billPath = path;
    }

    const { error } = await supabase.rpc('add_stock_to_store', {
      p_variant_id: parseInt(addStockForm.variant_id),
      p_quantity: qty,
      p_bill_path: billPath,
      p_invoice_number: addStockForm.invoice_number.trim() || null,
      p_notes: addStockForm.notes.trim() || null,
    });
    setAddingStock(false);

    if (error) { toast.error(error.message); return; }
    toast.success('Stock added');
    setAddStockOpen(false);
    resetAddStockForm();
    fetchAll();
    window.dispatchEvent(new CustomEvent('store-stock-updated'));
  };

  const resetReduceForm = () => setReduceForm({ material_id: '', quantity: '', reason: '' });

  const handleReduce = async () => {
    if (!reduceForm.material_id) { toast.error('Select a material'); return; }
    const qty = parseFloat(reduceForm.quantity);
    if (!qty || qty <= 0) { toast.error('Quantity must be > 0'); return; }
    if (!reduceForm.reason.trim()) { toast.error('Reason is required'); return; }

    setReducing(true);
    const { data, error } = await supabase.rpc('reduce_store_stock_lifo', {
      p_material_id: parseInt(reduceForm.material_id),
      p_quantity: qty,
      p_reason: reduceForm.reason.trim(),
    });
    setReducing(false);

    if (error) { toast.error(error.message); return; }
    const result = Array.isArray(data) ? data[0] : data;
    const val = Number(result?.total_value || 0);
    toast.success(`Reduced ${qty} — value Rs. ${val.toFixed(2)} (LIFO)`);
    setReduceOpen(false);
    resetReduceForm();
    fetchAll();
    window.dispatchEvent(new CustomEvent('store-stock-updated'));
  };

  const materialsWithStock = useMemo(() => {
    const byId = new Map<number, number>();
    for (const r of rows) {
      byId.set(r.material_id, (byId.get(r.material_id) || 0) + Number(r.quantity_available || 0));
    }
    return materials
      .map((m) => ({ ...m, available: byId.get(m.material_id) || 0 }))
      .filter((m) => m.available > 0);
  }, [materials, rows]);

  const handleToggle = async (variant_id: number, next_active: boolean) => {
    setTogglingId(variant_id);
    const { error } = await supabase.rpc('toggle_price_variant_status', {
      p_variant_id: variant_id,
      p_is_active: next_active,
    });
    setTogglingId(null);

    if (error) { toast.error(error.message); return; }
    toast.success(next_active ? 'Variant activated' : 'Variant paused');
    fetchAll();
  };

  // ------------------------------------------------------------------ Render

  const selectedAddStockMaterial = addStockForm.material_id ? parseInt(addStockForm.material_id) : null;
  const addStockVariantOptions = selectedAddStockMaterial != null
    ? (activeVariantsByMaterial.get(selectedAddStockMaterial) || [])
    : [];

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="border-b bg-slate-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            Price Variants (FIFO Store Stock)
          </CardTitle>
          <div className="flex gap-2">
            {/* Create Variant */}
            <Dialog
              open={createOpen}
              onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}
            >
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4 mr-2" /> New Variant
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Price Variant</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>Material *</Label>
                    <Select
                      value={createForm.material_id}
                      onValueChange={(v) => setCreateForm({ ...createForm, material_id: v })}
                    >
                      <SelectTrigger className="bg-white"><SelectValue placeholder="Select material" /></SelectTrigger>
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
                    <Label>Variant Name *</Label>
                    <Input
                      value={createForm.variant_name}
                      onChange={(e) => setCreateForm({ ...createForm, variant_name: e.target.value })}
                      placeholder="e.g. price_var_1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Unit Price (Rs.) *</Label>
                    <Input
                      type="number" step="0.01" min="0"
                      value={createForm.unit_price}
                      onChange={(e) => setCreateForm({ ...createForm, unit_price: e.target.value })}
                      placeholder="e.g. 150.00"
                    />
                    <p className="text-xs text-slate-500">
                      Two active variants for the same material cannot share the same price.
                      FIFO order follows variant creation order automatically.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      rows={2}
                      value={createForm.notes}
                      onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={creating} className="bg-blue-600 hover:bg-blue-700">
                    {creating ? 'Creating…' : 'Create Variant'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Damage / Write-off */}
            <Dialog
              open={reduceOpen}
              onOpenChange={(o) => { setReduceOpen(o); if (!o) resetReduceForm(); }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50">
                  <AlertTriangle className="h-4 w-4 mr-2" /> Damage / Write-off
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-md">
                <DialogHeader>
                  <DialogTitle>Reduce Store Stock (LIFO)</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>Material *</Label>
                    <Select
                      value={reduceForm.material_id}
                      onValueChange={(v) => setReduceForm({ ...reduceForm, material_id: v })}
                    >
                      <SelectTrigger className="bg-white"><SelectValue placeholder="Select material" /></SelectTrigger>
                      <SelectContent className="bg-white">
                        {materialsWithStock.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-slate-500">
                            No materials with stock available.
                          </div>
                        ) : materialsWithStock.map((m) => (
                          <SelectItem key={m.material_id} value={m.material_id.toString()}>
                            {m.material_name} — {m.available.toFixed(3)} {m.metric} available
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Quantity to Reduce *</Label>
                    <Input
                      type="number" step="0.001" min="0"
                      value={reduceForm.quantity}
                      onChange={(e) => setReduceForm({ ...reduceForm, quantity: e.target.value })}
                      placeholder="e.g. 5"
                    />
                    <p className="text-xs text-slate-500">
                      LIFO: newest (most-recently-priced) stock is consumed first, so the store retains older-priced inventory.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Reason *</Label>
                    <Textarea
                      rows={2}
                      value={reduceForm.reason}
                      onChange={(e) => setReduceForm({ ...reduceForm, reason: e.target.value })}
                      placeholder="e.g. Damaged in handling, transfer to warehouse B, expired..."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setReduceOpen(false)} disabled={reducing}>Cancel</Button>
                  <Button onClick={handleReduce} disabled={reducing} className="bg-red-600 hover:bg-red-700">
                    {reducing ? 'Reducing…' : 'Reduce Stock'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Add Stock */}
            <Dialog
              open={addStockOpen}
              onOpenChange={(o) => { setAddStockOpen(o); if (!o) resetAddStockForm(); }}
            >
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-2" /> Add Stock
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Stock to Store</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>Material *</Label>
                    <Select
                      value={addStockForm.material_id}
                      onValueChange={(v) => setAddStockForm({ ...addStockForm, material_id: v, variant_id: '' })}
                    >
                      <SelectTrigger className="bg-white"><SelectValue placeholder="Select material" /></SelectTrigger>
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
                    <Label>Price Variant *</Label>
                    <Select
                      value={addStockForm.variant_id}
                      onValueChange={(v) => setAddStockForm({ ...addStockForm, variant_id: v })}
                      disabled={!addStockForm.material_id}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder={addStockForm.material_id ? 'Select variant' : 'Pick a material first'} />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {addStockVariantOptions.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-slate-500">
                            No active variants. Create one first.
                          </div>
                        ) : addStockVariantOptions.map((v) => (
                          <SelectItem key={v.variant_id} value={v.variant_id.toString()}>
                            {v.variant_name} (Rs. {Number(v.unit_price).toFixed(2)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Quantity *</Label>
                    <Input
                      type="number" step="0.001" min="0"
                      value={addStockForm.quantity}
                      onChange={(e) => setAddStockForm({ ...addStockForm, quantity: e.target.value })}
                      placeholder="e.g. 100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Invoice Number</Label>
                    <Input
                      value={addStockForm.invoice_number}
                      onChange={(e) => setAddStockForm({ ...addStockForm, invoice_number: e.target.value })}
                      placeholder="INV-2026-001"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Bill Upload (PDF/JPG/PNG)</Label>
                    <Input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf"
                      onChange={(e) => setAddStockFile(e.target.files?.[0] || null)}
                    />
                    {addStockFile && (
                      <p className="text-xs text-slate-600 flex items-center gap-1">
                        <Upload className="h-3 w-3" /> {addStockFile.name}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      rows={2}
                      value={addStockForm.notes}
                      onChange={(e) => setAddStockForm({ ...addStockForm, notes: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddStockOpen(false)} disabled={addingStock}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddStock} disabled={addingStock} className="bg-blue-600 hover:bg-blue-700">
                    {addingStock ? 'Adding…' : 'Add Stock'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 text-slate-500 text-sm">Loading variants…</div>
        ) : groupedByMaterial.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <Package className="h-10 w-10 mx-auto mb-2 text-slate-300" />
            <p className="font-medium">No price variants yet.</p>
            <p className="text-sm">Create a variant to start tracking stock at exact purchase prices.</p>
          </div>
        ) : (
          <div className="divide-y">
            {groupedByMaterial.map((g) => (
              <div key={g.material_id} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">{g.material_name}</h3>
                    <p className="text-xs text-slate-500">
                      {g.variants.length} variant{g.variants.length === 1 ? '' : 's'}
                      {' • '}
                      Total stock: {g.total_qty.toFixed(3)}
                      {' • '}
                      Stock value: <IndianRupee className="inline h-3 w-3" />
                      {g.total_value.toFixed(2)}
                    </p>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-6"></TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Batches</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.variants.map((v) => {
                      const open = expanded.has(v.variant_id);
                      const variantBatches = batches.filter((b) => b.variant_id === v.variant_id);
                      const unit = v.metric || '';
                      return (
                        <>
                          <TableRow
                            key={`var-${v.variant_id}`}
                            className="cursor-pointer hover:bg-slate-50"
                            onClick={() => {
                              const next = new Set(expanded);
                              if (next.has(v.variant_id)) next.delete(v.variant_id);
                              else next.add(v.variant_id);
                              setExpanded(next);
                            }}
                          >
                            <TableCell>
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </TableCell>
                            <TableCell className="text-sm text-slate-700">
                              {v.material_name}
                              {v.metric && (
                                <span className="text-slate-400 text-xs ml-1">({v.metric})</span>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{v.variant_name}</TableCell>
                            <TableCell className="text-right">
                              Rs. {Number(v.unit_price).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">{v.batch_count}</TableCell>
                            <TableCell className="text-right">{Number(v.quantity_received).toFixed(3)}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {Number(v.quantity_available).toFixed(3)}
                            </TableCell>
                            <TableCell className="text-right">Rs. {Number(v.stock_value).toFixed(2)}</TableCell>
                            <TableCell>
                              {v.is_active ? (
                                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Active</Badge>
                              ) : (
                                <Badge variant="outline" className="text-slate-500">Paused</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={togglingId === v.variant_id}
                                onClick={() => handleToggle(v.variant_id, !v.is_active)}
                              >
                                {v.is_active ? (
                                  <><Pause className="h-3 w-3 mr-1" /> Pause</>
                                ) : (
                                  <><Play className="h-3 w-3 mr-1" /> Resume</>
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                          {open && (
                            <TableRow key={`var-${v.variant_id}-batches`}>
                              <TableCell colSpan={10} className="p-0 bg-slate-50">
                                <div className="p-4">
                                  <div className="text-xs font-semibold text-slate-600 mb-2">
                                    FIFO batches under this variant (oldest → newest)
                                  </div>
                                  {variantBatches.length === 0 ? (
                                    <div className="text-sm text-slate-500 py-2">
                                      No batches yet. Click <strong>+ Add Stock</strong> to create one.
                                    </div>
                                  ) : (
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Batch #</TableHead>
                                          <TableHead>Batch Date</TableHead>
                                          <TableHead className="text-right">Received</TableHead>
                                          <TableHead className="text-right">Available</TableHead>
                                          <TableHead className="text-right">Value</TableHead>
                                          <TableHead>Invoice</TableHead>
                                          <TableHead>Bill</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {variantBatches.map((b) => (
                                          <TableRow key={b.batch_id}>
                                            <TableCell className="font-mono text-xs">#{b.batch_id}</TableCell>
                                            <TableCell>{new Date(b.batch_date).toLocaleDateString()}</TableCell>
                                            <TableCell className="text-right">{Number(b.quantity_received).toFixed(3)} {unit}</TableCell>
                                            <TableCell className="text-right font-semibold">{Number(b.quantity_available).toFixed(3)}</TableCell>
                                            <TableCell className="text-right">Rs. {Number(b.stock_value).toFixed(2)}</TableCell>
                                            <TableCell className="text-xs">{b.invoice_number || '—'}</TableCell>
                                            <TableCell className="text-xs">
                                              {b.bill_path ? <span className="text-blue-600 underline">file</span> : '—'}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
