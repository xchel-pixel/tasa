"use client";

import { useEffect, useRef, useState } from "react";
import { useMontado } from "@/components/montado";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { pedirPorLiga } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

const TIPOS = [
  { valor: "casa", texto: "Casa" },
  { valor: "departamento", texto: "Departamento" },
  { valor: "terreno", texto: "Terreno" },
  { valor: "local_oficina", texto: "Local u oficina" },
  { valor: "bodega_nave", texto: "Bodega o nave" },
  { valor: "otro", texto: "Otro" },
];

const MAXIMO_ARCHIVOS = 3;
const MAXIMO_MB = 10;
const TIPOS_ARCHIVO = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

type Paso = { tipo: "llenando" } | { tipo: "enviando"; que: string } | { tipo: "listo"; aviso: string | null };

/** El motivo por el que los archivos no sirven; nulo si sirven. */
function errorDeArchivos(archivos: File[]): string | null {
  if (archivos.length > MAXIMO_ARCHIVOS) return `Hasta ${MAXIMO_ARCHIVOS} archivos.`;
  for (const a of archivos) {
    if (!TIPOS_ARCHIVO.includes(a.type)) return `"${a.name}" no es PDF ni imagen.`;
    if (a.size > MAXIMO_MB * 1024 * 1024) return `"${a.name}" pesa más de ${MAXIMO_MB} MB.`;
  }
  return null;
}

/** Nombre seguro para Storage: sin acentos, espacios ni símbolos. */
const nombreSeguro = (i: number, nombre: string) =>
  `${i + 1}-${nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9.-]+/g, "-").slice(-60)}`;

/**
 * Dos pasos que el cliente ve como uno: crear la solicitud (servidor) y subir sus archivos directo
 * a Storage (un PDF de varios MB no cabe en una acción del servidor). Si un archivo no sube, la
 * solicitud ya llegó: se le dice que lo mande a quien le pasó la liga.
 */
export default function FormularioCliente({
  org,
  codigo,
  con,
  servicios,
  avisoVersion,
  ligaAviso,
}: {
  org: string;
  codigo: string;
  con: string;
  servicios: { id: string; nombre: string }[];
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
    const archivos = (formulario.getAll("archivos") as File[]).filter((a) => a.size > 0);
    const errorArchivos = errorDeArchivos(archivos);
    if (errorArchivos) return setError(errorArchivos);
    formulario.delete("archivos");
    formulario.set("t", String(abierto.current));
    formulario.set("adjuntos", String(archivos.length));

    setPaso({ tipo: "enviando", que: "Enviando tu solicitud…" });
    const r = await pedirPorLiga(formulario);
    if (r.error || !r.id) {
      setPaso({ tipo: "llenando" });
      return setError(r.error ?? "No se pudo enviar la solicitud.");
    }

    let fallaron = 0;
    if (archivos.length > 0 && r.token && r.organizacion) {
      setPaso({ tipo: "enviando", que: "Subiendo tus archivos…" });
      const storage = crearClienteNavegador().storage.from("clientes");
      for (const [i, a] of archivos.entries()) {
        const { error: e } = await storage.upload(`${r.organizacion}/${r.id}/${r.token}/${nombreSeguro(i, a.name)}`, a, {
          contentType: a.type,
          upsert: false,
        });
        if (e) fallaron++;
      }
    }
    setPaso({
      tipo: "listo",
      aviso: fallaron > 0 ? `No se pudo subir ${fallaron === 1 ? "un archivo" : `${fallaron} archivos`}: mándaselo a ${con}.` : null,
    });
  }

  if (paso.tipo === "listo") {
    return (
      <div className="mt-8 rounded-xl bg-exito-fondo px-4 py-4 leading-7 text-exito">
        <p className="font-semibold">Recibimos tu solicitud.</p>
        <p className="mt-1">{con} te va a contactar para darle seguimiento.</p>
        {paso.aviso ? <p className="mt-2 text-error">{paso.aviso}</p> : null}
      </div>
    );
  }

  const enviando = paso.tipo === "enviando";
  return (
    <form onSubmit={enviar} className="mt-8 flex flex-col gap-5">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="codigo" value={codigo} />
      <input type="hidden" name="aviso_version" value={avisoVersion} />
      {/* Campo trampa: fuera de la pantalla y sin tabulador; una persona nunca lo llena. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="sitio_web">Sitio web</label>
        <input id="sitio_web" name="sitio_web" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <label htmlFor="nombre" className="block font-semibold">Tu nombre</label>
        <input id="nombre" name="nombre" required maxLength={120} autoComplete="name" className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="telefono" className="block font-semibold">Teléfono celular</label>
        <input id="telefono" name="telefono" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel" className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="correo" className="block font-semibold">
          Correo <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <input id="correo" name="correo" type="email" maxLength={120} autoComplete="email" className={ENTRADA} />
      </div>

      <div>
        <label htmlFor="servicio" className="block font-semibold">Servicio</label>
        <select id="servicio" name="servicio" required defaultValue="" className={ENTRADA}>
          <option value="" disabled>Elige uno</option>
          {servicios.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="font-semibold">¿Qué necesitas?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            { valor: "cotizacion", texto: "Solo cotización" },
            { valor: "tramite", texto: "Quiero el trámite" },
          ].map((o, i) => (
            <label key={o.valor} className="toque flex min-h-12 items-center gap-2 rounded-lg border border-borde-campo px-3">
              <input type="radio" name="que" value={o.valor} defaultChecked={i === 0} className="size-5 shrink-0" />
              {o.texto}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="direccion" className="block font-semibold">Ubicación o dirección del inmueble</label>
        <input id="direccion" name="direccion" required maxLength={300} autoComplete="street-address" className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="inmueble_tipo" className="block font-semibold">Tipo de inmueble</label>
        <select id="inmueble_tipo" name="inmueble_tipo" required defaultValue="" className={ENTRADA}>
          <option value="" disabled>Elige uno</option>
          {TIPOS.map((t) => (
            <option key={t.valor} value={t.valor}>{t.texto}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="clave" className="block font-semibold">
          Clave catastral <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <input id="clave" name="clave" maxLength={60} autoComplete="off" className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="comentarios" className="block font-semibold">
          Comentarios <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <textarea id="comentarios" name="comentarios" rows={3} maxLength={1000} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="archivos" className="block font-semibold">
          Documentos <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Escritura, predial u otros: PDF o foto, hasta {MAXIMO_ARCHIVOS} archivos de {MAXIMO_MB} MB.
        </p>
        <input
          id="archivos"
          name="archivos"
          type="file"
          multiple
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic"
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
