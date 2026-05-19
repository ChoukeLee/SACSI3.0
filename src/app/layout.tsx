import type { Metadata, Viewport } from "next";
import { AppShellWrapper } from "@/components/app-shell-wrapper";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SACIS 3.0 | 科建地产房屋管理系统",
  description: "11#公寓首期业务管理系统",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SACIS 3.0" },
};

export const viewport: Viewport = { themeColor: "#C96F2D" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="zh-CN">
      <body>
        <AppShellWrapper userRole={user?.role} userDisplayName={user?.displayName}>
          {children}
        </AppShellWrapper>
        <script defer dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(reg){reg.unregister()})});
          }
        `}} />
      </body>
    </html>
  );
}
