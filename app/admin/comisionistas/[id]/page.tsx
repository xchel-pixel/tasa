import Link from "next/link";
import { notFound } from "next/navigation";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { VistaEstadoDeCuenta } from "@/components/vista-estado-de-cuenta";
import { estatusVisible, type EstatusPublico } from "@/lib/estatus";
import { fechaCorta, mesLargo, pesos } from "@/lib/formato";
import { esStaff, exigirRol, ROLES_OPERACION } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import type { FilaComisionista } from "../page";
import { AccionConMotivo, MesCerrado } from "@/components/accion-con-motivo";
import { mesDeFecha, mesesCerrados } from "@/lib/meses";
import { tratosDeLaOrg, fechaDMA } from "@/lib/tratos";
import { AgregarMovimiento, CambiarActivo, CorregirReferidor, EditarDatos, ForzarElite, TasaDeBienvenida } from "./formularios";

export const metadata = { title: "Comisionista — Tasa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Por qué quedó en ese nivel ese mes (lo que no dice, es por su promedio). */
const MOTIVO = { promedio: "", bienvenida: "bienvenida", arranque: "arranque", escalon: "bajando un nivel", elite: "Élite" } as const;

const DOCUMENTO = { factura: "Factura", recibo: "Recibo simple", ninguno: "Sin documento" } as const;

type Ficha = {
  persona_id: string;
  slug: string;
  rfc: string | null;
  curp: string | null;
  codigo_referido: string;
  referido_desde: string | null;
  csf_ruta: string | null;
  csf_subida_en: string | null;
  emite_factura: boolean;
  porcentaje_forzado: string | number | null;
  elite_vence: string | null;
  trato_inicial: "bienvenida" | "arranque" | null;
  trato_nivel_id: string | null;
  trato_desde: string | null;
  trato_hasta: string | null;
  fecha_alta: string;
  personas: { nombre: string; correo: string; telefono: string | null; activo: boolean } | null;
  referido_por: string | null;
};

export default async function FichaComisionista({ params, searchParams }: PageProps<"/admin/comisionistas/[id]">) {
  const yo = await exigirRol(...ROLES_OPERACION);
  const { id } = await params;
  const { mes } = await searchParams;
  if (!UUID.test(id)) notFound();

  const supabase = await crearClienteServidor();
  const [ficha, resumen, niveles, trabajos, pendientes, pagos, cuentas, servicios] = await Promise.all([
    supabase
      .from("comisionistas")
      .select(
        "persona_id, slug, rfc, curp, codigo_referido, referido_desde, csf_ruta, csf_subida_en, emite_factura, porcentaje_forzado, elite_vence, trato_inicial, trato_nivel_id, trato_desde, trato_hasta, fecha_alta, personas!comisionistas_persona_id_fkey(nombre, correo, telefono, activo), referido_por"
      )
      .eq("persona_id", id)
      .maybeSingle()
      .returns<Ficha | null>(),
    supabase.rpc("resumen_comisionistas"),
    supabase
      .from("niveles_mensuales")
      .select("mes, porcentaje, promedio, motivo, niveles(nombre)")
      .eq("comisionista_id", id)
      .order("mes", { ascending: false })
      .returns<{ mes: string; porcentaje: string | number; promedio: string | number; motivo: keyof typeof MOTIVO; niveles: { nombre: string } | null }[]>(),
    supabase
      .from("solicitudes")
      .select("id, folio, cliente_nombre, estatus_publico, monto_total")
      .eq("comisionista_id", id)
      .order("creado_en", { ascending: false })
      .returns<{ id: string; folio: string | null; cliente_nombre: string; estatus_publico: EstatusPublico; monto_total: string | number }[]>(),
    supabase
      .from("pendientes_comision")
      .select("id, mes, monto, pagado, pagado_en, factura_ruta")
      .eq("comisionista_id", id)
      .order("mes", { ascending: false })
      .returns<{ id: string; mes: string; monto: string | number; pagado: string | number; pagado_en: string | null; factura_ruta: string | null }[]>(),
    supabase
      .from("pagos_comision")
      .select("id, fecha, monto, referencia, documento, estado, motivo_anulacion, origenes_pago(nombre)")
      .eq("comisionista_id", id)
      .order("fecha", { ascending: false })
      .returns<{ id: string; fecha: string; monto: string | number; referencia: string | null; documento: keyof typeof DOCUMENTO; estado: "registrado" | "anulado"; motivo_anulacion: string | null; origenes_pago: { nombre: string } | null }[]>(),
    supabase.from("cuentas_receptoras").select("id, alias").eq("activa", true).order("alias").returns<{ id: string; alias: string }[]>(),
    supabase.from("servicios").select("id, nombre").eq("activo", true).order("nombre").returns<{ id: string; nombre: string }[]>(),
  ]);

  const f = oExplota(ficha, "el comisionista");
  if (!f || !f.personas) notFound();
  const r = ((oExplota(resumen, "el resumen") ?? []) as FilaComisionista[]).find((x) => x.persona_id === id);
  const listaPendientes = oExplota(pendientes, "los pendientes") ?? [];
  const listaPagos = oExplota(pagos, "los pagos de comisión") ?? [];
  const saldo = listaPendientes.reduce((s, p) => s + Number(p.monto) - Number(p.pagado), 0);
  const superAdmin = yo.rol === "admin_org";
  // admin_marca ve al comisionista con los datos de sus marcas: sin pagos
  // de comisión, estado de cuenta ni acciones (mezclan marcas).
  const staff = esStaff(yo);
  const activo = r?.activo ?? f.personas.activo;
  const cerrados = staff ? await mesesCerrados() : new Set<string>();
  // PostgREST no sigue la llave compuesta de un comisionista a otro: el
  // nombre de quien lo refirió se lee aparte.
  const referido = f.referido_por
    ? ((await supabase.from("personas").select("nombre").eq("id", f.referido_por).maybeSingle()).data?.nombre ?? null)
    : null;
  const [csf, otros] = await Promise.all([
    staff && f.csf_ruta ? supabase.storage.from("altas").createSignedUrl(f.csf_ruta, 600) : Promise.resolve(null),
    yo.rol === "admin_org"
      ? supabase.from("comisionistas").select("persona_id, personas!comisionistas_persona_id_fkey(nombre)").neq("persona_id", id)
          .returns<{ persona_id: string; personas: { nombre: string } | null }[]>()
      : Promise.resolve(null),
  ]);
  const tratos = await tratosDeLaOrg(yo.organizacion.id);
  const nivelDelTrato = f.trato_nivel_id
    ? (await supabase.from("niveles").select("nombre, porcentaje").eq("id", f.trato_nivel_id).maybeSingle()).data
    : null;
  const { data: terminos } = await supabase
    .from("aceptaciones_terminos")
    .select("version, aceptado_en")
    .eq("persona_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <PantallaAdmin titulo={f.personas.nombre} volver={{ href: "/admin/comisionistas", texto: "Comisionistas" }}>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {activo ? <Etiqueta tono="exito">Activo</Etiqueta> : <Etiqueta tono="error">Inactivo</Etiqueta>}
        {r ? (
          <Etiqueta tono="neutro">
            {r.nivel} · {Number(r.porcentaje)}%{r.provisional ? " provisional" : ""}
          </Etiqueta>
        ) : null}
      </div>
      <p className="mt-2 text-[0.9375rem] text-secundario">
        Último acceso: {r?.ultimo_acceso ? fechaCorta(r.ultimo_acceso) : "nunca ha entrado"}
      </p>

      <Seccion titulo="Datos">
        <dl className="flex flex-col gap-1 text-[0.9375rem]">
          <Dato etiqueta="Correo" valor={f.personas.correo} />
          {f.rfc ? null : <Dato etiqueta="RFC" valor="— (llegó con CURP)" />}
          {f.curp ? <Dato etiqueta="CURP" valor={f.curp} /> : null}
          <Dato etiqueta="Código de referido" valor={f.codigo_referido} />
          <Dato etiqueta="Alta" valor={fechaCorta(f.fecha_alta)} />
          {referido ? (
            <Dato etiqueta="Referido por" valor={`${referido}${f.referido_desde ? ` (desde el ${fechaCorta(f.referido_desde)})` : ""}`} />
          ) : null}
          <Dato etiqueta="Constancia (CSF)" valor={f.csf_ruta ? `subida${f.csf_subida_en ? ` el ${fechaCorta(f.csf_subida_en)}` : ""}` : "pendiente"} />
          <Dato
            etiqueta="Términos"
            valor={terminos ? `aceptados el ${fechaCorta(terminos.aceptado_en)} (versión ${terminos.version})` : "sin aceptar"}
          />
        </dl>
        {csf && "data" in csf && csf.data ? (
          <a href={csf.data.signedUrl} target="_blank" rel="noopener" className="toque mt-2 inline-block text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
            Ver la constancia
          </a>
        ) : null}
        {otros?.data ? (
          <CorregirReferidor
            personaId={id}
            actual={f.referido_por}
            opciones={otros.data
              .map((o) => ({ id: o.persona_id, nombre: o.personas?.nombre ?? "" }))
              .sort((a, b) => a.nombre.localeCompare(b.nombre))}
          />
        ) : null}
        {staff ? (
          <EditarDatos
            personaId={id}
            nombre={f.personas.nombre}
            telefono={f.personas.telefono ?? ""}
            rfc={f.rfc ?? ""}
            emiteFactura={f.emite_factura}
          />
        ) : null}
      </Seccion>

      {staff ? (
      <Seccion titulo="Pagos de comisión">
        <dl className="flex items-baseline justify-between rounded-xl bg-tinte px-4 py-3">
          <dt className="font-semibold">Saldo por pagar</dt>
          <dd className="text-[1.25rem] font-bold text-primario">{pesos(saldo)}</dd>
        </dl>
        {saldo > 0 ? (
          <Link
            href={`/admin/comisiones/pagar?c=${id}`}
            className="mt-3 flex min-h-12 items-center justify-center rounded-lg bg-primario px-4 py-3 font-semibold text-sobre-primario"
          >
            Registrar pago
          </Link>
        ) : null}
        {listaPendientes.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {listaPendientes.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-linea px-4 py-3 text-[0.9375rem]">
                <span>
                  <span className="block font-semibold capitalize">{mesLargo(p.mes)}</span>
                  <span className="block text-secundario">
                    {pesos(Number(p.monto))} · pagado {pesos(Number(p.pagado))}
                    {f.emite_factura ? (p.factura_ruta ? " · con factura" : " · sin factura") : ""}
                  </span>
                </span>
                {p.pagado_en ? (
                  <Etiqueta tono="exito">Pagado</Etiqueta>
                ) : (
                  <span className="whitespace-nowrap font-semibold text-acento">{pesos(Number(p.monto) - Number(p.pagado))}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[0.9375rem] text-secundario">Todavía no tiene cierres con saldo a su favor.</p>
        )}
        {listaPagos.length > 0 ? (
          <>
            <h3 className="mt-4 font-semibold">Pagos registrados</h3>
            <ul className="mt-2 flex flex-col">
              {listaPagos.map((p, i) => (
                <li key={p.id} className={`rounded px-2 py-2 text-[0.9375rem] ${i % 2 ? "bg-alterno" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-semibold">{fechaCorta(p.fecha)}</span>
                      <span className="block text-secundario">
                        {p.origenes_pago?.nombre}
                        {p.referencia ? ` · ${p.referencia}` : ""} · {DOCUMENTO[p.documento]}
                      </span>
                    </span>
                    <span className={`whitespace-nowrap font-semibold ${p.estado === "anulado" ? "text-secundario line-through" : ""}`}>
                      {pesos(Number(p.monto))}
                    </span>
                  </div>
                  {p.estado === "anulado" ? (
                    <p className="mt-1 text-secundario"><Etiqueta tono="neutro">Anulado</Etiqueta> {p.motivo_anulacion}</p>
                  ) : cerrados.has(mesDeFecha(p.fecha)) ? (
                    <MesCerrado />
                  ) : (
                    <AccionConMotivo
                      que="anular_pago_comision"
                      id={p.id}
                      texto="Anular pago"
                      explicacion="El pago queda anulado (no se borra) y lo que cubrió vuelve a quedar por pagar. El comisionista deja de verlo."
                    />
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[0.875rem] text-secundario">El comisionista ve fecha, referencia y monto; no el origen.</p>
          </>
        ) : null}
      </Seccion>

      ) : null}

      <Seccion titulo="Trabajos">
        {(oExplota(trabajos, "los trabajos") ?? []).length === 0 ? (
          <p className="text-[0.9375rem] text-secundario">Sin trabajos todavía.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(oExplota(trabajos, "los trabajos") ?? []).map((t) => {
              const e = estatusVisible(t.estatus_publico, t.folio);
              return (
                <li key={t.id}>
                  <Link href={`/trabajos/${t.id}`} className="flex items-start justify-between gap-3 rounded-lg border border-linea px-4 py-3">
                    <span className="min-w-0 text-[0.9375rem]">
                      <span className="block font-semibold">{t.cliente_nombre}</span>
                      <span className="block text-secundario">
                        {t.folio ?? "Sin folio"}
                        {Number(t.monto_total) > 0 ? ` · ${pesos(Number(t.monto_total))}` : ""}
                      </span>
                    </span>
                    <Etiqueta tono={e.tono}>{e.texto}</Etiqueta>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>

      <Seccion titulo="Niveles">
        {(oExplota(niveles, "los niveles") ?? []).length === 0 ? (
          <p className="text-[0.9375rem] text-secundario">Sin niveles calculados: el primero sale al aprobar su primer cierre.</p>
        ) : (
          <ul className="flex flex-col">
            {(oExplota(niveles, "los niveles") ?? []).map((n, i) => (
              <li key={n.mes} className={`flex justify-between gap-3 rounded px-2 py-2 text-[0.9375rem] ${i % 2 ? "bg-alterno" : ""}`}>
                <span className="capitalize">{mesLargo(n.mes)}</span>
                <span>
                  <span className="font-semibold">{n.niveles?.nombre} · {Number(n.porcentaje)}%</span>
                  <span className="text-secundario"> · prom. {pesos(Number(n.promedio))}</span>
                  {MOTIVO[n.motivo] ? <span className="text-secundario"> · {MOTIVO[n.motivo]}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {f.trato_inicial && f.trato_desde && f.trato_hasta ? (
          <p className="mt-2 text-[0.9375rem] font-semibold text-primario">
            {f.trato_inicial === "bienvenida" ? "Tasa de bienvenida" : "Arranque"}: {nivelDelTrato?.nombre}{" "}
            {Number(nivelDelTrato?.porcentaje)}% del {fechaDMA(f.trato_desde)} al {fechaDMA(f.trato_hasta)}
            {f.trato_inicial === "bienvenida" ? ". Al terminar baja un nivel por cierre hasta su nivel real." : "."}
          </p>
        ) : null}
        {f.porcentaje_forzado !== null ? (
          <p className="mt-2 text-[0.9375rem] font-semibold text-primario">
            Élite forzado: {Number(f.porcentaje_forzado)}% manda sobre el nivel calculado
            {f.elite_vence ? `, hasta el ${fechaDMA(f.elite_vence)}` : ""}.
          </p>
        ) : null}
      </Seccion>

      {staff ? (
      <>
      <Seccion titulo="Estado de cuenta">
        <VistaEstadoDeCuenta
          personaId={id}
          mesPedido={typeof mes === "string" ? mes : undefined}
          base={`/admin/comisionistas/${id}`}
          dueno={false}
          puedeAnular={superAdmin}
        />
      </Seccion>

      <Seccion titulo="Acciones">
        <div className="flex flex-col gap-6">
          {superAdmin ? (
            <>
              <AgregarMovimiento personaId={id} cuentas={oExplota(cuentas, "las cuentas") ?? []} servicios={oExplota(servicios, "los servicios") ?? []} />
              <ForzarElite personaId={id} actual={f.porcentaje_forzado === null ? null : Number(f.porcentaje_forzado)}
                vence={f.elite_vence} />
            </>
          ) : null}
          <TasaDeBienvenida personaId={id} tratos={tratos} puedeCambiarMeses={superAdmin}
            tiene={f.trato_inicial === "bienvenida"} />
          <CambiarActivo personaId={id} activo={activo} />
        </div>
      </Seccion>
      </>
      ) : null}
    </PantallaAdmin>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[1.125rem] font-bold">{titulo}</h2>
      {children}
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-secundario">{etiqueta}</dt>
      <dd className="text-right font-semibold [overflow-wrap:anywhere]">{valor}</dd>
    </div>
  );
}
