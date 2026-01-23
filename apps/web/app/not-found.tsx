import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24 bg-gray-50">
      <div className="text-center space-y-4">
        <h2 className="text-4xl font-bold text-gray-900">404</h2>
        <p className="text-xl text-gray-600">Page Not Found</p>
        <p className="text-gray-500">The page you are looking for does not exist.</p>
        <Link href="/">
          <Button>Return Home</Button>
        </Link>
      </div>
    </div>
  );
}

