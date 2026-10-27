"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import {
  activarNotion,
  guardarConfiguracion,
  guardarCredencial,
  guardarMapeoEstatus,
  llamarCron,
  volverAManual,
  type EstadoConector,
} from "./acciones-conector";

const INICIAL: EstadoConector = { error: null, mensaje: null };
const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

/** Qué propiedad de Notion es cada dato. Vacío: no se escribe. */
const CAMPOS: { clave: string; texto: string; lee?: boolean }[] = [
  { clave: "titulo", texto: "Título (de ahí sale el folio)", lee: true },
  { clave: "etapa", texto: "Etapa", lee: true },
  { clave: "fecha_visita", texto: "Fecha de visita", lee: true },
  { clave: "tipo_tramite", texto: "Tipo de trámite (el servicio)" },
  { clave: "clasificacion", texto: "Clasificación" },
  { clave: "medio", texto: "Medio de solicitud (también filtra qué se lee)" },
  { clave: "fecha_aceptacion", texto: "Fecha de aceptación" },
  { clave: "requiere_factura", texto: "Requiere factura" },
  { clave: "solicitado_por", texto: "Solicitado por (el comisionista)" },
  { clave: "clave_catastral", texto: "Clave catastral" },
  { clave: "descripcion", texto: "Descripción (inmueble y terceros)" },
  { clave: "contacto_nombre", texto: "Nombre del cliente" },
  { clave: "contacto_telefono", texto: "Teléfono del cliente" },
  { clave: "contacto_correo", texto: "Correo del cliente" },
  { clave: "cotizacion", texto: "Honorarios sin IVA" },
];

const VALORES: { clave: string; texto: string }[] = [
  { clave: "etapa_inicial", texto: "Etapa con la que nace la página" },
  { clave: "clasificacion", texto: "Valor de Clasificación" },
  { clave: "medio", texto: "Valor de Medio de solicitud" },
  { clave: "valor_cancelado", texto: "Etapa que significa cancelado (levanta alerta)" },
];

const ESTATUS = [
  ["aceptada", "Aceptada"],
  ["visita_agendada", "Visita agendada"],
  ["en_elaboracion", "En elaboración"],
  ["en_revision", "En revisión"],
  ["entregado", "Entregado"],
] as const;

export type DatosNotion = {
  id: string;
  activo: boolean;
  estado: string;
  configuracion: Record<string, string>;
  mapeo_campos: Record<string, string>;
  credencial_guardada_en: string | null;
  ultimo_sync: string | null;
  ultimo_error: string | null;
  mapeo_estatus: { valor_externo: string; estatus_publico: string }[];
};

