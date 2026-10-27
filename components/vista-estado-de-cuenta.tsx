import Link from "next/link";
import { AccionConMotivo, MesCerrado } from "@/components/accion-con-motivo";
import { Etiqueta } from "@/components/etiqueta";
import { SubirFactura } from "@/components/subir-factura";
import { TIPO_MOVIMIENTO, estadoDelMes, mesesDisponibles, type Movimiento } from "@/lib/estado-de-cuenta";
import { fechaCorta, mesActual, mesLargo, mesSiguiente, pesos } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Un mes a la vez. La misma vista para el comisionista (lo suyo, por
 * RLS) y para Administración desde su ficha: lo que uno ve es lo que
 * ve el otro. Solo el dueño sube su factura.
 */
export async function VistaEstadoDeCuenta({
  personaId,
  mesPedido,
  base,
  dueno,
  carpeta,
  puedeAnular = false,
}: {
  personaId: string;
  mesPedido: string | undefined;
  /** Ruta de la pantalla; el mes va como `?mes=`. */
  base: string;
  /** Quien mira es el propio comisionista: sube su factura. */
  dueno: boolean;
  /** Carpeta del dueño para subir su factura (`{organización}/{persona}`). */
  carpeta?: string;
  /** admin_org desde la ficha: anula bonos, ajustes y cargos hechos a mano. */
  puedeAnular?: boolean;
}) {
  const meses = await mesesDisponibles(personaId);
  const mes = mesPedido && meses.includes(mesPedido) ? mesPedido : (meses[0] ?? mesActual());
  const cuenta = await estadoDelMes(personaId, mes, !dueno);

  let ligaFactura: string | null = null;
  if (cuenta.pendiente?.factura_ruta) {
    const supabase = await crearClienteServidor();
    const { data } = await supabase.storage.from("facturas").createSignedUrl(cuenta.pendiente.factura_ruta, 600);
    ligaFactura = data?.signedUrl ?? null;
  }
  const p = cuenta.pendiente;

  return (
    <>
      <nav aria-label="Mes" className="-mx-6 overflow-x-auto px-6">
        <ul className="flex gap-2">
          {meses.map((m) => (
            <li key={m}>
              <Link
                href={`${base}?mes=${m}`}
                scroll={false}
                aria-current={m === mes ? "page" : undefined}
                className={`toque whitespace-nowrap rounded-full border px-4 text-[0.9375rem] font-semibold capitalize ${
                  m === mes ? "border-primario bg-primario text-sobre-primario" : "border-linea bg-fondo text-primario"
                }`}
              >
                {mesLargo(m)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[1.125rem] font-bold capitalize">{mesLargo(mes)}</h2>
          {cuenta.publicado ? <Etiqueta tono="exito">Cierre publicado</Etiqueta> : <Etiqueta tono="proceso">En curso</Etiqueta>}
        </div>
        {!cuenta.publicado ? (
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Puede cambiar hasta que Administración apruebe el cierre del mes.
          </p>
        ) : null}

        {cuenta.movimientos.length === 0 ? (
          <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-[0.9375rem] text-secundario">Sin movimientos este mes.</p>
        ) : (
          <ul className="mt-4 flex flex-col">
            {cuenta.movimientos.map((m, i) => (
              <li key={m.id} className={`rounded-lg px-3 py-3 ${i % 2 === 1 ? "bg-alterno" : ""}`}>
                <Linea m={m} puedeAnular={puedeAnular} mesCerrado={cuenta.publicado} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {cuenta.movimientos.length > 0 ? (
        <section className="mt-6 flex flex-col gap-3">
          {cuenta.porEntidad.length > 1 || cuenta.porEntidad[0]?.entidad !== "Sin cuenta" ? (
            <div className="rounded-xl border border-linea px-4 py-3">
              <p className="font-semibold">Por empresa</p>
              <dl className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
                {cuenta.porEntidad.map((e) => (
                  <div key={e.entidad} className="flex justify-between gap-3">
                    <dt className="text-secundario">{e.entidad}</dt>
                    <dd className="font-semibold">{pesos(e.total)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <dl className="flex flex-col gap-1 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-semibold">Total del mes</dt>
              <dd className="text-[1.25rem] font-bold text-primario">{pesos(cuenta.total)}</dd>
            </div>
            {cuenta.publicado && p ? (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="text-secundario">Pagado</dt>
                  <dd className="font-semibold">{pesos(p.pagado)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-secundario">Por pagar</dt>
                  <dd className="font-semibold text-acento">{pesos(p.monto - p.pagado)}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {cuenta.publicado && !p ? (
            <p className="text-[0.9375rem] leading-6 text-secundario">
              Este mes no dejó saldo por pagar
              {cuenta.movimientos.some((m) => m.tipo === "arrastre" && m.monto > 0)
                ? ": el saldo negativo pasó al mes siguiente como arrastre."
                : "."}
            </p>
          ) : null}
        </section>
      ) : null}

      {cuenta.publicado && p ? (
        <section className="mt-6 rounded-xl border border-linea px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold">Pago de este mes</h3>
            {p.pagado_en ? (
              <Etiqueta tono="exito">Pagado el {fechaCorta(p.pagado_en)}</Etiqueta>
            ) : p.pagado > 0 ? (
              <Etiqueta tono="proceso">Pago parcial</Etiqueta>
            ) : (
              <Etiqueta tono="neutro">Pendiente</Etiqueta>
            )}
          </div>
          {p.pagos.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 text-[0.9375rem]">
              {p.pagos.map((x, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-secundario">
                    {fechaCorta(x.fecha)}
                    {x.referencia ? ` · ${x.referencia}` : ""}
                  </span>
                  <span className="font-semibold">{pesos(x.monto)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {ligaFactura ? (
            <a href={ligaFactura} target="_blank" rel="noopener noreferrer"
              className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
              Ver factura o recibo
            </a>
          ) : null}
          {dueno && carpeta ? <SubirFactura pendienteId={p.id} carpeta={carpeta} reemplaza={Boolean(p.factura_ruta)} /> : null}
        </section>
      ) : null}

      {cuenta.nivelSiguiente ? (
        <p className="mt-6 text-[0.9375rem] leading-6 text-secundario">
          Con este cierre, el nivel para <span className="capitalize">{mesLargo(mesSiguiente(mes))}</span> quedó en{" "}
          <strong className="font-semibold text-texto">
            {cuenta.nivelSiguiente.nombre} · {cuenta.nivelSiguiente.porcentaje}%
          </strong>{" "}
          (promedio de {pesos(cuenta.nivelSiguiente.promedio)} en {cuenta.nivelSiguiente.meses}{" "}
          {cuenta.nivelSiguiente.meses === 1 ? "mes" : "meses"}).
        </p>
      ) : null}
    </>
  );
}

function Linea({ m, puedeAnular, mesCerrado }: { m: Movimiento; puedeAnular: boolean; mesCerrado: boolean }) {
  const manual = !m.trabajo && (m.tipo === "bono" || m.tipo === "ajuste" || m.tipo === "cargo") && !m.anula_id;
  const titulo = m.trabajo ? m.trabajo.cliente : (m.nota ?? TIPO_MOVIMIENTO[m.tipo]);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {m.trabajo ? (
            <Link href={`/trabajos/${m.trabajo.id}`} className="font-semibold text-acento underline underline-offset-4">
              {titulo}
            </Link>
          ) : (
            <p className="font-semibold">{titulo}</p>
          )}
          <p className="text-[0.9375rem] text-secundario">
            {TIPO_MOVIMIENTO[m.tipo]}
            {m.trabajo?.folio ? ` · ${m.trabajo.folio}` : ""}
            {m.base !== null && m.porcentaje !== null ? ` · ${m.porcentaje}% de ${pesos(m.base)}` : ""}
            {!m.trabajo && m.tipo !== "arrastre" ? ` · ${m.entidad}` : ""}
          </p>
        </div>
        <p className={`whitespace-nowrap font-bold ${m.monto < 0 ? "text-error" : "text-texto"}`}>{pesos(m.monto)}</p>
      </div>
      {m.provisional || m.estado === "pagada" || m.anulado || m.anula_id || (m.tipo === "cargo" && m.nota && m.trabajo) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {m.anulado ? <Etiqueta tono="neutro">Anulado</Etiqueta> : null}
          {m.anula_id ? <Etiqueta tono="neutro">Anulación</Etiqueta> : null}
          {m.provisional ? <Etiqueta tono="proceso">Provisional</Etiqueta> : null}
          {m.estado === "pagada" && m.pagada_en ? <Etiqueta tono="exito">Pagada el {fechaCorta(m.pagada_en)}</Etiqueta> : null}
          {m.tipo === "cargo" && m.nota && m.trabajo ? <span className="text-[0.875rem] text-secundario">{m.nota}</span> : null}
        </div>
      ) : null}
      {puedeAnular && manual && !m.anulado ? (
        mesCerrado ? (
          <MesCerrado />
        ) : (
          <AccionConMotivo
            que="anular_movimiento"
            id={m.id}
            texto="Anular"
            explicacion="No se borra: entra el movimiento contrario en el mismo mes y los dos suman cero. El comisionista ve ambos."
          />
        )
      ) : null}
    </div>
  );
}
