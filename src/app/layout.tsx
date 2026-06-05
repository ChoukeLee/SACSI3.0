import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/next";
import { AppShellWrapper } from "@/components/app-shell-wrapper";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";

import Loading from "./loading";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SACIS 3.0 | 科建地产房屋管理系统",
  description: "11#公寓首期业务管理系统",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SACIS 3.0" },
};

export const viewport: Viewport = { themeColor: "#f7f5f2" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="zh-CN">
      <body>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            if (!location.pathname.includes('/daily-rentals')) return;
            try {
              if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
              var reset = function(){ scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; document.documentElement.scrollLeft = 0; document.body.scrollLeft = 0; };
              reset();
              addEventListener('pageshow', reset);
              addEventListener('DOMContentLoaded', reset);
              addEventListener('load', reset);
              [50, 250, 750, 1500, 3000].forEach(function(ms){ setTimeout(reset, ms); });
            } catch (_) {}
          })();
        `}} />
        <AppShellWrapper userRole={user?.role} userDisplayName={user?.displayName} notifT={dictionaries.zh.shell.notifications} notifTFr={dictionaries.fr.shell.notifications}>
          <Suspense fallback={<Loading />}>
            {children}
          </Suspense>
        </AppShellWrapper>
        <script defer dangerouslySetInnerHTML={{ __html: `
          (function(){
            if (!('serviceWorker' in navigator)) return;
            Promise.all([
              navigator.serviceWorker.getRegistrations().then(function(regs){
                return Promise.all(regs.map(function(reg){ return reg.unregister(); }));
              }),
              'caches' in window
                ? caches.keys().then(function(keys){ return Promise.all(keys.map(function(key){ return caches.delete(key); })); })
                : Promise.resolve()
            ]).then(function(){
              if (navigator.serviceWorker.controller && !sessionStorage.getItem('sacis-sw-cleaned')) {
                sessionStorage.setItem('sacis-sw-cleaned', '1');
                window.location.reload();
              }
            }).catch(function(){});
          })();
        `}} />
        <Analytics />
      </body>
    </html>
  );
}
