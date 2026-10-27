"use client";

import { useActionState, useState } from "react";
import { subirFactura, type EstadoFactura } from "@/app/estado-de-cuenta/acciones";
import { BotonEnviar } from "@/components/boton-enviar";
import { CampoArchivo } from "@/components/campo-archivo";
import { Aviso } from "@/components/pantalla-admin";

/** El comisionista sube la factura o el recibo de su pago del mes. */
export function SubirFactura({
  pendienteId,
  personaId,
  reemplaza,
}: {
  pendienteId: string;
  personaId: string;
  reemplaza: boolean;
}) {
  const [estado, enviar] = useActionState<EstadoFactura, FormData>(subirFactura, { error: null, mensaje: null });
  const [ruta, setRuta] = useState<string | null>(null);

  if (estado.mensaje) return <div className="mt-3"><Aviso estado={estado} /></div>;
  return (
    <form action={enviar} className="mt-4 flex flex-col gap-3 border-t border-linea pt-4">
      <input type="hidden" name="pendiente_id" value={pendienteId} />
      <CampoArchivo
        bucket="facturas"
        personaId={personaId}
        nombre="factura_ruta"
        etiqueta={reemplaza ? "Reemplazar factura o recibo" : "Tu factura o recibo"}
        ayuda="PDF, XML o foto."
        xml
        onCambio={setRuta}
      />
      {ruta ? <BotonEnviar variante="secundario">Enviar a Administración</BotonEnviar> : null}
      <Aviso estado={estado} />
    </form>
  );
}
