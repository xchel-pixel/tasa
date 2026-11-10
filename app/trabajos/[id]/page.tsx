import Link from "next/link";
import { notFound } from "next/navigation";
import { DatosBancarios } from "@/components/datos-bancarios";
import { Encabezado } from "@/components/encabezado";
import { Etiqueta } from "@/components/etiqueta";
import { ESTADO_PAGO, VIA_PAGO, estatusVisible } from "@/lib/estatus";
import { fechaCorta, pesos } from "@/lib/formato";
import { paraAsignar } from "@/lib/asignar";
import { carpetaDe, exigirPersona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerTrabajo, type Trabajo } from "@/lib/trabajos";
import { AccionConMotivo, MesCerrado } from "@/components/accion-con-motivo";
import { mesDeFecha, mesesCerrados } from "@/lib/meses";
import AceptarCotizacion from "./aceptar-cotizacion";
import { AsignarComisionista, EntregarPago, GeneraComision } from "./asignar";
import CambiarEstatus from "./cambiar-estatus";
import FijarHonorarioFinal from "./fijar-honorario-final";
import { AplicarCredito } from "@/app/admin/paquetes/formularios";

export const metadata = { title: "Trabajo — Tasa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FichaTrabajo({ params }: PageProps<"/trabajos/[id]">) {
  const persona = await exigirPersona();
  const { id } = await params;
  // Una dirección inventada no es un error de la base: es "no existe".
  if (!UUID.test(id)) notFound();

  const t = await obtenerTrabajo(id);
  if (!t) notFound();

  const estatus = estatusVisible(t.estatus_publico, t.folio);
  if (persona.rol === "comisionista") await (await crearClienteServidor()).rpc("marcar_avisos_del_trabajo", { p_solicitud: t.id });
  // El equipo ve lo de su liga solo para seguimiento: aceptar y pagar son del comisionista y del staff.
  const actua = persona.rol !== "equipo";

  // El PDF vive en un bucket privado: se abre con una liga que vence en 10 minutos.
  let ligaPdf: string | null = null;
  if (t.cotizacion?.pdf_ruta) {
    const supabase = await crearClienteServidor();
    const { data } = await supabase.storage.from("cotizaciones").createSignedUrl(t.cotizacion.pdf_ruta, 600);
    ligaPdf = data?.signedUrl ?? null;
  }
  // Sin conector externo, admin_org o el admin de la marca mueven el estatus a mano.
  let estatusAMano = false;
  if ((persona.rol === "admin_org" || persona.rol === "admin_marca") && t.estado === "tramite" && !t.pagado_en) {
    const supabase = await crearClienteServidor();
    const { data: conector } = await supabase.from("conectores").select("tipo").eq("activo", true).maybeSingle();
    estatusAMano = (conector?.tipo ?? "manual") === "manual";
  }
  // Quien opera el trabajo (admin_org, finanzas, admin_marca de su marca) puede deshacer y ve
  // el historial de correcciones; el RLS ya le dejó ver solo lo suyo.
  const operador = persona.rol === "admin_org" || persona.rol === "finanzas" || persona.rol === "admin_marca";
  let cerrados = new Set<string>();
  let correcciones: Correccion[] = [];
  if (operador) {
    const supabase = await crearClienteServidor();
    const [meses, eventos] = await Promise.all([
      mesesCerrados(),
      supabase
        .from("eventos_trabajo")
        .select("id, accion, motivo, detalle, creado_en, personas(nombre:nombre_visible)")
        .eq("solicitud_id", t.id)
        .order("creado_en")
        .returns<Correccion[]>(),
    ]);
    cerrados = meses;
    correcciones = eventos.data ?? [];
  }
  // Asignar o cambiar comisionista y "genera comisión": admin_org (o finanzas si Ajustes lo permite).
  const { asigna, comisionistas } =
    operador && t.estado !== "cancelada" ? await paraAsignar() : { asigna: false, comisionistas: [] };
  const hoyMx = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  // En un mes cerrado no se deshace: ni el mes del pago ni el de la comisión que devengó.
  const mesCerrado = (pago: { fecha_pago: string; estado: string }) =>
    cerrados.has(mesDeFecha(pago.fecha_pago)) ||
    (pago.estado === "confirmado" && Boolean(t.mes_cierre) && cerrados.has(mesDeFecha(t.mes_cierre!)));
  const confirmado = t.pagos.filter((p) => p.estado === "confirmado").reduce((s, p) => s + p.monto, 0);
  // Monedero (0077): admin_org o finanzas aplican crédito del comisionista a un trámite sin pagar.
  const finanzas = persona.rol === "admin_org" || persona.rol === "finanzas";
  let credito: { monto: number; saldo: number; motivo: string | null } | null = null;
  if (finanzas && t.estado === "tramite" && !t.pagado_en) {
    const supabase = await crearClienteServidor();
    const { data } = await supabase.rpc("credito_aplicable", { p_solicitud: t.id });
    const c = data as { monto: number | string; saldo: number | string | null; motivo: string | null } | null;
    if (c && Number(c.saldo ?? 0) > 0) credito = { monto: Number(c.monto), saldo: Number(c.saldo), motivo: c.motivo };
  }
  const porConfirmar = t.pagos.filter((p) => p.estado === "reportado").reduce((s, p) => s + p.monto, 0);

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← {persona.rol === "comisionista" ? "Mis trabajos" : persona.rol === "equipo" ? "Inicio" : "Panel"}
          </Link>

          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[1.5rem] font-bold leading-tight tracking-tight">{t.cliente_nombre}</h1>
              <p className="mt-1 text-[0.9375rem] text-secundario">
                {t.servicio}
                {t.folio ? ` · ${t.folio}` : ""}
                {t.marca ? ` · ${t.marca}` : ""}
              </p>
            </div>
            <Etiqueta tono={estatus.tono}>{estatus.texto}</Etiqueta>
          </div>
          {t.entrega_prioritaria ? <p className="mt-2"><Etiqueta tono="proceso">Entrega prioritaria</Etiqueta></p> : null}
          {estatusAMano ? <CambiarEstatus solicitudId={t.id} actual={t.estatus_publico} /> : null}

          {t.estado === "tramite" && t.honorario.tipo !== "fijo" ? (
            <AvisoHonorario t={t} puedeFijar={persona.rol === "admin_org" || persona.rol === "finanzas"} />
          ) : null}

          {t.estado === "cancelada" && t.motivo_cancelacion ? (
            <p className="mt-4 rounded-lg bg-error-fondo px-4 py-3 text-[0.9375rem] leading-6 text-error">
              Cancelado: {t.motivo_cancelacion}
            </p>
          ) : null}

          {t.estado === "solicitada" ? (
            <p className="mt-6 rounded-xl bg-alterno px-4 py-3 leading-7">
              Administración está preparando la cotización. Te avisamos por correo cuando esté lista.
            </p>
          ) : null}
          {t.estado === "solicitada" && persona.rol === "comisionista" ? (
            <AccionConMotivo
              que="cancelar_solicitud"
              id={t.id}
              texto="Cancelar solicitud"
              explicacion="La solicitud se cancela y Administración ya no la cotiza. Solo se puede mientras no tenga cotización."
            />
          ) : null}

          {t.estado === "cotizada" && t.cotizacion ? (
            <Seccion titulo="Cotización">
              <p className="text-[0.9375rem] text-secundario">
                Vigente hasta el {fechaCorta(t.cotizacion.vigente_hasta)}.
              </p>
              <Desglose
                tipo={t.cotizacion.honorario_tipo}
                minimo={t.cotizacion.honorario_minimo}
                honorarios={t.cotizacion.monto_honorarios}
                iva={t.cotizacion.requiere_factura ? t.cotizacion.monto_iva : null}
                terceros={t.cotizacion.monto_terceros}
                total={t.cotizacion.monto_total}
              />
              {t.cotizacion.cuenta ? <div className="mt-3"><DatosBancarios cuenta={t.cotizacion.cuenta} /></div> : null}
              {ligaPdf ? (
                <a
                  href={ligaPdf}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex min-h-12 items-center justify-center rounded-lg border border-primario px-4 font-semibold text-primario"
                >
                  Descargar PDF para el cliente
                </a>
              ) : null}
              {actua ? <AceptarCotizacion cotizacionId={t.cotizacion.id} /> : null}
              {operador ? (
                <AccionConMotivo
                  que="anular_cotizacion"
                  id={t.cotizacion.id}
                  texto="Anular cotización"
                  explicacion="La cotización queda anulada (no se borra) y la solicitud vuelve a por cotizar. El comisionista deja de verla."
                />
              ) : null}
            </Seccion>
          ) : null}

          {t.estado !== "solicitada" && t.estado !== "cotizada" && t.monto_honorarios !== null ? (
            <Seccion titulo="Montos">
              <Desglose
                tipo={t.honorario.tipo === "estimado" && t.honorario.final_en ? "fijo" : t.honorario.tipo}
                minimo={t.honorario.minimo}
                honorarios={t.monto_honorarios}
                iva={t.requiere_factura ? t.monto_iva : null}
                terceros={t.monto_terceros}
                total={t.monto_total}
              />
              {t.estado === "tramite" || t.pagos.length > 0 ? (
                <dl className="mt-3 flex flex-col gap-1 text-[0.9375rem]">
                  <Renglon etiqueta="Confirmado" valor={pesos(confirmado)} />
                  {porConfirmar > 0 ? <Renglon etiqueta="Por confirmar" valor={pesos(porConfirmar)} /> : null}
                  {t.pagado_en ? (
                    <Renglon etiqueta="Pagado al 100%" valor={fechaCorta(t.pagado_en)} />
                  ) : (
                    <Renglon etiqueta="Falta" valor={pesos(Math.max(0, t.monto_total - confirmado))} fuerte />
                  )}
                </dl>
              ) : null}
            </Seccion>
          ) : null}

          {t.estado === "tramite" && !t.pagado_en && t.cuenta && actua ? (
            <Seccion titulo="Dónde depositar">
              <div className="mt-3"><DatosBancarios cuenta={t.cuenta} /></div>
              <Link
                href={`/trabajos/${t.id}/pagar`}
                className="mt-4 flex min-h-12 items-center justify-center rounded-lg bg-primario px-4 py-3 text-[1.0625rem] font-semibold text-sobre-primario"
              >
                {persona.rol === "comisionista" ? "Reportar pago" : "Registrar pago"}
              </Link>
            </Seccion>
          ) : null}

          {credito ? (
            <Seccion titulo="Crédito del comisionista">
              <p className="text-[0.9375rem] leading-6 text-secundario">
                Saldo vigente {pesos(credito.saldo)}.{" "}
                {credito.monto > 0 ? `Este trabajo admite hasta ${pesos(Math.min(credito.monto, credito.saldo))} (honorarios${t.requiere_factura ? " + IVA" : ""}; nunca terceros). La parte con crédito no genera comisión ni bono.` : credito.motivo ?? "Este trabajo no admite crédito."}
              </p>
              {credito.monto > 0 ? <AplicarCredito solicitud={t.id} maximo={Math.min(credito.monto, credito.saldo)} /> : null}
            </Seccion>
          ) : null}
          {t.credito_honorarios > 0 ? (
            <p className="mt-3 text-[0.9375rem] text-secundario">Honorarios pagados con crédito: {pesos(t.credito_honorarios)} (sin comisión ni bono por referido).</p>
          ) : null}

          {t.pagos.length > 0 ? (
            <Seccion titulo="Pagos">
              <ul className="flex flex-col gap-2">
                {t.pagos.map((p) => (
                  <li key={p.id} className="rounded-lg border border-linea px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{pesos(p.monto)}</p>
                        <p className="text-[0.9375rem] text-secundario">
                          {fechaCorta(p.fecha_pago)} · {VIA_PAGO[p.via]}
                          {p.recibido_por ? ` · recibió ${p.recibido_por}` : ""}
                        </p>
                      </div>
                      <Etiqueta tono={ESTADO_PAGO[p.estado].tono}>{ESTADO_PAGO[p.estado].texto}</Etiqueta>
                    </div>
                    {p.recibio_asesor && p.estado === "reportado" ? (
                      <p className={`mt-2 text-[0.9375rem] leading-6 ${
                        !p.entregado_en && p.entregar_antes && p.entregar_antes < hoyMx ? "font-semibold text-error" : "text-secundario"}`}>
                        {p.entregado_en
                          ? `Lo recibió el comisionista · entregado a la cuenta el ${fechaCorta(p.entregado_en)}, por confirmar`
                          : `Lo recibió el comisionista · por entregar a la cuenta a más tardar el ${fechaCorta(p.entregar_antes ?? p.fecha_pago)}`}
                      </p>
                    ) : p.recibio_asesor ? (
                      <p className="mt-2 text-[0.9375rem] text-secundario">Lo recibió el comisionista y lo entregó a la cuenta.</p>
                    ) : null}
                    {p.recibio_asesor && p.estado === "reportado" && !p.entregado_en &&
                    ((persona.rol === "comisionista" && p.reportado_por === persona.id) || operador) ? (
                      <EntregarPago pagoId={p.id} solicitudId={t.id} carpeta={carpetaDe(persona)} staff={operador} />
                    ) : null}
                    {p.estado === "rechazado" && p.motivo_rechazo ? (
                      <p className="mt-2 text-[0.9375rem] leading-6 text-error">Motivo: {p.motivo_rechazo}</p>
                    ) : null}
                    {p.estado === "retirado" && p.motivo_retiro ? (
                      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">Retirado: {p.motivo_retiro}</p>
                    ) : null}
                    {p.nota ? <p className="mt-1 text-[0.9375rem] text-secundario">{p.nota}</p> : null}
                    {operador && (p.estado === "confirmado" || p.estado === "rechazado") ? (
                      mesCerrado(p) ? (
                        <MesCerrado />
                      ) : (
                        <AccionConMotivo
                          que="revertir_pago"
                          id={p.id}
                          texto={p.estado === "confirmado" ? "Revertir confirmación" : "Revertir rechazo"}
                          explicacion={
                            p.estado === "confirmado"
                              ? "El pago vuelve a \"Por confirmar\". Si con él el trabajo había quedado pagado, deja de estarlo y la comisión que devengó se quita."
                              : "El pago vuelve a \"Por confirmar\" para revisarlo otra vez."
                          }
                        />
                      )
                    ) : null}
                    {persona.rol === "comisionista" && p.estado === "reportado" && p.reportado_por === persona.id ? (
                      <AccionConMotivo
                        que="retirar_pago"
                        id={p.id}
                        texto="Retirar"
                        explicacion="El pago deja de esperar confirmación. Si lo reportaste mal, retíralo y repórtalo de nuevo."
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </Seccion>
          ) : null}

          {asigna ? (
            <Seccion titulo="Comisionista">
              <p className="text-[0.9375rem]">
                {t.comisionista ?? "Sin comisionista"}
                {t.origen === "importado" ? " · traído de Notion" : ""}
              </p>
              {t.comision_regla === "ninguna" ? (
                <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
                  No genera comisión{t.sin_comision_motivo ? `: ${t.sin_comision_motivo}` : " (convenio sin comisión)"}.
                </p>
              ) : null}
              <div className="mt-3 flex flex-col gap-6">
                <AsignarComisionista solicitudId={t.id} actual={t.comisionista_id} comisionistas={comisionistas} />
                {t.comisionista_id && (t.comision_regla !== "ninguna" || t.sin_comision_motivo) ? (
                  <GeneraComision solicitudId={t.id} genera={t.comision_regla !== "ninguna"} />
                ) : null}
              </div>
            </Seccion>
          ) : null}

          <Seccion titulo="Inmueble y cliente">
            <dl className="flex flex-col gap-2 text-[0.9375rem]">
              <Dato etiqueta="Dirección" valor={[t.inmueble_direccion, t.inmueble_municipio].filter(Boolean).join(", ")} />
              {t.inmueble_clave_catastral ? <Dato etiqueta="Clave catastral" valor={t.inmueble_clave_catastral} /> : null}
              {t.inmueble_descripcion ? <Dato etiqueta="Descripción" valor={t.inmueble_descripcion} /> : null}
              {t.calculo_traslado_id ? (
                <div>
                  <dt className="text-secundario">Origen</dt>
                  <dd>
                    Calculadora de traslado
                    {persona.rol === "comisionista" ? (
                      <> · <Link href={`/calculadora/${t.calculo_traslado_id}`} className="font-semibold text-acento underline underline-offset-4">ver el cálculo</Link></>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <Dato etiqueta="Cliente" valor={t.cliente_nombre} />
              {t.cliente_telefono ? <Dato etiqueta="Teléfono" valor={t.cliente_telefono} /> : null}
              {t.cliente_correo ? <Dato etiqueta="Correo" valor={t.cliente_correo} /> : null}
            </dl>
          </Seccion>

          {correcciones.length > 0 ? (
            <Seccion titulo="Correcciones">
              <ol className="flex flex-col gap-2 border-l-2 border-error pl-4">
                {correcciones.map((c) => (
                  <li key={c.id} className="text-[0.9375rem] leading-6">
                    <span className="font-semibold">{ACCION_CORRECCION[c.accion] ?? c.accion}</span>
                    <span className="text-secundario">
                      {" "}· {fechaCorta(c.creado_en)}
                      {c.personas?.nombre ? ` · ${c.personas.nombre}` : ""}
                    </span>
                    {c.detalle ? <span className="block text-secundario">{c.detalle}</span> : null}
                    {c.motivo ? <span className="block">Motivo: {c.motivo}</span> : null}
                  </li>
                ))}
              </ol>
            </Seccion>
          ) : null}

          {t.historial.length > 0 ? (
            <Seccion titulo="Historial">
              <ol className="flex flex-col gap-2 border-l-2 border-linea pl-4">
                {t.historial.map((h, i) => (
                  <li key={i} className="text-[0.9375rem]">
                    <span className="font-semibold">{estatusVisible(h.estatus_publico, "x").texto}</span>
                    <span className="text-secundario"> · {fechaCorta(h.desde)}</span>
                  </li>
                ))}
              </ol>
            </Seccion>
          ) : null}
        </div>
      </main>
    </>
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

/** "Estimado $X · por definir", "Honorario final $Y" o "Sin costo · ligado a …". Finanzas y admin_org fijan el final aquí. */
function AvisoHonorario({ t, puedeFijar }: { t: Trabajo; puedeFijar: boolean }) {
  const h = t.honorario;
  const monto = t.monto_honorarios ?? 0;
  if (h.tipo === "sin_costo") {
    return (
      <p className="mt-4 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem] leading-6">
        <span className="font-semibold">Sin costo.</span> No genera comisión ni cuenta para nivel.
        {h.ligada ? (
          <>
            {" "}Ligado a{" "}
            <Link href={`/trabajos/${h.ligada.id}`} className="font-semibold text-acento underline underline-offset-4">
              {h.ligada.folio ?? h.ligada.cliente_nombre}
            </Link>
            , que es el que genera la comisión.
          </>
        ) : null}
      </p>
    );
  }
  if (h.final_en) {
    return (
      <p className="mt-4 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem] leading-6">
        Honorario final <span className="font-semibold">{pesos(monto)}</span>
        {h.estimado ? <> (estimado {pesos(h.estimado)})</> : null}, fijado el {fechaCorta(h.final_en)}.
      </p>
    );
  }
  return (
    <div className="mt-4 rounded-xl bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6 text-proceso">
      <p>
        <span className="font-semibold">{textoEstimado(monto, h.minimo)} · por definir.</span> La comisión se
        calcula sobre el honorario final.
      </p>
      {puedeFijar && !t.pagado_en ? <FijarHonorarioFinal solicitudId={t.id} estimado={monto} /> : null}
    </div>
  );
}

const textoEstimado = (max: number, min: number | null) =>
  min !== null && min < max ? `Estimado ${pesos(min)} – ${pesos(max)}` : `Estimado ${pesos(max)}`;

function Desglose({
  tipo = "fijo",
  minimo = null,
  honorarios,
  iva,
  terceros,
  total,
}: {
  tipo?: "fijo" | "sin_costo" | "estimado";
  minimo?: number | null;
  honorarios: number;
  iva: number | null;
  terceros: number;
  total: number;
}) {
  return (
    <dl className="flex flex-col gap-1 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem]">
      <Renglon
        etiqueta={tipo === "estimado" ? "Honorarios (estimado)" : "Honorarios"}
        valor={tipo === "sin_costo" ? "Sin costo" : tipo === "estimado" ? `${textoEstimado(honorarios, minimo)} · por definir` : pesos(honorarios)}
      />
      {iva !== null ? <Renglon etiqueta="IVA" valor={pesos(iva)} /> : null}
      {terceros > 0 ? <Renglon etiqueta="Derechos y terceros" valor={pesos(terceros)} /> : null}
      <div className="mt-1 border-t border-linea pt-2">
        <Renglon etiqueta="Total" valor={pesos(total)} fuerte />
      </div>
    </dl>
  );
}

function Renglon({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={fuerte ? "font-semibold" : "text-secundario"}>{etiqueta}</dt>
      <dd className={fuerte ? "text-[1.0625rem] font-bold text-primario" : "font-semibold"}>{valor}</dd>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-secundario">{etiqueta}</dt>
      <dd className="whitespace-pre-line">{valor}</dd>
    </div>
  );
}

type Correccion = {
  id: string;
  accion: string;
  motivo: string | null;
  detalle: string | null;
  creado_en: string;
  personas: { nombre: string } | null;
};

const ACCION_CORRECCION: Record<string, string> = {
  revertir_confirmacion: "Confirmación revertida",
  revertir_rechazo: "Rechazo revertido",
  retirar_pago: "Pago retirado",
  anular_cotizacion: "Cotización anulada",
  cancelar: "Cancelado",
  asignar_comisionista: "Comisionista asignado",
  sin_comision: "No genera comisión",
  con_comision: "Vuelve a generar comisión",
  importar: "Traído de Notion",
  notion_solicitado: "Notion actualizado",
};
