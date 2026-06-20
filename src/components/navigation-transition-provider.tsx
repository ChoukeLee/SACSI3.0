"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";

interface NavTransitionContextType {
  pendingHref: string | null;
  startNavigation: (href: string) => void;
  clearNavigation: () => void;
  isNavigating: boolean;
}

const NavTransitionContext = createContext<NavTransitionContextType>({
  pendingHref: null,
  startNavigation: () => {},
  clearNavigation: () => {},
  isNavigating: false,
});

export function useNavigationTransition() {
  return useContext(NavTransitionContext);
}

function normalizePath(path: string) {
  // Strip trailing slash + query/hash so /management/ and /management both match
  return path.replace(/[/]+$/, "").replace(/[?#].*$/, "") || "/";
}

export function NavigationTransitionProvider({ children }: { children: React.ReactNode }) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pathname = usePathname();

  const startNavigation = useCallback((href: string) => {
    const normalized = normalizePath(href);
    // Don't trigger loading overlay for same-page clicks
    if (normalizePath(pathname) === normalized) return;
    setPendingHref(normalized);
  }, [pathname]);

  const clearNavigation = useCallback(() => {
    setPendingHref(null);
  }, []);

  useEffect(() => {
    if (pendingHref != null && normalizePath(pathname) === pendingHref) {
      setPendingHref(null);
    }
  }, [pathname, pendingHref]);

  useEffect(() => {
    if (pendingHref == null) return;
    const timeout = window.setTimeout(() => setPendingHref(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [pendingHref]);

  const isNavigating = pendingHref !== null;

  return (
    <NavTransitionContext.Provider value={{ pendingHref, startNavigation, clearNavigation, isNavigating }}>
      {children}
    </NavTransitionContext.Provider>
  );
}
