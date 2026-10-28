"use client";

import { useState } from "react";
import { registrarMiCsf } from "@/app/acciones-csf";
import { CampoArchivo } from "@/components/campo-archivo";

/** Para quien se dio de alta con "CSF pendiente": la sube aquí mismo, en PDF. */
export function AvisoCsf({ carpeta }: { carpeta: string }) {
  const [estado, setEstado] = useState<{ error: string | null; listo: boolean }>({ error: null, listo: false });

  if (estado.listo) {
    return <p className="mt-4 rounded-lg bg-exito-fondo px-4 py-3 text-[0.9375rem] text-exito">Recibimos tu constancia. Gracias.</p>;
  }
  return (
    <div className="mt-4 rounded-xl border border-proceso bg-proceso-fondo px-4 py-4">
      <CampoArchivo
        bucket="altas"
        carpeta={carpeta}
        nombre="csf_ruta"
        soloPdf
        etiqueta="Sube tu Constancia de Situación Fiscal"
        ayuda="El PDF que descargas del SAT. La necesitamos para pagarte tus comisiones."
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
