"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { pesos } from "@/lib/formato";
import { buscarEnNotion, traerTramite, type Busqueda, type EstadoTraer } from "./acciones";

const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

type Props = {
  comisionistas: { id: string; nombre: string }[];
  servicios: { id: string; nombre: string; nombre_notion: string | null }[];
  marcas: { id: string; nombre: string; cuenta_sugerida_id: string | null }[];
  cuentas: { id: string; alias: string; marca_id: string }[];
};

/** Paso 1: el folio. Paso 2: la vista previa de Notion, el comisionista y lo que Tasa necesita y Notion no trae. */
export function FormularioTraer(props: Props) {
  const [busqueda, buscar] = useActionState<Busqueda, FormData>(buscarEnNotion, { error: null });
  return (
    <>
      <form action={buscar} className="mt-6 flex flex-col gap-3">
        <label className="block">
          <span className="font-semibold">Folio</span>
          <input name="folio" required maxLength={20} defaultValue={busqueda.folio ?? ""} placeholder="MGP-2026-0123"
            autoCapitalize="characters" className={ENTRADA} />
        </label>
        {busqueda.error ? <p className="text-[0.9375rem] leading-6 text-error">{busqueda.error}</p> : null}
        <BotonEnviar variante="secundario" pendiente="Leyendo Notion…">Buscar en Notion</BotonEnviar>
      </form>
      {busqueda.tramite && busqueda.folio ? <VistaPrevia key={busqueda.tramite.externo_id} b={busqueda as Required<Busqueda>} {...props} /> : null}
    </>
  );
}

function VistaPrevia({ b, comisionistas, servicios, marcas, cuentas }: Props & { b: Required<Busqueda> }) {
  const t = b.tramite;
  const [estado, enviar] = useActionState<EstadoTraer, FormData>(traerTramite, { error: null });
  const [marca, setMarca] = useState("");
  const [genera, setGenera] = useState(true);
  const servicioNotion = servicios.find((s) => s.nombre_notion && s.nombre_notion === t.tipo)?.id ?? "";
  // El nombre del cliente: el de contacto o lo que sigue al folio en el título.
  const cliente = t.cliente_nombre ?? t.titulo.replace(b.folio, "").replace(/^[\s–—-]+/, "").trim();
  const cuentasDeMarca = cuentas.filter((c) => !marca || c.marca_id === marca);
  const sugerida = marcas.find((m) => m.id === marca)?.cuenta_sugerida_id ?? "";

  return (
    <form action={enviar} className="mt-8 flex flex-col gap-4">
      <input type="hidden" name="folio" value={b.folio} />
      <input type="hidden" name="externo_id" value={t.externo_id} />
      <input type="hidden" name="etapa" value={t.etapa ?? ""} />
      <input type="hidden" name="aceptada" value={t.fecha_aceptacion ?? ""} />

      <section className="rounded-xl bg-alterno px-4 py-3 text-[0.9375rem]">
        <h2 className="font-bold">{b.demo ? "Vista previa (lectura simulada de DEMO)" : "Lo que dice Notion"}</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-secundario">Página</dt><dd className="font-semibold">{t.titulo || b.folio}</dd>
          <dt className="text-secundario">Tipo</dt><dd>{t.tipo ?? "—"}</dd>
          <dt className="text-secundario">Cotización</dt><dd>{t.cotizacion === null ? "—" : `${pesos(t.cotizacion)} sin IVA`}</dd>
          <dt className="text-secundario">Etapa</dt><dd>{t.etapa ?? "—"}</dd>
          <dt className="text-secundario">Aceptación</dt><dd>{t.fecha_aceptacion ?? "—"}</dd>
        </dl>
      </section>

      <label className="block">
        <span className="font-semibold">Comisionista</span>
        <select name="comisionista" required defaultValue="" className={ENTRADA}>
          <option value="" disabled>Elige…</option>
          {comisionistas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="font-semibold">Cliente</span>
        <input name="cliente_nombre" required maxLength={120} defaultValue={cliente} className={ENTRADA} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="font-semibold">Teléfono</span>
          <input name="cliente_telefono" maxLength={20} defaultValue={t.cliente_telefono ?? ""} className={ENTRADA} />
        </label>
        <label className="block">
          <span className="font-semibold">Correo</span>
          <input name="cliente_correo" type="email" maxLength={120} defaultValue={t.cliente_correo ?? ""} className={ENTRADA} />
        </label>
      </div>
      <label className="block">
        <span className="font-semibold">Dirección del inmueble</span>
        <input name="direccion" required maxLength={200} defaultValue={t.descripcion?.split("\n")[0] ?? ""} className={ENTRADA} />
      </label>
      <label className="block">
        <span className="font-semibold">Clave catastral <span className="font-normal text-secundario">(opcional)</span></span>
        <input name="clave" maxLength={40} defaultValue={t.clave_catastral ?? ""} className={ENTRADA} />
      </label>
      <label className="block">
        <span className="font-semibold">Descripción <span className="font-normal text-secundario">(opcional)</span></span>
        <textarea name="descripcion" rows={3} maxLength={1000} defaultValue={t.descripcion ?? ""} className={ENTRADA} />
      </label>

      <label className="block">
        <span className="font-semibold">Servicio</span>
        <select name="servicio" required defaultValue={servicioNotion} className={ENTRADA}>
          <option value="" disabled>Elige…</option>
          {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="font-semibold">Marca</span>
          <select name="marca" required value={marca} onChange={(e) => setMarca(e.target.value)} className={ENTRADA}>
            <option value="" disabled>Elige…</option>
            {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="font-semibold">Cuenta</span>
          <select key={marca} name="cuenta" required defaultValue={sugerida} className={ENTRADA}>
            <option value="" disabled>Elige…</option>
            {cuentasDeMarca.map((c) => <option key={c.id} value={c.id}>{c.alias}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="font-semibold">Honorarios sin IVA</span>
          <input name="honorarios" inputMode="decimal" required defaultValue={t.cotizacion ?? ""} className={ENTRADA} />
        </label>
        <label className="block">
          <span className="font-semibold">Derechos y terceros</span>
          <input name="terceros" inputMode="decimal" defaultValue="0" className={ENTRADA} />
        </label>
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" name="requiere_factura" defaultChecked={t.requiere_factura} className="size-5 accent-primario" />
        <span>Requiere factura</span>
      </label>

      <fieldset>
        <legend className="font-semibold">¿Genera comisión?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" aria-pressed={genera === v} onClick={() => setGenera(v)}
              className={`min-h-12 rounded-lg border px-3 font-semibold ${genera === v ? "border-acento bg-tinte text-primario" : "border-linea bg-fondo"}`}>
              {v ? "Sí" : "No"}
            </button>
          ))}
        </div>
        <input type="hidden" name="genera_comision" value={genera ? "si" : "no"} />
        {!genera ? (
          <input name="sin_comision_motivo" required minLength={3} maxLength={300} className={ENTRADA}
            placeholder="Por qué no (p. ej. solo lo recomendó; ya estaba pactado distinto)" />
        ) : null}
      </fieldset>

      <label className="block">
        <span className="font-semibold">Motivo</span>
        <input name="motivo" required minLength={3} maxLength={300} className={ENTRADA}
          placeholder="p. ej. lo trajo antes de que existiera Tasa" />
      </label>

      {estado.error ? <p className="text-[0.9375rem] leading-6 text-error">{estado.error}</p> : null}
      <BotonEnviar pendiente="Creando…">Traer a Tasa</BotonEnviar>
    </form>
  );
}
