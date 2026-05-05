'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { Plus, Package, ClipboardList, TrendingUp, Bell, Check, X, Layers } from 'lucide-react';
import { toast } from 'sonner';
import PriceVariantsTab from '@/components/store/PriceVariantsTab';
import StoreInventoryAggregateTab from '@/components/store/StoreInventoryAggregateTab';
import { QUANTITY_STEP, isQuarterMultiple, parseQuarterQty } from '@/lib/quantity';

interface Material {
  material_id: number;
  material_name: string;
  metric: string;
}

interface Variant {
  variant_id: number;
  material_id: number;
  variant_name: string;
  quantity_per_unit: number;
}

interface MaterialRequest {
  request_id: number;
  request_number: string;
  project_id: number;
  material_id: number;
  requested_quantity: number;
  request_source: string;
  priority: string;
  required_by: string | null;
  purpose: string | null;
  status: string;
  created_at: string;
  project_name?: string;
  material_name?: string;
  metric?: string;
}

interface MaterialReturn {
  return_id: number;
  return_number: string;
  project_id: number;
  material_id: number;
  variant_id: number | null;
  returned_quantity: number;
  number_of_units: number | null;
  condition: string;
  reason: string | null;
  status: string;
  created_at: string;
  project_name?: string;
  material_name?: string;
  variant_name?: string;
}

interface StockBatchPreview {
  batch_id: number;
  variant_id: number;
  quantity_variant_id: number | null;
  variant_name: string;
  quantity_variant_name: string | null;
  unit_price: number;
  quantity_per_unit: number | null;
  batch_date: string;
  quantity_available: number;
}

interface StockEntryLog {
  log_id: number;
  material_id: number;
  variant_id: number | null;
  project_id: number | null;
  movement_type: string;
  quantity: number;
  number_of_units: number | null;
  notes: string | null;
  movement_date: string;
  created_by: string | null;
  material_name?: string;
  variant_name?: string;
  metric?: string;
  project_name?: string | null;
  created_by_name?: string | null;
}

