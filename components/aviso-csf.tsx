"use client";

import { useState } from "react";
import { registrarMiCsf } from "@/app/acciones-csf";
import { CampoArchivo } from "@/components/campo-archivo";

/**
 * El comisionista sube su CSF (o la reemplaza) en PDF. En el inicio
 * sale como aviso mientras está pendiente; en "Mis datos", siempre.
 * Cada cambio queda en la bitácora.
 */
export function AvisoCsf({ carpeta, reemplazar = false }: { carpeta: string; reemplazar?: boolean }) {
  const [estado, setEstado] = useState<{ error: string | null; listo: boolean }>({ error: null, listo: false });

  if (estado.listo) {
    return <p className="mt-4 rounded-lg bg-exito-fondo px-4 py-3 text-[0.9375rem] text-exito">Recibimos tu constancia. Gracias.</p>;
  }
  return (
    <div className={`mt-4 rounded-xl px-4 py-4 ${reemplazar ? "border border-linea" : "border border-proceso bg-proceso-fondo"}`}>
      <CampoArchivo
        bucket="altas"
        carpeta={carpeta}
        nombre="csf_ruta"
        soloPdf
        etiqueta={reemplazar ? "Reemplazar tu constancia" : "Sube tu Constancia de Situación Fiscal"}
        ayuda={
          reemplazar
            ? "Si cambió tu situación fiscal, sube la constancia nueva en PDF."
            : "El PDF que descargas del SAT. La necesitamos para pagarte tus comisiones."
        }
        onCambio={async (ruta) => {
          if (!ruta) return;
          const r = await registrarMiCsf(ruta);
          setEstado({ error: r.error, listo: !r.error });
        }}
      />
      {estado.error ? <p className="mt-2 text-[0.9375rem] text-error">{estado.error}</p> : null}
    </div>
  );
}
