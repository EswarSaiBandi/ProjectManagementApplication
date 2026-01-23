'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center p-24 bg-gray-50">
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold text-red-600">Something went wrong!</h2>
            <p className="text-gray-600">{error.message || 'An unexpected error occurred'}</p>
            <div className="flex gap-4 justify-center">
              <Button onClick={reset}>Try again</Button>
              <Button variant="outline" onClick={() => window.location.href = '/'}>
                Go home
              </Button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

