import Link from "next/link";
import { BloqueNivel } from "@/components/bloque-nivel";
import { Encabezado } from "@/components/encabezado";
import { Etiqueta } from "@/components/etiqueta";
import { TIPO_MOVIMIENTO, estadoDelMes, mesesDisponibles, type Movimiento } from "@/lib/estado-de-cuenta";
import { fechaCorta, mesActual, mesLargo, mesSiguiente, pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { miNivel } from "@/lib/trabajos";

export const metadata = { title: "Estado de cuenta — Tasa" };

/**
 * Un mes a la vez. Sin ranking ni comparación con otros comisionistas:
 * cada quien ve solo lo suyo (el RLS no le deja ver más).
 */
export default async function EstadoDeCuenta({ searchParams }: PageProps<"/estado-de-cuenta">) {
  const persona = await exigirRol("comisionista");
  const { mes: pedido } = await searchParams;

  const meses = await mesesDisponibles();
  const mes = typeof pedido === "string" && meses.includes(pedido) ? pedido : meses[0] ?? mesActual();

  const [cuenta, nivel] = await Promise.all([estadoDelMes(persona.id, mes), miNivel(persona.id)]);

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← Mis trabajos
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Estado de cuenta</h1>

          <div className="mt-4">
            <BloqueNivel nivel={nivel} />
          </div>

          <nav aria-label="Mes" className="-mx-6 mt-6 overflow-x-auto px-6">
            <ul className="flex gap-2">
              {meses.map((m) => (
                <li key={m}>
                  <Link
                    href={`/estado-de-cuenta?mes=${m}`}
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
              {cuenta.publicado ? (
                <Etiqueta tono="exito">Cierre publicado</Etiqueta>
              ) : (
                <Etiqueta tono="proceso">En curso</Etiqueta>
              )}
            </div>
            {!cuenta.publicado ? (
              <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
                Puede cambiar hasta que Administración apruebe el cierre del mes.
              </p>
            ) : null}

            {cuenta.movimientos.length === 0 ? (
              <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-[0.9375rem] text-secundario">
                Sin movimientos este mes.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col">
                {cuenta.movimientos.map((m, i) => (
                  <li key={m.id} className={`rounded-lg px-3 py-3 ${i % 2 === 1 ? "bg-alterno" : ""}`}>
                    <Linea m={m} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {cuenta.movimientos.length > 0 ? (
            <section className="mt-6 flex flex-col gap-3">
              {cuenta.porEntidad.length > 1 || cuenta.porEntidad[0]?.entidad !== "Sin cuenta" ? (
                <div className="rounded-xl border border-linea px-4 py-3">
                  <p className="font-semibold">Por cuenta que recibió el pago</p>
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
                {cuenta.publicado ? (
                  <>
                    <div className="flex justify-between gap-3">
                      <dt className="text-secundario">Pagado</dt>
                      <dd className="font-semibold">{pesos(cuenta.pagado)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-secundario">Por pagar</dt>
                      <dd className="font-semibold text-acento">{pesos(cuenta.porPagar)}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </section>
          ) : null}

          {cuenta.nivelSiguiente ? (
            <p className="mt-6 text-[0.9375rem] leading-6 text-secundario">
              Con este cierre, tu nivel para <span className="capitalize">{mesLargo(mesSiguiente(mes))}</span> quedó en{" "}
              <strong className="font-semibold text-texto">
                {cuenta.nivelSiguiente.nombre} · {cuenta.nivelSiguiente.porcentaje}%
              </strong>{" "}
              (promedio de {pesos(cuenta.nivelSiguiente.promedio)} en {cuenta.nivelSiguiente.meses}{" "}
              {cuenta.nivelSiguiente.meses === 1 ? "mes" : "meses"}).
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}

function Linea({ m }: { m: Movimiento }) {
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
          </p>
        </div>
        <p className={`whitespace-nowrap font-bold ${m.monto < 0 ? "text-error" : "text-texto"}`}>{pesos(m.monto)}</p>
      </div>
      {m.provisional || m.estado === "pagada" || (m.tipo === "cargo" && m.nota) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {m.provisional ? <Etiqueta tono="proceso">Provisional</Etiqueta> : null}
          {m.estado === "pagada" && m.pagada_en ? (
            <Etiqueta tono="exito">Pagada el {fechaCorta(m.pagada_en)}</Etiqueta>
          ) : null}
          {m.tipo === "cargo" && m.nota && m.trabajo ? (
            <span className="text-[0.875rem] text-secundario">{m.nota}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
