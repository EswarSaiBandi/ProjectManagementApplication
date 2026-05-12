'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/supabase';
import {
  FileText, Search, ChevronDown, ChevronRight, Package, Receipt,
} from 'lucide-react';
import { toast } from 'sonner';

const BILL_BUCKET = 'material-invoices';

interface InvoiceBatchRow {
  batch_id: number;
  batch_date: string;
  invoice_number: string | null;
  bill_path: string | null;
  notes: string | null;
  quantity_received: number;
  quantity_available: number;
  number_of_units: number | null;
  stock_value: number;
  material_id: number;
  material_name: string;
  metric: string | null;
  variant_id: number;
  variant_name: string;
  unit_price: number;
  base_unit_price: number | null;
  tax_type: string | null;
  tax_rate: number | null;
  quantity_variant_id: number | null;
  quantity_variant_name: string | null;
  quantity_per_unit: number | null;
  vendor_id: number | null;
  vendor_name: string | null;
  vendor_proprietor: string | null;
  vendor_gst: string | null;
  vendor_phone: string | null;
}

interface InvoiceGroup {
  invoice_number: string;
  earliest_date: string;
  latest_date: string;
  line_item_count: number;
  total_received_value: number;
  total_current_value: number;
  total_units: number;
  bill_paths: string[];
  vendor_names: string[];
  rows: InvoiceBatchRow[];
}

