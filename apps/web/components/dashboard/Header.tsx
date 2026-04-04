'use client';

import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { COMPANY } from '@/lib/company';

export function Header() {
    const router = useRouter();

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/login');
    };

    return (
        <header className="flex h-14 items-center justify-between border-b bg-white px-6">
            <div className="leading-tight">
                <h1 className="text-lg font-semibold">{COMPANY.name}</h1>
                <p className="text-xs text-muted-foreground">GST: {COMPANY.gstNo}</p>
            </div>
            <Button onClick={handleLogout} className="bg-blue-600 text-white hover:bg-blue-700 h-9 px-3 text-sm">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
            </Button>
        </header>
    );
}
