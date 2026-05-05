'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, IndianRupee } from 'lucide-react';

type Row = {
  material_id: number;
  material_name: string;
  metric: string;
  material_is_active: boolean;
  total_variants: number;
  active_variants: number;
  total_available: number;
  total_received: number;
  total_stock_value: number;
  min_price_in_stock: number | null;
  max_price_in_stock: number | null;
};

export default function StoreInventoryAggregateTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_stock' | 'out_of_stock' | 'inactive'>('all');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('store_stock_by_material')
      .select('*')
      .order('material_name');

    if (error) { toast.error('Failed to load inventory: ' + error.message); setRows([]); }
    else setRows((data as Row[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const q = search.trim().toLowerCase();
  const visibleRows = rows.filter((r) => {
    if (q && !r.material_name.toLowerCase().includes(q)) return false;
    if (statusFilter === 'in_stock'     && !(r.material_is_active && Number(r.total_available) > 0))  return false;
    if (statusFilter === 'out_of_stock' && !(r.material_is_active && Number(r.total_available) <= 0)) return false;
    if (statusFilter === 'inactive'     && r.material_is_active)                                       return false;
    return true;
  });

  const totalValue = visibleRows.reduce((s, r) => s + Number(r.total_stock_value || 0), 0);
  const totalMaterials = visibleRows.filter((r) => r.total_available > 0).length;

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="border-b bg-slate-50">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            Store Inventory (Aggregated per Material)
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search material"
              className="w-[220px] bg-white"
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-[160px] bg-white">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-white">
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="in_stock">In stock</SelectItem>
                <SelectItem value="out_of_stock">Out of stock</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-sm text-slate-600">
              <span className="mr-4">{totalMaterials} material{totalMaterials === 1 ? '' : 's'} in stock</span>
              <span>Total value: <IndianRupee className="inline h-3 w-3" />{totalValue.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Stock totals are summed across all price variants per material. To add stock, create variants or top up an existing one from the <strong>Price Variants</strong> tab.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 text-slate-500 text-sm">Loading…</div>
        ) : visibleRows.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <Package className="h-10 w-10 mx-auto mb-2 text-slate-300" />
            <p className="font-medium">No materials configured.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Material</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Variants</TableHead>
                <TableHead className="text-right">Received (total)</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Price Range</TableHead>
                <TableHead className="text-right">Stock Value</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r) => {
                const hasStock = Number(r.total_available) > 0;
                const priceRange = r.min_price_in_stock == null
                  ? '—'
                  : r.min_price_in_stock === r.max_price_in_stock
                    ? `Rs. ${Number(r.min_price_in_stock).toFixed(2)}`
                    : `Rs. ${Number(r.min_price_in_stock).toFixed(2)} – ${Number(r.max_price_in_stock).toFixed(2)}`;
                return (
                  <TableRow key={r.material_id} className={!hasStock ? 'opacity-60' : ''}>
                    <TableCell className="font-medium">{r.material_name}</TableCell>
                    <TableCell>{r.metric}</TableCell>
                    <TableCell className="text-right">
                      {r.active_variants}/{r.total_variants}
                      <span className="text-xs text-slate-500 ml-1">active</span>
                    </TableCell>
                    <TableCell className="text-right">{Number(r.total_received).toFixed(3)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {Number(r.total_available).toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right">{priceRange}</TableCell>
                    <TableCell className="text-right">
                      Rs. {Number(r.total_stock_value).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {!r.material_is_active ? (
                        <Badge variant="outline" className="text-slate-400">Inactive</Badge>
                      ) : hasStock ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">In Stock</Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">Out</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
