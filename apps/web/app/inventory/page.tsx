'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Layers, Plus, Search, Package, AlertCircle, Edit, Trash, Eye, Download, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import Link from 'next/link';

type InventoryItem = {
    id: number;
    name: string;
    unit: string;
    quantity: number;
    received?: number;
    approved?: number;
    category: string;
    sku: string;
    min_stock: number;
    unit_price: number;
    description: string | null;
    purchaseRequests?: any[];
    goodsReceived?: any[];
};

export default function InventoryPage() {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [stockFilter, setStockFilter] = useState<string>('all');
    
    // Dialog states
    const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
    const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
    const [viewingItem, setViewingItem] = useState<InventoryItem | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    
    // Form state
    const [itemForm, setItemForm] = useState({
        item_name: '',
        unit: 'units',
        category: 'General',
    });

    useEffect(() => {
        fetchInventory();
    }, []);

    const fetchInventory = async () => {
        try {
            setLoading(true);
            // Fetch from material_master
            const { data: materials, error: materialsError } = await supabase
                .from('material_master')
                .select('material_id, item_name, unit')
                .order('item_name');

            if (materialsError) throw materialsError;

            // Fetch approved PR items to calculate quantities
            const { data: prItems, error: prItemsError } = await supabase
                .from('pr_items')
                .select(`
                    material_id,
                    approved_qty,
                    requested_qty,
                    pr_id,
                    purchase_requests!inner (
                        pr_id,
                        status,
                        project_id,
                        created_at,
                        projects:project_id (
                            project_name
                        )
                    )
                `)
                .eq('purchase_requests.status', 'Approved');

            // Fetch goods received
            const { data: goodsReceived, error: grError } = await supabase
                .from('goods_received')
                .select(`
                    grn_id,
                    pr_id,
                    received_date,
                    received_by,
                    purchase_requests!inner (
                        pr_id,
                        pr_items (
                            material_id,
                            approved_qty
                        )
                    )
                `);

            // Calculate quantities: approved PRs minus goods received
            const quantitiesByMaterial: Record<number, { approved: number; received: number; pending: number }> = {};
            
            // Sum approved quantities
            (prItems || []).forEach((item: any) => {
                const materialId = item.material_id;
                const qty = parseFloat(item.approved_qty) || parseFloat(item.requested_qty) || 0;
                if (!quantitiesByMaterial[materialId]) {
                    quantitiesByMaterial[materialId] = { approved: 0, received: 0, pending: 0 };
                }
                quantitiesByMaterial[materialId].approved += qty;
            });

            // Sum received quantities
            (goodsReceived || []).forEach((gr: any) => {
                (gr.purchase_requests?.pr_items || []).forEach((prItem: any) => {
                    const materialId = prItem.material_id;
                    const qty = parseFloat(prItem.approved_qty) || 0;
                    if (quantitiesByMaterial[materialId]) {
                        quantitiesByMaterial[materialId].received += qty;
                    }
                });
            });

            // Calculate pending (approved - received)
            Object.keys(quantitiesByMaterial).forEach(materialId => {
                const qty = quantitiesByMaterial[parseInt(materialId)];
                qty.pending = qty.approved - qty.received;
            });

            // Group PRs by material
            const prsByMaterial: Record<number, any[]> = {};
            (prItems || []).forEach((item: any) => {
                const materialId = item.material_id;
                if (!prsByMaterial[materialId]) {
                    prsByMaterial[materialId] = [];
                }
                prsByMaterial[materialId].push(item.purchase_requests);
            });

            // Transform data
            const inventoryItems = (materials || []).map((material: any) => {
                const qty = quantitiesByMaterial[material.material_id] || { approved: 0, received: 0, pending: 0 };
                return {
                    id: material.material_id,
                    name: material.item_name,
                    unit: material.unit || 'units',
                    quantity: qty.pending, // Available stock = pending (approved but not yet received)
                    received: qty.received,
                    approved: qty.approved,
                    category: material.unit || 'General',
                    sku: `MAT-${material.material_id}`,
                    min_stock: 0,
                    unit_price: 0,
                    description: null,
                    purchaseRequests: prsByMaterial[material.material_id] || [],
                };
            });

            setItems(inventoryItems);
        } catch (error) {
            console.error('Error fetching inventory:', error);
            toast.error('Failed to load inventory');
        } finally {
            setLoading(false);
        }
    };

    const handleNewItem = () => {
        setEditingItem(null);
        setItemForm({
            item_name: '',
            unit: 'units',
            category: 'General',
        });
        setIsItemDialogOpen(true);
    };

    const handleEditItem = (item: InventoryItem) => {
        setEditingItem(item);
        setItemForm({
            item_name: item.name,
            unit: item.unit,
            category: item.category,
        });
        setIsItemDialogOpen(true);
    };

    const handleSaveItem = async () => {
        if (!itemForm.item_name.trim()) {
            toast.error('Item name is required');
            return;
        }

        setIsSaving(true);
        try {
            if (editingItem) {
                // Update existing item
                const { error } = await supabase
                    .from('material_master')
                    .update({
                        item_name: itemForm.item_name,
                        unit: itemForm.unit,
                    })
                    .eq('material_id', editingItem.id);

                if (error) throw error;
                toast.success('Item updated successfully');
            } else {
                // Create new item
                const { error } = await supabase
                    .from('material_master')
                    .insert([{
                        item_name: itemForm.item_name,
                        unit: itemForm.unit,
                    }]);

                if (error) throw error;
                toast.success('Item created successfully');
            }

            setIsItemDialogOpen(false);
            fetchInventory();
        } catch (error: any) {
            console.error('Error saving item:', error);
            toast.error(error.message || 'Failed to save item');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteItem = async (item: InventoryItem) => {
        if (!confirm(`Are you sure you want to delete "${item.name}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('material_master')
                .delete()
                .eq('material_id', item.id);

            if (error) throw error;
            toast.success('Item deleted successfully');
            fetchInventory();
        } catch (error: any) {
            console.error('Error deleting item:', error);
            toast.error(error.message || 'Failed to delete item');
        }
    };

    const handleViewItem = async (item: InventoryItem) => {
        // Fetch detailed PR and GR data for this item
        const { data: prItems } = await supabase
            .from('pr_items')
            .select(`
                pr_id,
                approved_qty,
                requested_qty,
                purchase_requests!inner (
                    pr_id,
                    status,
                    project_id,
                    created_at,
                    projects:project_id (
                        project_name
                    )
                )
            `)
            .eq('material_id', item.id);

        const { data: goodsReceived } = await supabase
            .from('goods_received')
            .select(`
                grn_id,
                pr_id,
                received_date,
                purchase_requests!inner (
                    pr_id,
                    pr_items (
                        material_id,
                        approved_qty
                    )
                )
            `);

        const filteredGRs = (goodsReceived || []).filter((gr: any) => 
            gr.purchase_requests?.pr_items?.some((prItem: any) => prItem.material_id === item.id)
        );

        setViewingItem({
            ...item,
            purchaseRequests: prItems?.map((pi: any) => pi.purchase_requests) || [],
            goodsReceived: filteredGRs || [],
        });
        setIsViewDialogOpen(true);
    };

    const exportToCSV = () => {
        const csvContent = [
            ['SKU', 'Item Name', 'Unit', 'Available Quantity', 'Received', 'Approved', 'Category'].join(','),
            ...items.map(item => [
                item.sku,
                item.name,
                item.unit,
                item.quantity,
                item.received || 0,
                item.approved || 0,
                item.category,
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `inventory_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('Inventory exported successfully');
    };

    const categories = Array.from(new Set(items.map(item => item.category).filter(Boolean)));
    const filteredItems = items.filter(item => {
        const matchesSearch = item.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.sku?.toLowerCase().includes(searchQuery.toLowerCase());
        
        const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
        
        const matchesStock = stockFilter === 'all' ||
            (stockFilter === 'low' && item.quantity <= (item.min_stock || 0)) ||
            (stockFilter === 'out' && item.quantity === 0) ||
            (stockFilter === 'in_stock' && item.quantity > (item.min_stock || 0));

        return matchesSearch && matchesCategory && matchesStock;
    });

    const stats = {
        totalItems: items.length,
        lowStock: items.filter(item => item.quantity <= (item.min_stock || 0)).length,
        outOfStock: items.filter(item => item.quantity === 0).length,
        categories: categories.length,
        totalValue: items.reduce((sum, item) => sum + (item.quantity * (item.unit_price || 0)), 0),
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Inventory</h2>
                    <p className="text-muted-foreground">Manage your construction materials and supplies</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={exportToCSV}>
                        <Download className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                    <Button onClick={handleNewItem}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Item
                    </Button>
                </div>
            </div>

            {/* Search and Filters */}
            <Card>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="relative md:col-span-2">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search by name, SKU, or category..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="category">Category</Label>
                            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                    <SelectItem value="all" className="bg-white hover:bg-gray-100">All Categories</SelectItem>
                                    {categories.map(cat => (
                                        <SelectItem key={cat} value={cat} className="bg-white hover:bg-gray-100">{cat}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="stock">Stock Status</Label>
                            <Select value={stockFilter} onValueChange={setStockFilter}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                    <SelectItem value="all" className="bg-white hover:bg-gray-100">All Items</SelectItem>
                                    <SelectItem value="in_stock" className="bg-white hover:bg-gray-100">In Stock</SelectItem>
                                    <SelectItem value="low" className="bg-white hover:bg-gray-100">Low Stock</SelectItem>
                                    <SelectItem value="out" className="bg-white hover:bg-gray-100">Out of Stock</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Inventory Stats */}
            <div className="grid gap-4 md:grid-cols-5">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Items</CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalItems}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
                        <AlertCircle className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">{stats.lowStock}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
                        <AlertCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-500">{stats.outOfStock}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Categories</CardTitle>
                        <Layers className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.categories}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Value</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            ₹{stats.totalValue.toLocaleString('en-IN')}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Price data not available</p>
                    </CardContent>
                </Card>
            </div>

            {/* Inventory List */}
            <Card>
                <CardHeader>
                    <CardTitle>Inventory Items</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading inventory...</div>
                    ) : filteredItems.length === 0 ? (
                        <div className="text-center py-8">
                            <Layers className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                            <h3 className="text-lg font-semibold mb-2">No inventory items</h3>
                            <p className="text-muted-foreground mb-4">
                                {searchQuery || categoryFilter !== 'all' || stockFilter !== 'all' 
                                    ? 'No items match your filters.' 
                                    : 'Get started by adding your first inventory item.'}
                            </p>
                            {!searchQuery && categoryFilter === 'all' && stockFilter === 'all' && (
                                <Button onClick={handleNewItem}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add Item
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Item Name</TableHead>
                                        <TableHead>SKU</TableHead>
                                        <TableHead>Category</TableHead>
                                        <TableHead className="text-right">Available</TableHead>
                                        <TableHead className="text-right">Received</TableHead>
                                        <TableHead className="text-right">Approved</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredItems.map((item) => {
                                        const isLowStock = item.quantity <= (item.min_stock || 0);
                                        const isOutOfStock = item.quantity === 0;
                                        return (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-semibold">{item.name}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="text-xs">
                                                        {item.sku}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary" className="text-xs">
                                                        {item.category}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className={`text-right font-semibold ${
                                                    isOutOfStock ? 'text-red-500' : isLowStock ? 'text-orange-500' : ''
                                                }`}>
                                                    {item.quantity || 0} {item.unit}
                                                </TableCell>
                                                <TableCell className="text-right text-muted-foreground">
                                                    {item.received || 0} {item.unit}
                                                </TableCell>
                                                <TableCell className="text-right text-muted-foreground">
                                                    {item.approved || 0} {item.unit}
                                                </TableCell>
                                                <TableCell>
                                                    {isOutOfStock ? (
                                                        <Badge className="bg-red-100 text-red-800">Out of Stock</Badge>
                                                    ) : isLowStock ? (
                                                        <Badge className="bg-orange-100 text-orange-800">Low Stock</Badge>
                                                    ) : (
                                                        <Badge className="bg-green-100 text-green-800">In Stock</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="outline" size="sm" onClick={() => handleViewItem(item)}>
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="outline" size="sm" onClick={() => handleEditItem(item)}>
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="outline" size="sm" onClick={() => handleDeleteItem(item)}>
                                                            <Trash className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Add/Edit Item Dialog */}
            <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
                <DialogContent className="bg-white">
                    <DialogHeader>
                        <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
                        <DialogDescription>
                            {editingItem ? 'Update item details' : 'Add a new material to your inventory'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="item_name">Item Name *</Label>
                            <Input
                                id="item_name"
                                value={itemForm.item_name}
                                onChange={(e) => setItemForm({ ...itemForm, item_name: e.target.value })}
                                placeholder="e.g., Cement, Steel Rods"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="unit">Unit</Label>
                                <Select value={itemForm.unit} onValueChange={(value) => setItemForm({ ...itemForm, unit: value })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                        <SelectItem value="units" className="bg-white hover:bg-gray-100">Units</SelectItem>
                                        <SelectItem value="kg" className="bg-white hover:bg-gray-100">Kilograms (kg)</SelectItem>
                                        <SelectItem value="tons" className="bg-white hover:bg-gray-100">Tons</SelectItem>
                                        <SelectItem value="bags" className="bg-white hover:bg-gray-100">Bags</SelectItem>
                                        <SelectItem value="sqft" className="bg-white hover:bg-gray-100">Square Feet</SelectItem>
                                        <SelectItem value="sqm" className="bg-white hover:bg-gray-100">Square Meters</SelectItem>
                                        <SelectItem value="cft" className="bg-white hover:bg-gray-100">Cubic Feet</SelectItem>
                                        <SelectItem value="cum" className="bg-white hover:bg-gray-100">Cubic Meters</SelectItem>
                                        <SelectItem value="liters" className="bg-white hover:bg-gray-100">Liters</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="category">Category</Label>
                                <Input
                                    id="category"
                                    value={itemForm.category}
                                    onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                                    placeholder="e.g., Civil, Electrical"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsItemDialogOpen(false)}>
                            Cancel
                        </Button>
                        {editingItem && (
                            <Button variant="outline" onClick={() => {
                                setIsItemDialogOpen(false);
                                handleDeleteItem(editingItem);
                            }}>
                                <Trash className="mr-2 h-4 w-4" />
                                Delete
                            </Button>
                        )}
                        <Button onClick={handleSaveItem} disabled={isSaving}>
                            {isSaving ? 'Saving...' : editingItem ? 'Update Item' : 'Create Item'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* View Item Details Dialog */}
            <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white">
                    <DialogHeader>
                        <DialogTitle>{viewingItem?.name}</DialogTitle>
                        <DialogDescription>Inventory details and purchase history</DialogDescription>
                    </DialogHeader>
                    {viewingItem && (
                        <div className="space-y-6 py-4">
                            <div className="grid grid-cols-4 gap-4">
                                <div>
                                    <Label className="text-xs text-muted-foreground">SKU</Label>
                                    <p className="font-semibold">{viewingItem.sku}</p>
                                </div>
                                <div>
                                    <Label className="text-xs text-muted-foreground">Unit</Label>
                                    <p className="font-semibold">{viewingItem.unit}</p>
                                </div>
                                <div>
                                    <Label className="text-xs text-muted-foreground">Available</Label>
                                    <p className={`font-semibold ${viewingItem.quantity === 0 ? 'text-red-500' : 'text-green-600'}`}>
                                        {viewingItem.quantity} {viewingItem.unit}
                                    </p>
                                </div>
                                <div>
                                    <Label className="text-xs text-muted-foreground">Category</Label>
                                    <p className="font-semibold">{viewingItem.category}</p>
                                </div>
                            </div>

                            <div>
                                <h3 className="font-semibold mb-3">Purchase Requests</h3>
                                {viewingItem.purchaseRequests && viewingItem.purchaseRequests.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>PR ID</TableHead>
                                                <TableHead>Project</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Date</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {viewingItem.purchaseRequests.map((pr: any) => (
                                                <TableRow key={pr.pr_id}>
                                                    <TableCell>#{pr.pr_id}</TableCell>
                                                    <TableCell>
                                                        <Link href={`/projects/${pr.project_id}`} className="text-blue-600 hover:underline">
                                                            {pr.projects?.project_name || `Project #${pr.project_id}`}
                                                        </Link>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge className={getStatusColor(pr.status)}>
                                                            {pr.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        {new Date(pr.created_at).toLocaleDateString()}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-muted-foreground">No purchase requests found</p>
                                )}
                            </div>

                            <div>
                                <h3 className="font-semibold mb-3">Goods Received</h3>
                                {viewingItem.goodsReceived && viewingItem.goodsReceived.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>GRN ID</TableHead>
                                                <TableHead>PR ID</TableHead>
                                                <TableHead>Received Date</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {viewingItem.goodsReceived.map((gr: any) => (
                                                <TableRow key={gr.grn_id}>
                                                    <TableCell>#{gr.grn_id}</TableCell>
                                                    <TableCell>#{gr.pr_id}</TableCell>
                                                    <TableCell>
                                                        {new Date(gr.received_date).toLocaleDateString()}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-muted-foreground">No goods received records found</p>
                                )}
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function getStatusColor(status: string) {
    const statusLower = status?.toLowerCase() || '';
    if (statusLower.includes('approved')) return 'bg-green-100 text-green-800';
    if (statusLower.includes('pending')) return 'bg-yellow-100 text-yellow-800';
    if (statusLower.includes('rejected')) return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-800';
}
