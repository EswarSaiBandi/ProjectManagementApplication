import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    // Legacy path: /labour → /manpower
    if (request.nextUrl.pathname === '/labour' || request.nextUrl.pathname.startsWith('/labour/')) {
        const url = request.nextUrl.clone()
        url.pathname = url.pathname.replace(/^\/labour/, '/manpower')
        return NextResponse.redirect(url)
    }

    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error('Missing Supabase environment variables:', {
            url: supabaseUrl ? 'present' : 'missing',
            key: supabaseAnonKey ? 'present' : 'missing'
        });
        return response;
    }

    const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                get(name: string) {
                    return request.cookies.get(name)?.value
                },
                set(name: string, value: string, options: CookieOptions) {
                    request.cookies.set({
                        name,
                        value,
                        ...options,
                    })
                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    })
                    response.cookies.set({
                        name,
                        value,
                        ...options,
                    })
                },
                remove(name: string, options: CookieOptions) {
                    request.cookies.set({
                        name,
                        value: '',
                        ...options,
                    })
                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    })
                    response.cookies.set({
                        name,
                        value: '',
                        ...options,
                    })
                },
            },
        }
    )

    // Refresh session if expired - required for Server Components
    // https://supabase.com/docs/guides/auth/server-side/nextjs
    const { data: { user } } = await supabase.auth.getUser()

    // Protect all authenticated app areas
    const protectedPaths = [
        '/projects', '/dashboard', '/settings', '/schedule', '/tasks',
        '/team', '/reports', '/inventory', '/leads', '/store', '/materials',
        '/movement-logs', '/leaves', '/manpower', '/attendance',
    ];
    const isProtectedPath = protectedPaths.some(path => request.nextUrl.pathname.startsWith(path));

    if (!user && isProtectedPath) {
        const redirectUrl = new URL('/login', request.url);
        return NextResponse.redirect(redirectUrl);
    }

    // Role-based route protection — fetch profile once for both checks
    const needsRoleCheck =
        request.nextUrl.pathname.startsWith('/leaves') ||
        request.nextUrl.pathname.startsWith('/inventory') ||
        request.nextUrl.pathname.startsWith('/manpower');

    if (user && needsRoleCheck) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('user_id', user.id)
            .single();

        const userRole = profile?.role ?? null;

        // /leaves — only block Clients; if profile missing let through (page handles it)
        if (request.nextUrl.pathname.startsWith('/leaves')) {
            if (userRole === 'Client') {
                return NextResponse.redirect(new URL('/projects', request.url));
            }
        }

        // /inventory — Admin only; if profile missing, block
        if (request.nextUrl.pathname.startsWith('/inventory')) {
            if (userRole !== 'Admin') {
                return NextResponse.redirect(new URL('/projects', request.url));
            }
        }

        // /manpower — Admin only
        if (request.nextUrl.pathname.startsWith('/manpower')) {
            if (userRole !== 'Admin') {
                return NextResponse.redirect(new URL('/projects', request.url));
            }
        }
    }

    // Optional: Redirect logged-in users away from /login
    // if (user && request.nextUrl.pathname === '/login') {
    //     return NextResponse.redirect(new URL('/projects', request.url))
    // }

    return response
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Feel free to modify this pattern to include more paths.
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
