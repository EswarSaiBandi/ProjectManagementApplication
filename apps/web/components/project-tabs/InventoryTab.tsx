'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, Plus, Pencil, Trash } from 'lucide-react';

type Material = {
  material_id: number;
  item_name: string;
  unit: string | null;
  quantity: number;
};

export default function InventoryTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);

  const [form, setForm] = useState({ item_name: '', unit: 'units', quantity: '0' });

  const fetchMaterials = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('material_master')
      .select('material_id, item_name, unit, quantity')
      .order('item_name');

    if (error) {
      console.error('Fetch materials error:', error);
      toast.error(error.message || 'Failed to load inventory');
      setMaterials([]);
      setLoading(false);
      return;
    }

    const rows = (data || []) as any[];
    setMaterials(
      rows.map((r) => ({
        material_id: r.material_id,
        item_name: r.item_name,
        unit: r.unit ?? null,
        quantity: Number.isFinite(Number(r.quantity)) ? Number(r.quantity) : 0,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ item_name: '', unit: 'units', quantity: '0' });
    setIsOpen(true);
  };

  const openEdit = (m: Material) => {
    setEditing(m);
    setForm({ item_name: m.item_name, unit: m.unit || 'units', quantity: String(m.quantity ?? 0) });
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    const name = form.item_name.trim();
    if (!name) {
      toast.error('Item name is required');
      return;
    }
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error('Quantity must be a valid non-negative number');
      return;
    }

    setIsSaving(true);
    if (editing) {
      const { error } = await supabase
        .from('material_master')
        .update({ item_name: name, unit: form.unit, quantity: qty })
        .eq('material_id', editing.material_id);
      if (error) {
        console.error('Update material error:', error);
        toast.error(error.message || 'Failed to update item');
        setIsSaving(false);
        return;
      }
      toast.success('Item updated');
    } else {
      const { error } = await supabase
        .from('material_master')
        .insert([{ item_name: name, unit: form.unit, quantity: qty }]);
      if (error) {
        console.error('Insert material error:', error);
        toast.error(error.message || 'Failed to add item');
        setIsSaving(false);
        return;
      }
      toast.success('Item added');
    }

    setIsOpen(false);
    setEditing(null);
    await fetchMaterials();
    setIsSaving(false);
  };

  const handleDelete = async (m: Material) => {
    if (!confirm(`Delete "${m.item_name}"?`)) return;
    const { error } = await supabase.from('material_master').delete().eq('material_id', m.material_id);
    if (error) {
      console.error('Delete material error:', error);
      toast.error(error.message || 'Failed to delete item');
      return;
    }
    toast.success('Deleted');
    fetchMaterials();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5 text-slate-500" /> Inventory
          </CardTitle>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                <Plus className="h-4 w-4 mr-2" /> Add Item
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white max-w-lg">
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Item' : 'Add Item'}</DialogTitle>
                <DialogDescription>Maintain materials and their stock quantity.</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Item name</Label>
                  <Input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className="bg-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Unit</Label>
                    <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="bg-white" />
                  </div>
                  <div className="space-y-2">
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading inventory...</div>
          ) : materials.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No inventory items yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-[140px]">Unit</TableHead>
                  <TableHead className="w-[160px] text-right">Quantity</TableHead>
                  <TableHead className="w-[140px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((m) => (
                  <TableRow key={m.material_id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">{m.item_name}</TableCell>
                    <TableCell className="text-slate-600">{m.unit || '—'}</TableCell>
                    <TableCell className="text-right font-semibold">{m.quantity}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(m)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(m)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {Number.isFinite(numericProjectId) ? (
            <p className="text-xs text-slate-500 mt-3">
              Inventory is shared across projects; this tab is a convenient editor.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

