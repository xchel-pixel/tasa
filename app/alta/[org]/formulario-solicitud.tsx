"use client";

import { useEffect, useRef, useState } from "react";
import { useMontado } from "@/components/montado";
import { errorDeCsf, subirCsf } from "@/lib/subir-csf";
import { confirmarAlta, pedirAlta } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

type Paso = { tipo: "llenando" } | { tipo: "enviando"; que: string } | { tipo: "listo"; correo: string };

/**
 * Con CSF, tres pasos que la persona ve como uno: crear la solicitud
 * (servidor), subir la CSF (directo a Storage) y confirmarla (servidor).
 * Si la subida falla, la solicitud queda "subiendo" y se borra sola al
 * día siguiente. Sin CSF, solo el primero: queda "CSF pendiente".
 */
export default function FormularioSolicitud({
  org,
  orgId,
  referidor,
  avisoVersion,
  ligaAviso,
}: {
  org: string;
  orgId: string;
  referidor: string;
  avisoVersion: number;
  ligaAviso: string;
}) {
  const [paso, setPaso] = useState<Paso>({ tipo: "llenando" });
  const [error, setError] = useState<string | null>(null);
  const montado = useMontado();
  // Cuándo se abrió el formulario: el servidor rechaza lo que se llenó en menos de 4 segundos.
  const abierto = useRef(0);
  useEffect(() => {
    abierto.current = Date.now();
  }, []);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    const formulario = new FormData(evento.currentTarget);
    const elegido = formulario.get("csf") as File | null;
    const archivo = elegido && elegido.size > 0 ? elegido : null;
    const errorArchivo = archivo ? errorDeCsf(archivo) : null;
    if (errorArchivo) return setError(errorArchivo);
    formulario.delete("csf");
    formulario.set("t", String(abierto.current));
    formulario.set("con_csf", archivo ? "1" : "0");

    setPaso({ tipo: "enviando", que: "Enviando tu solicitud…" });
    const pedido = await pedirAlta(formulario);
    if (pedido.error || !pedido.id) {
      setPaso({ tipo: "llenando" });
      return setError(pedido.error ?? "No se pudo enviar la solicitud.");
    }
    if (!archivo) return setPaso({ tipo: "listo", correo: String(formulario.get("correo") ?? "") });
    try {
      setPaso({ tipo: "enviando", que: "Subiendo tu constancia…" });
      await subirCsf(`${orgId}/${pedido.id}/csf.pdf`, archivo!);
    } catch (falla) {
      setPaso({ tipo: "llenando" });
      return setError(falla instanceof Error ? falla.message : "No se pudo subir la constancia.");
    }
    const confirmado = await confirmarAlta(pedido.id);
    if (confirmado.error) {
      setPaso({ tipo: "llenando" });
      return setError(confirmado.error);
    }
    setPaso({ tipo: "listo", correo: String(formulario.get("correo") ?? "") });
  }

  if (paso.tipo === "listo") {
    return (
      <div className="mt-8 rounded-xl bg-exito-fondo px-4 py-4 leading-7 text-exito">
        <p className="font-semibold">Recibimos tu solicitud.</p>
        <p className="mt-1">Te escribiremos a {paso.correo} en cuanto la revisemos.</p>
      </div>
    );
  }

  const enviando = paso.tipo === "enviando";
  return (
    <form onSubmit={enviar} className="mt-8 flex flex-col gap-5">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="ref" value={referidor} />
      <input type="hidden" name="aviso_version" value={avisoVersion} />
      {/* Campo trampa: fuera de la pantalla y sin tabulador; una persona nunca lo llena. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="sitio_web">Sitio web</label>
        <input id="sitio_web" name="sitio_web" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <label htmlFor="nombre" className="block font-semibold">Nombre completo</label>
        <input id="nombre" name="nombre" required maxLength={120} autoComplete="name" className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="correo" className="block font-semibold">Correo</label>
        <input id="correo" name="correo" type="email" required maxLength={120} autoComplete="email" className={ENTRADA} />
        <p className="mt-1 text-[0.9375rem] text-secundario">Con este correo vas a entrar a Tasa.</p>
      </div>
      <div>
        <label htmlFor="telefono" className="block font-semibold">Teléfono celular</label>
        <input id="telefono" name="telefono" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel" className={ENTRADA} />
      </div>
      <div>
        <p className="font-semibold">RFC o CURP</p>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">Uno de los dos es obligatorio; si tienes ambos, escribe ambos.</p>
        <label htmlFor="rfc" className="mt-3 block text-[0.9375rem] font-semibold">RFC, con homoclave</label>
        <input id="rfc" name="rfc" maxLength={20} autoCapitalize="characters" autoComplete="off" className={`${ENTRADA} uppercase`} />
        <label htmlFor="curp" className="mt-3 block text-[0.9375rem] font-semibold">CURP</label>
        <input id="curp" name="curp" maxLength={22} autoCapitalize="characters" autoComplete="off" className={`${ENTRADA} uppercase`} />
      </div>
      <div>
        <label htmlFor="csf" className="block font-semibold">
          Constancia de Situación Fiscal <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          El PDF que descargas del SAT, de máximo 5 MB. Si no la tienes a la mano, puedes subirla después desde Tasa.
        </p>
        <input
          id="csf"
          name="csf"
          type="file"
          accept="application/pdf,.pdf"
          className="mt-3 block w-full text-[0.9375rem] text-secundario file:mr-4 file:rounded-lg file:border file:border-borde-campo file:bg-fondo file:px-4 file:py-2 file:text-[0.9375rem] file:font-semibold file:text-primario"
        />
      </div>
      <label className="toque flex items-start gap-3 leading-6">
        <input type="checkbox" name="acepto" required className="mt-1 size-5 shrink-0" />
        <span>
          Leí y acepto el{" "}
          <a href={ligaAviso} target="_blank" rel="noopener" className="font-semibold text-acento underline underline-offset-4">
            aviso de privacidad
          </a>
          .
        </span>
      </label>

      {error ? <p className="text-[0.9375rem] leading-6 text-error">{error}</p> : null}
      <button
        type="submit"
        disabled={!montado || enviando}
        className="min-h-12 w-full rounded-lg bg-primario px-4 py-3 text-[1rem] font-semibold text-sobre-primario disabled:opacity-50"
      >
        {enviando ? paso.que : !montado ? "Preparando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}
