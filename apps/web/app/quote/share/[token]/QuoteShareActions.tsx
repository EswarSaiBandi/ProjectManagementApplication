'use client';

export default function QuoteShareActions() {
    const handleDownloadPDF = () => {
        // Use browser's print dialog which allows saving as PDF
        window.print();
    };

    return (
        <div className="flex gap-2">
            <button
                type="button"
                className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
                onClick={handleDownloadPDF}
            >
                Download PDF
            </button>
            <button
                type="button"
                className="inline-flex items-center rounded-md bg-slate-900 text-white px-3 py-2 text-sm hover:bg-slate-800"
                onClick={() => window.print()}
            >
                Print
            </button>
        </div>
    );
}

