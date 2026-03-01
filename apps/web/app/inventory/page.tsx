'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';
import { Package, Warehouse, ClipboardList, TrendingUp, Bell, Layers, ArrowDownUp } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

interface MaterialRequest {
  request_id: number;
  request_number: string;
  status: string;
  request_source: string;
  project_name?: string;
}

interface MaterialReturn {
  return_id: number;
  return_number: string;
  status: string;
  project_name?: string;
}

export default function InventoryPage() {
  const [pendingRequests, setPendingRequests] = useState<MaterialRequest[]>([]);
  const [pendingReturns, setPendingReturns] = useState<MaterialReturn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPendingItems();
  }, []);

  const fetchPendingItems = async () => {
    try {
      // Fetch pending material requests
      const { data: requests, error: reqError } = await supabase
        .from('material_requests')
        .select(`
          request_id,
          request_number,
          status,
          request_source,
          projects!inner(project_name)
        `)
        .eq('status', 'Pending')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!reqError) {
        setPendingRequests((requests || []).map((r: any) => ({
          ...r,
          project_name: r.projects?.project_name
        })));
      }

      // Fetch pending material returns
      const { data: returns, error: retError } = await supabase
        .from('material_returns')
        .select(`
          return_id,
          return_number,
          status,
          projects!inner(project_name)
        `)
        .eq('status', 'Pending')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!retError) {
        setPendingReturns((returns || []).map((r: any) => ({
          ...r,
          project_name: r.projects?.project_name
        })));
      }
    } catch (error: any) {
      console.error('Error fetching pending items:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-slate-500">Loading inventory...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Global Inventory Management</h1>
            <p className="text-slate-600 mt-1">Manage materials, store inventory, and track movements</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="px-3 py-1">
              <Bell className="h-4 w-4 mr-1" />
              {pendingRequests.length} Requests
            </Badge>
            <Badge variant="outline" className="px-3 py-1">
              <TrendingUp className="h-4 w-4 mr-1" />
              {pendingReturns.length} Returns
            </Badge>
          </div>
        </div>

        {/* Quick Access Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/materials">
            <Card className="bg-white hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-blue-500">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-100 rounded-lg">
                    <Package className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Material Master</p>
                    <h3 className="text-xl font-bold text-slate-900">Materials</h3>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-3">Manage materials & quantity variants</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/store">
            <Card className="bg-white hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-green-500">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-100 rounded-lg">
                    <Warehouse className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Store Inventory</p>
                    <h3 className="text-xl font-bold text-slate-900">Store</h3>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-3">Manage stock & approve requests</p>
              </CardContent>
            </Card>
          </Link>

          <Card className="bg-white border-2">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-100 rounded-lg">
                  <ClipboardList className="h-6 w-6 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-600">Pending Actions</p>
                  <h3 className="text-xl font-bold text-slate-900">{pendingRequests.length + pendingReturns.length}</h3>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3">Requests & returns to review</p>
            </CardContent>
          </Card>

          <Link href="/movement-logs">
            <Card className="bg-white hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-purple-500">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-100 rounded-lg">
                    <ArrowDownUp className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Movement Logs</p>
                    <h3 className="text-xl font-bold text-slate-900">Audit Trail</h3>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-3">Track all material movements</p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Pending Items */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pending Requests */}
          <Card className="bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ClipboardList className="h-5 w-5 text-orange-600" />
                Pending Material Requests
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pendingRequests.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No pending requests
                </div>
              ) : (
                <div className="divide-y">
                  {pendingRequests.map((req) => (
                    <div key={req.request_id} className="p-4 hover:bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{req.request_number}</p>
                          <p className="text-sm text-slate-600">{req.project_name}</p>
                        </div>
                        <Badge variant="outline">{req.request_source}</Badge>
                      </div>
                    </div>
                  ))}
                  <div className="p-4 bg-slate-50">
                    <Link href="/store">
                      <Button variant="outline" size="sm" className="w-full">
                        View All Requests
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Returns */}
          <Card className="bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50">
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingUp className="h-5 w-5 text-green-600" />
                Pending Material Returns
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pendingReturns.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No pending returns
                </div>
              ) : (
                <div className="divide-y">
                  {pendingReturns.map((ret) => (
                    <div key={ret.return_id} className="p-4 hover:bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{ret.return_number}</p>
                          <p className="text-sm text-slate-600">{ret.project_name}</p>
                        </div>
                        <Badge className="bg-yellow-100 text-yellow-700">Pending Review</Badge>
                      </div>
                    </div>
                  ))}
                  <div className="p-4 bg-slate-50">
                    <Link href="/store">
                      <Button variant="outline" size="sm" className="w-full">
                        View All Returns
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Info */}
        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-600 rounded-lg">
                <Layers className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">New Inventory System</h3>
                <p className="text-sm text-slate-700 mb-3">
                  Complete material management with variants, store inventory, approval workflows, and full audit trail.
                </p>
                <div className="flex gap-2">
                  <Link href="/materials">
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                      Manage Materials
                    </Button>
                  </Link>
                  <Link href="/store">
                    <Button size="sm" variant="outline">
                      Store Inventory
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