const STOCK_META_PREFIX = '[STOCK_META]';

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export default function StorePage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [pendingRequests, setPendingRequests] = useState<MaterialRequest[]>([]);
  const [pendingReturns, setPendingReturns] = useState<MaterialReturn[]>([]);
  const [stockEntryLogs, setStockEntryLogs] = useState<StockEntryLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [isFulfillDialogOpen, setIsFulfillDialogOpen] = useState(false);
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);

  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | null>(null);
  const [fulfillmentUnits, setFulfillmentUnits] = useState<Array<{ variant_id: number; units: number }>>([]);
  const [fulfillQty, setFulfillQty] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  
  const [selectedReturn, setSelectedReturn] = useState<MaterialReturn | null>(null);
  const [returnReviewNotes, setReturnReviewNotes] = useState('');
  const [selectedStockLog, setSelectedStockLog] = useState<StockEntryLog | null>(null);
  const [isStockLogDialogOpen, setIsStockLogDialogOpen] = useState(false);

  // Stock Entry Logs filters
  const [logSearch, setLogSearch] = useState('');
  const [logInvoice, setLogInvoice] = useState('');
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');
  const [logCreatedBy, setLogCreatedBy] = useState('all');
  const [logType, setLogType] = useState('all');

  const [stockPreview, setStockPreview] = useState<StockBatchPreview[]>([]);
  const [stockPreviewLoading, setStockPreviewLoading] = useState(false);
  // variantUnits[price_variant_id] = number of physical packaging units (string for input)
  const [variantUnits, setVariantUnits] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchAll();
  }, []);

  // Refresh Stock Entry Logs whenever PriceVariantsTab mutates store stock
  // (add stock, damage/write-off, pause/resume variant).
  useEffect(() => {
    const handler = () => {
      fetchStockEntryLogs();
    };
    window.addEventListener('store-stock-updated', handler);
    return () => window.removeEventListener('store-stock-updated', handler);
  }, []);

  const fetchAll = async () => {
    await Promise.all([
      fetchMaterials(),
      fetchPendingRequests(),
      fetchPendingReturns(),
      fetchStockEntryLogs()
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

  const fetchPendingRequests = async () => {
    const { data, error } = await supabase
      .from('material_requests')
      .select(`
        *,
        projects!inner(project_name),
        materials_master!inner(material_name, metric)
      `)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false });
    
    if (error) {
      toast.error('Failed to load requests: ' + error.message);
      return;
    }
    
    const requestsWithDetails = (data || []).map((req: any) => ({
      ...req,
      project_name: req.projects?.project_name,
      material_name: req.materials_master?.material_name,
      metric: req.materials_master?.metric,
    }));
    
    setPendingRequests(requestsWithDetails);
  };

  const fetchPendingReturns = async () => {
    const { data, error } = await supabase
      .from('material_returns')
      .select(`
        *,
        projects!inner(project_name),
        materials_master!inner(material_name),
        material_variants!quantity_variant_id(variant_name)
      `)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false });
    
    if (error) {
      toast.error('Failed to load returns: ' + error.message);
      return;
    }
    
    const returnsWithDetails = (data || []).map((ret: any) => ({
      ...ret,
      project_name: ret.projects?.project_name,
      material_name: ret.materials_master?.material_name,
      variant_name: ret.material_variants?.variant_name
    }));
    
    setPendingReturns(returnsWithDetails);
  };

  const fetchStockEntryLogs = async () => {
    const { data, error } = await supabase
      .from('material_movement_logs')
      .select(`
        log_id,
        material_id,
        variant_id,
        project_id,
        movement_type,
        quantity,
        number_of_units,
        notes,
        movement_date,
        created_by,
        materials_master!inner(material_name, metric),
        material_variants(variant_name),
        projects(project_name)
      `)
      // Store Entry Logs shows every store-side stock movement regardless of
      // source: manual adjustments, damage/write-off, MR-approval dispatches,
      // and return-acceptance receipts. The companion Store In/Out rows for
      // MR/return flows keep project_id set for audit linkage, so we filter
      // on movement_type alone.
      .in('movement_type', ['Store In', 'Store Out', 'Damage / Write-off'])
      .order('movement_date', { ascending: false })
      .limit(200);

    if (error) {
      toast.error('Failed to load stock entry logs: ' + error.message);
      return;
    }

    // No FK from material_movement_logs.created_by to public.profiles (FK is to auth.users),
    // so PostgREST can't embed profiles directly — resolve names via a separate lookup.
    const userIds = Array.from(new Set(
      (data || []).map((log: any) => log.created_by).filter((id: string | null): id is string => !!id)
    ));
    const nameByUserId = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);
      for (const p of profs || []) {
        if (p.full_name) nameByUserId.set(p.user_id, p.full_name);
      }
    }

    const logsWithDetails = (data || []).map((log: any) => ({
      ...log,
      material_name: log.materials_master?.material_name,
      metric: log.materials_master?.metric,
      variant_name: log.material_variants?.variant_name,
      project_name: log.projects?.project_name ?? null,
      created_by_name: log.created_by ? nameByUserId.get(log.created_by) ?? null : null,
    }));

    setStockEntryLogs(logsWithDetails);
  };

  const parseStockEntryNotes = (notes: string | null) => {
    if (!notes) {
      return {
        poDate: '-',
        invoiceNumber: '-',
        amountPerUnit: '-',
        gst: '-',
        remarks: '-',
        billPath: '',
        billFileName: '',
        billBucket: 'documents'
      };
    }

    const lines = notes.split('\n').map((line) => line.trim()).filter(Boolean);

    const metaLine = lines.find((line) => line.startsWith(STOCK_META_PREFIX));
    if (metaLine) {
      try {
        const metaRaw = metaLine.slice(STOCK_META_PREFIX.length);
        const meta = JSON.parse(metaRaw) as {
          poDate?: string;
          invoiceNumber?: string;
          amountPerUnit?: string;
          gst?: string;
          remarks?: string;
          billPath?: string;
          billFileName?: string;
          billBucket?: string;
        };

        return {
          poDate: meta.poDate?.trim() || '-',
          invoiceNumber: meta.invoiceNumber?.trim() || '-',
          amountPerUnit: meta.amountPerUnit?.trim() || '-',
          gst: meta.gst?.trim() || '-',
          remarks: meta.remarks?.trim() || '-',
          billPath: meta.billPath?.trim() || '',
          billFileName: meta.billFileName?.trim() || '',
          billBucket: meta.billBucket?.trim() || 'documents'
        };
      } catch {
        // Fall back to legacy tag parsing if metadata is malformed.
      }
    }

    const getTaggedValue = (tag: string) => {
      const line = lines.find((entry) => entry.startsWith(`[${tag}]`));
      if (!line) return null;
      return line.replace(`[${tag}]`, '').trim();
    };

    const hasStructuredTags = lines.some((entry) => entry.startsWith('['));
    const poDate = getTaggedValue('PO_DATE');
    const invoiceNumber = getTaggedValue('INVOICE_NUMBER');
    const amountPerUnit = getTaggedValue('AMOUNT_PER_UNIT');
    const gst = getTaggedValue('GST');
    const remarks = getTaggedValue('REMARKS') || (!hasStructuredTags ? notes : null);

    return {
      poDate: poDate || '-',
      invoiceNumber: invoiceNumber || '-',
      amountPerUnit: amountPerUnit || '-',
      gst: gst || '-',
      remarks: remarks || '-',
      billPath: '',
      billFileName: '',
      billBucket: 'documents'
    };
  };

  // Unique creators across currently-loaded logs (for the Created By filter).
  const stockLogCreatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const log of stockEntryLogs) {
      if (log.created_by) {
        map.set(log.created_by, log.created_by_name || log.created_by);
      }
    }
    return Array.from(map.entries());
  }, [stockEntryLogs]);

  const filteredStockEntryLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    const inv = logInvoice.trim().toLowerCase();
    const from = logDateFrom ? new Date(logDateFrom).getTime() : null;
    const to = logDateTo ? new Date(logDateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

    return stockEntryLogs.filter((log) => {
      if (logType !== 'all' && log.movement_type !== logType) return false;
      if (logCreatedBy !== 'all' && log.created_by !== logCreatedBy) return false;

      const ts = new Date(log.movement_date).getTime();
      if (from !== null && ts < from) return false;
      if (to !== null && ts > to) return false;

      const notes = (log.notes || '').toLowerCase();
      if (inv && !notes.includes(inv)) return false;

      if (q) {
        const hay = [
          log.material_name,
          log.variant_name,
          log.project_name,
          log.created_by_name,
          log.notes,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [stockEntryLogs, logSearch, logInvoice, logDateFrom, logDateTo, logCreatedBy, logType]);

  const openFulfillDialog = async (request: MaterialRequest) => {
    setSelectedRequest(request);
    setApprovalNotes('');
    setFulfillQty(String(request.requested_quantity));
    setFulfillmentUnits([]);
    setVariantUnits({});
    setIsFulfillDialogOpen(true);

    // Fetch available batches for this material (FIFO order)
    setStockPreview([]);
    setStockPreviewLoading(true);
    const { data } = await supabase
      .from('material_stock_batches_admin')
      .select('batch_id, variant_id, quantity_variant_id, variant_name, quantity_variant_name, unit_price, quantity_per_unit, batch_date, quantity_available')
      .eq('material_id', request.material_id)
      .gt('quantity_available', 0)
      .order('batch_date', { ascending: true })
      .order('batch_id', { ascending: true });
    setStockPreview((data as StockBatchPreview[]) || []);
    setStockPreviewLoading(false);
  };

  const handleApproveRequest = async () => {
    if (!selectedRequest) return;

    // Build per-packaging-variant allocations.
    // variantUnits keys are quantity_variant_id (packaging type); FIFO picks price batches.
    const uniqueQtyVariantMap = new Map<number, { quantity_per_unit: number | null }>();
    stockPreview.forEach(b => {
      if (b.quantity_variant_id && !uniqueQtyVariantMap.has(b.quantity_variant_id)) {
        uniqueQtyVariantMap.set(b.quantity_variant_id, { quantity_per_unit: b.quantity_per_unit });
      }
    });

    // Validate each per-variant unit count as a 0.25 multiple before building allocations.
    for (const [qvidStr, unitsStr] of Object.entries(variantUnits)) {
      if (!unitsStr || parseFloat(unitsStr) <= 0) continue;
      if (!isQuarterMultiple(parseFloat(unitsStr))) {
        toast.error(`Units must be multiples of ${QUANTITY_STEP} (got ${unitsStr})`);
        return;
      }
    }

    const allocations = Object.entries(variantUnits)
      .map(([qvidStr, unitsStr]) => {
        const qvid = parseInt(qvidStr);
        const n    = parseFloat(unitsStr);
        const qpu  = uniqueQtyVariantMap.get(qvid)?.quantity_per_unit ?? 1;
        return { qty_variant_id: qvid, qty: isNaN(n) || n <= 0 ? 0 : n * qpu };
      })
      .filter(a => a.qty > 0);

    // Total base-metric qty for the fulfilled_quantity field
    let qty: number;
    if (allocations.length > 0) {
      qty = allocations.reduce((s, a) => s + a.qty, 0);
    } else {
      const parsed = parseQuarterQty(fulfillQty, { label: 'Quantity' });
      if (!parsed.ok) {
        toast.error(parsed.error === 'Quantity is required'
          ? 'Enter units above per variant, or set a quantity for auto-FIFO'
          : parsed.error);
        return;
      }
      qty = parsed.value;
    }

    try {
      // 1. FIFO-allocate FIRST — validates stock + deducts batches atomically.
      //    Multi-packaging: one transaction, FIFO across all price batches per packaging type.
      //    Auto-FIFO: across ALL variants, oldest batch first.
      let rpcData: any, rpcErr: any;
      if (allocations.length > 0) {
        ({ data: rpcData, error: rpcErr } = await supabase.rpc(
          'allocate_material_fifo_multi_qty_variant',
          {
            p_allocations: allocations,
            p_project_id:  Number(selectedRequest.project_id),
          }
        ));
      } else {
        ({ data: rpcData, error: rpcErr } = await supabase.rpc(
          'allocate_material_fifo',
          {
            p_material_id:  Number(selectedRequest.material_id),
            p_project_id:   Number(selectedRequest.project_id),
            p_required_qty: qty,
          }
        ));
      }
      if (rpcErr) throw rpcErr;

      const result      = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      const allocationId = result?.allocation_id;
      const totalCost    = Number(result?.total_cost || 0);

      // 2. Stamp allocation metadata to link back to the request.
      if (allocationId) {
        const noteParts: string[] = [`Fulfills MR ${selectedRequest.request_number}`];
        if (approvalNotes.trim()) noteParts.push(approvalNotes.trim());
        noteParts.push(`FIFO cost=Rs.${totalCost.toFixed(2)}`);
        await supabase
          .from('material_allocations')
          .update({
            source_type: 'In-Store',
            allocation_date: new Date().toISOString().slice(0, 10),
            notes: noteParts.join(' | '),
          })
          .eq('allocation_id', allocationId);
      }

      // 3. Mark the request Fulfilled — only reached when FIFO succeeded.
      const { error: reqError } = await supabase
        .from('material_requests')
        .update({
          status: 'Fulfilled',
          approved_at: new Date().toISOString(),
          fulfilled_at: new Date().toISOString(),
          approval_notes: approvalNotes.trim() || null,
          fulfilled_quantity: qty,
        })
        .eq('request_id', selectedRequest.request_id);
      if (reqError) throw reqError;

      toast.success(`Request fulfilled — FIFO allocated Rs. ${totalCost.toFixed(2)}`);
      setIsFulfillDialogOpen(false);
      fetchAll();
    } catch (error: any) {
      toast.error('Failed to fulfill request: ' + error.message);
    }
  };

  const handleRejectRequest = async () => {
    if (!selectedRequest) return;

    try {
      const { error } = await supabase
        .from('material_requests')
        .update({
          status: 'Rejected',
          approved_at: new Date().toISOString(),
          approval_notes: approvalNotes.trim() || 'Rejected by store'
        })
        .eq('request_id', selectedRequest.request_id);

      if (error) throw error;

      const { data: userRes } = await supabase.auth.getUser();
      await supabase.from('material_movement_logs').insert({
        material_id: selectedRequest.material_id,
        project_id: selectedRequest.project_id,
        movement_type: 'Request Rejected',
        reference_type: 'Material Request',
        reference_id: selectedRequest.request_id,
        quantity: Number(selectedRequest.requested_quantity || 0),
        notes:
          'REQUEST REJECTED by store'
          + ' | request#=' + selectedRequest.request_number
          + ' | qty=' + Number(selectedRequest.requested_quantity || 0)
          + (approvalNotes.trim() ? ' | reason="' + approvalNotes.trim() + '"' : '')
          + ' | at=' + new Date().toISOString(),
        created_by: userRes?.user?.id ?? null,
      });

      toast.success('Request rejected');
      setIsFulfillDialogOpen(false);
      fetchPendingRequests();
    } catch (error: any) {
      toast.error('Failed to reject request: ' + error.message);
    }
  };

  const openReturnDialog = (returnItem: MaterialReturn) => {
    setSelectedReturn(returnItem);
    setReturnReviewNotes('');
    setIsReturnDialogOpen(true);
  };

  const handleAcceptReturn = async () => {
    if (!selectedReturn) return;

    // Approval RPC does everything atomically: LIFO stock-move, batch re-credit,
    // status update, and movement log. No parallel inserts from UI needed.
    const { data, error } = await supabase.rpc('approve_material_return_request', {
      p_return_id:    selectedReturn.return_id,
      p_review_notes: returnReviewNotes.trim() || null,
    });

    if (error) { toast.error('Failed to accept return: ' + error.message); return; }

    const result = Array.isArray(data) ? data[0] : data;
    const value = Number(result?.total_value || 0);
    toast.success(`Return accepted — Rs. ${value.toFixed(2)} re-credited to store (LIFO)`);
    setIsReturnDialogOpen(false);
    fetchAll();
  };

  const handleRejectReturn = async () => {
    if (!selectedReturn) return;

    const { error } = await supabase.rpc('reject_material_return_request', {
      p_return_id:    selectedReturn.return_id,
      p_review_notes: returnReviewNotes.trim() || null,
    });

    if (error) { toast.error('Failed to reject return: ' + error.message); return; }

    toast.success('Return rejected');
    setIsReturnDialogOpen(false);
    fetchPendingReturns();
  };

  const selectedStockEntryDetails = selectedStockLog ? parseStockEntryNotes(selectedStockLog.notes) : null;

  const openBillForLog = async (log: StockEntryLog) => {
    const parsed = parseStockEntryNotes(log.notes);
    if (!parsed.billPath) {
      toast.error('No bill attached for this stock entry');
      return;
    }
    const { data, error } = await supabase
      .storage
      .from(parsed.billBucket || 'documents')
      .createSignedUrl(parsed.billPath, 60);
    if (error) {
      toast.error(error.message || 'Failed to open bill');
      return;
    }
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-slate-500">Loading store inventory...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Store Inventory</h1>
            <p className="text-slate-600 mt-1">Global inventory management & material requests</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="px-3 py-1">
              <Bell className="h-4 w-4 mr-1" />
              {pendingRequests.length} Pending Requests
            </Badge>
            <Badge variant="outline" className="px-3 py-1">
              <TrendingUp className="h-4 w-4 mr-1" />
              {pendingReturns.length} Pending Returns
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="price-variants" className="space-y-6">
          <TabsList className="bg-white border">
            <TabsTrigger value="price-variants">Price Variants</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="requests">Material Requests</TabsTrigger>
            <TabsTrigger value="returns">Material Returns</TabsTrigger>
            <TabsTrigger value="stock-entry-logs">Stock Entry Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="price-variants" className="space-y-4">
            <PriceVariantsTab />
          </TabsContent>

          {/* Inventory Tab (aggregated FIFO view) */}
          <TabsContent value="inventory" className="space-y-4">
            <StoreInventoryAggregateTab />
          </TabsContent>

          {/* Stock Entry Logs Tab */}
          <TabsContent value="stock-entry-logs" className="space-y-4">
            <Card className="bg-white shadow-sm">
              <CardHeader className="border-b bg-slate-50 space-y-3">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-blue-600" />
                  Stock Entry Logs
                  <span className="text-sm font-normal text-slate-500 ml-1">
                    ({filteredStockEntryLogs.length} of {stockEntryLogs.length})
                  </span>
                </CardTitle>
                <div className="flex flex-wrap gap-2 items-center">
                  <Input
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Search material / variant / project / user"
                    className="w-[280px] bg-white"
                  />
                  <Input
                    value={logInvoice}
                    onChange={(e) => setLogInvoice(e.target.value)}
                    placeholder="Invoice #"
                    className="w-[160px] bg-white"
                  />
                  <Input
                    type="date"
                    value={logDateFrom}
                    onChange={(e) => setLogDateFrom(e.target.value)}
                    className="w-[150px] bg-white"
                    title="From date"
                  />
                  <Input
                    type="date"
                    value={logDateTo}
                    onChange={(e) => setLogDateTo(e.target.value)}
                    className="w-[150px] bg-white"
                    title="To date"
                  />
                  <Select value={logType} onValueChange={setLogType}>
                    <SelectTrigger className="w-[180px] bg-white">
                      <SelectValue placeholder="Movement type" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="Store In">Store In</SelectItem>
                      <SelectItem value="Store Out">Store Out</SelectItem>
                      <SelectItem value="Damage / Write-off">Damage / Write-off</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={logCreatedBy} onValueChange={setLogCreatedBy}>
                    <SelectTrigger className="w-[180px] bg-white">
                      <SelectValue placeholder="Created by" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value="all">All users</SelectItem>
                      {stockLogCreatorOptions.map(([uid, name]) => (
                        <SelectItem key={uid} value={uid}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(logSearch || logInvoice || logDateFrom || logDateTo || logType !== 'all' || logCreatedBy !== 'all') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLogSearch(''); setLogInvoice(''); setLogDateFrom(''); setLogDateTo('');
                        setLogType('all'); setLogCreatedBy('all');
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Date</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Type</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Project</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Material</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Variant</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">Units</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">Quantity</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">PO Date</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Invoice</th>
                        <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">Amount/Unit</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">GST</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Bill</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredStockEntryLogs.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="px-4 py-8 text-center text-slate-500">
                            {stockEntryLogs.length === 0 ? 'No stock entry logs found' : 'No logs match the current filters'}
                          </td>
                        </tr>
                      ) : (
                        filteredStockEntryLogs.map((log) => {
                          const parsed = parseStockEntryNotes(log.notes);
                          return (
                            <tr
                              key={log.log_id}
                              className="hover:bg-slate-50 cursor-pointer"
                              onClick={() => {
                                setSelectedStockLog(log);
                                setIsStockLogDialogOpen(true);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  setSelectedStockLog(log);
                                  setIsStockLogDialogOpen(true);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              title="Click to view full entry details"
                            >
                              <td className="px-4 py-3 text-sm text-slate-900">
                                {new Date(log.movement_date).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <Badge className={
                                  log.movement_type === 'Store Out' || log.movement_type === 'Damage / Write-off'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-green-100 text-green-700'
                                }>
                                  {log.movement_type}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-700">
                                {log.project_name ? (
                                  <span>{log.project_name} <span className="text-slate-400 text-xs">#{log.project_id}</span></span>
                                ) : (
                                  <span className="text-slate-400 italic">— store-only —</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm font-medium text-slate-900">{log.material_name}</td>
                              <td className="px-4 py-3 text-sm text-slate-600">{log.variant_name || '-'}</td>
                              <td className="px-4 py-3 text-sm text-right text-slate-900">{log.number_of_units ?? '-'}</td>
                              <td className="px-4 py-3 text-sm text-right">
                                {(() => {
                                  const isOutflow = log.movement_type === 'Store Out' || log.movement_type === 'Damage / Write-off';
                                  return (
                                    <span className={`font-semibold ${isOutflow ? 'text-red-700' : 'text-slate-900'}`}>
                                      {isOutflow ? '-' : ''}
                                      {log.quantity}
                                    </span>
                                  );
                                })()}
                                <span className="text-slate-500 ml-1">{log.metric}</span>
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-600">{parsed.poDate}</td>
                              <td className="px-4 py-3 text-sm text-slate-600">{parsed.invoiceNumber}</td>
                              <td className="px-4 py-3 text-sm text-right text-slate-600">{parsed.amountPerUnit}</td>
                              <td className="px-4 py-3 text-sm text-slate-600">{parsed.gst}</td>
                              <td className="px-4 py-3 text-sm text-slate-600">
                                {parsed.billPath ? (
                                  <button
                                    type="button"
                                    className="text-blue-600 hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void openBillForLog(log);
                                    }}
                                  >
                                    {parsed.billFileName || 'Open bill'}
                                  </button>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">{parsed.remarks}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Dialog open={isStockLogDialogOpen} onOpenChange={setIsStockLogDialogOpen}>
              <DialogContent className="bg-white max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Stock Entry Details</DialogTitle>
                </DialogHeader>
                {selectedStockLog && selectedStockEntryDetails && (
                  <div className="space-y-4 py-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-slate-500">Date & Time</p>
                        <p className="font-medium text-slate-900">{new Date(selectedStockLog.movement_date).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Material</p>
                        <p className="font-medium text-slate-900">{selectedStockLog.material_name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Movement Type</p>
                        <p className="font-medium text-slate-900">{selectedStockLog.movement_type}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Variant</p>
                        <p className="font-medium text-slate-900">{selectedStockLog.variant_name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Units</p>
                        <p className="font-medium text-slate-900">{selectedStockLog.number_of_units ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Quantity</p>
                        <p className="font-medium text-slate-900">
                          {selectedStockLog.quantity} {selectedStockLog.metric || ''}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">PO Date</p>
                        <p className="font-medium text-slate-900">{selectedStockEntryDetails.poDate}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Invoice Number</p>
                        <p className="font-medium text-slate-900">{selectedStockEntryDetails.invoiceNumber}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Amount Per Unit</p>
                        <p className="font-medium text-slate-900">{selectedStockEntryDetails.amountPerUnit}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">GST</p>
                        <p className="font-medium text-slate-900">{selectedStockEntryDetails.gst}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Bill</p>
                        {selectedStockEntryDetails.billPath ? (
                          <button
                            type="button"
                            className="font-medium text-blue-600 hover:underline"
                            onClick={() => void openBillForLog(selectedStockLog)}
                          >
                            {selectedStockEntryDetails.billFileName || 'Open bill'}
                          </button>
                        ) : (
                          <p className="font-medium text-slate-900">-</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-slate-500">Remarks</p>
                      <p className="text-sm font-medium text-slate-900 whitespace-pre-wrap break-words">
                        {selectedStockEntryDetails.remarks}
                      </p>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Material Requests Tab */}
          <TabsContent value="requests" className="space-y-4">
            <Card className="bg-white shadow-sm">
              <CardHeader className="border-b bg-slate-50">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-orange-600" />
                  Pending Material Requests ({pendingRequests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {pendingRequests.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      No pending requests
                    </div>
                  ) : (
                    pendingRequests.map((req) => (
                      <div key={req.request_id} className="p-4 hover:bg-slate-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono">{req.request_number}</Badge>
                              <Badge className={
                                req.request_source === 'Store' ? 'bg-blue-100 text-blue-700' : 'bg-teal-100 text-teal-700'
                              }>
                                {req.request_source}
                              </Badge>
                              <Badge className={
                                req.priority === 'Urgent' ? 'bg-red-100 text-red-700' :
                                req.priority === 'High' ? 'bg-orange-100 text-orange-700' :
                                'bg-slate-100 text-slate-700'
                              }>
                                {req.priority}
                              </Badge>
                            </div>
                            <h3 className="font-semibold text-slate-900 mt-2">{req.project_name}</h3>
                            <p className="text-sm text-slate-600 mt-1">
                              Material: <span className="font-medium">{req.material_name}</span>
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-slate-600">
                              <span>Requested: <span className="font-semibold text-slate-900">{req.requested_quantity} {req.metric}</span></span>
                              {req.required_by && <span>Required by: {new Date(req.required_by).toLocaleDateString()}</span>}
                            </div>
                            {req.purpose && (
                              <p className="text-sm text-slate-600 mt-2">Purpose: {req.purpose}</p>
                            )}
                          </div>
                          <Button
                            onClick={() => openFulfillDialog(req)}
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {req.request_source === 'Store' ? 'Review & Fulfill' : 'Acknowledge'}
                          </Button>
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
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Pending Material Returns ({pendingReturns.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {pendingReturns.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      No pending returns
                    </div>
                  ) : (
                    pendingReturns.map((ret) => (
                      <div key={ret.return_id} className="p-4 hover:bg-slate-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono">{ret.return_number}</Badge>
                              <Badge className={
                                ret.condition === 'Excellent' || ret.condition === 'Good' ? 'bg-green-100 text-green-700' :
                                ret.condition === 'Fair' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }>
                                {ret.condition}
                              </Badge>
                            </div>
                            <h3 className="font-semibold text-slate-900 mt-2">{ret.project_name}</h3>
                            <p className="text-sm text-slate-600 mt-1">
                              Material: <span className="font-medium">{ret.material_name}</span>
                              {ret.variant_name && <span> - {ret.variant_name}</span>}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-slate-600">
                              <span>Quantity: <span className="font-semibold text-slate-900">{ret.returned_quantity}</span></span>
                              {ret.number_of_units && <span>Units: <span className="font-semibold">{ret.number_of_units}</span></span>}
                            </div>
                            {ret.reason && (
                              <p className="text-sm text-slate-600 mt-2">Reason: {ret.reason}</p>
                            )}
                          </div>
                          <Button
                            onClick={() => openReturnDialog(ret)}
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            Review Return
                          </Button>
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

      {/* Fulfill Request Dialog */}
      <Dialog open={isFulfillDialogOpen} onOpenChange={setIsFulfillDialogOpen}>
        <DialogContent className="bg-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fulfill Material Request</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4 py-4">
              {/* Request summary */}
              <div className="bg-slate-50 p-4 rounded-lg space-y-1 text-sm">
                <p><span className="font-semibold">Request:</span> {selectedRequest.request_number}</p>
                <p><span className="font-semibold">Project:</span> {selectedRequest.project_name}</p>
                <p><span className="font-semibold">Material:</span> {selectedRequest.material_name}</p>
                <p><span className="font-semibold">Requested:</span> {selectedRequest.requested_quantity} {selectedRequest.metric}</p>
              </div>

              {/* Packaging-variant allocation grid */}
              {selectedRequest.request_source === 'Store' && (() => {
                // Group by PACKAGING variant (quantity_variant_id) — price tier is hidden from admin
                const pkgMap = new Map<number, {
                  qty_variant_id: number;
                  qty_variant_name: string;
                  quantity_per_unit: number;
                  total_available: number;
                }>();
                stockPreview.forEach(b => {
                  if (!b.quantity_variant_id) return;
                  const key = b.quantity_variant_id;
                  if (!pkgMap.has(key)) {
                    pkgMap.set(key, {
                      qty_variant_id:   key,
                      qty_variant_name: b.quantity_variant_name ?? b.variant_name,
                      quantity_per_unit: b.quantity_per_unit ?? 1,
                      total_available:  0,
                    });
                  }
                  pkgMap.get(key)!.total_available += Number(b.quantity_available);
                });
                const pkgVariants = Array.from(pkgMap.values());

                const metric = selectedRequest.metric ?? '';

                const totalAllocQty = pkgVariants.reduce((sum, v) => {
                  const n   = parseFloat(variantUnits[v.qty_variant_id] ?? '');
                  return sum + (isNaN(n) || n <= 0 ? 0 : n * v.quantity_per_unit);
                }, 0);

                const hasAnyUnits = totalAllocQty > 0;
                const requested   = selectedRequest.requested_quantity;
                const diff        = totalAllocQty - requested;

                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-blue-600" />
                      <Label className="text-xs font-semibold text-slate-700">
                        Allocate Packaging — enter units to issue per variant
                      </Label>
                    </div>

                    {stockPreviewLoading ? (
                      <p className="text-xs text-slate-500 pl-1">Loading stock…</p>
                    ) : pkgVariants.length === 0 ? (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                        ⚠ No stock available for this material.
                      </div>
                    ) : (
                      <>
                        <div className="rounded border text-xs overflow-hidden">
                          <div className="bg-slate-100 grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 font-semibold text-slate-600">
                            <span>Packaging</span>
                            <span className="text-right">In Stock</span>
                            <span className="text-right w-20">Units</span>
                            <span className="text-right w-20">= {metric}</span>
                          </div>
                          {pkgVariants.map((v) => {
                            const unitsVal = variantUnits[v.qty_variant_id] ?? '';
                            const numUnits = parseFloat(unitsVal);
                            const allocKg  = !isNaN(numUnits) && numUnits > 0
                              ? numUnits * v.quantity_per_unit
                              : null;
                            const stockUnits = (v.total_available / v.quantity_per_unit).toFixed(1);
                            return (
                              <div
                                key={v.qty_variant_id}
                                className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2 items-center border-t transition-colors ${
                                  allocKg ? 'bg-blue-50' : ''
                                }`}
                              >
                                <div>
                                  <div className="font-medium text-slate-800">
                                    {v.qty_variant_name}
                                  </div>
                                  <div className="text-slate-400">
                                    {v.quantity_per_unit} {metric}/unit · {v.total_available.toFixed(2)} {metric} total
                                  </div>
                                </div>
                                <div className="text-right text-slate-500 shrink-0">
                                  {stockUnits} units
                                </div>
                                <Input
                                  type="number"
                                  step={QUANTITY_STEP}
                                  min="0"
                                  value={unitsVal}
                                  onChange={(e) =>
                                    setVariantUnits(prev => ({
                                      ...prev,
                                      [v.qty_variant_id]: e.target.value,
                                    }))
                                  }
                                  className="bg-white w-20 text-right text-xs h-7 px-2"
                                  placeholder="0"
                                />
                                <div className={`text-right font-semibold w-20 ${allocKg ? 'text-blue-700' : 'text-slate-300'}`}>
                                  {allocKg !== null ? allocKg.toFixed(2) : '—'}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Running total */}
                        {hasAnyUnits && (
                          <div className={`text-xs rounded px-3 py-2 font-medium flex items-center justify-between border ${
                            Math.abs(diff) < 0.001
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : diff > 0
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-blue-50 text-blue-700 border-blue-100'
                          }`}>
                            <span>Total: {totalAllocQty.toFixed(3)} {metric}</span>
                            <span>
                              {Math.abs(diff) < 0.001
                                ? '✓ Exactly matches requested'
                                : diff > 0
                                ? `+${diff.toFixed(3)} ${metric} over requested`
                                : `${Math.abs(diff).toFixed(3)} ${metric} short`}
                            </span>
                          </div>
                        )}

                        {/* Auto-FIFO fallback — shown only when no units entered */}
                        {!hasAnyUnits && (
                          <div className="space-y-1">
                            <Label className="text-xs text-slate-600">
                              Or: auto-fulfill quantity ({metric})
                            </Label>
                            <Input
                              type="number"
                              step={QUANTITY_STEP}
                              min="0"
                              value={fulfillQty}
                              onChange={(e) => setFulfillQty(e.target.value)}
                              className="bg-white"
                              placeholder={`${selectedRequest.requested_quantity}`}
                            />
                            <p className="text-xs text-slate-400">
                              FIFO across all stock (oldest batch first). Enter units above for a specific mix.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Approval notes */}
              <div className="space-y-2">
                <Label>Approval Notes</Label>
                <Textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Optional notes about this fulfillment"
                  className="bg-white"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleApproveRequest}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={selectedRequest.request_source === 'Store' && stockPreview.length === 0}
                >
                  <Check className="h-4 w-4 mr-2" />
                  {Object.values(variantUnits).some(u => parseFloat(u) > 0)
                    ? 'Fulfill — custom mix (FIFO per variant)'
                    : 'Fulfill — auto FIFO (all variants)'}
                </Button>
                <Button onClick={handleRejectRequest} variant="destructive" className="flex-1">
                  <X className="h-4 w-4 mr-2" /> Reject Request
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Return Review Dialog */}
      <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Review Material Return</DialogTitle>
          </DialogHeader>
          {selectedReturn && (
            <div className="space-y-4 py-4">
              <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                <p><span className="font-semibold">Return:</span> {selectedReturn.return_number}</p>
                <p><span className="font-semibold">Project:</span> {selectedReturn.project_name}</p>
                <p><span className="font-semibold">Material:</span> {selectedReturn.material_name}</p>
                <p><span className="font-semibold">Variant:</span> {selectedReturn.variant_name || 'Not specified'}</p>
                <p><span className="font-semibold">Quantity:</span> {selectedReturn.returned_quantity}</p>
                {selectedReturn.number_of_units && (
                  <p><span className="font-semibold">Units:</span> {selectedReturn.number_of_units}</p>
                )}
                <p><span className="font-semibold">Condition:</span> <Badge className={
                  selectedReturn.condition === 'Excellent' || selectedReturn.condition === 'Good' ? 'bg-green-100 text-green-700' :
                  selectedReturn.condition === 'Fair' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }>{selectedReturn.condition}</Badge></p>
                {selectedReturn.reason && (
                  <p><span className="font-semibold">Reason:</span> {selectedReturn.reason}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Review Notes</Label>
                <Textarea
                  value={returnReviewNotes}
                  onChange={(e) => setReturnReviewNotes(e.target.value)}
                  placeholder="Notes about accepting or rejecting this return"
                  className="bg-white"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleAcceptReturn} className="flex-1 bg-green-600 hover:bg-green-700">
                  <Check className="h-4 w-4 mr-2" /> Accept Return
                </Button>
                <Button onClick={handleRejectReturn} variant="destructive" className="flex-1">
                  <X className="h-4 w-4 mr-2" /> Reject Return
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
