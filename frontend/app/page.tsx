'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/store';
import { LOGIN_ROUTE, ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

/**
 * Application entry point.
 *
 * Holds no screens of its own: it sends an unauthenticated visitor to the
 * sign-in route and an authenticated one to the landing route for the role on
 * their account record. Every screen now lives at its own URL under
 * /buyer, /category-manager, /vendor or /admin.
 */
export default function HomePage() {
  const router = useRouter();
  const { isLoggedIn, currentRole } = useApp();

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace(LOGIN_ROUTE);
      return;
    }
    router.replace(ROLE_LANDING_ROUTE[currentRole] || ROLE_LANDING_ROUTE.buyer);
  }, [isLoggedIn, currentRole, router]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <p className="text-xs text-slate-500 dark:text-gray-400">{UI_STRINGS.auth.redirecting}</p>
    </div>
  );
}
