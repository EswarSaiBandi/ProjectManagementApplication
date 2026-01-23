'use client';

import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export function Header() {
    const router = useRouter();

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/login');
    };

    return (
        <header className="flex h-14 items-center justify-between border-b bg-white px-6">
            <h1 className="text-lg font-semibold">Dashboard</h1>
            <Button onClick={handleLogout} className="bg-blue-600 text-white hover:bg-blue-700 h-9 px-3 text-sm">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
            </Button>
        </header>
    );
}
