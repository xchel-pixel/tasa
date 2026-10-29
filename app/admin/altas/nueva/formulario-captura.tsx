"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMontado } from "@/components/montado";
import { errorDeCsf, subirCsf } from "@/lib/subir-csf";
import { capturarAlta, confirmarCaptura } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

/** Los mismos pasos que la solicitud pública: capturar y, si hay CSF, subirla y confirmar. */
export default function FormularioCaptura({ existentes }: { existentes: { codigo: string; nombre: string }[] }) {
  const router = useRouter();
  const montado = useMontado();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    const formulario = new FormData(evento.currentTarget);
    const elegido = formulario.get("csf") as File | null;
    const archivo = elegido && elegido.size > 0 ? elegido : null;
    const errorArchivo = archivo ? errorDeCsf(archivo) : null;
    if (errorArchivo) return setError(errorArchivo);
    formulario.delete("csf");
    formulario.set("con_csf", archivo ? "1" : "0");

    setEnviando("Capturando…");
    const r = await capturarAlta(formulario);
    if (r.error || !r.id) {
      setEnviando(null);
      return setError(r.error ?? "No se pudo capturar.");
    }
    if (!archivo) return router.push(`/admin/altas/${r.id}`);
    try {
      setEnviando("Subiendo la constancia…");
      await subirCsf(`${r.carpeta}/${r.id}/csf.pdf`, archivo!);
    } catch (falla) {
      setEnviando(null);
      return setError(falla instanceof Error ? falla.message : "No se pudo subir la constancia.");
    }
    const c = await confirmarCaptura(r.id);
    if (c.error) {
      setEnviando(null);
      return setError(c.error);
    }
    router.push(`/admin/altas/${r.id}`);
  }

  return (
    <form onSubmit={enviar} className="mt-6 flex flex-col gap-5">
      <div>
        <label htmlFor="nombre" className="block font-semibold">Nombre completo</label>
        <input id="nombre" name="nombre" required maxLength={120} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="correo" className="block font-semibold">Correo</label>
        <input id="correo" name="correo" type="email" required maxLength={120} autoComplete="off" className={ENTRADA} />
        <p className="mt-1 text-[0.9375rem] text-secundario">Con este correo va a entrar.</p>
      </div>
      <div>
        <label htmlFor="telefono" className="block font-semibold">Teléfono</label>
        <input id="telefono" name="telefono" type="tel" inputMode="tel" required maxLength={20} className={ENTRADA} />
      </div>
      <div>
        <p className="font-semibold">RFC o CURP</p>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Uno de los dos. Si el último carácter del RFC no cuadra (RFC antiguo), se captura igual y queda &quot;RFC por revisar&quot;.
        </p>
        <label htmlFor="rfc" className="mt-3 block text-[0.9375rem] font-semibold">RFC</label>
        <input id="rfc" name="rfc" maxLength={20} autoCapitalize="characters" className={`${ENTRADA} uppercase`} />
        <label htmlFor="curp" className="mt-3 block text-[0.9375rem] font-semibold">CURP</label>
        <input id="curp" name="curp" maxLength={22} autoCapitalize="characters" className={`${ENTRADA} uppercase`} />
      </div>
      <div>
        <label htmlFor="csf" className="block font-semibold">
          Constancia de Situación Fiscal (PDF) <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <input
          id="csf"
          name="csf"
          type="file"
          accept="application/pdf,.pdf"
          className="mt-3 block w-full text-[0.9375rem] text-secundario file:mr-4 file:rounded-lg file:border file:border-borde-campo file:bg-fondo file:px-4 file:py-2 file:text-[0.9375rem] file:font-semibold file:text-primario"
        />
      </div>
      <div>
        <label htmlFor="ref" className="block font-semibold">
          Lo refirió <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <select id="ref" name="ref" defaultValue="" className={ENTRADA}>
          <option value="">Nadie</option>
          {existentes.map((e) => <option key={e.codigo} value={e.codigo}>{e.nombre}</option>)}
        </select>
      </div>
      <p className="text-[0.9375rem] leading-6 text-secundario">
        El aviso de privacidad lo acepta la persona en su primer acceso, junto con los términos.
      </p>

      {error ? <p className="text-[0.9375rem] leading-6 text-error">{error}</p> : null}
      <button
        type="submit"
        disabled={!montado || Boolean(enviando)}
        className="min-h-12 w-full rounded-lg bg-primario px-4 py-3 text-[1rem] font-semibold text-sobre-primario disabled:opacity-50"
      >
        {enviando ?? "Capturar solicitud"}
      </button>
    </form>
  );
}
