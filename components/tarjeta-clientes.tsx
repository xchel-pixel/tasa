"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/**
 * "Para tus clientes": la liga /s/<org>/<código> con la que un cliente pide cotización o trámite a
 * nombre de esta persona. Copiar, WhatsApp con mensaje listo y QR descargable (se genera en el
 * teléfono, sin mandar la liga a ningún servicio). A propósito se ve distinta de "Invita a un
 * comisionista": esta es para clientes, aquella para colegas.
 */
export function TarjetaClientes({ liga }: { liga: string }) {
  const [copiada, setCopiada] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const mensaje = `Hola. Para pedir tu cotización o tu trámite de avalúo, llena esta solicitud: ${liga}`;

  useEffect(() => {
    QRCode.toDataURL(liga, { width: 640, margin: 2, errorCorrectionLevel: "M" }).then(setQr, () => setQr(null));
  }, [liga]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(liga);
      setCopiada(true);
    } catch {
      setCopiada(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl bg-tinte px-4 py-4">
      <h2 className="font-bold">Para tus clientes</h2>
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
        Con esta liga tu cliente pide su cotización o su trámite y la solicitud llega a tu nombre. No necesita cuenta.
      </p>
      <p className="mt-2 rounded-lg bg-fondo px-3 py-2 text-[0.9375rem] break-all">{liga}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={copiar}
          className="min-h-12 rounded-lg border border-primario bg-fondo px-3 font-semibold text-primario">
          {copiada ? "Copiada" : "Copiar liga"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener"
          className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-3 text-center font-semibold text-sobre-primario">
          Mandar por WhatsApp
        </a>
      </div>
      {qr ? (
        <div className="mt-4 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en el navegador */}
          <img src={qr} alt="Código QR de tu liga para clientes" width={112} height={112} className="rounded-lg bg-white" />
          <a href={qr} download="qr-solicitud-tasa.png"
            className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-primario bg-fondo px-3 font-semibold text-primario">
            Descargar QR
          </a>
        </div>
      ) : null}
    </section>
  );
}
