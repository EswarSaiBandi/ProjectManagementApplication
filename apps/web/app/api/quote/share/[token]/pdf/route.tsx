import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    // Dynamically import React PDF to avoid build-time issues
    const React = await import('react');
    const { Document, Page, Text, View, StyleSheet, pdf } = await import('@react-pdf/renderer');

    const supabaseAdmin = getSupabaseAdmin();
    const token = params.token;

    // Fetch quote data
    const { data: quote, error: quoteError } = await supabaseAdmin
      .from('project_quotes')
      .select('*')
      .eq('share_token', token)
      .eq('share_enabled', true)
      .limit(1);

    if (quoteError || !quote || quote.length === 0) {
      return NextResponse.json(
        { error: 'Quote not found or sharing disabled' },
        { status: 404 }
      );
    }

    const q = quote[0];

    // Fetch quote items
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('project_quote_items')
      .select('*')
      .eq('quote_id', q.id)
      .order('line_no', { ascending: true });

    if (itemsError) {
      return NextResponse.json(
        { error: 'Failed to fetch quote items' },
        { status: 500 }
      );
    }

    // Define styles inline for dynamic context
    const styles = StyleSheet.create({
      page: {
        padding: 40,
        fontSize: 10,
        fontFamily: 'Helvetica',
      },
      header: {
        marginBottom: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
      },
      title: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 5,
      },
      subtitle: {
        fontSize: 10,
        color: '#666',
        marginBottom: 3,
      },
      section: {
        marginBottom: 15,
      },
      sectionTitle: {
        fontSize: 9,
        fontWeight: 'bold',
        color: '#666',
        marginBottom: 5,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      },
      text: {
        fontSize: 10,
        marginBottom: 3,
      },
      boldText: {
        fontWeight: 'bold',
      },
      grid: {
        flexDirection: 'row',
        marginBottom: 15,
      },
      gridColumn: {
        flex: 1,
        paddingRight: 10,
      },
      table: {
        marginTop: 15,
        marginBottom: 15,
      },
      tableHeader: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#000',
        paddingBottom: 5,
        marginBottom: 5,
      },
      tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#ddd',
        paddingVertical: 5,
      },
      tableCell: {
        fontSize: 9,
      },
      tableCellHeader: {
        fontSize: 9,
        fontWeight: 'bold',
      },
      colSNo: {
        width: '8%',
      },
      colScope: {
        width: '40%',
      },
      colMetric: {
        width: '15%',
      },
      colQty: {
        width: '10%',
        textAlign: 'right',
      },
      colPrice: {
        width: '15%',
        textAlign: 'right',
      },
      colAmount: {
        width: '15%',
        textAlign: 'right',
      },
      totalsContainer: {
        marginTop: 10,
        alignItems: 'flex-end',
      },
      totalsBox: {
        width: '40%',
        minWidth: 200,
      },
      totalRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 3,
      },
      totalRowBorder: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 5,
        borderTopWidth: 1,
        borderTopColor: '#000',
        marginTop: 5,
      },
      totalLabel: {
        fontSize: 9,
        color: '#666',
      },
      totalValue: {
        fontSize: 9,
        fontWeight: 'bold',
      },
      grandTotalLabel: {
        fontSize: 10,
        fontWeight: 'bold',
      },
      grandTotalValue: {
        fontSize: 10,
        fontWeight: 'bold',
      },
    });

    const formatMoney = (n: number) => {
      return `₹ ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0)}`;
    };

    const subTotal = Number(q.sub_total || 0);
    const gstAmount = Number(q.gst_amount || 0);
    const grandTotal = Number(q.grand_total || 0);
    const gstPercent = Number(q.gst_percent || 0);

    // Generate PDF
    const pdfDoc = React.createElement(
      Document,
      {},
      React.createElement(
        Page,
        { size: 'A4', style: styles.page },
        // Header
        React.createElement(
          View,
          { style: styles.header },
          React.createElement(
            View,
            {},
            React.createElement(Text, { style: styles.title }, 'Quotation'),
            React.createElement(
              Text,
              { style: styles.subtitle },
              `Date: ${q.issued_date ? new Date(q.issued_date).toLocaleDateString() : new Date().toLocaleDateString()}`
            ),
            React.createElement(Text, { style: styles.subtitle }, `Quote #: ${q.quote_number || `#${q.id}`}`)
          ),
          React.createElement(
            View,
            { style: { textAlign: 'right' } },
            React.createElement(Text, { style: [styles.text, styles.boldText] }, q.vendor_name || 'Vendor'),
            React.createElement(Text, { style: styles.subtitle }, 'Generated from Project Studio')
          )
        ),
        // Customer & Subject
        React.createElement(
          View,
          { style: styles.grid },
          React.createElement(
            View,
            { style: styles.gridColumn },
            React.createElement(Text, { style: styles.sectionTitle }, 'To'),
            React.createElement(Text, { style: [styles.text, styles.boldText] }, q.customer_name || 'Customer'),
            React.createElement(Text, { style: styles.text }, q.customer_address || '')
          ),
          React.createElement(
            View,
            { style: styles.gridColumn },
            React.createElement(Text, { style: styles.sectionTitle }, 'Subject'),
            React.createElement(Text, { style: styles.text }, q.subject || q.title || 'Quotation')
          )
        ),
        // Table
        React.createElement(
          View,
          { style: styles.table },
          React.createElement(
            View,
            { style: styles.tableHeader },
            React.createElement(Text, { style: [styles.tableCellHeader, styles.colSNo] }, 'S No'),
            React.createElement(Text, { style: [styles.tableCellHeader, styles.colScope] }, 'Scope'),
            React.createElement(Text, { style: [styles.tableCellHeader, styles.colMetric] }, 'Metric'),
            React.createElement(Text, { style: [styles.tableCellHeader, styles.colQty] }, 'Qty'),
            React.createElement(Text, { style: [styles.tableCellHeader, styles.colPrice] }, 'Price'),
            React.createElement(Text, { style: [styles.tableCellHeader, styles.colAmount] }, 'Amount')
          ),
          ...(items || []).map((item: any, idx: number) => {
            const qty = item.quantity != null ? Number(item.quantity) : null;
            const price = item.unit_price != null ? Number(item.unit_price) : null;
            const amount = item.amount != null ? Number(item.amount) : (qty != null && price != null ? qty * price : 0);
            
            return React.createElement(
              View,
              { key: item.id, style: styles.tableRow },
              React.createElement(Text, { style: [styles.tableCell, styles.colSNo] }, String(idx + 1)),
              React.createElement(Text, { style: [styles.tableCell, styles.colScope] }, item.scope),
              React.createElement(Text, { style: [styles.tableCell, styles.colMetric] }, item.metric || '—'),
              React.createElement(Text, { style: [styles.tableCell, styles.colQty] }, qty != null ? String(qty) : '—'),
              React.createElement(Text, { style: [styles.tableCell, styles.colPrice] }, price != null ? formatMoney(price) : '—'),
              React.createElement(Text, { style: [styles.tableCell, styles.colAmount] }, formatMoney(amount))
            );
          })
        ),
        // Totals
        React.createElement(
          View,
          { style: styles.totalsContainer },
          React.createElement(
            View,
            { style: styles.totalsBox },
            React.createElement(
              View,
              { style: styles.totalRow },
              React.createElement(Text, { style: styles.totalLabel }, 'Subtotal'),
              React.createElement(Text, { style: styles.totalValue }, formatMoney(subTotal))
            ),
            React.createElement(
              View,
              { style: styles.totalRow },
              React.createElement(Text, { style: styles.totalLabel }, `GST (${gstPercent}%)`),
              React.createElement(Text, { style: styles.totalValue }, formatMoney(gstAmount))
            ),
            React.createElement(
              View,
              { style: styles.totalRowBorder },
              React.createElement(Text, { style: styles.grandTotalLabel }, 'Grand Total'),
              React.createElement(Text, { style: styles.grandTotalValue }, formatMoney(grandTotal))
            )
          )
        ),
        // Terms
        q.terms ? React.createElement(
          View,
          { style: [styles.section, { marginTop: 20 }] },
          React.createElement(Text, { style: styles.sectionTitle }, 'Terms & Conditions'),
          React.createElement(Text, { style: styles.text }, q.terms)
        ) : null
      )
    );

    const pdfBlob = await pdf(pdfDoc).toBlob();
    
    // Convert blob to buffer
    const buffer = Buffer.from(await pdfBlob.arrayBuffer());

    // Return PDF with proper headers
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="quote-${q.quote_number || q.id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
