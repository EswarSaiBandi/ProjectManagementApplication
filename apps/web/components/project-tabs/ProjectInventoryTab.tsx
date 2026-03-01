'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, ShoppingCart, TrendingDown, CheckCircle, Clock } from 'lucide-react';

type MaterialRequest = {
  request_id: number;
  request_number: string;
  material_name: string;
  requested_quantity: number;
  fulfilled_quantity: number | null;
  metric: string;
  request_source: string;
  status: string;
  created_at: string;
};

type StockUsed = {
  id: number;
  material_name: string;
  variant_name: string;
  quantity_used: number;
  metric: string;
  used_date: string;
  notes: string | null;
};

type MaterialReturn = {
  return_id: number;
  return_number: string;
  material_name: string;
  variant_name: string | null;
  returned_quantity: number;
  metric: string;
  condition: string;
  status: string;
  created_at: string;
};

type ProjectInventoryItem = {
  variant_id: number;
  material_name: string;
  variant_name: string;
  quantity_per_unit: number;
  metric: string;
  allocated_units: number;
  used_units: number;
  returned_units: number;
  available_units: number;
};

export default function ProjectInventoryTab({ projectId }: { projectId: string }) {
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [stockUsed, setStockUsed] = useState<StockUsed[]>([]);
  const [returns, setReturns] = useState<MaterialReturn[]>([]);
  const [inventory, setInventory] = useState<ProjectInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllData();
  }, [projectId]);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([fetchInventory(), fetchRequests(), fetchStockUsed(), fetchReturns()]);
    setLoading(false);
  };

  const fetchInventory = async () => {
    try {
      const { data, error } = await supabase
        .from('project_inventory')
        .select(`
          *,
          material_variants!inner(
            variant_name,
            quantity_per_unit,
            materials_master!inner(material_name, metric)
          )
        `)
        .eq('project_id', projectId)
        .order('available_units', { ascending: false });

      if (!error && data) {
        setInventory(data.map((inv: any) => ({
          variant_id: inv.variant_id,
          material_name: inv.material_variants?.materials_master?.material_name || 'Unknown',
          variant_name: inv.material_variants?.variant_name || 'Unknown',
          quantity_per_unit: inv.material_variants?.quantity_per_unit || 0,
          metric: inv.material_variants?.materials_master?.metric || '',
          allocated_units: inv.allocated_units,
          used_units: inv.used_units,
          returned_units: inv.returned_units,
          available_units: inv.available_units
        })));
      }
    } catch (error: any) {
      console.error('Error fetching inventory:', error);
    }
  };

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('material_requests')
        .select(`
          request_id,
          request_number,
          requested_quantity,
          fulfilled_quantity,
          request_source,
          status,
          created_at,
          materials_master!inner(material_name, metric)
        `)
        .eq('project_id', projectId)
        .in('status', ['Fulfilled', 'Approved'])
        .order('created_at', { ascending: false });

      if (!error && data) {
        setRequests(data.map((r: any) => ({
          ...r,
          material_name: r.materials_master?.material_name || 'Unknown',
          metric: r.materials_master?.metric || ''
        })));
      }
    } catch (error: any) {
      console.error('Error fetching requests:', error);
    }
  };

  const fetchStockUsed = async () => {
    try {
      const { data, error } = await supabase
        .from('project_stock_used')
        .select(`
          *,
          material_variants!inner(
            variant_name,
            materials_master!inner(material_name, metric)
          )
        `)
        .eq('project_id', projectId)
        .order('used_date', { ascending: false });

      if (!error && data) {
        setStockUsed(data.map((s: any) => ({
          ...s,
          material_name: s.material_variants?.materials_master?.material_name || 'Unknown',
          variant_name: s.material_variants?.variant_name || 'Unknown',
          metric: s.material_variants?.materials_master?.metric || ''
        })));
      }
    } catch (error: any) {
      console.error('Error fetching stock used:', error);
    }
  };

  const fetchReturns = async () => {
    try {
      const { data, error } = await supabase
        .from('material_returns')
        .select(`
          *,
          materials_master!inner(material_name, metric),
          material_variants(variant_name)
        `)
        .eq('project_id', projectId)
        .eq('status', 'Accepted')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setReturns(data.map((r: any) => ({
          ...r,
          material_name: r.materials_master?.material_name || 'Unknown',
          variant_name: r.material_variants?.variant_name || null,
          metric: r.materials_master?.metric || ''
        })));
      }
    } catch (error: any) {
      console.error('Error fetching returns:', error);
    }
  };

  const totalAllocated = requests.reduce((sum, r) => sum + (r.fulfilled_quantity || 0), 0);
  const totalUsed = stockUsed.reduce((sum, s) => sum + s.quantity_used, 0);
  const totalReturned = returns.reduce((sum, r) => sum + r.returned_quantity, 0);
  const netUsed = totalAllocated - totalReturned;

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading inventory...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-blue-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-blue-600 mb-1">Materials Allocated</div>
                <div className="text-2xl font-bold text-blue-700">{totalAllocated.toFixed(2)}</div>
                <div className="text-xs text-slate-500 mt-1">{requests.length} requests</div>
              </div>
              <ShoppingCart className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-orange-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-orange-600 mb-1">Stock Consumed</div>
                <div className="text-2xl font-bold text-orange-700">{totalUsed.toFixed(2)}</div>
                <div className="text-xs text-slate-500 mt-1">{stockUsed.length} entries</div>
              </div>
              <TrendingDown className="h-8 w-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-green-600 mb-1">Returned to Store</div>
                <div className="text-2xl font-bold text-green-700">{totalReturned.toFixed(2)}</div>
                <div className="text-xs text-slate-500 mt-1">{returns.length} returns</div>
              </div>
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-purple-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-purple-600 mb-1">Net Material Used</div>
                <div className="text-2xl font-bold text-purple-700">{netUsed.toFixed(2)}</div>
                <div className="text-xs text-slate-500 mt-1">Allocated - Returned</div>
              </div>
              <Package className="h-8 w-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Tabs */}
      <Tabs defaultValue="current" className="space-y-4">
        <TabsList>
          <TabsTrigger value="current">
            <Package className="h-4 w-4 mr-2" />
            Current Inventory ({inventory.length})
          </TabsTrigger>
          <TabsTrigger value="allocated">
            <ShoppingCart className="h-4 w-4 mr-2" />
            Allocated ({requests.length})
          </TabsTrigger>
          <TabsTrigger value="consumed">
            <TrendingDown className="h-4 w-4 mr-2" />
            Consumed ({stockUsed.length})
          </TabsTrigger>
          <TabsTrigger value="returned">
            <CheckCircle className="h-4 w-4 mr-2" />
            Returned ({returns.length})
          </TabsTrigger>
        </TabsList>

        {/* Current Inventory Tab */}
        <TabsContent value="current" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Current Project Inventory (Available Stock)</CardTitle>
            </CardHeader>
            <CardContent>
              {inventory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No materials allocated to this project yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-center">Allocated</TableHead>
                      <TableHead className="text-center">Used</TableHead>
                      <TableHead className="text-center">Returned</TableHead>
                      <TableHead className="text-center bg-green-50">Available</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map((inv) => (
                      <TableRow key={inv.variant_id} className={inv.available_units <= 0 ? 'opacity-50' : ''}>
                        <TableCell className="font-medium">{inv.material_name}</TableCell>
                        <TableCell>
                          {inv.variant_name}
                          <div className="text-xs text-slate-500 mt-1">
                            {inv.quantity_per_unit} {inv.metric} per unit
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{inv.allocated_units.toFixed(2)} units</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                            {inv.used_units.toFixed(2)} units
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                            {inv.returned_units.toFixed(2)} units
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center bg-green-50">
                          <Badge className={inv.available_units > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                            {inv.available_units.toFixed(2)} units
                          </Badge>
                          <div className="text-xs text-slate-500 mt-1">
                            {(inv.available_units * inv.quantity_per_unit).toFixed(2)} {inv.metric}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Material Requests Tab */}
        <TabsContent value="allocated" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Materials Allocated to Project</CardTitle>
            </CardHeader>
            <CardContent>
              {requests.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No materials allocated yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request #</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead className="text-center">Requested</TableHead>
                      <TableHead className="text-center">Fulfilled</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((req) => (
                      <TableRow key={req.request_id}>
                        <TableCell className="font-mono text-sm">{req.request_number}</TableCell>
                        <TableCell className="font-medium">{req.material_name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{req.requested_quantity} {req.metric}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="default" className="bg-green-100 text-green-700">
                            {req.fulfilled_quantity || 0} {req.metric}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={req.request_source === 'Store' ? 'bg-blue-100 text-blue-700' : 'bg-teal-100 text-teal-700'}>
                            {req.request_source}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-green-100 text-green-700">{req.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {new Date(req.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stock Used Tab */}
        <TabsContent value="consumed" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Materials Consumed in Project</CardTitle>
            </CardHeader>
            <CardContent>
              {stockUsed.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No stock usage recorded yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-center">Quantity</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockUsed.map((stock) => (
                      <TableRow key={stock.id}>
                        <TableCell className="font-medium">{stock.material_name}</TableCell>
                        <TableCell>{stock.variant_name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{stock.quantity_used} {stock.metric}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {new Date(stock.used_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 max-w-xs truncate">
                          {stock.notes || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Returns Tab */}
        <TabsContent value="returned" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Materials Returned to Store (Accepted)</CardTitle>
            </CardHeader>
            <CardContent>
              {returns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No accepted returns yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Return #</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-center">Quantity</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returns.map((ret) => (
                      <TableRow key={ret.return_id}>
                        <TableCell className="font-mono text-sm">{ret.return_number}</TableCell>
                        <TableCell className="font-medium">{ret.material_name}</TableCell>
                        <TableCell>{ret.variant_name || '—'}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{ret.returned_quantity} {ret.metric}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            ret.condition === 'Excellent' ? 'bg-green-100 text-green-700' :
                            ret.condition === 'Good' ? 'bg-blue-100 text-blue-700' :
                            'bg-yellow-100 text-yellow-700'
                          }>
                            {ret.condition}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {new Date(ret.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
