import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import ErroresVisibles from "@/components/errores-visibles";
import EstadoDelNavegador from "@/components/estado-del-navegador";
import "./globals.css";

/**
 * Manrope la sirve el mismo dominio de Tasa (next/font la descarga al
 * compilar), no Google en cada visita. `swap` muestra el texto de
 * inmediato con la del sistema mientras llega.
 */
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "Tasa",
  description: "Portal de comisionistas de servicios de valuación",
  applicationName: "Tasa",
  appleWebApp: { capable: true, title: "Tasa", statusBarStyle: "default" },
  // Los archivos viven en public/ (el proxy deja pasar .svg y .png sin sesión).
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // La barra del navegador del teléfono. Next pide el color como texto:
  // es el mismo blanco de --fondo en globals.css.
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`h-full antialiased ${manrope.variable}`}>
      <body className="flex min-h-full flex-col">
        <ErroresVisibles />
        <EstadoDelNavegador />
        {children}
      </body>
    </html>
  );
}
