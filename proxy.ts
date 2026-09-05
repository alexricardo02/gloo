import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';


const intlMiddleware = createMiddleware({
  locales: ['en', 'de', 'es', 'fr', 'it'], // languages
  defaultLocale: 'en'
});

export default function middleware(req: NextRequest) {
  // 2. if user is guest
  const isGuest = req.cookies.get('gloo_is_guest')?.value === 'true';
  
  // Where does he want to go?
  const pathname = req.nextUrl.pathname;

  // 3. protected zones
  const isProtectedRoute = /\/(messages|chat|profile)/.test(pathname);

  if (isGuest && isProtectedRoute) {
    const localeMatch = pathname.match(/^\/([a-z]{2})\//);
    const locale = localeMatch ? localeMatch[1] : 'en';
    
    // redirecto to dashboard if guest tries to access protected route
    const redirectUrl = new URL(`/${locale}/search-groups`, req.url);
    redirectUrl.searchParams.set('showPaywall', 'true');
    return NextResponse.redirect(redirectUrl);
  }

  return intlMiddleware(req);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};

