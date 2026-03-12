'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { ArrowDownUp, ArrowDown, ArrowUp, RefreshCw, Package } from 'lucide-react';
import { toast } from 'sonner';

interface MovementLog {
  log_id: number;
  material_id: number;
  variant_id: number | null;
  movement_type: string;
  project_id: number | null;
  quantity: number;
  number_of_units: number | null;
  reference_type: string | null;
  reference_id: number | null;
  notes: string | null;
  movement_date: string;
  material_name?: string;
  metric?: string;
  variant_name?: string;
  project_name?: string;
}

type ParsedMovementNotes = {
  poDate: string;
  invoiceNumber: string;
  amountPerUnit: string;
  gst: string;
  remarks: string;
  rawText: string;
  hasStructuredStockMeta: boolean;
};

export default function MovementLogsTab({ projectId }: { projectId?: string }) {
  
  const [logs, setLogs] = useState<MovementLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<MovementLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<MovementLog | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, [projectId]);

  useEffect(() => {
    applyFilter();
  }, [filterType, logs]);

  const fetchLogs = async () => {
    try {
      let query = supabase
        .from('material_movement_logs')
        .select(`
          *,
          materials_master!inner(material_name, metric),
          material_variants(variant_name),
          projects(project_name)
        `)
        .order('movement_date', { ascending: false });
      
      if (projectId) {
        query = query.eq('project_id', projectId);
      }

      const { data, error } = await query.limit(200);
      
      if (error) throw error;
      
      const logsWithDetails = (data || []).map((log: any) => ({
        ...log,
        material_name: log.materials_master?.material_name,
        metric: log.materials_master?.metric,
        variant_name: log.material_variants?.variant_name,
        project_name: log.projects?.project_name
      }));
      
      setLogs(logsWithDetails);
      setFilteredLogs(logsWithDetails);
    } catch (error: any) {
      toast.error('Failed to load movement logs: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = () => {
    if (filterType === 'all') {
      setFilteredLogs(logs);
    } else if (filterType === 'Stock Reduction') {
      setFilteredLogs(
        logs.filter(
          (log) => log.movement_type === 'Store Out' && log.reference_type === 'Manual Adjustment'
        )
      );
    } else {
      setFilteredLogs(logs.filter(log => log.movement_type === filterType));
    }
  };

  const getDisplayMovementType = (log: MovementLog) => {
    if (log.movement_type === 'Store Out' && log.reference_type === 'Manual Adjustment') {
      return 'Stock Reduction';
    }
    return log.movement_type;
  };

  const getMovementIcon = (type: string) => {
    switch (type) {
      case 'Store In':
        return <ArrowDown className="h-4 w-4 text-green-600" />;
      case 'Store Out':
        return <ArrowUp className="h-4 w-4 text-orange-600" />;
      case 'Stock Reduction':
        return <ArrowUp className="h-4 w-4 text-red-600" />;
      case 'Project In':
        return <ArrowDown className="h-4 w-4 text-blue-600" />;
      case 'Project Out':
        return <ArrowUp className="h-4 w-4 text-red-600" />;
      case 'Return to Store':
        return <RefreshCw className="h-4 w-4 text-purple-600" />;
      case 'Local Procurement':
        return <Package className="h-4 w-4 text-teal-600" />;
      case 'Stock Used':
        return <Package className="h-4 w-4 text-amber-600" />;
      default:
        return <ArrowDownUp className="h-4 w-4 text-slate-600" />;
    }
  };

  const getMovementColor = (type: string) => {
    switch (type) {
      case 'Store In':
        return 'bg-green-100 text-green-700';
      case 'Store Out':
        return 'bg-orange-100 text-orange-700';
      case 'Stock Reduction':
        return 'bg-red-100 text-red-700';
      case 'Project In':
        return 'bg-blue-100 text-blue-700';
      case 'Project Out':
        return 'bg-red-100 text-red-700';
      case 'Return to Store':
        return 'bg-purple-100 text-purple-700';
      case 'Local Procurement':
        return 'bg-teal-100 text-teal-700';
      case 'Stock Used':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  const parseMovementNotes = (notes: string | null): ParsedMovementNotes => {
    if (!notes || !notes.trim()) {
      return {
        poDate: '-',
        invoiceNumber: '-',
        amountPerUnit: '-',
        gst: '-',
        remarks: '-',
        rawText: '-',
        hasStructuredStockMeta: false
      };
    }

    const trimmed = notes.trim();
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
    const metaLine = lines.find((line) => line.startsWith('[STOCK_META]'));

    if (metaLine) {
      try {
        const metaRaw = metaLine.replace('[STOCK_META]', '');
        const meta = JSON.parse(metaRaw) as {
          poDate?: string;
          invoiceNumber?: string;
          amountPerUnit?: string;
          gst?: string;
          remarks?: string;
        };

        return {
          poDate: meta.poDate?.trim() || '-',
          invoiceNumber: meta.invoiceNumber?.trim() || '-',
          amountPerUnit: meta.amountPerUnit?.trim() || '-',
          gst: meta.gst?.trim() || '-',
          remarks: meta.remarks?.trim() || '-',
          rawText: '-',
          hasStructuredStockMeta: true
        };
      } catch {
        // Fall back to raw note display when metadata is malformed.
      }
    }

    return {
      poDate: '-',
      invoiceNumber: '-',
      amountPerUnit: '-',
      gst: '-',
      remarks: '-',
      rawText: trimmed,
      hasStructuredStockMeta: false
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="text-slate-500">Loading movement logs...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-white shadow-sm">
        <CardHeader className="border-b bg-slate-50">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ArrowDownUp className="h-5 w-5 text-blue-600" />
              Material Movement Logs {projectId && '(This Project)'}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[200px] bg-white">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="all">All Movements</SelectItem>
                  <SelectItem value="Store In">Store In</SelectItem>
                  <SelectItem value="Store Out">Store Out</SelectItem>
                  <SelectItem value="Stock Reduction">Stock Reduction</SelectItem>
                  <SelectItem value="Project In">Project In</SelectItem>
                  <SelectItem value="Project Out">Project Out</SelectItem>
                  <SelectItem value="Return to Store">Return to Store</SelectItem>
                  <SelectItem value="Local Procurement">Local Procurement</SelectItem>
                  <SelectItem value="Stock Used">Stock Used</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="outline" className="px-3 py-1">
                {filteredLogs.length} {filteredLogs.length === 1 ? 'log' : 'logs'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Date & Time</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Movement Type</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Material</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700">Quantity</th>
                  {!projectId && <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Project</th>}
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Reference</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={projectId ? 6 : 7} className="px-4 py-8 text-center text-slate-500">
                      No movement logs found
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    (() => {
                      const displayType = getDisplayMovementType(log);
                      return (
                    <tr
                      key={log.log_id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => {
                        setSelectedLog(log);
                        setIsDetailsOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedLog(log);
                          setIsDetailsOpen(true);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title="Click to view full details"
                    >
                      <td className="px-4 py-3 text-sm text-slate-900">
                        {new Date(log.movement_date).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={getMovementColor(displayType)}>
                          {getMovementIcon(displayType)}
                          <span className="ml-1">{displayType}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="font-medium text-slate-900">{log.material_name}</div>
                        {log.variant_name && (
                          <div className="text-xs text-slate-500">{log.variant_name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <div className="font-semibold text-slate-900">
                          {log.quantity} {log.metric}
                        </div>
                        {log.number_of_units && (
                          <div className="text-xs text-slate-500">
                            {log.number_of_units} {log.number_of_units === 1 ? 'unit' : 'units'}
                          </div>
                        )}
                      </td>
                      {!projectId && (
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {log.project_name || '-'}
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {log.reference_type ? (
                          <Badge variant="outline" className="text-xs">
                            {log.reference_type}
                          </Badge>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">
                        {log.notes || '-'}
                      </td>
                    </tr>
                      );
                    })()
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="bg-white max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Movement Log Details</DialogTitle>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 py-2">
              {(() => {
                const parsedNotes = parseMovementNotes(selectedLog.notes);
                return (
                  <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-slate-500">Log ID</p>
                  <p className="font-medium text-slate-900">{selectedLog.log_id}</p>
                </div>
                <div>
                  <p className="text-slate-500">Date & Time</p>
                  <p className="font-medium text-slate-900">{new Date(selectedLog.movement_date).toLocaleString()}</p>
                </div>

                <div>
                  <p className="text-slate-500">Movement Type</p>
                  <p className="font-medium text-slate-900">{getDisplayMovementType(selectedLog)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Project</p>
                  <p className="font-medium text-slate-900">{selectedLog.project_name || '-'}</p>
                </div>

                <div>
                  <p className="text-slate-500">Material</p>
                  <p className="font-medium text-slate-900">{selectedLog.material_name || '-'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Variant</p>
                  <p className="font-medium text-slate-900">{selectedLog.variant_name || '-'}</p>
                </div>

                <div>
                  <p className="text-slate-500">Quantity</p>
                  <p className="font-medium text-slate-900">
                    {selectedLog.quantity} {selectedLog.metric || ''}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Units</p>
                  <p className="font-medium text-slate-900">{selectedLog.number_of_units ?? '-'}</p>
                </div>

                <div>
                  <p className="text-slate-500">Material ID</p>
                  <p className="font-medium text-slate-900">{selectedLog.material_id}</p>
                </div>
                <div>
                  <p className="text-slate-500">Variant ID</p>
                  <p className="font-medium text-slate-900">{selectedLog.variant_id ?? '-'}</p>
                </div>

                <div>
                  <p className="text-slate-500">Reference Type</p>
                  <p className="font-medium text-slate-900">{selectedLog.reference_type || '-'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Reference ID</p>
                  <p className="font-medium text-slate-900">{selectedLog.reference_id ?? '-'}</p>
                </div>
              </div>

              <div>
                <p className="text-sm text-slate-500">Notes</p>
                {parsedNotes.hasStructuredStockMeta ? (
                  <div className="mt-1 rounded-md border bg-slate-50 p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-slate-500">PO Date</p>
                        <p className="font-medium text-slate-900">{parsedNotes.poDate}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Invoice Number</p>
                        <p className="font-medium text-slate-900">{parsedNotes.invoiceNumber}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Amount Per Unit</p>
                        <p className="font-medium text-slate-900">{parsedNotes.amountPerUnit}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">GST</p>
                        <p className="font-medium text-slate-900">{parsedNotes.gst}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <p className="text-slate-500 text-sm">Remarks</p>
                      <p className="text-sm font-medium text-slate-900 whitespace-pre-wrap break-words">
                        {parsedNotes.remarks}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-slate-900 whitespace-pre-wrap break-words">
                    {parsedNotes.rawText}
                  </p>
                )}
              </div>
                  </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
