'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { supabase } from '@/lib/supabase';
import { QUANTITY_STEP, parseQuarterQty } from '@/lib/quantity';
import {
  Plus, Receipt, Search, Trash2, Upload, AlertTriangle, Lock, Layers,
} from 'lucide-react';
import { toast } from 'sonner';

const BILL_BUCKET = 'material-invoices';

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

interface Material {
  material_id: number;
  material_name: string;
  metric: string;
}

interface VendorOption {
  vendor_id: number;
  vendor_name: string;
  proprietor_name: string;
  gst_number: string | null;
}

interface VariantRow {
  material_id: number;
  variant_id: number;
  variant_name: string;
  unit_price: number;
  is_active: boolean;
  quantity_variant_id: number;
  quantity_variant_name: string | null;
  quantity_per_unit: number | null;
  metric: string | null;
}

interface LineItem {
  key: string;
  material_id: string;
  variant_id: string;
  number_of_units: string;
  material_search: string;
}

interface ExistingInvoiceInfo {
  vendor_id: number | null;
  vendor_name: string | null;
  batch_count: number;
}

interface Props {
  materials: Material[];
  vendors: VendorOption[];
  rows: VariantRow[];
  onSuccess: () => void;
}

const makeEmptyLine = (): LineItem => ({
  key: (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random()),
  material_id: '',
  variant_id: '',
  number_of_units: '',
  material_search: '',
});