export function ActivarNotion() {
  const [estado, enviar] = useActionState(activarNotion, INICIAL);
  const [confirmar, setConfirmar] = useState(false);
  if (!confirmar) {
    return (
      <button type="button" onClick={() => setConfirmar(true)}
        className="mt-3 min-h-12 w-full rounded-lg bg-primario px-4 font-semibold text-sobre-primario">
        Activar Notion
      </button>
    );
  }
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3 rounded-lg border border-acento bg-tinte px-4 py-3">
      <p className="text-[0.9375rem] leading-6">
        Desde ahora, cada trámite que se acepte crea su página en Notion (en máximo 15 minutos) y el estatus y el folio se
        leen de ahí. El estatus ya no se mueve a mano. Lo aceptado antes de activar no se sube.
      </p>
      <BotonEnviar>Sí, activar Notion</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function VolverAManualBoton() {
  const [estado, enviar] = useActionState(volverAManual, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2">
      <BotonEnviar variante="peligro">Volver a manual</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function ConfigNotion({ d }: { d: DatosNotion }) {
  const [estCred, enviarCred] = useActionState(guardarCredencial, INICIAL);
  const [estConf, enviarConf] = useActionState(guardarConfiguracion, INICIAL);
  const [estMapeo, enviarMapeo] = useActionState(guardarMapeoEstatus, INICIAL);
  const [estCron, enviarCron] = useActionState(llamarCron, INICIAL);
  const [filas, setFilas] = useState(d.mapeo_estatus.length > 0 ? d.mapeo_estatus : [{ valor_externo: "", estatus_publico: "aceptada" }]);

  return (
    <div className="mt-4 flex flex-col gap-6">
      {/* Credencial */}
      <form action={enviarCred} className="flex flex-col gap-2">
        <input type="hidden" name="conector" value={d.id} />
        <label htmlFor="credencial" className="font-semibold">Secreto de la integración</label>
        <p className="text-[0.9375rem] leading-6 text-secundario">
          {d.credencial_guardada_en
            ? `Guardado y cifrado el ${new Date(d.credencial_guardada_en).toLocaleDateString("es-MX")}. No se puede ver; pega uno nuevo para reemplazarlo.`
            : "Empieza con ntn_. Se guarda cifrado y no vuelve a mostrarse."}
        </p>
        <input id="credencial" name="credencial" type="password" autoComplete="off" className={ENTRADA} />
        <BotonEnviar variante="secundario">{d.credencial_guardada_en ? "Reemplazar secreto" : "Guardar secreto"}</BotonEnviar>
        <Aviso estado={estCred} />
      </form>

      {/* Probar y sincronizar */}
      <form action={enviarCron} className="flex flex-col gap-2">
        <input type="hidden" name="conector" value={d.id} />
        <p className="text-[0.9375rem] leading-6 text-secundario">
          {d.ultimo_sync ? `Última sincronización: ${new Date(d.ultimo_sync).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}.` : "Todavía no sincroniza."}
          {d.ultimo_error ? ` Último error: ${d.ultimo_error}` : ""}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button name="accion" value="probar" type="submit"
            className="min-h-12 rounded-lg border border-primario bg-fondo px-3 font-semibold text-primario disabled:opacity-50"
            disabled={!d.credencial_guardada_en}>
            Probar conexión
          </button>
          <button name="accion" value="sincronizar" type="submit"
            className="min-h-12 rounded-lg bg-primario px-3 font-semibold text-sobre-primario disabled:opacity-50"
            disabled={!d.credencial_guardada_en || !d.activo}>
            Sincronizar ahora
          </button>
        </div>
        <Aviso estado={estCron} />
      </form>

      {/* Base, valores y mapeo de campos */}
      <details className="rounded-xl border border-linea px-4 py-3">
        <summary className="toque cursor-pointer font-semibold text-acento">Base de datos y mapeo de campos</summary>
        <form action={enviarConf} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="conector" value={d.id} />
          <label className="block text-[0.9375rem] font-semibold">
            Base de datos (id en Notion)
            <input name="config.base_de_datos" required defaultValue={d.configuracion.base_de_datos ?? ""} className={`${ENTRADA} font-mono`} />
          </label>
          {VALORES.map((v) => (
            <label key={v.clave} className="block text-[0.9375rem] font-semibold">
              {v.texto}
              <input name={`config.${v.clave}`} defaultValue={d.configuracion[v.clave] ?? ""} className={ENTRADA} />
            </label>
          ))}
          <p className="mt-2 font-semibold">Propiedad en Notion de cada dato</p>
          {CAMPOS.map((c) => (
            <label key={c.clave} className="block text-[0.9375rem]">
              {c.texto}
              {c.lee ? <span className="text-secundario"> · se lee</span> : null}
              <input name={`mapeo.${c.clave}`} defaultValue={d.mapeo_campos[c.clave] ?? ""} className={ENTRADA} />
            </label>
          ))}
          <BotonEnviar variante="secundario">Guardar configuración</BotonEnviar>
          <Aviso estado={estConf} />
        </form>
      </details>

      {/* Mapeo de estatus */}
      <details className="rounded-xl border border-linea px-4 py-3">
        <summary className="toque cursor-pointer font-semibold text-acento">Mapeo de etapas → estatus</summary>
        <form action={enviarMapeo} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="conector" value={d.id} />
          <p className="text-[0.9375rem] leading-6 text-secundario">
            Una etapa que no esté aquí no mueve el estatus. Con fecha de visita, lo que daría &quot;Aceptada&quot; se muestra como
            &quot;Visita agendada&quot;. &quot;Pagado&quot; y &quot;Cancelada&quot; los decide Tasa.
          </p>
          {filas.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <input name="valor_externo" aria-label="Etapa en Notion" defaultValue={f.valor_externo} className={ENTRADA} />
              <select name="estatus_publico" aria-label="Estatus en Tasa" defaultValue={f.estatus_publico} className={ENTRADA}>
                {ESTATUS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
              <button type="button" aria-label="Quitar" onClick={() => setFilas(filas.filter((_, j) => j !== i))}
                className="toque px-2 text-error">✕</button>
            </div>
          ))}
          <button type="button" onClick={() => setFilas([...filas, { valor_externo: "", estatus_publico: "aceptada" }])}
            className="toque self-start text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
            + Agregar etapa
          </button>
          <BotonEnviar variante="secundario">Guardar mapeo</BotonEnviar>
          <Aviso estado={estMapeo} />
        </form>
      </details>
    </div>
  );
}
