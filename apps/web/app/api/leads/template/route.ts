import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const csvTemplate = `Client Name*,Email,Phone,Address,Project Type,Estimated Value,Estimated Duration (Days),Source,Priority,Status,Description,Requirements,Notes,Contacted Date,Follow-up Date
John Doe,john@example.com,+91-9876543210,"123 Main St, Mumbai",Residential Interior,500000,45,Referral,High,New,"3BHK apartment full interior design","Modular kitchen, wardrobes, false ceiling","Client prefers modern minimalist style",2026-02-01,2026-02-10
Jane Smith,jane@example.com,+91-9876543211,"456 Park Ave, Delhi",Commercial Interior,1200000,60,Website,Medium,Contacted,"Office space 5000 sqft","Workstations, meeting rooms, reception","Budget flexible, needs quick turnaround",2026-02-05,2026-02-15
ABC Corp,contact@abc.com,+91-9876543212,"789 Business Center, Bangalore",Renovation,800000,30,Social Media,Urgent,Qualified,"Restaurant renovation","Kitchen upgrade, seating area redesign","Opening in 2 months",2026-02-03,2026-02-12

INSTRUCTIONS:
- Fields marked with * are mandatory
- Dates should be in YYYY-MM-DD format
- Priority: Low, Medium, High, Urgent
- Status: New, Contacted, In Progress, Qualified, Proposal Sent, Negotiation, Realized, Unrealized, Won, Lost
- Delete the sample rows before uploading your data
- You can customize Source and Priority options in Settings > Dynamic Field Configuration`;

  return new NextResponse(csvTemplate, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="leads_bulk_upload_template.csv"',
    },
  });
}
