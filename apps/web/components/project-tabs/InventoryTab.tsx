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
      <div className="grid grid-cols-4 gap-4">
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
          <div className="flex items-center justify-between">
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Material</TableHead>
                    <TableHead className="text-center">Unit</TableHead>
                    <TableHead className="text-center bg-blue-50">
                      <div className="flex items-center justify-center gap-1">
                        <Store className="h-4 w-4 text-blue-600" />
                        In-Store
                      </div>
                    </TableHead>
                    <TableHead className="text-center bg-green-50">
                      <div className="flex items-center justify-center gap-1">
                        <ShoppingCart className="h-4 w-4 text-green-600" />
                        Market Purchase
                      </div>
                    </TableHead>
                    <TableHead className="text-center bg-purple-50">Total Stock</TableHead>
                    <TableHead className="text-center bg-orange-50">Allocated (Global)</TableHead>
                    <TableHead className="text-center bg-emerald-50">Available</TableHead>
                    <TableHead>Project Allocations</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInventory.map((item) => (
                    <TableRow key={item.material_id} className="hover:bg-slate-50">
                      <TableCell className="font-medium">{item.material_name}</TableCell>
                      <TableCell className="text-center text-sm text-slate-600">{item.unit || '—'}</TableCell>
                      
                      {/* In-Store */}
                      <TableCell className="text-center bg-blue-50/50">
                        <div className="space-y-1">
                          <div className="font-semibold text-blue-700">{item.in_store_quantity}</div>
                          <div className="text-xs text-slate-500">
                            Allocated: {item.in_store_allocated}<br/>
                            Available: <span className="font-semibold text-blue-600">{item.in_store_available}</span>
                          </div>
                        </div>
                      </TableCell>
                      
                      {/* Market Purchase */}
                      <TableCell className="text-center bg-green-50/50">
                        <div className="space-y-1">
                          <div className="font-semibold text-green-700">{item.market_purchase_quantity}</div>
                          <div className="text-xs text-slate-500">
                            Allocated: {item.market_allocated}<br/>
                            Available: <span className="font-semibold text-green-600">{item.market_available}</span>
                          </div>
                        </div>
                      </TableCell>
                      
                      {/* Total */}
                      <TableCell className="text-center bg-purple-50/50">
                        <div className="text-lg font-bold text-purple-700">{item.total_quantity}</div>
                      </TableCell>
                      
                      {/* Allocated Global */}
                      <TableCell className="text-center bg-orange-50/50">
                        <div className="text-lg font-semibold text-orange-700">
                          {item.in_store_allocated + item.market_allocated}
                        </div>
                      </TableCell>
                      
                      {/* Available */}
                      <TableCell className="text-center bg-emerald-50/50">
                        <div className="text-lg font-bold text-emerald-700">{item.total_available}</div>
                        {item.total_available === 0 && (
                          <Badge variant="destructive" className="text-xs mt-1">Out of Stock</Badge>
                        )}
                      </TableCell>
                      
                      {/* Project Allocations */}
                      <TableCell>
                        {item.project_allocations && item.project_allocations.length > 0 ? (
                          <div className="space-y-1">
                            {item.project_allocations.map((alloc, idx) => (
                              <div key={idx} className="text-xs">
                                <Badge variant="outline" className="mr-1">
                                  {alloc.project_name}
                                </Badge>
                                <span className="text-slate-600">
                                  {alloc.allocated} ({alloc.source === 'In-Store' ? (
                                    <Store className="inline h-3 w-3 text-blue-600" />
                                  ) : (
                                    <ShoppingCart className="inline h-3 w-3 text-green-600" />
                                  )})
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No allocations</span>
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
