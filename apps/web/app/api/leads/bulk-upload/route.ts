import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabaseAdmin() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function parseCSV(csvText: string): any[] {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/\*/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length < headers.length) continue;

    const row: any = {};
    headers.forEach((header, idx) => {
      const value = values[idx]?.trim().replace(/^"|"$/g, '');
      
      switch (header.toLowerCase()) {
        case 'client name':
          row.client_name = value;
          break;
        case 'email':
          row.email = value || null;
          break;
        case 'phone':
          row.phone = value || null;
          break;
        case 'address':
          row.address = value || null;
          break;
        case 'project type':
          row.project_type = value || null;
          break;
        case 'estimated value':
          row.estimated_value = value ? parseFloat(value) : null;
          break;
        case 'estimated duration (days)':
          row.estimated_duration_days = value ? parseInt(value) : null;
          break;
        case 'source':
          row.source = value || null;
          break;
        case 'priority':
          row.priority = value || 'Medium';
          break;
        case 'status':
          row.status = value || 'New';
          break;
        case 'description':
          row.description = value || null;
          break;
        case 'requirements':
          row.requirements = value || null;
          break;
        case 'notes':
          row.notes = value || null;
          break;
        case 'contacted date':
          row.contacted_date = value || null;
          break;
        case 'follow-up date':
          row.follow_up_date = value || null;
          break;
      }
    });

    if (row.client_name) {
      row.project_name = row.client_name + ' Project';
      rows.push(row);
    }
  }

  return rows;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'Only CSV files are supported' }, { status: 400 });
    }

    const csvText = await file.text();
    const leads = parseCSV(csvText);

    if (leads.length === 0) {
      return NextResponse.json({ error: 'No valid leads found in CSV' }, { status: 400 });
    }

    // Insert leads into database
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('leads')
      .insert(leads)
      .select();

    if (error) {
      console.error('Bulk insert error:', error);
      return NextResponse.json({ error: error.message || 'Failed to insert leads' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `Successfully uploaded ${data?.length || 0} leads`,
      count: data?.length || 0
    });

  } catch (error: any) {
    console.error('Bulk upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
