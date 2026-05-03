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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { Plus, Package, ClipboardList, TrendingUp, Bell, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import PriceVariantsTab from '@/components/store/PriceVariantsTab';
import StoreInventoryAggregateTab from '@/components/store/StoreInventoryAggregateTab';

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

interface StoreInventory {
  inventory_id: number;
  material_id: number;
  variant_id: number;
  number_of_units: number;
  total_quantity: number;
  location: string | null;
  notes: string | null;
  last_updated: string;
  material_name?: string;
  variant_name?: string;
  quantity_per_unit?: number;
  metric?: string;
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
  material_name?: string;
  variant_name?: string;
  metric?: string;
  project_name?: string | null;
}

const STOCK_META_PREFIX = '[STOCK_META]';

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export default function StorePage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [inventory, setInventory] = useState<StoreInventory[]>([]);
  const [pendingRequests, setPendingRequests] = useState<MaterialRequest[]>([]);
  const [pendingReturns, setPendingReturns] = useState<MaterialReturn[]>([]);
  const [stockEntryLogs, setStockEntryLogs] = useState<StockEntryLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isInventoryDialogOpen, setIsInventoryDialogOpen] = useState(false);
  const [isFulfillDialogOpen, setIsFulfillDialogOpen] = useState(false);
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
  
  const [inventoryForm, setInventoryForm] = useState({
    inventory_id: null as number | null,
    material_id: null as number | null,
    variant_id: null as number | null,
    number_of_units: '',
    location: '',
    notes: '',
    purchase_order_date: '',
    invoice_number: '',
    amount_per_unit: '',
    gst: ''
  });
  const [stockBillFile, setStockBillFile] = useState<File | null>(null);
  const [reductionForm, setReductionForm] = useState({
    material_id: null as number | null,
    variant_id: null as number | null,
    number_of_units: '',
    remarks: ''
  });
  const [isReducingStock, setIsReducingStock] = useState(false);
  
  const [selectedRequest, setSelectedRequest] = useState<MaterialRequest | null>(null);
  const [fulfillmentUnits, setFulfillmentUnits] = useState<Array<{ variant_id: number; units: number }>>([]);
  const [fulfillQty, setFulfillQty] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  
  const [selectedReturn, setSelectedReturn] = useState<MaterialReturn | null>(null);
  const [returnReviewNotes, setReturnReviewNotes] = useState('');
  const [selectedStockLog, setSelectedStockLog] = useState<StockEntryLog | null>(null);
  const [isStockLogDialogOpen, setIsStockLogDialogOpen] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  // Refresh Stock Entry Logs + inventory whenever PriceVariantsTab mutates store stock
  // (add stock, damage/write-off, pause/resume variant).
  useEffect(() => {
    const handler = () => {
      fetchStockEntryLogs();
      fetchInventory();
    };
    window.addEventListener('store-stock-updated', handler);
    return () => window.removeEventListener('store-stock-updated', handler);
  }, []);

  const fetchAll = async () => {
    await Promise.all([
      fetchMaterials(),
      fetchVariants(),
      fetchInventory(),
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

  const fetchVariants = async () => {
    const { data } = await supabase
      .from('material_variants')
      .select('*')
      .eq('is_active', true)
      .order('material_id')
      .order('quantity_per_unit', { ascending: false });
    setVariants(data || []);
  };

  const fetchInventory = async () => {
    const { data, error } = await supabase
      .from('store_inventory')
      .select(`
        *,
        materials_master!inner(material_name, metric),
        material_variants!inner(variant_name, quantity_per_unit)
      `)
      .order('material_id');
    
    if (error) {
      toast.error('Failed to load inventory: ' + error.message);
      return;
    }
    
    const inventoryWithDetails = (data || []).map((item: any) => ({
      ...item,
      material_name: item.materials_master?.material_name,
      metric: item.materials_master?.metric,
      variant_name: item.material_variants?.variant_name,
      quantity_per_unit: item.material_variants?.quantity_per_unit
    }));
    
    setInventory(inventoryWithDetails);
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
      metric: req.materials_master?.metric
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
        material_variants(variant_name)
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
        materials_master!inner(material_name, metric),
        material_variants(variant_name),
        projects(project_name)
      `)
      // Store Entry Logs shows every store-side stock movement regardless of
      // source: manual adjustments, damage/write-off, MR-approval dispatches,
      // and return-acceptance receipts. The companion Store In/Out rows for
      // MR/return flows keep project_id set for audit linkage, so we filter
      // on movement_type alone.
      .in('movement_type', ['Store In', 'Store Out'])
      .order('movement_date', { ascending: false })
      .limit(200);

    if (error) {
      toast.error('Failed to load stock entry logs: ' + error.message);
      return;
    }

    const logsWithDetails = (data || []).map((log: any) => ({
      ...log,
      material_name: log.materials_master?.material_name,
      metric: log.materials_master?.metric,
      variant_name: log.material_variants?.variant_name,
      project_name: log.projects?.project_name ?? null,
    }));

    setStockEntryLogs(logsWithDetails);
  };

  const buildStockEntryNotes = (billMeta?: { billPath: string; billFileName: string; billBucket: string } | null) => {
    const meta = {
      poDate: inventoryForm.purchase_order_date || '',
      invoiceNumber: inventoryForm.invoice_number.trim(),
      amountPerUnit: inventoryForm.amount_per_unit.trim(),
      gst: inventoryForm.gst.trim(),
      remarks: inventoryForm.notes.trim(),
      billPath: billMeta?.billPath || '',
      billFileName: billMeta?.billFileName || '',
      billBucket: billMeta?.billBucket || ''
    };

    const hasDetails = Object.values(meta).some((value) => value.length > 0);
    if (!hasDetails) return null;

    const lines: string[] = [];
    if (meta.poDate) lines.push(`[PO_DATE] ${meta.poDate}`);
    if (meta.invoiceNumber) lines.push(`[INVOICE_NUMBER] ${meta.invoiceNumber}`);
    if (meta.amountPerUnit) lines.push(`[AMOUNT_PER_UNIT] ${meta.amountPerUnit}`);
    if (meta.gst) lines.push(`[GST] ${meta.gst}`);
    if (meta.remarks) lines.push(`[REMARKS] ${meta.remarks}`);

    return `${STOCK_META_PREFIX}${JSON.stringify(meta)}\n${lines.join('\n')}`;
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

  const handleSaveInventory = async () => {
    try {
      if (!inventoryForm.material_id || !inventoryForm.variant_id) {
        toast.error('Please select material and variant');
        return;
      }
      if (!inventoryForm.number_of_units || parseFloat(inventoryForm.number_of_units) <= 0) {
        toast.error('Please enter valid number of units');
        return;
      }
      if (!stockBillFile) {
        toast.error('Bill upload is mandatory while adding stock');
        return;
      }

      const variant = variants.find(v => v.variant_id === inventoryForm.variant_id);
      const units = parseFloat(inventoryForm.number_of_units);
      const totalQuantity = variant ? units * variant.quantity_per_unit : 0;
      const billBucket = 'documents';
      const billPath = `store/stock-bills/${Date.now()}-${safeFileName(stockBillFile.name)}`;
      const { error: billUploadError } = await supabase.storage
        .from(billBucket)
        .upload(billPath, stockBillFile, {
          contentType: stockBillFile.type || undefined,
          upsert: false
        });
      if (billUploadError) throw billUploadError;

      const stockNotes = buildStockEntryNotes({
        billPath,
        billFileName: stockBillFile.name,
        billBucket
      });

      const payload = {
        material_id: inventoryForm.material_id,
        variant_id: inventoryForm.variant_id,
        number_of_units: units,
        total_quantity: totalQuantity,
        location: inventoryForm.location.trim() || null,
        notes: stockNotes,
        last_updated: new Date().toISOString()
      };

      if (inventoryForm.inventory_id) {
        const { error } = await supabase
          .from('store_inventory')
          .update(payload)
          .eq('inventory_id', inventoryForm.inventory_id);
        
        if (error) throw error;
        toast.success('Inventory updated successfully');
      } else {
        const existingInventory = inventory.find(
          (inv) =>
            inv.material_id === inventoryForm.material_id &&
            inv.variant_id === inventoryForm.variant_id
        );

        if (existingInventory) {
          const { error } = await supabase
            .from('store_inventory')
            .update({
              number_of_units: existingInventory.number_of_units + units,
              total_quantity: existingInventory.total_quantity + totalQuantity,
              location: inventoryForm.location.trim() || existingInventory.location || null,
              notes: stockNotes || existingInventory.notes || null,
              last_updated: new Date().toISOString()
            })
            .eq('inventory_id', existingInventory.inventory_id);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('store_inventory')
            .insert([payload]);

          if (error) throw error;
        }

        toast.success('Inventory added successfully');
      }

      const existingInventoryForLog = inventory.find(
        (inv) =>
          inv.material_id === inventoryForm.material_id &&
          inv.variant_id === inventoryForm.variant_id
      );

      const { error: movementLogError } = await supabase
        .from('material_movement_logs')
        .insert({
          material_id: inventoryForm.material_id,
          variant_id: inventoryForm.variant_id,
          movement_type: 'Store In',
          quantity: totalQuantity,
          number_of_units: units,
          reference_type: inventoryForm.inventory_id || existingInventoryForLog ? 'Manual Adjustment' : 'Initial Stock',
          reference_id: inventoryForm.inventory_id,
          notes: stockNotes || (inventoryForm.inventory_id ? 'Inventory manually adjusted in store page' : 'Stock added from store page'),
          movement_date: new Date().toISOString()
        });

      if (movementLogError) {
        toast.error('Inventory saved, but failed to create stock entry log: ' + movementLogError.message);
      }

      setIsInventoryDialogOpen(false);
      resetInventoryForm();
      fetchInventory();
      fetchStockEntryLogs();
    } catch (error: any) {
      toast.error('Failed to save inventory: ' + error.message);
    }
  };

  const openFulfillDialog = (request: MaterialRequest) => {
    setSelectedRequest(request);
    setApprovalNotes('');
    setFulfillQty(String(request.requested_quantity));
    setFulfillmentUnits([]); // legacy, unused by new flow
    setIsFulfillDialogOpen(true);
  };

  const handleApproveRequest = async () => {
    if (!selectedRequest) return;

    const qty = parseFloat(fulfillQty);
    if (!qty || qty <= 0) {
      toast.error('Fulfill quantity must be > 0');
      return;
    }

    try {
      // 1. Mark the request approved with the approved quantity.
      const { error: reqError } = await supabase
        .from('material_requests')
        .update({
          status: 'Approved',
          approved_at: new Date().toISOString(),
          approval_notes: approvalNotes.trim() || null,
          fulfilled_quantity: qty,
        })
        .eq('request_id', selectedRequest.request_id);
      if (reqError) throw reqError;

      // 2. FIFO-allocate from store to project.
      const { data: rpcData, error: rpcErr } = await supabase.rpc('allocate_material_fifo', {
        p_material_id: Number(selectedRequest.material_id),
        p_project_id:  Number(selectedRequest.project_id),
        p_required_qty: qty,
      });
      if (rpcErr) throw rpcErr;

      const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      const allocationId = result?.allocation_id;
      const totalCost    = Number(result?.total_cost || 0);

      // 3. Stamp allocation metadata to link back to the request.
      if (allocationId) {
        const noteParts: string[] = [`Fulfills request ${selectedRequest.request_number}`];
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

      // 4. Mark the request Fulfilled.
      await supabase
        .from('material_requests')
        .update({ status: 'Fulfilled', fulfilled_at: new Date().toISOString() })
        .eq('request_id', selectedRequest.request_id);

      toast.success(`Request fulfilled — FIFO cost Rs. ${totalCost.toFixed(2)}`);
      setIsFulfillDialogOpen(false);
      fetchAll();
    } catch (error: any) {
      toast.error('Failed to approve request: ' + error.message);
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

  const resetReductionForm = () => {
    setReductionForm({
      material_id: null,
      variant_id: null,
      number_of_units: '',
      remarks: ''
    });
  };

  const handleReduceStock = async () => {
    try {
      if (!reductionForm.material_id || !reductionForm.variant_id) {
        toast.error('Please select material and variant');
        return;
      }

      if (!reductionForm.number_of_units || parseFloat(reductionForm.number_of_units) <= 0) {
        toast.error('Please enter valid units to remove');
        return;
      }

      if (!reductionForm.remarks.trim()) {
        toast.error('Remarks are mandatory for stock reduction');
        return;
      }

      const unitsToReduce = parseFloat(reductionForm.number_of_units);
      const selectedInventory = inventory.find(
        (inv) =>
          inv.material_id === reductionForm.material_id &&
          inv.variant_id === reductionForm.variant_id
      );

      if (!selectedInventory) {
        toast.error('Inventory item not found');
        return;
      }

      if (unitsToReduce > selectedInventory.number_of_units) {
        toast.error('Cannot reduce more units than available');
        return;
      }

      const variant = variants.find((v) => v.variant_id === reductionForm.variant_id);
      if (!variant) {
        toast.error('Selected variant details not found');
        return;
      }

      const quantityToReduce = unitsToReduce * variant.quantity_per_unit;
      const remainingUnits = selectedInventory.number_of_units - unitsToReduce;
      const remainingQuantity = selectedInventory.total_quantity - quantityToReduce;

      setIsReducingStock(true);

      const { error: movementLogError } = await supabase
        .from('material_movement_logs')
        .insert({
          material_id: selectedInventory.material_id,
          variant_id: selectedInventory.variant_id,
          movement_type: 'Store Out',
          quantity: quantityToReduce,
          number_of_units: unitsToReduce,
          reference_type: 'Manual Adjustment',
          reference_id: selectedInventory.inventory_id,
          notes: `Stock reduced from store. Remarks: ${reductionForm.remarks.trim()}`,
          movement_date: new Date().toISOString()
        });

      if (movementLogError) throw movementLogError;

      if (remainingUnits <= 0) {
        const { error: deleteError } = await supabase
          .from('store_inventory')
          .delete()
          .eq('inventory_id', selectedInventory.inventory_id);

        if (deleteError) throw deleteError;
      } else {
        const { error: updateError } = await supabase
          .from('store_inventory')
          .update({
            number_of_units: remainingUnits,
            total_quantity: remainingQuantity,
            last_updated: new Date().toISOString()
          })
          .eq('inventory_id', selectedInventory.inventory_id);

        if (updateError) throw updateError;
      }

      toast.success('Stock reduced successfully');
      resetReductionForm();
      fetchInventory();
      fetchStockEntryLogs();
    } catch (error: any) {
      toast.error('Failed to reduce stock: ' + error.message);
    } finally {
      setIsReducingStock(false);
    }
  };

  const resetInventoryForm = () => {
    setInventoryForm({
      inventory_id: null,
      material_id: null,
      variant_id: null,
      number_of_units: '',
      location: '',
      notes: '',
      purchase_order_date: '',
      invoice_number: '',
      amount_per_unit: '',
      gst: ''
    });
    setStockBillFile(null);
  };

  const openNewInventory = () => {
    resetInventoryForm();
    setIsInventoryDialogOpen(true);
  };

  const getVariantsForMaterial = (materialId: number | null) => {
    if (!materialId) return [];
    return variants.filter(v => v.material_id === materialId);
  };

  const unitsForPrice = parseFloat(inventoryForm.number_of_units);
  const validUnitsForPrice = Number.isFinite(unitsForPrice) && unitsForPrice > 0 ? unitsForPrice : 0;

  const amountPerUnitForPrice = parseFloat(inventoryForm.amount_per_unit);
  const validAmountPerUnitForPrice = Number.isFinite(amountPerUnitForPrice) && amountPerUnitForPrice >= 0 ? amountPerUnitForPrice : 0;

  const basePrice = validUnitsForPrice * validAmountPerUnitForPrice;
  const gstInput = inventoryForm.gst.trim();
  const todayDate = new Date().toISOString().split('T')[0];

  let gstAmount = 0;
  let gstDisplay = '-';

  if (gstInput) {
    if (gstInput.includes('%')) {
      const gstRate = parseFloat(gstInput.replace('%', '').trim());
      if (Number.isFinite(gstRate) && gstRate >= 0) {
        gstAmount = (basePrice * gstRate) / 100;
        gstDisplay = `${gstRate}%`;
      }
    } else {
      const fixedGst = parseFloat(gstInput);
      if (Number.isFinite(fixedGst) && fixedGst >= 0) {
        gstAmount = fixedGst;
        gstDisplay = 'Fixed';
      }
    }
  }

  const totalPrice = basePrice + gstAmount;
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
              <CardHeader className="border-b bg-slate-50">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-blue-600" />
                  Stock Entry Logs ({stockEntryLogs.length})
                </CardTitle>
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
                      {stockEntryLogs.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="px-4 py-8 text-center text-slate-500">
                            No stock entry logs found
                          </td>
                        </tr>
                      ) : (
                        stockEntryLogs.map((log) => {
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
                                <Badge className={log.movement_type === 'Store Out' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
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
                                <span className={`font-semibold ${log.movement_type === 'Store Out' ? 'text-red-700' : 'text-slate-900'}`}>
                                  {log.movement_type === 'Store Out' ? '-' : ''}
                                  {log.quantity}
                                </span>
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
        <DialogContent className="bg-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fulfill Material Request</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4 py-4">
              <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                <p><span className="font-semibold">Request:</span> {selectedRequest.request_number}</p>
                <p><span className="font-semibold">Project:</span> {selectedRequest.project_name}</p>
                <p><span className="font-semibold">Material:</span> {selectedRequest.material_name}</p>
                <p><span className="font-semibold">Requested Quantity:</span> {selectedRequest.requested_quantity} {selectedRequest.metric}</p>
              </div>

              <div className="space-y-2">
                <Label>Quantity to Fulfill *</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={fulfillQty}
                  onChange={(e) => setFulfillQty(e.target.value)}
                  className="bg-white"
                  placeholder={`${selectedRequest.requested_quantity}`}
                />
                <p className="text-xs text-slate-500">
                  Stock will be allocated from the store using FIFO across price variants (oldest purchase first). Cost is calculated at the exact variant prices consumed.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Approval Notes</Label>
                <Textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Optional notes about this fulfillment"
                  className="bg-white"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleApproveRequest} className="flex-1 bg-green-600 hover:bg-green-700">
                  <Check className="h-4 w-4 mr-2" /> Approve & Fulfill
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
