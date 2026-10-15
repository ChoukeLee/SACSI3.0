"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useTransition,
  useRef,
} from "react";
import { usePathname, useRouter } from "next/navigation";

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
  return path.replace(/[?#].*$/, "").replace(/[/]+$/, "") || "/";
}

export function NavigationTransitionProvider({ children }: { children: React.ReactNode }) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const targetRef = useRef<string | null>(null);

  const startNavigation = useCallback(
    (href: string) => {
      const normalized = normalizePath(href);
      // Don't trigger loading overlay for same-page clicks
      if (normalizePath(pathname) === normalized || targetRef.current === normalized) return;
      targetRef.current = normalized;
      setPendingHref(normalized);
      startTransition(() => router.push(href));
    },
    [pathname, router],
  );

  const clearNavigation = useCallback(() => {
    targetRef.current = null;
    setPendingHref(null);
  }, []);

  useEffect(() => {
    if (!isPending || (pendingHref != null && normalizePath(pathname) === pendingHref)) {
      targetRef.current = null;
      setPendingHref(null);
    }
  }, [pathname, pendingHref, isPending]);

  // Pending follows the actual route transition, not a timer which exposes the
  // old page as interactive while a slower server response is still in flight.
  const isNavigating = isPending && pendingHref !== null;

  return (
    <NavTransitionContext.Provider
      value={{ pendingHref, startNavigation, clearNavigation, isNavigating }}
    >
      {children}
    </NavTransitionContext.Provider>
  );
}
