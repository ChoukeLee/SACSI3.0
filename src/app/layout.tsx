import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SACIS 3.0 | 科建地产房屋管理系统",
  description: "11#公寓首期业务管理系统",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SACIS 3.0",
  },
};

export const viewport: Viewport = {
  themeColor: "#F77F00",
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {/* PERF: deferred SW script — doesn't block first paint */}
        <script
          defer
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                navigator.serviceWorker.getRegistrations().then(function(regs) {
                  regs.forEach(function(reg) { reg.unregister(); });
                });
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(
                    function(reg) { console.log('SW registered:', reg.scope); },
                    function(err) { console.log('SW failed:', err); }
                  );
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
