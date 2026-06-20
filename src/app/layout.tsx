import type { Metadata, Viewport } from "next";
import { AppShellWrapper } from "@/components/app-shell-wrapper";
import { getCurrentUser } from "@/lib/auth";
import { notificationStrings } from "@/lib/dictionaries/notifications";

import "./globals.css";

export const metadata: Metadata = {
  title: "SACIS 3.0 | ç§‘å»ºåœ°äº§æˆ¿å±‹ç®¡ç†ç³»ç»Ÿ",
  description: "11#å…¬å¯“é¦–æœŸä¸šåŠ¡ç®¡ç†ç³»ç»Ÿ",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SACIS 3.0" },
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
        <AppShellWrapper userRole={user?.role} userDisplayName={user?.displayName} notifT={notificationStrings.zh} notifTFr={notificationStrings.fr}>
          {children}
        </AppShellWrapper>
      </body>
    </html>
  );
}



