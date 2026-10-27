"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useMontado } from "@/components/montado";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { reportarPago, type EstadoReporte } from "./acciones";

/** Lado largo máximo de una foto de comprobante, en pixeles. */
const LADO_MAXIMO = 1600;
/** Un PDF se sube tal cual; más de esto ya no es un comprobante. */
const PDF_MAXIMO = 5 * 1024 * 1024;

type Subida =
  | { paso: "vacio" }
  | { paso: "subiendo" }
  | { paso: "listo"; ruta: string; nombre: string }
  | { paso: "error"; mensaje: string };

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

/**
 * El comprobante no viaja dentro del formulario: se achica en el
 * teléfono (las fotos) y se sube directo al bucket privado en cuanto se
 * elige. Al servidor solo llega la ruta. Una foto de celular pesa 3 o
 * 4 MB; achicada, unos 300 KB, que sí suben con mala señal.
 */
export default function FormularioPago({
  solicitudId,
  personaId,
  sugerido,
  hoy,
}: {
  solicitudId: string;
  personaId: string;
  sugerido: number;
  hoy: string;
}) {
  const [estado, enviar] = useActionState<EstadoReporte, FormData>(reportarPago, { error: null });
  const [via, setVia] = useState<"comprobante" | "aviso">("comprobante");
  const [subida, setSubida] = useState<Subida>({ paso: "vacio" });
  const archivo = useRef<HTMLInputElement>(null);
  const montado = useMontado();

  async function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const elegido = evento.target.files?.[0];
    if (!elegido) return;
    setSubida({ paso: "subiendo" });

    try {
      const esPdf = elegido.type === "application/pdf";
      if (esPdf && elegido.size > PDF_MAXIMO) throw new Error("El PDF pesa más de 5 MB.");
      if (!esPdf && !elegido.type.startsWith("image/")) throw new Error("Sube una foto o un PDF.");

      const cuerpo = esPdf ? elegido : await achicar(elegido);
      const ruta = `${personaId}/${crypto.randomUUID()}.${esPdf ? "pdf" : "jpg"}`;

      const { error } = await crearClienteNavegador()
        .storage.from("comprobantes")
        .upload(ruta, cuerpo, { contentType: esPdf ? "application/pdf" : "image/jpeg" });
      if (error) throw error;

      setSubida({ paso: "listo", ruta, nombre: elegido.name });
    } catch (falla) {
      setSubida({
        paso: "error",
        mensaje: `No se pudo subir: ${falla instanceof Error ? falla.message : String(falla)}`,
      });
      if (archivo.current) archivo.current.value = "";
    }
  }

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="solicitud_id" value={solicitudId} />
      <input type="hidden" name="via" value={via} />
      {subida.paso === "listo" && via === "comprobante" ? (
        <input type="hidden" name="comprobante_ruta" value={subida.ruta} />
      ) : null}

      <fieldset>
        <legend className="font-semibold">Cómo lo reportas</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <BotonVia activa={via === "comprobante"} onClick={() => setVia("comprobante")}>
            Con comprobante
          </BotonVia>
          <BotonVia activa={via === "aviso"} onClick={() => setVia("aviso")}>
            Solo aviso
          </BotonVia>
        </div>
      </fieldset>

      <div>
        <label htmlFor="monto" className="block font-semibold">Monto que pagó el cliente</label>
        <input
          id="monto"
          name="monto"
          inputMode="decimal"
          required
          defaultValue={sugerido > 0 ? sugerido.toFixed(2) : ""}
          className={ENTRADA}
        />
        <p className="mt-1 text-[0.9375rem] text-secundario">Puede ser un pago parcial.</p>
      </div>

      <div>
        <label htmlFor="fecha_pago" className="block font-semibold">Fecha del pago</label>
        <input id="fecha_pago" name="fecha_pago" type="date" required max={hoy} defaultValue={hoy} className={ENTRADA} />
      </div>

      {via === "comprobante" ? (
        <div>
          <label htmlFor="comprobante" className="block font-semibold">Comprobante</label>
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Foto o PDF de la transferencia o del depósito.
          </p>
          <input
            id="comprobante"
            ref={archivo}
            type="file"
            accept="image/*,application/pdf"
            disabled={!montado}
            onChange={alElegirArchivo}
            className="mt-3 block w-full text-[0.9375rem] text-secundario file:mr-4 file:rounded-lg file:border file:border-borde-campo file:bg-fondo file:px-4 file:py-2 file:text-[0.9375rem] file:font-semibold file:text-primario"
          />
          {!montado ? (
            <p className="mt-3 text-[0.9375rem] text-secundario">Preparando… si esto no desaparece, recarga la página.</p>
          ) : null}
          {subida.paso === "subiendo" ? <p className="mt-3 text-[0.9375rem] text-secundario">Subiendo…</p> : null}
          {subida.paso === "listo" ? (
            <p className="mt-3 rounded-lg bg-exito-fondo px-4 py-2 text-[0.9375rem] text-exito">
              Listo: {subida.nombre}
            </p>
          ) : null}
          {subida.paso === "error" ? <p className="mt-3 text-[0.9375rem] leading-6 text-error">{subida.mensaje}</p> : null}
        </div>
      ) : null}

      <div>
        <label htmlFor="nota" className="block font-semibold">
          Nota{" "}
          {via === "comprobante" ? <span className="font-normal text-secundario">(opcional)</span> : null}
        </label>
        {via === "aviso" ? (
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Banco, referencia y a nombre de quién: lo que ayude a encontrar el depósito.
          </p>
        ) : null}
        <textarea id="nota" name="nota" rows={3} required={via === "aviso"} className={ENTRADA} />
      </div>

      {estado.error ? <p className="text-[0.9375rem] leading-6 text-error">{estado.error}</p> : null}

      <Enviar bloqueado={via === "comprobante" && subida.paso !== "listo"} />
      <p className="-mt-3 text-[0.9375rem] leading-6 text-secundario">
        Administración lo revisa y lo confirma. Si algo no cuadra, te dice el motivo.
      </p>
    </form>
  );
}

function BotonVia({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`min-h-12 rounded-lg border px-3 py-2 text-[0.9375rem] font-semibold ${
        activa ? "border-acento bg-tinte text-primario" : "border-linea bg-fondo text-secundario"
      }`}
    >
      {children}
    </button>
  );
}

function Enviar({ bloqueado }: { bloqueado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || bloqueado}
      className="min-h-12 w-full rounded-lg bg-primario px-4 py-3 text-[1.0625rem] font-semibold text-sobre-primario disabled:opacity-50"
    >
      {pending ? "Un momento…" : "Reportar pago"}
    </button>
  );
}

/** Redimensiona con el canvas del navegador, sin librerías. Siempre JPEG. */
async function achicar(archivo: File): Promise<Blob> {
  const mapa = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(mapa.width, mapa.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(mapa.width * escala);
  lienzo.height = Math.round(mapa.height * escala);
  const pincel = lienzo.getContext("2d");
  if (!pincel) throw new Error("El teléfono no pudo procesar la foto.");
  pincel.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
  mapa.close();
  return new Promise((resolver, rechazar) =>
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error("No se pudo preparar la foto."))), "image/jpeg", 0.82)
  );
}
