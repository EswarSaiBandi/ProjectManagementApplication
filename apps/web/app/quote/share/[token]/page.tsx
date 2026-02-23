import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import Link from 'next/link';
import QuoteShareActions from './QuoteShareActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatMoney(n: number) {
    return `₹ ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0)}`;
}

export default async function QuoteSharePage({ params }: { params: { token: string } }) {
    const supabaseAdmin = getSupabaseAdmin();

    const token = params.token;
    const { data: quote, error } = await supabaseAdmin
        .from('project_quotes')
        .select('*')
        .eq('share_token', token)
        .eq('share_enabled', true)
        .limit(1);

    if (error) {
        return <div className="p-10 text-red-600">Failed to load quote: {error.message}</div>;
    }

    const q = quote?.[0] as any;
    if (!q) {
        return <div className="p-10 text-slate-600">Quote not found (or sharing disabled).</div>;
    }

    const { data: items, error: itemsError } = await supabaseAdmin
        .from('project_quote_items')
        .select('*')
        .eq('quote_id', q.id)
        .order('line_no', { ascending: true });

    if (itemsError) {
        return <div className="p-10 text-red-600">Failed to load quote items: {itemsError.message}</div>;
    }

    const subTotal = Number(q.sub_total || 0);
    const gstAmount = Number(q.gst_amount || 0);
    const grandTotal = Number(q.grand_total || 0);
    const gstPercent = Number(q.gst_percent || 0);

    return (
        <div className="min-h-screen bg-white text-slate-900">
            <div className="max-w-4xl mx-auto p-6 md:p-10">
                <div className="flex items-center justify-between gap-4 mb-6 print:hidden">
                    <div className="text-sm text-slate-500">Quote view</div>
                    <QuoteShareActions />
                </div>

                <div className="border rounded-lg p-6 md:p-8">
                    <div className="flex items-start justify-between gap-6">
                        <div>
                            <div className="text-xl font-bold">Quotation</div>
                            <div className="text-sm text-slate-600 mt-1">
                                Date: {q.issued_date ? new Date(q.issued_date).toLocaleDateString() : new Date().toLocaleDateString()}
                            </div>
                            <div className="text-sm text-slate-600 mt-1">Quote #: {q.quote_number || `#${q.id}`}</div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm font-semibold text-slate-800">{q.vendor_name || 'Vendor'}</div>
                            <div className="text-xs text-slate-500">Generated from Project Studio</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                        <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">To</div>
                            <div className="mt-2 text-sm">
                                <div className="font-medium">{q.customer_name || 'Customer'}</div>
                                <div className="text-slate-600 whitespace-pre-line">{q.customer_address || ''}</div>
                            </div>
                        </div>
                        <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Subject</div>
                            <div className="mt-2 text-sm text-slate-700">{q.subject || q.title || 'Quotation'}</div>
                        </div>
                    </div>

                    <div className="mt-8">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-2 pr-2 w-12">S No</th>
                                        <th className="text-left py-2 pr-2">Scope</th>
                                        <th className="text-left py-2 pr-2 w-24">Metric</th>
                                        <th className="text-right py-2 pr-2 w-20">Qty</th>
                                        <th className="text-right py-2 pr-2 w-32">Price</th>
                                        <th className="text-right py-2 w-32">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(items || []).map((it: any, idx: number) => {
                                        const qty = it.quantity != null ? Number(it.quantity) : null;
                                        const price = it.unit_price != null ? Number(it.unit_price) : null;
                                        const amount = it.amount != null ? Number(it.amount) : (qty != null && price != null ? qty * price : 0);
                                        return (
                                            <tr key={it.id} className="border-b">
                                                <td className="py-2 pr-2">{idx + 1}</td>
                                                <td className="py-2 pr-2 whitespace-pre-line">{it.scope}</td>
                                                <td className="py-2 pr-2">{it.metric || '—'}</td>
                                                <td className="py-2 pr-2 text-right">{qty != null ? qty : '—'}</td>
                                                <td className="py-2 pr-2 text-right">{price != null ? formatMoney(price) : '—'}</td>
                                                <td className="py-2 text-right font-medium">{formatMoney(amount)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <div className="w-full max-w-sm text-sm">
                                <div className="flex justify-between py-1">
                                    <span className="text-slate-600">Subtotal</span>
                                    <span className="font-medium">{formatMoney(subTotal)}</span>
                                </div>
                                <div className="flex justify-between py-1">
                                    <span className="text-slate-600">GST ({gstPercent}%)</span>
                                    <span className="font-medium">{formatMoney(gstAmount)}</span>
                                </div>
                                <div className="flex justify-between py-2 border-t mt-2">
                                    <span className="font-semibold">Grand Total</span>
                                    <span className="font-bold">{formatMoney(grandTotal)}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {q.terms ? (
                        <div className="mt-8">
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Terms & Conditions</div>
                            <div className="mt-2 text-sm text-slate-700 whitespace-pre-line">{q.terms}</div>
                        </div>
                    ) : null}
                </div>

                <div className="mt-6 text-xs text-slate-500 print:hidden">
                    Powered by Project Studio. <Link className="underline" href="/login">Login</Link>
                </div>
            </div>
        </div>
    );
}

