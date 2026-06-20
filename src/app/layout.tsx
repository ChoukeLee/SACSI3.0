import type { Metadata, Viewport } from "next";
import { AppShellWrapper } from "@/components/app-shell-wrapper";
import { getCurrentUser } from "@/lib/auth";
import { notificationStrings } from "@/lib/dictionaries/notifications";

import "./globals.css";

export const metadata: Metadata = {
  title: "SACSI | 科建地产房屋管理系统",
  description: "11#公寓首期业务管理系统",
  manifest: "/manifest.json",
  icons: { icon: "/favicon.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SACSI" },
};

export const viewport: Viewport = { themeColor: "#f7f5f2" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

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
        <AppShellWrapper
          userRole={user?.role}
          userDisplayName={user?.displayName}
          notifT={notificationStrings.zh}
          notifTFr={notificationStrings.fr}
        >
          {children}
        </AppShellWrapper>
      </body>
    </html>
  );
}
