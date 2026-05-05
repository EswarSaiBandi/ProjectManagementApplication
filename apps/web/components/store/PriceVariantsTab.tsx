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
import { QUANTITY_STEP, parseQuarterQty } from '@/lib/quantity';
import {
  Plus, Package, Pause, Play, Upload, IndianRupee,
  AlertTriangle, ChevronDown, ChevronRight, Layers,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Material {
  material_id: number;
  material_name: string;
  metric: string;
}

interface QuantityVariant {
  variant_id: number;
  material_id: number;
  variant_name: string;         // e.g. "50 kg Bag"
  quantity_per_unit: number;    // e.g. 50
}

interface VariantRow {
  material_id: number;
  material_name: string;
  metric: string | null;
  variant_id: number;
  variant_name: string;
  unit_price: number;
  is_active: boolean;
  quantity_variant_id: number;
  quantity_variant_name: string | null;
  quantity_per_unit: number | null;
  batch_count: number;
  earliest_batch_date: string | null;
  latest_batch_date: string | null;
  quantity_received: number;
  quantity_available: number;
  total_units: number;
  stock_value: number;
}

interface BatchRow {
  batch_id: number;
  variant_id: number;
  batch_date: string;
  quantity_received: number;
  quantity_available: number;
  quantity_outflow: number;
  number_of_units: number | null;
  quantity_variant_name: string | null;
  quantity_per_unit: number | null;
  stock_value: number;
  invoice_number: string | null;
  bill_path: string | null;
  notes: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BILL_BUCKET = 'material-invoices';

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function fmtNum(n: number | null | undefined, decimals = 3): string {
  return Number(n ?? 0).toFixed(decimals);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PriceVariantsTab() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [qtyVariants, setQtyVariants] = useState<QuantityVariant[]>([]);
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // --- Create price-variant dialog ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    material_id: '',
    quantity_variant_id: '',   // selected qty variant (packaging size)
    variant_name: '',          // custom label for this price tier
    price_per_pkg: '',         // Rs. per packaging unit, PRE-TAX
    tax_type: '' as '' | 'CGST_SGST' | 'IGST',
    tax_rate: '' as '' | '0' | '5' | '12' | '18',
    notes: '',
  });
  // True once the user has manually typed in the Variant Label input —
  // after that we stop overwriting it from auto-suggest.
  const [variantNameEdited, setVariantNameEdited] = useState(false);
  const [creating, setCreating] = useState(false);

  // --- Add stock dialog ---
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [addStockForm, setAddStockForm] = useState({
    material_id: '',
    variant_id: '',            // price variant id
    number_of_units: '',       // number of bags / cans / etc.
    invoice_number: '',
    notes: '',
  });
  const [addStockFile, setAddStockFile] = useState<File | null>(null);
  const [addingStock, setAddingStock] = useState(false);

  // --- Toggle / Reduce ---
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [reduceOpen, setReduceOpen] = useState(false);
  const [reduceForm, setReduceForm] = useState({
    material_id: '',
    quantity_variant_id: '',
    units: '',
    reason: '',
  });
  const [reducing, setReducing] = useState(false);

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [matRes, qvRes, rowRes, batchRes] = await Promise.all([
      supabase
        .from('materials_master')
        .select('material_id, material_name, metric')
        .eq('is_active', true)
        .order('material_name'),

      supabase
        .from('material_variants')
        .select('variant_id, material_id, variant_name, quantity_per_unit')
        .eq('is_active', true)
        .order('material_id')
        .order('quantity_per_unit', { ascending: false }),

      supabase
        .from('material_stock_variants_admin')
        .select('*')
        .order('material_name')
        .order('earliest_batch_date', { ascending: true, nullsFirst: false }),

      supabase
        .from('material_stock_batches_admin')
        .select(
          'batch_id, variant_id, batch_date, quantity_received, quantity_available, ' +
          'quantity_outflow, number_of_units, quantity_variant_name, quantity_per_unit, ' +
          'stock_value, invoice_number, bill_path, notes'
        )
        .order('batch_date', { ascending: true })
        .order('batch_id', { ascending: true }),
    ]);

    if (matRes.error)   toast.error('Failed to load materials: '      + matRes.error.message);
    else setMaterials(matRes.data || []);

    if (qvRes.error)    toast.error('Failed to load qty variants: '   + qvRes.error.message);
    else setQtyVariants((qvRes.data as QuantityVariant[]) || []);

    if (rowRes.error)   toast.error('Failed to load price variants: ' + rowRes.error.message);
    else setRows((rowRes.data as VariantRow[]) || []);

    if (batchRes.error) toast.error('Failed to load batches: '        + batchRes.error.message);
    else setBatches((batchRes.data as unknown as BatchRow[]) || []);

    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ─── Derived data ──────────────────────────────────────────────────────────

  const groupedByMaterial = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (r: VariantRow) =>
      !q ||
      r.material_name.toLowerCase().includes(q) ||
      r.variant_name.toLowerCase().includes(q) ||
      (r.quantity_variant_name ?? '').toLowerCase().includes(q);

    const filteredRows = q ? rows.filter(matches) : rows;

    const map = new Map<number, { material_name: string; metric: string | null; variants: VariantRow[] }>();
    for (const r of filteredRows) {
      if (!map.has(r.material_id)) {
        map.set(r.material_id, { material_name: r.material_name, metric: r.metric, variants: [] });
      }
      map.get(r.material_id)!.variants.push(r);
    }
    return Array.from(map.entries()).map(([material_id, v]) => ({
      material_id,
      material_name: v.material_name,
      metric: v.metric,
      variants: v.variants,
      total_qty:   v.variants.reduce((s, x) => s + Number(x.quantity_available ?? 0), 0),
      total_value: v.variants.reduce((s, x) => s + Number(x.stock_value ?? 0), 0),
    }));
  }, [rows, search]);

  const activeVariantsByMaterial = useMemo(() => {
    const map = new Map<number, VariantRow[]>();
    for (const r of rows) {
      if (!r.is_active) continue;
      if (!map.has(r.material_id)) map.set(r.material_id, []);
      map.get(r.material_id)!.push(r);
    }
    return map;
  }, [rows]);

  const qtyVariantsByMaterial = useMemo(() => {
    const map = new Map<number, QuantityVariant[]>();
    for (const qv of qtyVariants) {
      if (!map.has(qv.material_id)) map.set(qv.material_id, []);
      map.get(qv.material_id)!.push(qv);
    }
    return map;
  }, [qtyVariants]);

  const materialsWithStock = useMemo(() => {
    const byId = new Map<number, number>();
    for (const r of rows) {
      byId.set(r.material_id, (byId.get(r.material_id) || 0) + Number(r.quantity_available ?? 0));
    }
    return materials
      .map((m) => ({ ...m, available: byId.get(m.material_id) || 0 }))
      .filter((m) => m.available > 0);
  }, [materials, rows]);

  // ─── Create price variant ──────────────────────────────────────────────────

  const resetCreateForm = () => {
    setCreateForm({
      material_id: '', quantity_variant_id: '', variant_name: '', price_per_pkg: '',
      tax_type: '', tax_rate: '', notes: '',
    });
    setVariantNameEdited(false);
  };

  const selectedCreateMaterial = createForm.material_id
    ? materials.find((m) => m.material_id === parseInt(createForm.material_id))
    : null;

  const createQtyVariantOptions = createForm.material_id
    ? (qtyVariantsByMaterial.get(parseInt(createForm.material_id)) || [])
    : [];

  const selectedCreateQtyVariant = createForm.quantity_variant_id
    ? createQtyVariantOptions.find((qv) => qv.variant_id === parseInt(createForm.quantity_variant_id))
    : null;

  const handleCreate = async () => {
    if (!createForm.material_id)          { toast.error('Select a material');                       return; }
    if (!createForm.quantity_variant_id)  { toast.error('Select a packaging / quantity variant');   return; }
    if (!createForm.variant_name.trim())  { toast.error('Variant name is required');                return; }

    const pricePerPkg = parseFloat(createForm.price_per_pkg);
    if (!pricePerPkg || pricePerPkg <= 0) { toast.error('Price per packaging unit must be > 0');    return; }
    if (!selectedCreateQtyVariant)        { toast.error('Select a packaging variant to set price'); return; }

    if (!createForm.tax_type)             { toast.error('Select tax type (CGST+SGST or IGST)');     return; }
    if (!createForm.tax_rate)             { toast.error('Select tax rate');                          return; }

    // Pre-tax per-base-metric rate. RPC will compute tax-inclusive unit_price.
    const baseUnitPrice = pricePerPkg / selectedCreateQtyVariant.quantity_per_unit;

    setCreating(true);
    const { error } = await supabase.rpc('create_price_variant', {
      p_material_id:         parseInt(createForm.material_id),
      p_variant_name:        createForm.variant_name.trim(),
      p_base_unit_price:     baseUnitPrice,
      p_quantity_variant_id: parseInt(createForm.quantity_variant_id),
      p_tax_type:            createForm.tax_type,
      p_tax_rate:            parseFloat(createForm.tax_rate),
      p_notes:               createForm.notes.trim() || null,
    });
    setCreating(false);

    if (error) { toast.error(error.message); return; }
    toast.success('Price variant created');
    setCreateOpen(false);
    resetCreateForm();
    fetchAll();
  };

  // Auto-suggest variant name: "50 kg Bag @ Rs.300/bag"
  const autoSuggestVariantName = (
    qvName: string | undefined,
    pricePerPkg: string,
  ) => {
    if (!qvName) return '';
    const priceStr = pricePerPkg ? ` @ Rs.${parseFloat(pricePerPkg).toFixed(2)}/bag` : '';
    return `${qvName}${priceStr}`;
  };

  // ─── Add stock ─────────────────────────────────────────────────────────────

  const resetAddStockForm = () => {
    setAddStockForm({ material_id: '', variant_id: '', number_of_units: '', invoice_number: '', notes: '' });
    setAddStockFile(null);
  };

  const selectedAddStockVariant = addStockForm.variant_id
    ? rows.find((r) => r.variant_id === parseInt(addStockForm.variant_id))
    : null;

  const addStockVariantOptions = addStockForm.material_id
    ? (activeVariantsByMaterial.get(parseInt(addStockForm.material_id)) || [])
    : [];

  const computedTotalQty = useMemo(() => {
    const units = parseFloat(addStockForm.number_of_units);
    if (!units || units <= 0 || !selectedAddStockVariant) return null;
    const qtyPerUnit = selectedAddStockVariant.quantity_per_unit ?? 1;
    return units * qtyPerUnit;
  }, [addStockForm.number_of_units, selectedAddStockVariant]);

  const handleAddStock = async () => {
    if (!addStockForm.variant_id) { toast.error('Select a price variant'); return; }
    const unitsParsed = parseQuarterQty(addStockForm.number_of_units, { label: 'Number of units' });
    if (!unitsParsed.ok) { toast.error(unitsParsed.error); return; }
    const units = unitsParsed.value;

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
      p_variant_id:      parseInt(addStockForm.variant_id),
      p_number_of_units: units,
      p_bill_path:       billPath,
      p_invoice_number:  addStockForm.invoice_number.trim() || null,
      p_notes:           addStockForm.notes.trim() || null,
    });
    setAddingStock(false);

    if (error) { toast.error(error.message); return; }
    toast.success('Stock added successfully');
    setAddStockOpen(false);
    resetAddStockForm();
    fetchAll();
    window.dispatchEvent(new CustomEvent('store-stock-updated'));
  };

  // ─── Damage / Write-off (LIFO) ─────────────────────────────────────────────

  const resetReduceForm = () =>
    setReduceForm({ material_id: '', quantity_variant_id: '', units: '', reason: '' });

  const handleReduce = async () => {
    if (!reduceForm.material_id)         { toast.error('Select a material');   return; }
    if (!reduceForm.quantity_variant_id) { toast.error('Select a packaging'); return; }
    if (!reduceForm.reason.trim())       { toast.error('Reason is required'); return; }

    const qvId = parseInt(reduceForm.quantity_variant_id);
    const unitsParsed = parseQuarterQty(reduceForm.units, { label: 'Units' });
    if (!unitsParsed.ok) { toast.error(unitsParsed.error); return; }
    const units = unitsParsed.value;
    const qpu = rows.find(r => r.quantity_variant_id === qvId && r.material_id === parseInt(reduceForm.material_id))?.quantity_per_unit ?? 1;
    const qty = units * qpu;

    setReducing(true);
    const { data, error } = await supabase.rpc('reduce_store_stock_lifo', {
      p_material_id:    parseInt(reduceForm.material_id),
      p_quantity:       qty,
      p_reason:         reduceForm.reason.trim(),
      p_qty_variant_id: qvId,
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

  // ─── Toggle active ─────────────────────────────────────────────────────────

  const handleToggle = async (variant_id: number, next_active: boolean) => {
    setTogglingId(variant_id);
    const { error } = await supabase.rpc('toggle_price_variant_status', {
      p_variant_id: variant_id,
      p_is_active:  next_active,
    });
    setTogglingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(next_active ? 'Variant activated' : 'Variant paused');
    fetchAll();
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="border-b bg-slate-50">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            Price Variants &amp; Stock (FIFO)
          </CardTitle>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search material / label / packaging"
              className="w-[260px] bg-white"
            />

            {/* ── Create Price Variant ── */}
            <Dialog
              open={createOpen}
              onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}
            >
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus className="h-4 w-4 mr-2" /> New Price Variant
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Price Variant</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">

                  {/* Material */}
                  <div className="space-y-2">
                    <Label>Material *</Label>
                    <Select
                      value={createForm.material_id}
                      onValueChange={(v) => setCreateForm({
                        ...createForm,
                        material_id: v,
                        quantity_variant_id: '',
                        variant_name: '',
                      })}
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

                  {/* Quantity Variant (packaging size) */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5 text-green-600" />
                      Packaging / Quantity Variant *
                    </Label>
                    <Select
                      value={createForm.quantity_variant_id}
                      onValueChange={(v) => {
                        const qv = createQtyVariantOptions.find(
                          (qv) => qv.variant_id === parseInt(v)
                        );
                        setCreateForm({
                          ...createForm,
                          quantity_variant_id: v,
                          variant_name: variantNameEdited
                            ? createForm.variant_name
                            : autoSuggestVariantName(qv?.variant_name, createForm.price_per_pkg),
                        });
                      }}
                      disabled={!createForm.material_id}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder={
                          createForm.material_id
                            ? (createQtyVariantOptions.length ? 'Select packaging size' : 'No quantity variants — add them in Materials page')
                            : 'Pick a material first'
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {createQtyVariantOptions.map((qv) => (
                          <SelectItem key={qv.variant_id} value={qv.variant_id.toString()}>
                            {qv.variant_name} — {qv.quantity_per_unit} {selectedCreateMaterial?.metric}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedCreateQtyVariant && (
                      <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                        Each <strong>{selectedCreateQtyVariant.variant_name}</strong> contains{' '}
                        <strong>{selectedCreateQtyVariant.quantity_per_unit} {selectedCreateMaterial?.metric}</strong>.
                        When adding stock you enter the number of bags/units — total quantity is auto-computed.
                      </p>
                    )}
                  </div>

                  {/* Price per packaging unit */}
                  <div className="space-y-2">
                    <Label>
                      Price per {selectedCreateQtyVariant?.variant_name ?? 'packaging unit'} (Rs.) *
                    </Label>
                    <Input
                      type="number" step="0.01" min="0"
                      value={createForm.price_per_pkg}
                      onChange={(e) => {
                        setCreateForm({
                          ...createForm,
                          price_per_pkg: e.target.value,
                          variant_name: variantNameEdited
                            ? createForm.variant_name
                            : autoSuggestVariantName(selectedCreateQtyVariant?.variant_name, e.target.value),
                        });
                      }}
                      placeholder={selectedCreateQtyVariant ? `e.g. ${selectedCreateQtyVariant.quantity_per_unit * 6}` : 'Select packaging first'}
                      disabled={!selectedCreateQtyVariant}
                    />
                    {selectedCreateQtyVariant && createForm.price_per_pkg && (
                      <div className="text-xs space-y-0.5">
                        <p className="text-blue-700 font-medium">
                          = Rs.&nbsp;
                          {(parseFloat(createForm.price_per_pkg) / selectedCreateQtyVariant.quantity_per_unit).toFixed(4)}
                          &nbsp;per {selectedCreateMaterial?.metric ?? 'unit'} (pre-tax base rate)
                        </p>
                        <p className="text-slate-400">
                          Tax is added on top — FIFO cost uses the tax-inclusive rate.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Tax Type */}
                  <div className="space-y-2">
                    <Label>Tax Type *</Label>
                    <Select
                      value={createForm.tax_type}
                      onValueChange={(v) => setCreateForm({
                        ...createForm,
                        tax_type: v as 'CGST_SGST' | 'IGST',
                      })}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select tax type" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value="CGST_SGST">CGST + SGST (intra-state)</SelectItem>
                        <SelectItem value="IGST">IGST (inter-state)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Tax Rate */}
                  <div className="space-y-2">
                    <Label>Tax Rate (%) *</Label>
                    <Select
                      value={createForm.tax_rate}
                      onValueChange={(v) => setCreateForm({
                        ...createForm,
                        tax_rate: v as '0' | '5' | '12' | '18',
                      })}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select rate" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value="0">0%</SelectItem>
                        <SelectItem value="5">5%</SelectItem>
                        <SelectItem value="12">12%</SelectItem>
                        <SelectItem value="18">18%</SelectItem>
                      </SelectContent>
                    </Select>
                    {(() => {
                      const pkg = parseFloat(createForm.price_per_pkg);
                      const rate = parseFloat(createForm.tax_rate);
                      if (!pkg || pkg <= 0 || !createForm.tax_type || isNaN(rate)) return null;
                      const taxAmt = pkg * rate / 100;
                      const total = pkg + taxAmt;
                      const pkgLabel = selectedCreateQtyVariant?.variant_name ?? 'pkg';
                      return (
                        <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 space-y-0.5">
                          <div className="flex justify-between">
                            <span>Base (pre-tax)</span>
                            <span className="font-medium">Rs. {pkg.toFixed(2)}/{pkgLabel}</span>
                          </div>
                          {createForm.tax_type === 'CGST_SGST' ? (
                            <>
                              <div className="flex justify-between text-amber-800">
                                <span>CGST @ {(rate / 2).toFixed(1)}%</span>
                                <span>Rs. {(taxAmt / 2).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-amber-800">
                                <span>SGST @ {(rate / 2).toFixed(1)}%</span>
                                <span>Rs. {(taxAmt / 2).toFixed(2)}</span>
                              </div>
                            </>
                          ) : (
                            <div className="flex justify-between text-amber-800">
                              <span>IGST @ {rate.toFixed(1)}%</span>
                              <span>Rs. {taxAmt.toFixed(2)}</span>
                            </div>
                          )}
                          <div className="flex justify-between border-t border-amber-200 pt-0.5 font-semibold text-amber-900">
                            <span>Total (tax incl.)</span>
                            <span>Rs. {total.toFixed(2)}/{pkgLabel}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Variant Name */}
                  <div className="space-y-2">
                    <Label>Price Variant Label *</Label>
                    <Input
                      value={createForm.variant_name}
                      onChange={(e) => {
                        setCreateForm({ ...createForm, variant_name: e.target.value });
                        setVariantNameEdited(true);
                      }}
                      placeholder="e.g. 50 kg Bag @ Rs.6/kg"
                    />
                    <p className="text-xs text-slate-400">
                      Auto-suggested from packaging + price; once you edit it, your label is kept as-is.
                    </p>
                  </div>

                  {/* Notes */}
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

            {/* ── Damage / Write-off ── */}
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
                      onValueChange={(v) => setReduceForm({
                        ...reduceForm,
                        material_id: v,
                        quantity_variant_id: '',
                        units: '',
                      })}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select material" />
                      </SelectTrigger>
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

                  {/* Packaging variant (MV) picker + units/qty input — derived from selected material. */}
                  {(() => {
                    if (!reduceForm.material_id) return null;
                    const matId = parseInt(reduceForm.material_id);
                    const metric = rows.find(r => r.material_id === matId)?.metric || '';

                    // Aggregate per-packaging availability across price variants of this material.
                    type PkgAgg = {
                      qty_variant_id: number;
                      qty_variant_name: string;
                      quantity_per_unit: number | null;
                      available: number;
                    };
                    const pkgMap = new Map<number, PkgAgg>();
                    rows.filter(r => r.material_id === matId).forEach(r => {
                      const key = r.quantity_variant_id;
                      if (!pkgMap.has(key)) {
                        pkgMap.set(key, {
                          qty_variant_id:    key,
                          qty_variant_name:  r.quantity_variant_name ?? r.variant_name,
                          quantity_per_unit: r.quantity_per_unit,
                          available:         0,
                        });
                      }
                      pkgMap.get(key)!.available += Number(r.quantity_available ?? 0);
                    });
                    const pkgList = Array.from(pkgMap.values()).filter(p => p.available > 0);

                    const qvIdStr = reduceForm.quantity_variant_id;
                    const selectedPkg = qvIdStr ? pkgMap.get(parseInt(qvIdStr)) ?? null : null;
                    const qpu = selectedPkg?.quantity_per_unit ?? null;
                    const unitsN = parseFloat(reduceForm.units);
                    const derivedQty = selectedPkg && qpu && Number.isFinite(unitsN) && unitsN > 0
                      ? unitsN * qpu
                      : null;

                    return (
                      <>
                        <div className="space-y-2">
                          <Label>Packaging Variant *</Label>
                          <Select
                            value={reduceForm.quantity_variant_id}
                            onValueChange={(v) => setReduceForm({
                              ...reduceForm,
                              quantity_variant_id: v,
                              units: '',
                            })}
                          >
                            <SelectTrigger className="bg-white">
                              <SelectValue placeholder="Select packaging" />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              {pkgList.map((pv) => (
                                <SelectItem key={pv.qty_variant_id} value={pv.qty_variant_id.toString()}>
                                  {pv.qty_variant_name} — {pv.available.toFixed(3)} {metric} available
                                  {pv.quantity_per_unit ? ` (${(pv.available / pv.quantity_per_unit).toFixed(2)} units)` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {selectedPkg && qpu ? (
                          <div className="space-y-2">
                            <Label>Number of {selectedPkg.qty_variant_name}s * <span className="text-xs text-slate-400">(multiples of {QUANTITY_STEP})</span></Label>
                            <Input
                              type="number" step={QUANTITY_STEP} min={QUANTITY_STEP}
                              value={reduceForm.units}
                              onChange={(e) => setReduceForm({ ...reduceForm, units: e.target.value })}
                              placeholder={`e.g. ${Math.floor(selectedPkg.available / qpu)}`}
                            />
                            {derivedQty !== null && (
                              <div className="text-xs bg-red-50 border border-red-100 rounded px-3 py-1.5 text-red-700 font-medium">
                                = {derivedQty.toFixed(3)} {metric}
                                <span className="text-red-400 font-normal ml-1">
                                  ({reduceForm.units} × {qpu} {metric})
                                </span>
                              </div>
                            )}
                            <p className="text-xs text-slate-500">
                              LIFO within this packaging: newest batches of {selectedPkg.qty_variant_name} consumed first.
                            </p>
                          </div>
                        ) : null}
                      </>
                    );
                  })()}

                  <div className="space-y-2">
                    <Label>Reason *</Label>
                    <Textarea
                      rows={2}
                      value={reduceForm.reason}
                      onChange={(e) => setReduceForm({ ...reduceForm, reason: e.target.value })}
                      placeholder="e.g. Damaged, expired, transfer-out…"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setReduceOpen(false)} disabled={reducing}>
                    Cancel
                  </Button>
                  <Button onClick={handleReduce} disabled={reducing} className="bg-red-600 hover:bg-red-700">
                    {reducing ? 'Reducing…' : 'Reduce Stock'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* ── Add Stock ── */}
            <Dialog
              open={addStockOpen}
              onOpenChange={(o) => { setAddStockOpen(o); if (!o) resetAddStockForm(); }}
            >
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-2" /> Add Stock
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Stock to Store</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">

                  {/* Material */}
                  <div className="space-y-2">
                    <Label>Material *</Label>
                    <Select
                      value={addStockForm.material_id}
                      onValueChange={(v) => setAddStockForm({
                        ...addStockForm, material_id: v, variant_id: '', number_of_units: '',
                      })}
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

                  {/* Price Variant */}
                  <div className="space-y-2">
                    <Label>Price Variant *</Label>
                    <Select
                      value={addStockForm.variant_id}
                      onValueChange={(v) => setAddStockForm({
                        ...addStockForm, variant_id: v, number_of_units: '',
                      })}
                      disabled={!addStockForm.material_id}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder={
                          addStockForm.material_id ? 'Select price variant' : 'Pick a material first'
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {addStockVariantOptions.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-slate-500">
                            No active price variants. Create one first.
                          </div>
                        ) : addStockVariantOptions.map((v) => (
                          <SelectItem key={v.variant_id} value={v.variant_id.toString()}>
                            {v.quantity_variant_name
                              ? `${v.quantity_variant_name} — ${v.variant_name}`
                              : v.variant_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Show linked qty variant info */}
                    {selectedAddStockVariant?.quantity_variant_name && (
                      <div className="bg-green-50 border border-green-200 rounded p-3 space-y-1">
                        <div className="flex items-center gap-2 text-xs font-semibold text-green-800">
                          <Layers className="h-3.5 w-3.5" />
                          Packaging: {selectedAddStockVariant.quantity_variant_name}
                        </div>
                        <p className="text-xs text-green-700">
                          Each <strong>{selectedAddStockVariant.quantity_variant_name}</strong>
                          {' = '}
                          <strong>{selectedAddStockVariant.quantity_per_unit} {selectedAddStockVariant.metric}</strong>
                          {' at '}
                          <strong>
                            Rs. {(Number(selectedAddStockVariant.unit_price) * Number(selectedAddStockVariant.quantity_per_unit)).toFixed(2)}
                            /{selectedAddStockVariant.quantity_variant_name}
                          </strong>
                          <span className="text-green-600 ml-1">
                            (= Rs. {Number(selectedAddStockVariant.unit_price).toFixed(4)}/{selectedAddStockVariant.metric})
                          </span>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Number of units / bags */}
                  <div className="space-y-2">
                    <Label>
                      {selectedAddStockVariant?.quantity_variant_name
                        ? `Number of ${selectedAddStockVariant.quantity_variant_name}s *`
                        : 'Quantity *'
                      }
                      <span className="text-xs text-slate-400 ml-1">(multiples of {QUANTITY_STEP})</span>
                    </Label>
                    <Input
                      type="number" step={QUANTITY_STEP} min={QUANTITY_STEP}
                      value={addStockForm.number_of_units}
                      onChange={(e) => setAddStockForm({ ...addStockForm, number_of_units: e.target.value })}
                      placeholder={
                        selectedAddStockVariant?.quantity_variant_name
                          ? `e.g. 100 (bags/units)`
                          : `e.g. 500 (${selectedAddStockVariant?.metric ?? 'units'})`
                      }
                    />
                    {/* Auto-computed total quantity */}
                    {computedTotalQty !== null && selectedAddStockVariant?.quantity_per_unit && (
                      <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs text-blue-800">
                        <span className="font-semibold">
                          {addStockForm.number_of_units} {selectedAddStockVariant.quantity_variant_name ?? 'units'}
                        </span>
                        {' × '}
                        <span className="font-semibold">
                          {selectedAddStockVariant.quantity_per_unit} {selectedAddStockVariant.metric}
                        </span>
                        {' = '}
                        <span className="font-bold text-blue-900">
                          {computedTotalQty.toFixed(3)} {selectedAddStockVariant.metric} total
                        </span>
                        {' — value ≈ Rs. '}
                        <span className="font-bold">
                          {(computedTotalQty * Number(selectedAddStockVariant.unit_price)).toFixed(2)}
                        </span>
                      </div>
                    )}
                    {computedTotalQty !== null && !selectedAddStockVariant?.quantity_per_unit && (
                      <p className="text-xs text-slate-500">
                        {addStockForm.number_of_units} {selectedAddStockVariant?.metric} will be added to store.
                      </p>
                    )}
                  </div>

                  {/* Invoice */}
                  <div className="space-y-2">
                    <Label>Invoice Number</Label>
                    <Input
                      value={addStockForm.invoice_number}
                      onChange={(e) => setAddStockForm({ ...addStockForm, invoice_number: e.target.value })}
                      placeholder="INV-2026-001"
                    />
                  </div>

                  {/* Bill upload */}
                  <div className="space-y-2">
                    <Label>Bill Upload (PDF / JPG / PNG)</Label>
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

                  {/* Notes */}
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

      {/* ── Table ── */}
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 text-slate-500 text-sm">Loading variants…</div>
        ) : groupedByMaterial.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <Package className="h-10 w-10 mx-auto mb-2 text-slate-300" />
            <p className="font-medium">No price variants yet.</p>
            <p className="text-sm mt-1">
              Create a price variant to start tracking stock.
              Make sure you&apos;ve added quantity variants (packaging sizes) in the
              <strong> Materials</strong> page first.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {groupedByMaterial.map((g) => (
              <div key={g.material_id} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">{g.material_name}</h3>
                    <p className="text-xs text-slate-500">
                      {g.variants.length} price variant{g.variants.length === 1 ? '' : 's'}
                      {' • '}
                      Total stock: {fmtNum(g.total_qty)} {g.metric}
                      {' • '}
                      Value: <IndianRupee className="inline h-3 w-3" />
                      {fmtNum(g.total_value, 2)}
                    </p>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-6" />
                      <TableHead>Packaging Variant</TableHead>
                      <TableHead>Price Variant Label</TableHead>
                      <TableHead className="text-right">Unit Price <span className="text-[10px] font-normal text-slate-400">(incl. GST)</span></TableHead>
                      <TableHead className="text-right">Batches</TableHead>
                      <TableHead className="text-right">Units Rcvd</TableHead>
                      <TableHead className="text-right">Qty Available</TableHead>
                      <TableHead className="text-right">Value <span className="text-[10px] font-normal text-slate-400">(incl. GST)</span></TableHead>
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
                              {open
                                ? <ChevronDown className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4" />}
                            </TableCell>

                            {/* Packaging variant */}
                            <TableCell>
                              {v.quantity_variant_name ? (
                                <div className="flex items-center gap-1.5">
                                  <Layers className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                  <div>
                                    <div className="text-sm font-medium text-slate-800">
                                      {v.quantity_variant_name}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {v.quantity_per_unit} {unit} each
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400 italic">— no packaging —</span>
                              )}
                            </TableCell>

                            {/* Price variant label */}
                            <TableCell className="font-medium text-slate-700 text-sm">
                              {v.variant_name}
                            </TableCell>

                            {/* Price — shown as price per packaging unit (primary) */}
                            <TableCell className="text-right text-sm">
                              {v.quantity_per_unit ? (
                                <>
                                  <div className="font-medium">
                                    Rs. {(Number(v.unit_price) * v.quantity_per_unit).toFixed(2)}/
                                    {v.quantity_variant_name ?? 'unit'}
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    = Rs. {Number(v.unit_price).toFixed(4)}/{unit}
                                  </div>
                                </>
                              ) : (
                                <div>Rs. {Number(v.unit_price).toFixed(2)}/{unit}</div>
                              )}
                            </TableCell>

                            <TableCell className="text-right">{v.batch_count}</TableCell>

                            {/* Units received */}
                            <TableCell className="text-right text-sm">
                              {v.quantity_variant_name
                                ? `${fmtNum(v.total_units, 0)} units`
                                : '—'}
                            </TableCell>

                            {/* Qty available */}
                            <TableCell className="text-right font-semibold text-sm">
                              {fmtNum(v.quantity_available)} {unit}
                            </TableCell>

                            <TableCell className="text-right text-sm">
                              Rs. {fmtNum(v.stock_value, 2)}
                            </TableCell>

                            <TableCell>
                              {v.is_active ? (
                                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                                  Active
                                </Badge>
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
                                {v.is_active
                                  ? <><Pause className="h-3 w-3 mr-1" /> Pause</>
                                  : <><Play  className="h-3 w-3 mr-1" /> Resume</>}
                              </Button>
                            </TableCell>
                          </TableRow>

                          {/* Batch rows */}
                          {open && (
                            <TableRow key={`var-${v.variant_id}-batches`}>
                              <TableCell colSpan={10} className="p-0 bg-slate-50">
                                <div className="p-4">
                                  <div className="text-xs font-semibold text-slate-600 mb-2">
                                    FIFO batches — oldest → newest (MR allocates oldest first; returns credit back via LIFO)
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
                                          <TableHead>Date</TableHead>
                                          <TableHead className="text-right">Units</TableHead>
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
                                            <TableCell className="font-mono text-xs">
                                              #{b.batch_id}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                              {new Date(b.batch_date).toLocaleDateString()}
                                            </TableCell>
                                            <TableCell className="text-right text-xs">
                                              {b.number_of_units != null
                                                ? `${fmtNum(b.number_of_units, 0)} ${b.quantity_variant_name ?? 'units'}`
                                                : '—'}
                                            </TableCell>
                                            <TableCell className="text-right text-xs">
                                              {fmtNum(b.quantity_received)} {unit}
                                            </TableCell>
                                            <TableCell className="text-right text-xs font-semibold">
                                              {fmtNum(b.quantity_available)} {unit}
                                            </TableCell>
                                            <TableCell className="text-right text-xs">
                                              Rs. {fmtNum(b.stock_value, 2)}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                              {b.invoice_number || '—'}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                              {b.bill_path
                                                ? <span className="text-blue-600 underline">file</span>
                                                : '—'}
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
