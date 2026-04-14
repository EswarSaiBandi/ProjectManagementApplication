'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Settings, Check, X } from 'lucide-react';

type DynamicOption = {
  option_id: number;
  field_type: string;
  option_value: string;
  display_order: number;
  is_active: boolean;
  color_code: string | null;
  description: string | null;
  created_at: string;
};

const FIELD_TYPES = [
  { value: 'lead_source', label: 'Lead Sources' },
  { value: 'cost_category', label: 'Cost Categories' },
  { value: 'project_expense_type', label: 'Project Expense Types' },
  { value: 'payment_method', label: 'Payment Methods' },
  { value: 'project_type', label: 'Project Types' },
  { value: 'material_category', label: 'Material Metrics' },
  { value: 'task_priority', label: 'Task Priorities' },
];

export default function DynamicFieldsManager() {
  const [activeFieldType, setActiveFieldType] = useState('lead_source');
  const [options, setOptions] = useState<DynamicOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [newOption, setNewOption] = useState('');
  const [newColor, setNewColor] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchOptions = async (fieldType: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('dynamic_field_options')
      .select('*')
      .eq('field_type', fieldType)
      .order('display_order');

    if (!error && data) {
      setOptions(data as DynamicOption[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOptions(activeFieldType);
  }, [activeFieldType]);

  const handleAdd = async () => {
    const nextValue = newOption.trim();
    if (!nextValue) {
      toast.error('Option value is required');
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();

    const existing = options.find(
      (o) => o.option_value.trim().toLowerCase() === nextValue.toLowerCase()
    );

    if (existing) {
      if (existing.is_active) {
        toast.error('Option already exists and is active');
        setIsSaving(false);
        return;
      }

      const { error: reactivateError } = await supabase
        .from('dynamic_field_options')
        .update({
          is_active: true,
          color_code: activeFieldType === 'cost_category' ? (newColor.trim() || existing.color_code) : existing.color_code,
        })
        .eq('option_id', existing.option_id);

      if (reactivateError) {
        console.error('Reactivate option error:', reactivateError);
        toast.error(reactivateError.message || 'Failed to reactivate option');
        setIsSaving(false);
        return;
      }

      toast.success('Option reactivated');
      setNewOption('');
      setNewColor('');
      await fetchOptions(activeFieldType);
      setIsSaving(false);
      return;
    }

    const maxOrder = options.length > 0 ? Math.max(...options.map(o => o.display_order)) : 0;

    const payload = {
      field_type: activeFieldType,
      option_value: nextValue,
      display_order: maxOrder + 1,
      is_active: true,
      color_code: newColor.trim() || null,
      created_by: userData.user?.id,
    };

    const { error } = await supabase.from('dynamic_field_options').insert([payload]);

    if (error) {
      console.error('Add option error:', error);
      toast.error(error.message || 'Failed to add option');
      setIsSaving(false);
      return;
    }

    toast.success('Option added');
    setNewOption('');
    setNewColor('');
    await fetchOptions(activeFieldType);
    setIsSaving(false);
  };

  const handleToggleActive = async (optionId: number, currentActive: boolean) => {
    const { error } = await supabase
      .from('dynamic_field_options')
      .update({ is_active: !currentActive })
      .eq('option_id', optionId);

    if (error) {
      console.error('Toggle active error:', error);
      toast.error('Failed to update status');
      return;
    }

    toast.success(currentActive ? 'Option deactivated' : 'Option activated');
    await fetchOptions(activeFieldType);
  };

  const activeOptions = options.filter(o => o.is_active);
  const inactiveOptions = options.filter(o => !o.is_active);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-slate-600" />
          Dynamic Field Configuration
        </CardTitle>
        <p className="text-sm text-slate-600 mt-1">
          Manage dropdown options for leads, costs, and other fields across the application
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Field Type Selector */}
        <div className="space-y-2">
          <Label>Select Field Type to Manage</Label>
          <Select value={activeFieldType} onValueChange={setActiveFieldType}>
            <SelectTrigger className="bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {FIELD_TYPES.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Add New Option */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-4">
            <div className="flex gap-3 items-end">
              <div className="flex-1 space-y-2">
                <Label>New Option Value</Label>
                <Input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder={`e.g., ${
                    activeFieldType === 'lead_source'
                      ? 'LinkedIn'
                      : activeFieldType === 'cost_category'
                      ? 'Transportation'
                      : activeFieldType === 'project_expense_type'
                      ? 'Accommodation'
                      : 'New Option'
                  }`}
                  className="bg-white"
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
              </div>
              {activeFieldType === 'cost_category' && (
                <div className="w-[140px] space-y-2">
                  <Label>Color (optional)</Label>
                  <Input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="bg-white h-10"
                  />
                </div>
              )}
              <Button 
                onClick={handleAdd} 
                disabled={isSaving}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Option
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Active Options */}
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
            Active Options ({activeOptions.length})
          </h3>
          {loading ? (
            <div className="text-center py-6 text-muted-foreground">Loading...</div>
          ) : activeOptions.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No active options. Add one above.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Order</TableHead>
                  <TableHead>Option Value</TableHead>
                  {activeFieldType === 'cost_category' && <TableHead className="w-[100px]">Color</TableHead>}
                  <TableHead className="w-[180px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeOptions.map((option) => (
                  <TableRow key={option.option_id}>
                    <TableCell className="font-medium">{option.display_order}</TableCell>
                    <TableCell className="font-medium">{option.option_value}</TableCell>
                    {activeFieldType === 'cost_category' && (
                      <TableCell>
                        {option.color_code ? (
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-6 h-6 rounded border"
                              style={{ backgroundColor: option.color_code }}
                            />
                            <span className="text-xs text-slate-600">{option.color_code}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No color</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleActive(option.option_id, option.is_active)}
                      >
                        <X className="h-4 w-4 text-orange-600 mr-1" />
                        Deactivate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Inactive Options */}
        {inactiveOptions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <X className="h-4 w-4 text-slate-400" />
              Inactive Options ({inactiveOptions.length})
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Option Value</TableHead>
                  <TableHead className="w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inactiveOptions.map((option) => (
                  <TableRow key={option.option_id} className="opacity-50">
                    <TableCell className="line-through">{option.option_value}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleActive(option.option_id, option.is_active)}
                      >
                        <Check className="h-4 w-4 text-green-600 mr-1" />
                        Activate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
