'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target } from 'lucide-react';

export default function LeadsPage() {
  return (
    <div className="p-8 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <Card className="bg-white shadow-sm">
          <CardHeader className="border-b bg-slate-50">
            <CardTitle className="text-2xl flex items-center gap-2">
              <Target className="h-6 w-6 text-blue-600" />
              Leads Management
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8">
            <div className="text-center">
              <div className="mb-4">
                <Target className="h-16 w-16 text-slate-300 mx-auto" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                Leads Module Temporarily Disabled
              </h3>
              <p className="text-slate-600">
                This page is currently undergoing maintenance and will be available soon.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
