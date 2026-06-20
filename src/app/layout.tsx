import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { AppShellWrapper } from "@/components/app-shell-wrapper";
import { StaticShell } from "@/components/static-shell";
import { getCurrentUser } from "@/lib/auth";
import { notificationStrings } from "@/lib/dictionaries/notifications";

import "./globals.css";

export const metadata: Metadata = {
  title: "SACIS 3.0 | 科建地产房屋管理系统",
  description: "11#公寓首期业务管理系统",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SACIS 3.0" },
};

export const viewport: Viewport = { themeColor: "#f7f5f2" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
              if (location.pathname === '/daily-rentals' || location.pathname === '/fr/daily-rentals') {
                window.scrollTo(0, 0);
              }
            } catch (_) {}
          })();
        `}} />
      </head>
      <body>
        {/* PERF: StaticShell renders instantly (zero data fetching).
             The real AppShell with auth streams in when getCurrentUser resolves. */}
        <Suspense fallback={<StaticShell>{children}</StaticShell>}>
          <AuthShell>{children}</AuthShell>
        </Suspense>
      </body>
    </html>
  );
}

/** Inner async component — awaits auth then renders the full AppShell. */
async function AuthShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <AppShellWrapper
      userRole={user?.role}
      userDisplayName={user?.displayName}
      notifT={notificationStrings.zh}
      notifTFr={notificationStrings.fr}
    >
      {children}
    </AppShellWrapper>
  );
}
