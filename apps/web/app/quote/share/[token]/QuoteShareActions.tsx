'use client';

import { useState } from 'react';

export default function QuoteShareActions({ pdfUrl }: { pdfUrl: string }) {
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownloadPDF = async () => {
        setIsDownloading(true);
        try {
            const response = await fetch(pdfUrl);
            if (!response.ok) {
                // Fallback to print if API fails
                console.log('API failed, opening print dialog');
                window.print();
                setIsDownloading(false);
                return;
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quote-${Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('PDF download failed, using print fallback:', error);
            // Fallback to print dialog
            window.print();
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="flex gap-2">
            <button
                type="button"
                className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={handleDownloadPDF}
                disabled={isDownloading}
            >
                {isDownloading ? 'Processing...' : 'Download PDF'}
            </button>
            <button
                type="button"
                className="inline-flex items-center rounded-md bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800"
                onClick={() => window.print()}
            >
                Print / Save as PDF
            </button>
        </div>
    );
}