function fmtNum(n: number | null | undefined, decimals = 3): string {
  return Number(n ?? 0).toFixed(decimals);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export default function InvoicesTab() {
  const [rows, setRows] = useState<InvoiceBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchInvoiceBatches = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('material_stock_batches_admin')
      .select(
        'batch_id, batch_date, invoice_number, bill_path, notes, ' +
        'quantity_received, quantity_available, number_of_units, stock_value, ' +
        'material_id, material_name, metric, ' +
        'variant_id, variant_name, unit_price, base_unit_price, tax_type, tax_rate, ' +
        'quantity_variant_id, quantity_variant_name, quantity_per_unit, ' +
        'vendor_id, vendor_name, vendor_proprietor, vendor_gst, vendor_phone'
      )
      .not('invoice_number', 'is', null)
      .order('batch_date', { ascending: false })
      .order('batch_id', { ascending: false });

    if (error) {
      toast.error('Failed to load invoices: ' + error.message);
      setRows([]);
    } else {
      setRows((data as unknown as InvoiceBatchRow[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchInvoiceBatches();
  }, [fetchInvoiceBatches]);

  // Refresh when Price Variants tab dispatches a store stock update.
  useEffect(() => {
    const handler = () => { fetchInvoiceBatches(); };
    window.addEventListener('store-stock-updated', handler);
    return () => window.removeEventListener('store-stock-updated', handler);
  }, [fetchInvoiceBatches]);

  const invoiceGroups = useMemo<InvoiceGroup[]>(() => {
    const map = new Map<string, InvoiceGroup>();
    for (const r of rows) {
      const key = (r.invoice_number ?? '').trim();
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          invoice_number: key,
          earliest_date: r.batch_date,
          latest_date: r.batch_date,
          line_item_count: 0,
          total_received_value: 0,
          total_current_value: 0,
          total_units: 0,
          bill_paths: [],
          vendor_names: [],
          rows: [],
        });
      }
      const g = map.get(key)!;
      g.rows.push(r);
      g.line_item_count += 1;
      g.total_received_value += Number(r.quantity_received ?? 0) * Number(r.unit_price ?? 0);
      g.total_current_value += Number(r.stock_value ?? 0);
      g.total_units += Number(r.number_of_units ?? 0);
      if (r.batch_date < g.earliest_date) g.earliest_date = r.batch_date;
      if (r.batch_date > g.latest_date) g.latest_date = r.batch_date;
      if (r.bill_path && !g.bill_paths.includes(r.bill_path)) {
        g.bill_paths.push(r.bill_path);
      }
      if (r.vendor_name && !g.vendor_names.includes(r.vendor_name)) {
        g.vendor_names.push(r.vendor_name);
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => (a.latest_date < b.latest_date ? 1 : a.latest_date > b.latest_date ? -1 : 0)
    );
  }, [rows]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoiceGroups;
    return invoiceGroups.filter((g) => {
      if (g.invoice_number.toLowerCase().includes(q)) return true;
      if (g.vendor_names.some((n) => n.toLowerCase().includes(q))) return true;
      return g.rows.some((r) =>
        r.material_name.toLowerCase().includes(q) ||
        (r.variant_name ?? '').toLowerCase().includes(q) ||
        (r.quantity_variant_name ?? '').toLowerCase().includes(q) ||
        (r.vendor_name ?? '').toLowerCase().includes(q) ||
        (r.vendor_proprietor ?? '').toLowerCase().includes(q) ||
        (r.vendor_gst ?? '').toLowerCase().includes(q) ||
        (r.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [invoiceGroups, search]);

  const toggleExpand = (invoiceNumber: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceNumber)) next.delete(invoiceNumber);
      else next.add(invoiceNumber);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(filteredGroups.map((g) => g.invoice_number)));
  const collapseAll = () => setExpanded(new Set());

  const openBill = async (billPath: string) => {
    const { data, error } = await supabase.storage
      .from(BILL_BUCKET)
      .createSignedUrl(billPath, 60);
    if (error) {
      toast.error(error.message || 'Failed to open bill');
      return;
    }
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const billFileName = (p: string) => p.split('/').pop() || 'bill';

  const totals = useMemo(() => ({
    invoices: filteredGroups.length,
    line_items: filteredGroups.reduce((s, g) => s + g.line_item_count, 0),
    received_value: filteredGroups.reduce((s, g) => s + g.total_received_value, 0),
    current_value: filteredGroups.reduce((s, g) => s + g.total_current_value, 0),
  }), [filteredGroups]);

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="border-b bg-slate-50 space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-blue-600" />
            Invoices
            <span className="text-sm font-normal text-slate-500 ml-1">
              ({totals.invoices} invoice{totals.invoices === 1 ? '' : 's'} · {totals.line_items} line item{totals.line_items === 1 ? '' : 's'})
            </span>
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={expandAll}
              disabled={filteredGroups.length === 0}
            >
              Expand all
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={collapseAll}
              disabled={expanded.size === 0}
            >
              Collapse all
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative w-[340px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice # / vendor / material / variant / GST / notes"
              className="pl-8 bg-white"
            />
          </div>
          {search && (
            <Button variant="outline" size="sm" onClick={() => setSearch('')}>
              Clear
            </Button>
          )}
          <div className="ml-auto text-xs text-slate-600 flex items-center gap-4">
            <span>
              Received value:{' '}
              <strong className="text-slate-900">Rs. {fmtNum(totals.received_value, 2)}</strong>
            </span>
            <span>
              Current value:{' '}
              <strong className="text-slate-900">Rs. {fmtNum(totals.current_value, 2)}</strong>
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading invoices…</div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {invoiceGroups.length === 0
              ? 'No invoices yet. Add stock with an invoice number to see entries here.'
              : `No invoices match "${search}".`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0">
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Date(s)</TableHead>
                  <TableHead className="text-right">Line items</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Received value</TableHead>
                  <TableHead className="text-right">Current value</TableHead>
                  <TableHead>Bill(s)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGroups.map((g) => {
                  const isOpen = expanded.has(g.invoice_number);
                  const sameDate = g.earliest_date === g.latest_date;
                  return (
                    <Fragment key={g.invoice_number}>
                      <TableRow
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => toggleExpand(g.invoice_number)}
                      >
                        <TableCell className="py-2">
                          {isOpen
                            ? <ChevronDown className="h-4 w-4 text-slate-500" />
                            : <ChevronRight className="h-4 w-4 text-slate-500" />}
                        </TableCell>
                        <TableCell className="py-2 font-mono font-medium text-slate-900">
                          {g.invoice_number}
                        </TableCell>
                        <TableCell className="py-2 text-sm text-slate-700">
                          {g.vendor_names.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : g.vendor_names.length === 1 ? (
                            g.vendor_names[0]
                          ) : (
                            <span title={g.vendor_names.join(', ')}>
                              {g.vendor_names[0]}{' '}
                              <span className="text-slate-400">+{g.vendor_names.length - 1}</span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-sm text-slate-600">
                          {sameDate
                            ? fmtDate(g.earliest_date)
                            : `${fmtDate(g.earliest_date)} → ${fmtDate(g.latest_date)}`}
                        </TableCell>
                        <TableCell className="py-2 text-right text-sm">
                          <Badge variant="outline">{g.line_item_count}</Badge>
                        </TableCell>
                        <TableCell className="py-2 text-right text-sm text-slate-700">
                          {g.total_units || '—'}
                        </TableCell>
                        <TableCell className="py-2 text-right text-sm font-semibold text-slate-900">
                          Rs. {fmtNum(g.total_received_value, 2)}
                        </TableCell>
                        <TableCell className="py-2 text-right text-sm text-slate-700">
                          Rs. {fmtNum(g.total_current_value, 2)}
                        </TableCell>
                        <TableCell className="py-2 text-sm" onClick={(e) => e.stopPropagation()}>
                          {g.bill_paths.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {g.bill_paths.map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs"
                                  onClick={() => void openBill(p)}
                                  title={p}
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  {billFileName(p)}
                                </button>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>

                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={9} className="bg-slate-50 p-0">
                            <div className="p-4">
                              <div className="flex items-center gap-2 mb-2 text-xs text-slate-600">
                                <Package className="h-3.5 w-3.5" />
                                Line items under invoice <span className="font-mono font-semibold">{g.invoice_number}</span>
                              </div>
                              <div className="rounded border bg-white overflow-x-auto">
                                <Table>
                                  <TableHeader className="bg-slate-100">
                                    <TableRow>
                                      <TableHead className="text-xs">Material</TableHead>
                                      <TableHead className="text-xs">Packaging</TableHead>
                                      <TableHead className="text-xs">Price variant</TableHead>
                                      <TableHead className="text-xs">Vendor</TableHead>
                                      <TableHead className="text-xs text-right">Units</TableHead>
                                      <TableHead className="text-xs text-right">Qty received</TableHead>
                                      <TableHead className="text-xs text-right">Qty available</TableHead>
                                      <TableHead className="text-xs text-right">Unit price (incl. tax)</TableHead>
                                      <TableHead className="text-xs">Tax</TableHead>
                                      <TableHead className="text-xs text-right">Line value (received)</TableHead>
                                      <TableHead className="text-xs text-right">Current value</TableHead>
                                      <TableHead className="text-xs">Batch date</TableHead>
                                      <TableHead className="text-xs">Bill</TableHead>
                                      <TableHead className="text-xs">Notes</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {g.rows.map((r) => {
                                      const unit = r.metric ?? '';
                                      const lineValueReceived =
                                        Number(r.quantity_received ?? 0) * Number(r.unit_price ?? 0);
                                      const taxLabel =
                                        r.tax_type && r.tax_rate != null
                                          ? `${r.tax_type === 'CGST_SGST' ? 'CGST+SGST' : r.tax_type} @ ${Number(r.tax_rate).toFixed(1)}%`
                                          : '—';
                                      return (
                                        <TableRow key={r.batch_id} className="hover:bg-slate-50">
                                          <TableCell className="text-xs">
                                            <div className="font-medium text-slate-900">{r.material_name}</div>
                                            {unit && <div className="text-slate-400">{unit}</div>}
                                          </TableCell>
                                          <TableCell className="text-xs">
                                            {r.quantity_variant_name ? (
                                              <>
                                                <div className="font-medium">{r.quantity_variant_name}</div>
                                                {r.quantity_per_unit != null && (
                                                  <div className="text-slate-400">
                                                    {r.quantity_per_unit} {unit}/unit
                                                  </div>
                                                )}
                                              </>
                                            ) : '—'}
                                          </TableCell>
                                          <TableCell className="text-xs text-slate-700">
                                            {r.variant_name}
                                          </TableCell>
                                          <TableCell className="text-xs text-slate-700">
                                            {r.vendor_name ? (
                                              <>
                                                <div className="font-medium">{r.vendor_name}</div>
                                                {r.vendor_proprietor && (
                                                  <div className="text-slate-400">{r.vendor_proprietor}</div>
                                                )}
                                                {r.vendor_gst && (
                                                  <div className="text-slate-400 font-mono">GST: {r.vendor_gst}</div>
                                                )}
                                              </>
                                            ) : <span className="text-slate-400">—</span>}
                                          </TableCell>
                                          <TableCell className="text-xs text-right">
                                            {r.number_of_units ?? '—'}
                                          </TableCell>
                                          <TableCell className="text-xs text-right">
                                            {fmtNum(r.quantity_received)} {unit}
                                          </TableCell>
                                          <TableCell className="text-xs text-right font-semibold">
                                            {fmtNum(r.quantity_available)} {unit}
                                          </TableCell>
                                          <TableCell className="text-xs text-right">
                                            Rs. {fmtNum(r.unit_price, 4)}
                                            {r.base_unit_price != null && r.base_unit_price !== r.unit_price && (
                                              <div className="text-slate-400">
                                                base Rs. {fmtNum(r.base_unit_price, 4)}
                                              </div>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-xs text-slate-600">{taxLabel}</TableCell>
                                          <TableCell className="text-xs text-right">
                                            Rs. {fmtNum(lineValueReceived, 2)}
                                          </TableCell>
                                          <TableCell className="text-xs text-right">
                                            Rs. {fmtNum(r.stock_value, 2)}
                                          </TableCell>
                                          <TableCell className="text-xs text-slate-600">
                                            {fmtDate(r.batch_date)}
                                          </TableCell>
                                          <TableCell className="text-xs">
                                            {r.bill_path ? (
                                              <button
                                                type="button"
                                                className="text-blue-600 hover:underline inline-flex items-center gap-1"
                                                onClick={() => void openBill(r.bill_path!)}
                                                title={r.bill_path}
                                              >
                                                <FileText className="h-3.5 w-3.5" />
                                                {billFileName(r.bill_path)}
                                              </button>
                                            ) : '—'}
                                          </TableCell>
                                          <TableCell className="text-xs text-slate-600 max-w-xs">
                                            {r.notes ? (
                                              <span className="whitespace-pre-wrap break-words">{r.notes}</span>
                                            ) : '—'}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
