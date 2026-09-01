import type { Metadata, Viewport } from "next";
import { AppShellWrapper } from "@/components/app-shell-wrapper";
import { ToastProvider } from "@/components/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { getCurrentUser } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: "SACSI | 科建地产房屋管理系统",
  description: "11#公寓首期业务管理系统",
  manifest: "/manifest.json",
  icons: { icon: "/favicon.ico", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SACSI" },
};

export const viewport: Viewport = {
  themeColor: "#f7f5f2",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
              // Prevent flash of wrong theme
              const theme = localStorage.getItem('sacsi-theme');
              if (theme === 'dark') document.documentElement.classList.add('dark');
            } catch (_) {}

            // Retire stale PWA workers/caches left by older mobile releases.
            // Those releases cached the root route and Next.js chunks, so a successful
            // login could be followed by an obsolete anonymous page.
            try {
              if (!('serviceWorker' in navigator)) return;
              const cleanupKey = 'sacsi-sw-cleanup-v3';
              if (sessionStorage.getItem(cleanupKey)) return;
              const wasControlled = Boolean(navigator.serviceWorker.controller);
              Promise.all([
                navigator.serviceWorker.getRegistrations().then(function(registrations) {
                  return Promise.all(registrations.map(function(registration) {
                    return registration.unregister();
                  }));
                }),
                'caches' in window
                  ? caches.keys().then(function(keys) {
                      return Promise.all(keys
                        .filter(function(key) { return key.indexOf('sacsi') === 0; })
                        .map(function(key) { return caches.delete(key); }));
                    })
                  : Promise.resolve()
              ]).then(function() {
                sessionStorage.setItem(cleanupKey, '1');
                if (wasControlled) window.location.reload();
              }).catch(function() {});
            } catch (_) {}
          })();
        `}} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <AppShellWrapper
              userRole={user?.role}
              userDisplayName={user?.displayName}
            >
              {children}
            </AppShellWrapper>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
