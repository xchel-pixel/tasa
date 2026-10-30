"use client";

import QRCode from "qrcode";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * "Compartir mi tarjeta": WhatsApp con mensaje listo, copiar la liga y QR descargable (se genera
 * en el teléfono). Sin tarjeta publicada, invita a armarla.
 */
export function CompartirTarjeta({ liga, publicada }: { liga: string; publicada: boolean }) {
  const [copiada, setCopiada] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (publicada) QRCode.toDataURL(liga, { width: 640, margin: 2, errorCorrectionLevel: "M" }).then(setQr, () => setQr(null));
  }, [liga, publicada]);

  if (!publicada) {
    return (
      <Link href="/tarjeta" className="mt-6 block rounded-xl border border-dashed border-borde-campo px-4 py-4">
        <span className="block font-bold">Tu tarjeta digital</span>
        <span className="block text-[0.9375rem] leading-6 text-secundario">
          Ármala y compártela por WhatsApp: tus clientes te escriben o piden su avalúo desde ahí.
        </span>
      </Link>
    );
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(liga);
      setCopiada(true);
    } catch {
      setCopiada(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-primario px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-bold">Compartir mi tarjeta</h2>
        <Link href="/tarjeta" className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Editar</Link>
      </div>
      <p className="mt-2 rounded-lg bg-alterno px-3 py-2 text-[0.9375rem] break-all">{liga}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(`Te comparto mi tarjeta: ${liga}`)}`} target="_blank" rel="noopener"
          className="flex min-h-12 items-center justify-center rounded-lg bg-primario px-3 text-center font-semibold text-sobre-primario">
          WhatsApp
        </a>
        <button type="button" onClick={copiar} className="min-h-12 rounded-lg border border-primario px-3 font-semibold text-primario">
          {copiada ? "Copiada" : "Copiar liga"}
        </button>
      </div>
      {qr ? (
        <div className="mt-4 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en el navegador */}
          <img src={qr} alt="Código QR de tu tarjeta" width={112} height={112} className="rounded-lg bg-white" />
          <a href={qr} download="qr-mi-tarjeta.png"
            className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-primario px-3 font-semibold text-primario">
            Descargar QR
          </a>
        </div>
      ) : null}
    </section>
  );
}
