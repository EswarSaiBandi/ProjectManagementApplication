'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Store, ShoppingCart, Package, TrendingUp, AlertCircle, Search, RefreshCw } from 'lucide-react';

type InventoryItem = {
  material_id: number;
  material_name: string;
  unit: string | null;
  in_store_quantity: number;
  market_purchase_quantity: number;
  total_quantity: number;
  in_store_allocated: number;
  market_allocated: number;
  in_store_available: number;
  market_available: number;
  total_available: number;
  project_allocations: Array<{
    project_id: number;
    project_name: string;
    allocated: number;
    source: string;
  }>;
};

export default function InventoryTab({ projectId }: { projectId: string }) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchInventory = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('inventory_realtime_status')
      .select('*')
      .order('material_name');

    if (error) {
      console.error('Fetch inventory error:', error);
      toast.error('Failed to load inventory');
      setInventory([]);
    } else {
      setInventory((data || []) as InventoryItem[]);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchInventory();
    // Set up real-time refresh every 10 seconds
    const interval = setInterval(fetchInventory, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredInventory = inventory.filter((item) =>
    item.material_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalInStore = inventory.reduce((sum, item) => sum + item.in_store_quantity, 0);
  const totalMarket = inventory.reduce((sum, item) => sum + item.market_purchase_quantity, 0);
  const totalAllocated = inventory.reduce((sum, item) => sum + item.in_store_allocated + item.market_allocated, 0);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="bg-blue-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-blue-600 mb-1">In-Store Stock</div>
                <div className="text-2xl font-bold text-blue-700">{totalInStore.toFixed(0)}</div>
                <div className="text-xs text-slate-500 mt-1">units across all materials</div>
              </div>
              <Store className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-green-600 mb-1">Market Purchase</div>
                <div className="text-2xl font-bold text-green-700">{totalMarket.toFixed(0)}</div>
                <div className="text-xs text-slate-500 mt-1">units across all materials</div>
              </div>
              <ShoppingCart className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-purple-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-purple-600 mb-1">Total Stock</div>
                <div className="text-2xl font-bold text-purple-700">{(totalInStore + totalMarket).toFixed(0)}</div>
                <div className="text-xs text-slate-500 mt-1">In-Store + Market</div>
              </div>
              <Package className="h-8 w-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-orange-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-orange-600 mb-1">Allocated (All Projects)</div>
                <div className="text-2xl font-bold text-orange-700">{totalAllocated.toFixed(0)}</div>
                <div className="text-xs text-slate-500 mt-1">reserved across projects</div>
              </div>
              <TrendingUp className="h-8 w-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Inventory Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="h-5 w-5 text-slate-500" />
                Real-Time Inventory (Global Sync)
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">
                Last updated: {lastRefresh.toLocaleTimeString()} - Auto-refreshes every 10s
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={fetchInventory}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh Now
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {/* Search */}
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search materials..."
              className="pl-10 bg-white"
            />
          </div>

          {/* Info Banner */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <div className="font-semibold mb-1">Dual-Source Inventory with Global Sync</div>
              <ul className="space-y-1 list-disc list-inside text-xs">
                <li><strong>In-Store</strong>: Materials available in your warehouse</li>
                <li><strong>Market Purchase</strong>: Materials purchased directly for projects</li>
                <li><strong>Real-Time Sync</strong>: When allocated to Project A, instantly updates for Project B & C</li>
                <li><strong>Auto-Reclassification</strong>: Market Purchase excess auto-returns as In-Store</li>
              </ul>
            </div>
          </div>

          {loading && inventory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Loading inventory...</div>
          ) : filteredInventory.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No materials found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[750px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Material</TableHead>
                    <TableHead className="w-[60px] text-center">Unit</TableHead>
                    <TableHead className="w-[100px] text-center bg-blue-50">
                      <div className="flex items-center justify-center gap-1">
                        <Store className="h-4 w-4 text-blue-600" />
                        <span className="text-xs">Store</span>
                      </div>
                    </TableHead>
                    <TableHead className="w-[100px] text-center bg-green-50">
                      <div className="flex items-center justify-center gap-1">
                        <ShoppingCart className="h-4 w-4 text-green-600" />
                        <span className="text-xs">Market</span>
                      </div>
                    </TableHead>
                    <TableHead className="w-[80px] text-center bg-purple-50 text-xs">Total</TableHead>
                    <TableHead className="w-[90px] text-center bg-orange-50 text-xs">Allocated</TableHead>
                    <TableHead className="w-[90px] text-center bg-emerald-50 text-xs">Available</TableHead>
                    <TableHead className="min-w-[150px]">Projects</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInventory.map((item) => (
                    <TableRow key={item.material_id} className="hover:bg-slate-50">
                      <TableCell className="font-medium text-sm">{item.material_name}</TableCell>
                      <TableCell className="text-center text-xs text-slate-600">{item.unit || '—'}</TableCell>
                      
                      {/* In-Store */}
                      <TableCell className="text-center bg-blue-50/50">
                        <div className="space-y-1">
                          <div className="font-semibold text-blue-700 text-sm">{item.in_store_quantity}</div>
                          <div className="text-[10px] text-slate-500">
                            Avail: <span className="font-semibold text-blue-600">{item.in_store_available}</span>
                          </div>
                        </div>
                      </TableCell>
                      
                      {/* Market Purchase */}
                      <TableCell className="text-center bg-green-50/50">
                        <div className="space-y-1">
                          <div className="font-semibold text-green-700 text-sm">{item.market_purchase_quantity}</div>
                          <div className="text-[10px] text-slate-500">
                            Avail: <span className="font-semibold text-green-600">{item.market_available}</span>
                          </div>
                        </div>
                      </TableCell>
                      
                      {/* Total */}
                      <TableCell className="text-center bg-purple-50/50">
                        <div className="text-base font-bold text-purple-700">{item.total_quantity}</div>
                      </TableCell>
                      
                      {/* Allocated Global */}
                      <TableCell className="text-center bg-orange-50/50">
                        <div className="text-base font-semibold text-orange-700">
                          {item.in_store_allocated + item.market_allocated}
                        </div>
                      </TableCell>
                      
                      {/* Available */}
                      <TableCell className="text-center bg-emerald-50/50">
                        <div className="text-base font-bold text-emerald-700">{item.total_available}</div>
                        {item.total_available === 0 && (
                          <Badge variant="destructive" className="text-[10px] mt-1">Out</Badge>
                        )}
                      </TableCell>
                      
                      {/* Project Allocations */}
                      <TableCell>
                        {item.project_allocations && item.project_allocations.length > 0 ? (
                          <div className="space-y-1">
                            {item.project_allocations.slice(0, 2).map((alloc, idx) => (
                              <div key={idx} className="text-[10px]">
                                <Badge variant="outline" className="mr-1 text-[10px] py-0">
                                  {alloc.project_name.substring(0, 15)}{alloc.project_name.length > 15 ? '...' : ''}
                                </Badge>
                                <span className="text-slate-600">
                                  {alloc.allocated} ({alloc.source === 'In-Store' ? (
                                    <Store className="inline h-2.5 w-2.5 text-blue-600" />
                                  ) : (
                                    <ShoppingCart className="inline h-2.5 w-2.5 text-green-600" />
                                  )})
                                </span>
                              </div>
                            ))}
                            {item.project_allocations.length > 2 && (
                              <div className="text-[10px] text-slate-400">+{item.project_allocations.length - 2} more</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">None</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
