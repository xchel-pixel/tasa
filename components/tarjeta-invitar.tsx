"use client";

import { useState } from "react";

/** "Invita a otro comisionista": su liga de alta con su código, para copiar o mandar por WhatsApp. */
export function TarjetaInvitar({ liga }: { liga: string }) {
  const [copiada, setCopiada] = useState(false);
  const mensaje = `Te invito a Tasa para encargar cotizaciones y avalúos y ganar comisiones. Pide tu alta aquí: ${liga}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(liga);
      setCopiada(true);
    } catch {
      setCopiada(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-linea px-4 py-4">
      <h2 className="font-bold">Invita a otro comisionista</h2>
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
        Con tu liga, su solicitud queda a tu nombre como referido.
      </p>
      <p className="mt-2 rounded-lg bg-alterno px-3 py-2 text-[0.9375rem] break-all">{liga}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={copiar}
          className="min-h-12 rounded-lg border border-primario bg-fondo px-3 font-semibold text-primario">
          {copiada ? "Copiada" : "Copiar liga"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener"
          className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-3 text-center font-semibold text-sobre-primario">
          Compartir por WhatsApp
        </a>
      </div>
    </section>
  );
}
