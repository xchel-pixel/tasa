import Link from "next/link";
import { notFound } from "next/navigation";
import { DatosBancarios } from "@/components/datos-bancarios";
import { Encabezado } from "@/components/encabezado";
import { Etiqueta } from "@/components/etiqueta";
import { ESTADO_PAGO, VIA_PAGO, estatusVisible } from "@/lib/estatus";
import { fechaCorta, pesos } from "@/lib/formato";
import { exigirPersona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerTrabajo } from "@/lib/trabajos";
import { AccionConMotivo, MesCerrado } from "@/components/accion-con-motivo";
import { mesDeFecha, mesesCerrados } from "@/lib/meses";
import AceptarCotizacion from "./aceptar-cotizacion";
import CambiarEstatus from "./cambiar-estatus";

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
  // En un mes cerrado no se deshace: ni el mes del pago ni el de la comisión que devengó.
  const mesCerrado = (pago: { fecha_pago: string; estado: string }) =>
    cerrados.has(mesDeFecha(pago.fecha_pago)) ||
    (pago.estado === "confirmado" && Boolean(t.mes_cierre) && cerrados.has(mesDeFecha(t.mes_cierre!)));
  const confirmado = t.pagos.filter((p) => p.estado === "confirmado").reduce((s, p) => s + p.monto, 0);
  const porConfirmar = t.pagos.filter((p) => p.estado === "reportado").reduce((s, p) => s + p.monto, 0);

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← {persona.rol === "comisionista" ? "Mis trabajos" : "Panel"}
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
          {estatusAMano ? <CambiarEstatus solicitudId={t.id} actual={t.estatus_publico} /> : null}

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
              <AceptarCotizacion cotizacionId={t.cotizacion.id} />
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

          {t.estado === "tramite" && !t.pagado_en && t.cuenta ? (
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

          <Seccion titulo="Inmueble y cliente">
            <dl className="flex flex-col gap-2 text-[0.9375rem]">
              <Dato etiqueta="Dirección" valor={[t.inmueble_direccion, t.inmueble_municipio].filter(Boolean).join(", ")} />
              {t.inmueble_clave_catastral ? <Dato etiqueta="Clave catastral" valor={t.inmueble_clave_catastral} /> : null}
              {t.inmueble_descripcion ? <Dato etiqueta="Descripción" valor={t.inmueble_descripcion} /> : null}
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

function Desglose({
  honorarios,
  iva,
  terceros,
  total,
}: {
  honorarios: number;
  iva: number | null;
  terceros: number;
  total: number;
}) {
  return (
    <dl className="flex flex-col gap-1 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem]">
      <Renglon etiqueta="Honorarios" valor={pesos(honorarios)} />
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
      <dd>{valor}</dd>
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
};