export default function AddInvoiceDialog({ materials, vendors, rows, onSuccess }: Props) {
  const [open, setOpen] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [vendorId, setVendorId] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [billFile, setBillFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([makeEmptyLine()]);

  const [existingInvoice, setExistingInvoice] = useState<ExistingInvoiceInfo | null>(null);
  const [checkingInvoice, setCheckingInvoice] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Confirmation dialog for appending
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reset = () => {
    setInvoiceNumber('');
    setVendorId('');
    setVendorSearch('');
    setBillFile(null);
    setNotes('');
    setLines([makeEmptyLine()]);
    setExistingInvoice(null);
    setCheckingInvoice(false);
  };

  // ── Existing-invoice lookup (debounced) ──────────────────────────────────
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const trimmed = invoiceNumber.trim();
    if (!trimmed) {
      setExistingInvoice(null);
      setCheckingInvoice(false);
      return;
    }

    setCheckingInvoice(true);
    lookupTimer.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from('material_stock_batches_admin')
        .select('vendor_id, vendor_name, batch_id')
        .eq('invoice_number', trimmed);

      if (error) {
        setCheckingInvoice(false);
        return;
      }

      const list = (data || []) as Array<{
        vendor_id: number | null; vendor_name: string | null; batch_id: number;
      }>;

      if (list.length === 0) {
        setExistingInvoice(null);
      } else {
        // Pick the first non-null vendor we see; warn separately if they differ.
        const first = list.find((b) => b.vendor_id) || list[0];
        setExistingInvoice({
          vendor_id:   first.vendor_id ?? null,
          vendor_name: first.vendor_name ?? null,
          batch_count: list.length,
        });
        if (first.vendor_id && vendorId !== String(first.vendor_id)) {
          setVendorId(String(first.vendor_id));
        }
      }
      setCheckingInvoice(false);
    }, 350);

    return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceNumber]);

  const vendorLocked = !!(existingInvoice && existingInvoice.vendor_id);

  // ── Derived ──────────────────────────────────────────────────────────────
  const activeVariantsByMaterial = useMemo(() => {
    const map = new Map<number, VariantRow[]>();
    for (const r of rows) {
      if (!r.is_active) continue;
      if (!map.has(r.material_id)) map.set(r.material_id, []);
      map.get(r.material_id)!.push(r);
    }
    return map;
  }, [rows]);

  const selectedVendor = vendorId
    ? vendors.find((v) => v.vendor_id === parseInt(vendorId))
    : null;

  // Validate each line to show inline totals
  const lineCalculations = lines.map((ln) => {
    const variant = ln.variant_id
      ? rows.find((r) => r.variant_id === parseInt(ln.variant_id))
      : null;
    const units = parseFloat(ln.number_of_units);
    const qtyPerUnit = variant?.quantity_per_unit ?? null;
    const totalQty = Number.isFinite(units) && units > 0 && qtyPerUnit
      ? units * qtyPerUnit
      : null;
    const lineValue = totalQty && variant
      ? totalQty * Number(variant.unit_price)
      : null;
    return { variant, totalQty, lineValue };
  });

  const invoiceTotal = lineCalculations.reduce(
    (s, c) => s + (c.lineValue ?? 0), 0
  );

  // ── Line ops ─────────────────────────────────────────────────────────────
  const addLine  = () => setLines([...lines, makeEmptyLine()]);
  const removeLine = (key: string) => setLines(lines.length === 1
    ? [makeEmptyLine()]
    : lines.filter((l) => l.key !== key));

  const updateLine = (key: string, patch: Partial<LineItem>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // ── Submit ───────────────────────────────────────────────────────────────
  const validateForSubmit = useCallback((): string | null => {
    const inv = invoiceNumber.trim();
    if (!inv)    return 'Invoice number is required';
    if (!vendorId) return 'Select a vendor';
    if (!billFile) return 'Bill upload is required';

    if (lines.length === 0) return 'Add at least one line item';
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.variant_id) return `Line ${i + 1}: select material & price variant`;
      const parsed = parseQuarterQty(ln.number_of_units, { label: `Line ${i + 1} units` });
      if (!parsed.ok) return parsed.error;
    }

    // Duplicate variant_ids inside the same invoice submission are allowed
    // (two batches of the same variant), but warn if the user likely made a typo.
    return null;
  }, [invoiceNumber, vendorId, billFile, lines]);

  const doSubmit = async () => {
    const err = validateForSubmit();
    if (err) { toast.error(err); return; }

    setSubmitting(true);

    // 1. Upload bill
    let billPath: string | null = null;
    if (billFile) {
      const path = `bills/${Date.now()}-${safeFileName(billFile.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BILL_BUCKET)
        .upload(path, billFile, {
          contentType: billFile.type || undefined,
          upsert: false,
        });
      if (upErr) {
        setSubmitting(false);
        toast.error('Bill upload failed: ' + upErr.message);
        return;
      }
      billPath = path;
    }

    // 2. Build items array. validateForSubmit above already guaranteed every
    //    line parses cleanly, so we can assert .ok here.
    const items = lines.map((ln) => {
      const parsed = parseQuarterQty(ln.number_of_units, { label: 'units' });
      return {
        variant_id:      parseInt(ln.variant_id),
        number_of_units: parsed.ok ? parsed.value : 0,
      };
    });

    // 3. Call RPC
    const { data, error } = await supabase.rpc('add_stock_bulk', {
      p_invoice_number: invoiceNumber.trim(),
      p_vendor_id:      parseInt(vendorId),
      p_bill_path:      billPath,
      p_items:          items,
      p_notes:          notes.trim() || null,
    });

    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const rowCount = Array.isArray(data) ? data.length : 0;
    const total = Array.isArray(data)
      ? data.reduce((s: number, r: any) => s + Number(r?.total_value ?? 0), 0)
      : 0;
    toast.success(
      existingInvoice
        ? `Appended ${rowCount} line item${rowCount === 1 ? '' : 's'} (Rs. ${total.toFixed(2)}) to invoice ${invoiceNumber.trim()}`
        : `Invoice ${invoiceNumber.trim()} added with ${rowCount} line item${rowCount === 1 ? '' : 's'} (Rs. ${total.toFixed(2)})`
    );

    setOpen(false);
    reset();
    onSuccess();
    window.dispatchEvent(new CustomEvent('store-stock-updated'));
  };

  const handleSubmitClick = () => {
    const err = validateForSubmit();
    if (err) { toast.error(err); return; }

    if (existingInvoice && existingInvoice.batch_count > 0) {
      setConfirmOpen(true);
    } else {
      void doSubmit();
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogTrigger asChild>
          <Button variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50">
            <Receipt className="h-4 w-4 mr-2" /> Add Invoice
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-white max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-600" />
              Add Stock by Invoice
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Invoice Number */}
            <div className="space-y-2">
              <Label>Invoice Number *</Label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="INV-2026-001"
              />
              {checkingInvoice && (
                <p className="text-xs text-slate-500">Checking for existing entries…</p>
              )}
              {!checkingInvoice && existingInvoice && existingInvoice.batch_count > 0 && (
                <div className="text-xs bg-amber-50 border border-amber-300 rounded px-3 py-2 text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <div className="font-semibold">Invoice already exists</div>
                    <div>
                      {existingInvoice.batch_count} batch{existingInvoice.batch_count === 1 ? '' : 'es'} already
                      recorded under this invoice
                      {existingInvoice.vendor_name && (
                        <> for <strong>{existingInvoice.vendor_name}</strong></>
                      )}.
                      New line items will be <strong>appended</strong> to it. You'll be asked to confirm on submit.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Vendor */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Vendor *
                {vendorLocked && (
                  <span className="text-xs font-normal text-slate-500 inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" /> locked to invoice
                  </span>
                )}
              </Label>
              <Select
                value={vendorId}
                onValueChange={(v) => setVendorId(v)}
                disabled={vendorLocked}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder={
                    vendors.length === 0
                      ? 'No active vendors — create one in the Vendors tab'
                      : 'Select vendor'
                  } />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <div className="sticky top-0 z-20 bg-white border-b p-2 -mx-1 -mt-1 mb-1 shadow-sm">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                      <Input
                        autoFocus
                        placeholder="Search vendor / proprietor / GST..."
                        value={vendorSearch}
                        onChange={(e) => setVendorSearch(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="h-8 pl-8 bg-white"
                      />
                    </div>
                  </div>
                  {(() => {
                    if (vendors.length === 0) {
                      return (
                        <div className="px-3 py-2 text-sm text-slate-500">
                          No active vendors. Create one in the Vendors tab first.
                        </div>
                      );
                    }
                    const q = vendorSearch.trim().toLowerCase();
                    const list = vendors.filter((v) =>
                      !q ||
                      v.vendor_name.toLowerCase().includes(q) ||
                      v.proprietor_name.toLowerCase().includes(q) ||
                      (v.gst_number ?? '').toLowerCase().includes(q)
                    );
                    if (list.length === 0) {
                      return (
                        <div className="px-2 py-3 text-sm text-slate-500 text-center">
                          No vendors match &ldquo;{vendorSearch}&rdquo;
                        </div>
                      );
                    }
                    return list.map((v) => (
                      <SelectItem key={v.vendor_id} value={v.vendor_id.toString()}>
                        {v.vendor_name}
                        <span className="text-slate-500"> — {v.proprietor_name}</span>
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
              {selectedVendor && (
                <div className="text-xs bg-blue-50 border border-blue-200 rounded px-2 py-1.5 text-blue-800 space-y-0.5">
                  <div><strong>{selectedVendor.vendor_name}</strong> — {selectedVendor.proprietor_name}</div>
                  {selectedVendor.gst_number && (
                    <div className="font-mono text-blue-700">GST: {selectedVendor.gst_number}</div>
                  )}
                </div>
              )}
            </div>

            {/* Bill upload */}
            <div className="space-y-2">
              <Label>Bill Upload (PDF / JPG / PNG) *</Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf"
                onChange={(e) => setBillFile(e.target.files?.[0] || null)}
              />
              {billFile && (
                <p className="text-xs text-slate-600 flex items-center gap-1">
                  <Upload className="h-3 w-3" /> {billFile.name}
                </p>
              )}
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line items *</Label>
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={addLine}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add line
                </Button>
              </div>

              <div className="rounded border bg-white overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_140px_auto] gap-2 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                  <div>Material *</div>
                  <div>Price variant *</div>
                  <div>Units *</div>
                  <div></div>
                </div>
                <div className="divide-y">
                  {lines.map((ln, idx) => {
                    const matId = ln.material_id ? parseInt(ln.material_id) : null;
                    const variantOptions = matId
                      ? (activeVariantsByMaterial.get(matId) ?? [])
                      : [];
                    const calc = lineCalculations[idx];
                    return (
                      <div key={ln.key} className="grid grid-cols-[1fr_1fr_140px_auto] gap-2 px-3 py-2 items-start">
                        {/* Material */}
                        <div className="space-y-1">
                          <Select
                            value={ln.material_id}
                            onValueChange={(v) => updateLine(ln.key, {
                              material_id: v,
                              variant_id: '',
                              number_of_units: '',
                            })}
                          >
                            <SelectTrigger className="bg-white h-9">
                              <SelectValue placeholder="Material" />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              <div className="sticky top-0 z-20 bg-white border-b p-2 -mx-1 -mt-1 mb-1 shadow-sm">
                                <div className="relative">
                                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                                  <Input
                                    autoFocus
                                    placeholder="Search materials..."
                                    value={ln.material_search}
                                    onChange={(e) => updateLine(ln.key, { material_search: e.target.value })}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    className="h-8 pl-8 bg-white"
                                  />
                                </div>
                              </div>
                              {(() => {
                                const q = ln.material_search.trim().toLowerCase();
                                const list = materials.filter((m) =>
                                  !q ||
                                  m.material_name.toLowerCase().includes(q) ||
                                  (m.metric ?? '').toLowerCase().includes(q)
                                );
                                if (list.length === 0) {
                                  return (
                                    <div className="px-2 py-3 text-sm text-slate-500 text-center">
                                      No materials match
                                    </div>
                                  );
                                }
                                return list.map((m) => (
                                  <SelectItem key={m.material_id} value={m.material_id.toString()}>
                                    {m.material_name} ({m.metric})
                                  </SelectItem>
                                ));
                              })()}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Variant */}
                        <div className="space-y-1">
                          <Select
                            value={ln.variant_id}
                            onValueChange={(v) => updateLine(ln.key, { variant_id: v, number_of_units: '' })}
                            disabled={!ln.material_id}
                          >
                            <SelectTrigger className="bg-white h-9">
                              <SelectValue placeholder={
                                ln.material_id ? 'Price variant' : 'Pick material first'
                              } />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              {variantOptions.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-slate-500">
                                  No active price variants.
                                </div>
                              ) : variantOptions.map((v) => (
                                <SelectItem key={v.variant_id} value={v.variant_id.toString()}>
                                  {v.quantity_variant_name
                                    ? `${v.quantity_variant_name} — ${v.variant_name}`
                                    : v.variant_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {calc.variant && calc.variant.quantity_variant_name && (
                            <p className="text-[11px] text-slate-500 flex items-center gap-1">
                              <Layers className="h-3 w-3" />
                              {calc.variant.quantity_per_unit} {calc.variant.metric}/unit · Rs. {Number(calc.variant.unit_price).toFixed(4)}/{calc.variant.metric} (incl. tax)
                            </p>
                          )}
                        </div>

                        {/* Units */}
                        <div className="space-y-1">
                          <Input
                            type="number"
                            step={QUANTITY_STEP}
                            min={QUANTITY_STEP}
                            value={ln.number_of_units}
                            onChange={(e) => updateLine(ln.key, { number_of_units: e.target.value })}
                            placeholder="e.g. 10"
                            className="bg-white h-9"
                            disabled={!ln.variant_id}
                          />
                          {calc.totalQty !== null && calc.variant && (
                            <p className="text-[11px] text-blue-700">
                              = {calc.totalQty.toFixed(3)} {calc.variant.metric}
                              {calc.lineValue !== null && (
                                <> · Rs. {calc.lineValue.toFixed(2)}</>
                              )}
                            </p>
                          )}
                        </div>

                        {/* Remove */}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeLine(ln.key)}
                          className="h-9 w-9 text-red-600 hover:bg-red-50"
                          title={lines.length === 1 ? 'Clear this line' : 'Remove line'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {invoiceTotal > 0 && (
                <div className="flex justify-end text-sm font-semibold text-slate-900 bg-slate-50 rounded px-3 py-2 border">
                  Invoice total: Rs. {invoiceTotal.toFixed(2)}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional — applied to every line item under this invoice"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitClick}
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {submitting
                ? 'Submitting…'
                : existingInvoice
                  ? 'Append to invoice'
                  : 'Create invoice entries'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm append */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Append to existing invoice?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-slate-700 space-y-2">
            <p>
              Invoice <strong className="font-mono">{invoiceNumber.trim()}</strong>
              {' '}already has{' '}
              <strong>{existingInvoice?.batch_count}</strong> batch{existingInvoice?.batch_count === 1 ? '' : 'es'}
              {existingInvoice?.vendor_name && <> under <strong>{existingInvoice.vendor_name}</strong></>}.
            </p>
            <p>
              The {lines.length} new line item{lines.length === 1 ? '' : 's'} will be{' '}
              <strong>added</strong> to that invoice. This does not modify the existing batches.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={async () => { setConfirmOpen(false); await doSubmit(); }}
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : 'Yes, append'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
