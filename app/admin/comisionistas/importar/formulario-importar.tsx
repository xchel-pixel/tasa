"use client";

import { useActionState, useMemo, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { MAXIMO_FILAS, parsearTabla } from "@/lib/importar-comisionistas";
import { importarComisionistas, type EstadoImportar } from "./acciones";

const INICIAL: EstadoImportar = { error: null, resultados: null };

/**
 * Pegar → revisar → importar. La vista previa se calcula aquí mismo con
 * el mismo lector que usa el servidor; los correos ya dados de alta se
 * descubren al importar.
 */
export function FormularioImportar() {
  const [texto, setTexto] = useState("");
  const [estado, enviar] = useActionState(importarComisionistas, INICIAL);
  const filas = useMemo(() => parsearTabla(texto), [texto]);
  const conError = filas.filter((f) => f.errores.length).length;

  if (estado.resultados) {
    const bien = estado.resultados.filter((r) => r.ok).length;
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p className="rounded-lg bg-exito-fondo px-4 py-2 text-[0.9375rem] leading-6 text-exito">
          {bien} de {estado.resultados.length} quedaron dados de alta.
        </p>
        <ul className="flex flex-col gap-1 text-[0.9375rem]">
          {estado.resultados.map((r) => (
            <li key={r.linea} className={r.ok ? "" : "text-error"}>
              Renglón {r.linea} · {r.nombre || "(sin nombre)"}: {r.mensaje}
            </li>
          ))}
        </ul>
        <p className="text-[0.9375rem] leading-6 text-secundario">
          Corrige los renglones con error y vuelve a importar la tabla completa: a quien ya está dado de alta no se le
          duplica.
        </p>
      </div>
    );
  }

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-4">
      <label className="block font-semibold">
        Tabla
        <textarea
          name="tabla"
          rows={8}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={"Nombre\tCorreo\tTeléfono\tRFC\tFactura\tÉlite %\nAna López\tana@correo.com\t4421234567\t\tno\t"}
          className="mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 font-mono text-[0.875rem] focus:border-acento"
        />
      </label>

      {filas.length > 0 ? (
        <div>
          <p className="text-[0.9375rem] font-semibold">
            {filas.length} renglón{filas.length === 1 ? "" : "es"}
            {conError ? `, ${conError} con error (no se importan)` : ", sin errores"}.
          </p>
          <ul className="mt-2 flex max-h-80 flex-col gap-1 overflow-y-auto text-[0.9375rem]">
            {filas.map((f) => (
              <li key={f.linea} className="rounded-lg border border-linea px-3 py-2">
                <span className="block font-semibold">{f.nombre || "(sin nombre)"}</span>
                <span className="block text-secundario">
                  {f.correo}
                  {f.telefono ? ` · ${f.telefono}` : ""}
                  {f.rfc ? ` · ${f.rfc}` : ""}
                  {f.emite_factura ? " · factura" : ""}
                  {f.elite !== null ? ` · élite ${f.elite}%` : ""}
                </span>
                {f.errores.length ? <span className="block text-error">{f.errores.join(", ")}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Aviso estado={{ error: estado.error }} />
      {filas.length > MAXIMO_FILAS ? (
        <p className="text-[0.9375rem] text-error">Máximo {MAXIMO_FILAS} renglones por importación.</p>
      ) : filas.length - conError > 0 ? (
        <BotonEnviar pendiente="Importando…">
          Importar {filas.length - conError} comisionista{filas.length - conError === 1 ? "" : "s"}
        </BotonEnviar>
      ) : null}
    </form>
  );
}
