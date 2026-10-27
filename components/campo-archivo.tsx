"use client";

import { useRef, useState } from "react";
import { useMontado } from "@/components/montado";
import { subirArchivo } from "@/lib/subir-archivo";

type Subida =
  | { paso: "vacio" }
  | { paso: "subiendo" }
  | { paso: "listo"; ruta: string; nombre: string }
  | { paso: "error"; mensaje: string };

/**
 * Elegir un archivo lo sube en ese momento al bucket privado; el
 * formulario solo lleva la ruta en un campo oculto (`nombre`).
 */
export function CampoArchivo({
  bucket,
  carpeta,
  nombre,
  etiqueta,
  ayuda,
  xml = false,
  opcional = false,
  onCambio,
}: {
  bucket: "comprobantes" | "facturas";
  /** `{organización}/{persona}` de quien sube. */
  carpeta: string;
  nombre: string;
  etiqueta: string;
  ayuda?: string;
  xml?: boolean;
  opcional?: boolean;
  onCambio?: (ruta: string | null) => void;
}) {
  const [subida, setSubida] = useState<Subida>({ paso: "vacio" });
  const entrada = useRef<HTMLInputElement>(null);
  const montado = useMontado();
  const id = `archivo-${nombre}`;

  async function alElegir(evento: React.ChangeEvent<HTMLInputElement>) {
    const elegido = evento.target.files?.[0];
    if (!elegido) return;
    setSubida({ paso: "subiendo" });
    onCambio?.(null);
    try {
      const ruta = await subirArchivo(bucket, carpeta, elegido, { xml });
      setSubida({ paso: "listo", ruta, nombre: elegido.name });
      onCambio?.(ruta);
    } catch (falla) {
      setSubida({ paso: "error", mensaje: `No se pudo subir: ${falla instanceof Error ? falla.message : String(falla)}` });
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <div>
      {subida.paso === "listo" ? <input type="hidden" name={nombre} value={subida.ruta} /> : null}
      <label htmlFor={id} className="block font-semibold">
        {etiqueta} {opcional ? <span className="font-normal text-secundario">(opcional)</span> : null}
      </label>
      {ayuda ? <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">{ayuda}</p> : null}
      <input
        id={id}
        ref={entrada}
        type="file"
        accept={xml ? "image/*,application/pdf,.xml,text/xml,application/xml" : "image/*,application/pdf"}
        disabled={!montado}
        onChange={alElegir}
        className="mt-3 block w-full text-[0.9375rem] text-secundario file:mr-4 file:rounded-lg file:border file:border-borde-campo file:bg-fondo file:px-4 file:py-2 file:text-[0.9375rem] file:font-semibold file:text-primario"
      />
      {!montado ? (
        <p className="mt-3 text-[0.9375rem] text-secundario">Preparando… si esto no desaparece, recarga la página.</p>
      ) : null}
      {subida.paso === "subiendo" ? <p className="mt-3 text-[0.9375rem] text-secundario">Subiendo…</p> : null}
      {subida.paso === "listo" ? (
        <p className="mt-3 rounded-lg bg-exito-fondo px-4 py-2 text-[0.9375rem] text-exito">Listo: {subida.nombre}</p>
      ) : null}
      {subida.paso === "error" ? <p className="mt-3 text-[0.9375rem] leading-6 text-error">{subida.mensaje}</p> : null}
    </div>
  );
}
