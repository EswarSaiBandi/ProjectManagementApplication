# Deployment Notes for Vercel

## Required Package Installation

Before deploying to Vercel, run the following commands:

```bash
cd apps/web
npm install
```

This will install:
- `@react-pdf/renderer@^4.3.2` - For generating PDF documents from React components
- All required dependencies with proper overrides for fontkit

## Known Issue: PDF Generation with @react-pdf/renderer

There's a known compatibility issue between `@react-pdf/renderer` and Next.js regarding the `fontkit` module resolution. We've added:

1. **Package override** in `package.json` to use fontkit@^2.0.2
2. **Fallback mechanism**: If PDF generation fails, the Download button will trigger the browser's print dialog (which can save as PDF)

### To Fix PDF Generation Locally:

```bash
cd apps/web
npm install
# This will apply the fontkit override

# Then restart your dev server
```

## Quote PDF Feature

The quote PDF download feature is implemented at:
- **API Route**: `/apps/web/app/api/quote/share/[token]/pdf/route.tsx`
- **Frontend**: Uses the share token to generate downloadable PDFs
- **Fallback**: Browser print dialog if API fails

## Workaround for Users

If the PDF download doesn't work immediately:
1. Click the "Download PDF" button (will fallback to print dialog)
2. Or click the "Print" button
3. In the print dialog, select "Save as PDF" as the destination
4. The PDF will be saved with all quote details

## Vercel Configuration

The app includes:
- Next.js webpack config for handling canvas and encoding modules
- Node.js runtime for the PDF API route
- Dynamic imports to avoid build-time issues

## Testing

To test the PDF download:
1. Create a quote with line items
2. Enable sharing for the quote
3. Click the "Download PDF" button
4. Either the PDF downloads directly, or the print dialog opens as a fallback

## Future Improvement

Consider migrating to a different PDF library like:
- `jspdf` with `jspdf-autotable` for better Next.js compatibility
- Or use a headless browser service (like Vercel's Edge Functions with Puppeteer)
