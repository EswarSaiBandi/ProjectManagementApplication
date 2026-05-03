'use client';

import { useMemo, useState } from 'react';
import { useRole } from '@/hooks/useRole';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { FileText, Plus, Trash2, Download } from 'lucide-react';

type QuoteItem = {
  scope: string;
  qty: string;
  rate: string;    // stored as typed string; numeric parse for grand total
  amount: string;  // stored as typed string
};

function formatDateForTemplate(d: string): string {
  // Accept YYYY-MM-DD, emit "1st May 2026" style that matches the template voice.
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  const [y, m, day] = parts.map((p) => parseInt(p, 10));
  const date = new Date(y, (m || 1) - 1, day || 1);
  const dd = date.getDate();
  const suffix =
    dd % 10 === 1 && dd !== 11 ? 'st' :
    dd % 10 === 2 && dd !== 12 ? 'nd' :
    dd % 10 === 3 && dd !== 13 ? 'rd' : 'th';
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${dd}${suffix} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function toNumber(s: string): number {
  if (!s) return 0;
  const cleaned = String(s).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatRupees(n: number): string {
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(n));
}

export default function QuotationsPage() {
  const { role, loading: roleLoading, isAdmin } = useRole();

  const today = new Date().toISOString().slice(0, 10);
  const [quoteDate, setQuoteDate] = useState(today);
  const [toAddress, setToAddress] = useState(
    'THE SOCIETY MANAGEMENT,\nARAVINDAM,\nNESTILA DEVELOPERS LLP,\nBACHUPALLY, HYDERABAD.'
  );
  const [subject, setSubject] = useState('Masonry Works');
  const [items, setItems] = useState<QuoteItem[]>([
    { scope: 'PIPELINE BORE PACKING', qty: '21 HOLES', rate: '15000', amount: '15000' },
  ]);
  const [downloading, setDownloading] = useState(false);

  const grandTotal = useMemo(
    () => items.reduce((s, i) => s + toNumber(i.amount), 0),
    [items],
  );

  const addItem = () => setItems([...items, { scope: '', qty: '', rate: '', amount: '' }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<QuoteItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  // Auto-fill amount = qty_numeric * rate_numeric when both are numeric.
  // If qty is like "21 HOLES", we leave amount alone (user enters manually).
  const autoAmount = (idx: number) => {
    const row = items[idx];
    const qtyNum = toNumber(row.qty);
    const rateNum = toNumber(row.rate);
    if (qtyNum > 0 && rateNum > 0) {
      updateItem(idx, { amount: String(Math.round(qtyNum * rateNum)) });
    }
  };

  const handleDownload = async () => {
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    if (!toAddress.trim()) { toast.error('To address is required'); return; }
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    for (let i = 0; i < items.length; i++) {
      if (!items[i].scope.trim()) { toast.error(`Item ${i + 1}: Scope is required`); return; }
    }

    setDownloading(true);
    try {
      // Dynamic imports — these are big libs we only need on click.
      const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([
        import('pizzip'),
        import('docxtemplater'),
      ]);

      // Fetch the prepared template from /public
      const res = await fetch('/quote-templates/template.docx');
      if (!res.ok) {
        throw new Error(
          'Template not found. See the template-prep instructions on this page to create /public/quote-templates/template.docx.'
        );
      }
      const ab = await res.arrayBuffer();
      const zip = new PizZip(ab);

      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
      });

      doc.render({
        quote_date: formatDateForTemplate(quoteDate),
        to_address: toAddress.trim(),
        subject: subject.trim(),
        items: items.map((it, i) => ({
          sno: i + 1,
          scope: it.scope,
          qty: it.qty,
          rate: toNumber(it.rate) > 0 ? formatRupees(toNumber(it.rate)) : it.rate,
          amount: toNumber(it.amount) > 0 ? formatRupees(toNumber(it.amount)) : it.amount,
        })),
        grand_total: formatRupees(grandTotal),
      });

      const blob = doc.getZip().generate({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const safeSubject = (subject || 'quotation').replace(/[^a-zA-Z0-9\- ]/g, '').trim().replace(/\s+/g, '_');
      const filename = `Quotation_${safeSubject}_${quoteDate}.docx`;

      // Trigger download via a transient anchor — avoids ESM/CJS interop headaches
      // of file-saver under Next.js.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success('Quotation downloaded');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to generate quotation');
    } finally {
      setDownloading(false);
    }
  };

  // -------- Access control --------

  if (roleLoading) {
    return <div className="text-slate-500 text-sm">Loading…</div>;
  }
  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-slate-600">
          <FileText className="h-10 w-10 mx-auto text-slate-300 mb-3" />
          <p className="font-medium">Admin access required.</p>
          <p className="text-sm">Your role: {role ?? 'unknown'}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quotations</h1>
          <p className="text-sm text-slate-600 mt-1">
            Fill the editable fields; the rest of the quotation template stays as-is. Output: DOCX.
          </p>
        </div>
        <Button
          onClick={handleDownload}
          disabled={downloading}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Download className="h-4 w-4 mr-2" />
          {downloading ? 'Generating…' : 'Download DOCX'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Header fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
                className="bg-white"
              />
              <p className="text-xs text-slate-500">
                Output format in DOCX: <code>{formatDateForTemplate(quoteDate) || '—'}</code>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Masonry Works"
                className="bg-white"
              />
              <p className="text-xs text-slate-500">Renders as: <code>Sub: Quotation for {subject || '…'}.</code></p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>To address *</Label>
            <Textarea
              rows={5}
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              placeholder={'THE SOCIETY MANAGEMENT,\nBUILDING NAME,\nDEVELOPER,\nLOCALITY, CITY.'}
              className="bg-white font-mono text-sm"
            />
            <p className="text-xs text-slate-500">One line per row. Line breaks are preserved in the DOCX.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Items</CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                Add as many rows as needed. Amount auto-computes when Qty and Rate are numeric; edit manually otherwise.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-4 w-4 mr-1" /> Add Row
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-10">S No.</TableHead>
                <TableHead>Scope of Work</TableHead>
                <TableHead className="w-40">Quantity</TableHead>
                <TableHead className="w-32">Rate (₹)</TableHead>
                <TableHead className="w-32">Amount (₹)</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium">{idx + 1}</TableCell>
                  <TableCell>
                    <Textarea
                      rows={2}
                      value={it.scope}
                      onChange={(e) => updateItem(idx, { scope: e.target.value })}
                      placeholder="e.g. PIPELINE BORE PACKING"
                      className="bg-white text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={it.qty}
                      onChange={(e) => updateItem(idx, { qty: e.target.value })}
                      onBlur={() => autoAmount(idx)}
                      placeholder="21 HOLES or 400"
                      className="bg-white text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={it.rate}
                      onChange={(e) => updateItem(idx, { rate: e.target.value })}
                      onBlur={() => autoAmount(idx)}
                      placeholder="15000"
                      className="bg-white text-sm"
                      inputMode="decimal"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={it.amount}
                      onChange={(e) => updateItem(idx, { amount: e.target.value })}
                      placeholder="15000"
                      className="bg-white text-sm font-semibold"
                      inputMode="decimal"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                      className="text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-slate-50 font-semibold">
                <TableCell colSpan={4} className="text-right">GRAND TOTAL (Excluding GST)</TableCell>
                <TableCell>{formatRupees(grandTotal)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="bg-slate-50 border-slate-200">
        <CardHeader>
          <CardTitle className="text-sm text-slate-700">How this works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p>
            The quotation template (letterhead, account details, payment terms, T&amp;Cs) lives at
            <code className="bg-slate-200 px-1 mx-1 rounded">apps/web/public/quote-templates/template.docx</code>.
            When you click Download DOCX, the app fills these editable fields:
            <code className="bg-slate-200 px-1 mx-1 rounded">&#123;quote_date&#125;</code>,
            <code className="bg-slate-200 px-1 mx-1 rounded">&#123;to_address&#125;</code>,
            <code className="bg-slate-200 px-1 mx-1 rounded">&#123;subject&#125;</code>,
            the items loop (<code className="bg-slate-200 px-1 mx-1 rounded">&#123;#items&#125;…&#123;/items&#125;</code>), and
            <code className="bg-slate-200 px-1 mx-1 rounded">&#123;grand_total&#125;</code> — everything else is kept exactly as in the template.
          </p>

        </CardContent>
      </Card>
    </div>
  );
}
