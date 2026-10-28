import type { MetadataRoute } from "next";

/**
 * Para agregar Tasa a la pantalla de inicio del celular. Se sirve en
 * /manifest.webmanifest, que el proxy deja pasar sin sesión.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tasa",
    short_name: "Tasa",
    description: "Portal de comisionistas de servicios de valuación",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#04386C",
    icons: [
      { src: "/tasa-icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/tasa-icono-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
