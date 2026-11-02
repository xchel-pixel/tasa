/**
 * Íconos de la tarjeta digital: la lista fija de "Mis servicios" y los de las redes. SVG propios,
 * sin librerías, en el color del texto (currentColor). La lista coincide con la de la base
 * (`tarjeta_servicios.icono`).
 */

export const ICONOS_SERVICIO = [
  { clave: "casa", nombre: "Casa" },
  { clave: "edificio", nombre: "Edificio" },
  { clave: "llave", nombre: "Llave" },
  { clave: "documento", nombre: "Documento" },
  { clave: "calculadora", nombre: "Calculadora" },
  { clave: "maletin", nombre: "Maletín" },
  { clave: "trato", nombre: "Trato" },
  { clave: "grafica", nombre: "Gráfica" },
  { clave: "escudo", nombre: "Escudo" },
  { clave: "herramienta", nombre: "Herramienta" },
  { clave: "camara", nombre: "Cámara" },
  { clave: "mapa", nombre: "Mapa" },
] as const;

export type ClaveIcono = (typeof ICONOS_SERVICIO)[number]["clave"];

const TRAZOS: Record<string, React.ReactNode> = {
  casa: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  edificio: <><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M11 21v-3h2v3" /></>,
  llave: <><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M17 5l2 2M15 7l2 2" /></>,
  documento: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  calculadora: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0" /></>,
  maletin: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5h6v2M3 13h18" /></>,
  trato: <><path d="M3 12l4-4 4 3 3-3 7 6" /><path d="M7 14l3 3M10 13l3 3M13 12l3 3" /></>,
  grafica: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-7" /></>,
  escudo: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  herramienta: <><path d="M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z" /></>,
  camara: <><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="12" cy="13" r="3.5" /><path d="M9 7l1.5-3h3L15 7" /></>,
  mapa: <><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" /><circle cx="12" cy="10" r="2" /></>,
  facebook: <><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h0" /></>,
  tiktok: <><path d="M14 3v11a4 4 0 1 1-4-4" /><path d="M14 3c.5 3 2.5 5 5 5" /></>,
  linkedin: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 10v7M8 7h0M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" /></>,
  sitio: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
};

export function Icono({ clave, className = "size-6" }: { clave: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      {TRAZOS[clave] ?? TRAZOS.casa}
    </svg>
  );
}
