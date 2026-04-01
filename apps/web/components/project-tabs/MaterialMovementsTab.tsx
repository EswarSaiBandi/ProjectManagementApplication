'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Package, Search, Filter } from 'lucide-react';

type MaterialMovementLog = {
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
  created_by: string | null;
  material_name?: string;
  metric?: string;
  variant_name?: string;
  quantity_per_unit?: number;
};

export default function MaterialMovementsTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [movements, setMovements] = useState<MaterialMovementLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');

  const fetchMovements = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('material_movement_logs')
        .select(`
          *,
          materials_master(material_name, metric),
          material_variants(variant_name, quantity_per_unit)
        `)
        .eq('project_id', numericProjectId)
        .order('movement_date', { ascending: false });

      if (error) {
        console.error('Fetch movements error:', error);
        toast.error(`Failed to load material movements: ${error.message}`);
        setMovements([]);
      } else {
        const mapped = (data || []).map((m: any) => ({
          ...m,
          material_name: m.materials_master?.material_name,
          metric: m.materials_master?.metric,
          variant_name: m.material_variants?.variant_name,
          quantity_per_unit: m.material_variants?.quantity_per_unit,
        }));
        setMovements(mapped as MaterialMovementLog[]);
      }
    } catch (err) {
      console.error('Unexpected error fetching movements:', err);
      toast.error('Failed to load material movements');
      setMovements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (detail?.projectId === projectId) fetchMovements();
    };
    window.addEventListener('material-movements-updated', handler);
    return () => window.removeEventListener('material-movements-updated', handler);
  }, [projectId]);

  const filteredMovements = movements.filter(m => {
    const matchesSearch = (m.material_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (m.variant_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (m.notes || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = movementTypeFilter === 'all' || m.movement_type === movementTypeFilter;
    return matchesSearch && matchesFilter;
  });

  const getMovementColor = (type: string) => {
    switch (type) {
      case 'Store In': return 'bg-green-100 text-green-800 border-green-300';
      case 'Store Out': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'Project In': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'Project Out': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'Return to Store': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'Local Procurement': return 'bg-teal-100 text-teal-800 border-teal-300';
      case 'Stock Used': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-white shadow-sm">
        <CardHeader className="border-b bg-slate-50">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            Material Movements (Inward & Outward)
          </CardTitle>
          <p className="text-sm text-slate-600 mt-1">
            All material movements tracked for this project - requests, fulfillment, returns, and stock usage
          </p>
        </CardHeader>

        <CardContent className="pt-6">
          {/* Filters */}
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search materials, variants, notes..."
                className="pl-10 bg-white"
              />
            </div>
            <div className="w-64">
              <Select value={movementTypeFilter} onValueChange={setMovementTypeFilter}>
                <SelectTrigger className="bg-white">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="all">All Movements</SelectItem>
                  <SelectItem value="Store In">Store In</SelectItem>
                  <SelectItem value="Store Out">Store Out</SelectItem>
                  <SelectItem value="Project In">Project In (Request Fulfilled)</SelectItem>
                  <SelectItem value="Project Out">Project Out</SelectItem>
                  <SelectItem value="Return to Store">Return to Store</SelectItem>
                  <SelectItem value="Local Procurement">Local Procurement</SelectItem>
                  <SelectItem value="Stock Used">Stock Used</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Movement Logs Table */}
          {loading ? (
            <div className="text-center py-8 text-slate-500">Loading movements...</div>
          ) : filteredMovements.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No material movements found</p>
              <p className="text-xs text-slate-400 mt-1">
                {searchQuery || movementTypeFilter !== 'all' ? 'Try adjusting your filters' : 'Material movements will appear here'}
              </p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead className="w-[180px]">Movement Type</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead className="text-right w-[100px]">Units</TableHead>
                    <TableHead className="text-right w-[120px]">Quantity</TableHead>
                    <TableHead className="w-[120px]">Reference</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMovements.map((m) => (
                    <TableRow key={m.log_id} className="hover:bg-slate-50">
                      <TableCell className="text-sm text-slate-600">
                        {new Date(m.movement_date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${getMovementColor(m.movement_type)} border`}>
                          {m.movement_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{m.material_name || '—'}</TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {m.variant_name ? (
                          <div>
                            {m.variant_name}
                            {m.quantity_per_unit && (
                              <span className="text-xs text-slate-500"> ({m.quantity_per_unit} {m.metric})</span>
                            )}
                          </div>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {m.number_of_units !== null ? m.number_of_units : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {m.quantity.toFixed(2)} {m.metric}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {m.reference_type || '—'}
                        {m.reference_id && <div className="text-slate-400">#{m.reference_id}</div>}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 max-w-xs truncate">
                        {m.notes || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Summary */}
          {filteredMovements.length > 0 && (
            <div className="mt-4 flex justify-between items-center text-sm text-slate-600 px-2">
              <div>
                Showing <strong>{filteredMovements.length}</strong> of <strong>{movements.length}</strong> movements
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
