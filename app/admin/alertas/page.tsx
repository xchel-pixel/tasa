import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { fechaCorta } from "@/lib/formato";
import { exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { CerrarAlerta, LiberarTelefono } from "./liberar-telefono";
import ResolverAlerta from "./resolver-alerta";
import { CerrarAlertaCredito } from "./cerrar-credito";
import { ConfirmarPaginaNotion } from "./confirmar-notion";

export const metadata = { title: "Alertas — Tasa" };

type Fila = {
  id: string;
  tipo: "cancelado_externo" | "externo_borrado" | "liga_inactiva" | "estimado_sin_final" | "liga_limite" | "pago_por_entregar" | "externo_solicitado" | "perfil_por_aprobar" | "conector"
    | "externo_comision" | "notion_sin_pagina" | "notion_pagina_propuesta" | "notion_pago" | "parametros_fiscales" | "cupo_agotado" | "catastro" | "credito_no_aplicado"
    | "externo_credito";
  codigo: string | null;
  mensaje: string;
  creada_en: string;
  solicitudes: { id: string; cliente_nombre: string; folio: string | null; pagado_en: string | null } | null;
};

const FALLA: Record<string, string> = {
  propiedad_no_encontrada: "Falta una propiedad o columna",
  credencial_invalida: "Credencial inválida",
  inaccesible: "No se puede leer la base",
  limite: "Límite de llamadas",
  otro: "Falla del conector",
};

/**
 * Lo que el sistema externo dijo y Tasa no hace solo:
 *   · un trabajo cancelado afuera: cancelar en Tasa decide si se borra la
 *     comisión (mes abierto) o entra un cargo (mes cerrado); por eso lo
 *     confirma admin_org;
 *   · una falla del conector: se cierra sola cuando el siguiente sync sale bien.
 */
export default async function Alertas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const persona = await exigirRol(...ROLES_OPERACION);
  const supabase = await crearClienteServidor();
  // "Ver todas" desde Hoy: el historial de las ya resueltas.
  if ((await searchParams).ver === "resueltas") {
    const resueltas = oExplota(
      await supabase.from("alertas").select("id, tipo, mensaje, creada_en, resuelta_en, resolucion").not("resuelta_en", "is", null)
        .order("resuelta_en", { ascending: false }).limit(100)
        .returns<{ id: string; tipo: string; mensaje: string; creada_en: string; resuelta_en: string; resolucion: string | null }[]>(),
      "las alertas resueltas"
    ) ?? [];
    return (
      <PantallaAdmin titulo="Alertas resueltas" volver={{ href: "/admin/alertas", texto: "Alertas abiertas" }}>
        <p className="mt-3 text-[0.9375rem] leading-6 text-secundario">Para qué sirve: revisar qué alertas hubo y cómo se cerraron. Las 100 más recientes.</p>
        <ul className="mt-4 flex flex-col gap-2">
          {resueltas.map((a) => (
            <li key={a.id} className="rounded-xl border border-linea px-4 py-3 text-[0.9375rem] leading-6">
              <p>{a.mensaje}</p>
              <p className="text-secundario">Abierta el {fechaCorta(a.creada_en)} · cerrada el {fechaCorta(a.resuelta_en)}{a.resolucion ? ` · ${a.resolucion}` : ""}</p>
            </li>
          ))}
        </ul>
      </PantallaAdmin>
    );
  }
  const alertas =
    oExplota(
      await supabase
        .from("alertas")
        .select("id, tipo, codigo, mensaje, creada_en, solicitudes(id, cliente_nombre, folio, pagado_en)")
        .is("resuelta_en", null)
        .order("creada_en")
        .returns<Fila[]>(),
      "las alertas"
    ) ?? [];
  // "Pedir más": de un comisionista se resuelve en su ficha (único lugar donde se editan sus cupos y su DXF).
  const idsCupo = alertas.filter((a) => a.tipo === "cupo_agotado").map((a) => a.codigo?.split(":")[0] ?? "").filter((x) => x.length === 36);
  const comisionistas = new Set(idsCupo.length
    ? ((await supabase.from("comisionistas").select("persona_id").in("persona_id", idsCupo)).data ?? []).map((c: { persona_id: string }) => c.persona_id)
    : []);
  // Páginas de Notion por confirmar (0087): las parecidas de cada propuesta, para ligar o crear una nueva (solo admin_org).
  const propuestas = new Map(
    persona.rol === "admin_org" && alertas.some((a) => a.tipo === "notion_pagina_propuesta")
      ? (((await supabase.rpc("propuestas_notion")).data ?? []) as { persona_id: string; nombre: string; candidatos: { id: string; nombre: string }[] }[])
          .map((p) => [p.persona_id, p] as const)
      : []
  );
  const ligaCupo = (codigo: string | null) => {
    const pid = codigo?.split(":")[0] ?? "";
    return comisionistas.has(pid) ? `/admin/comisionistas/${pid}?tab=accesos` : `/admin/accesos/${pid}`;
  };

  return (
    <PantallaAdmin titulo="Alertas" volver={{ href: "/admin", texto: "Hoy" }}>
      <p className="mt-3 text-[0.9375rem] leading-6 text-secundario">
        Para qué sirve: lo que el sistema no resuelve solo y necesita que alguien decida. También salen en Hoy.{" "}
        <Link href="/admin/alertas?ver=resueltas" className="font-semibold text-acento underline underline-offset-4">Ver las resueltas</Link>
      </p>
      {alertas.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">No hay alertas abiertas.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {alertas.map((a) => (
            <li key={a.id} className="rounded-xl border border-linea px-4 py-4">
              {a.tipo === "conector" ? (
                <div className="mb-2"><Etiqueta tono="error">{FALLA[a.codigo ?? "otro"] ?? FALLA.otro}</Etiqueta></div>
              ) : null}
              <p className="font-semibold">{a.mensaje}</p>
              <p className="text-[0.9375rem] text-secundario">{fechaCorta(a.creada_en)}</p>
              {a.solicitudes ? (
                <Link href={a.tipo === "liga_inactiva" ? `/admin/solicitudes/${a.solicitudes.id}` : `/trabajos/${a.solicitudes.id}`}
                  className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
                  {a.tipo === "liga_inactiva" ? "Ver solicitud" : "Ver trabajo"}
                </Link>
              ) : null}
              {a.solicitudes?.pagado_en ? (
                <p className="rounded-lg bg-proceso-fondo px-3 py-2 text-[0.9375rem] text-proceso">
                  Este trabajo ya está pagado: si su mes ya cerró, cancelar crea un cargo al comisionista.
                </p>
              ) : null}
              {a.tipo === "conector" ? (
                <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                  Revisa el conector en{" "}
                  {persona.rol === "admin_org" ? (
                    <Link href="/ajustes" className="font-semibold text-acento underline underline-offset-4">Ajustes</Link>
                  ) : (
                    "Ajustes"
                  )}
                  . Se cierra sola cuando la siguiente sincronización sale bien.
                </p>
              ) : a.tipo === "perfil_por_aprobar" ? (
                <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                  {persona.rol === "admin_org" ? "Apruébalo o recházalo en " : "Lo aprueba Administración en "}
                  <Link href={`/admin/comisionistas/${a.codigo}`} className="font-semibold text-acento underline underline-offset-4">su ficha</Link>.
                  Mientras tanto, su tarjeta sigue con el perfil anterior.
                </p>
              ) : a.tipo === "notion_pagina_propuesta" ? (
                <>
                <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                  {persona.rol === "admin_org" ? "Confírmala en " : "La confirma Administración en "}
                  <Link href={`/admin/comisionistas/${a.codigo}`} className="font-semibold text-acento underline underline-offset-4">su ficha</Link>
                  {" "}(Página en Notion): busca su nombre y liga la que es, o créala. Se cierra sola al ligarla.
                </p>
                {a.codigo && propuestas.get(a.codigo) ? (
                  <ConfirmarPaginaNotion personaId={a.codigo} nombre={propuestas.get(a.codigo)!.nombre}
                    candidatos={propuestas.get(a.codigo)!.candidatos} />
                ) : null}
                </>
              ) : a.tipo === "notion_sin_pagina" ? (
                <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                  {persona.rol === "admin_org" ? "Lígalo en " : "Lo liga Administración en "}
                  <Link href={`/admin/comisionistas/${a.codigo}`} className="font-semibold text-acento underline underline-offset-4">su ficha</Link>
                  {" "}(Página en Notion). Mientras no esté ligado, Tasa escribe los montos pero no toca su relación en Notion. Se cierra sola al ligarlo.
                </p>
              ) : a.tipo === "cupo_agotado" ? (
                persona.rol === "admin_org" ? (
                  <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                    <Link href={ligaCupo(a.codigo)} className="font-semibold text-acento underline underline-offset-4">Darle más en su ficha</Link>
                    {" "}(pestaña Accesos y sesiones). Se cierra sola al darle cupo o DXF.
                  </p>
                ) : <p className="mt-2 text-[0.9375rem] text-secundario">La resuelve Administración.</p>
              ) : a.tipo === "parametros_fiscales" ? (
                persona.rol === "admin_org" ? (
                  <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                    Actualízalos en <Link href="/ajustes/parametros" className="font-semibold text-acento underline underline-offset-4">Parámetros fiscales</Link>; la del INPC se cierra sola al agregar el mes.
                  </p>
                ) : <p className="mt-2 text-[0.9375rem] text-secundario">La resuelve Administración.</p>
              ) : a.tipo === "catastro" ? (
                persona.rol === "admin_org" ? (
                  <>
                    <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                      Revisa que el <a href="https://catastroedo.queretaro.gob.mx/Qsig/" target="_blank" rel="noopener noreferrer" className="font-semibold text-acento underline underline-offset-4">visor oficial</a> responda; ciérrala cuando vuelva.
                    </p>
                    <CerrarAlerta alertaId={a.id} />
                  </>
                ) : <p className="mt-2 text-[0.9375rem] text-secundario">La resuelve Administración.</p>
              ) : a.tipo === "credito_no_aplicado" ? (
                persona.rol === "admin_org" || persona.rol === "finanzas" ? (
                  <>
                    <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                      Se cierra sola cuando el trabajo quede pagado. Si aplica, puedes aplicar crédito desde el trámite.
                    </p>
                    <CerrarAlertaCredito alertaId={a.id} />
                  </>
                ) : null
              ) : a.tipo === "notion_pago" ? (
                persona.rol === "admin_org" ? <CerrarAlerta alertaId={a.id} /> : null
              ) : a.tipo === "liga_limite" ? (
                /^[0-9]{10}$/.test(a.codigo ?? "") ? (
                  persona.rol === "admin_org" || persona.rol === "finanzas" ? <LiberarTelefono alertaId={a.id} /> : null
                ) : persona.rol === "admin_org" ? (
                  <CerrarAlerta alertaId={a.id} />
                ) : null
              ) : persona.rol === "admin_org" && a.solicitudes ? (
                <ResolverAlerta alertaId={a.id} solicitudId={a.solicitudes.id} />
              ) : (
                <p className="mt-2 text-[0.9375rem] text-secundario">La resuelve Administración.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PantallaAdmin>
  );
}
