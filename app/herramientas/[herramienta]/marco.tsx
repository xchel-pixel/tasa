"use client";

import { useEffect, useRef, useState } from "react";

/**
 * La herramienta dentro de Tasa: un marco del mismo sitio (su ruta /h/... con sesión y CSP propia) que crece con su
 * contenido (la herramienta avisa su altura), para que la página tenga una sola barra.
 */
export function MarcoHerramienta({ src, titulo }: { src: string; titulo: string }) {
  const marco = useRef<HTMLIFrameElement>(null);
  const [alto, setAlto] = useState(900);
  useEffect(() => {
    const oir = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== marco.current?.contentWindow) return;
      const h = Number((e.data as { tasaAltura?: unknown } | null)?.tasaAltura);
      if (Number.isFinite(h) && h > 200 && h < 40_000) setAlto(Math.ceil(h) + 8);
    };
    addEventListener("message", oir);
    return () => removeEventListener("message", oir);
  }, []);
  return <iframe ref={marco} src={src} title={titulo} className="mt-3 block w-full rounded-xl border border-linea bg-fondo" style={{ height: alto }} />;
}
