import type { Metadata, Viewport } from "next";
import ErroresVisibles from "@/components/errores-visibles";
import EstadoDelNavegador from "@/components/estado-del-navegador";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tasa",
  description: "Portal de comisionistas de servicios de valuación",
  applicationName: "Tasa",
  appleWebApp: { capable: true, title: "Tasa", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafaf9",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <ErroresVisibles />
        <EstadoDelNavegador />
        {children}
      </body>
    </html>
  );
}
