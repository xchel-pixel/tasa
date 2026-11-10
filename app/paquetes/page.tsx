import { DatosBancarios } from "@/components/datos-bancarios";
import { Encabezado } from "@/components/encabezado";
import { Etiqueta } from "@/components/etiqueta";
import { VolverPortada } from "@/components/volver-portada";
import { hoyMx } from "@/lib/estadisticas";
import { fechaCorta, pesos } from "@/lib/formato";
import { detalleMovimiento, diasHasta, TIPO_COMPRA, TIPO_MOVIMIENTO, type MisPaquetes } from "@/lib/paquetes";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { CancelarCompra, ComprarPaquete } from "./formularios";

export const metadata = { title: "Mis paquetes — Tasa" };

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[1.125rem] font-bold">{titulo}</h2>
      {children}
    </section>
  );
}

/** "Mis paquetes" (0077): saldo, vencimiento, movimientos; comprar, subir y renovar. */
export default async function MisPaquetesPagina() {
  await exigirRol("comisionista");
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("mis_paquetes");
  if (error) throw new Error(`No se pudieron leer tus paquetes: ${error.message}`);
  const d = data as MisPaquetes;
  const hoy = hoyMx();
  const v = d.vigente;
  const actual = v ? d.catalogo.find((p) => p.clave === v.clave) : null;
  const num = (x: number | string) => Number(x);
  const todos = d.catalogo.map((p) => ({ ...p, precio: num(p.precio), credito: num(p.credito), pagar: num(p.precio), recibe: num(p.credito) }));
  const mayores = actual ? todos.filter((p) => p.precio > num(actual.precio) && p.credito > num(actual.credito))
    .map((p) => ({ ...p, pagar: p.precio - num(actual.precio), recibe: p.credito - num(actual.credito) })) : [];
  const dias = v ? diasHasta(v.vence, hoy) : null;

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <VolverPortada />
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Mis paquetes</h1>

          <section className="mt-4 rounded-xl border border-linea px-4 py-4">
            <p className="text-[0.9375rem] text-secundario">Tu crédito disponible</p>
            <p className="mt-1 text-[2rem] font-bold tabular-nums leading-none text-primario">{pesos(num(d.saldo))}</p>
            {v ? (
              <>
                <p className="mt-3 flex flex-wrap items-center gap-2 font-semibold">
                  Paquete {v.paquete}
                  {dias !== null && dias <= 7 ? <Etiqueta tono="error">Vence en {dias} día{dias === 1 ? "" : "s"}</Etiqueta>
                    : dias !== null && dias <= 30 ? <Etiqueta tono="proceso">Vence en {dias} días</Etiqueta> : <Etiqueta tono="exito">Vigente</Etiqueta>}
                </p>
                <p className="text-[0.9375rem] text-secundario">Del {fechaCorta(v.inicia)} al {fechaCorta(v.vence)}</p>
                <p className="mt-2 text-[0.9375rem] leading-6">{v.beneficios}</p>
                {dias !== null && dias <= 30 ? (
                  <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
                    Si no renuevas antes del {fechaCorta(v.vence)}, el saldo se pierde. Si renuevas, se suma al nuevo paquete.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-[0.9375rem] leading-6 text-secundario">
                Con un paquete pagas los honorarios de tus trabajos con crédito y tus herramientas suben de cupo.
              </p>
            )}
          </section>

          {d.por_pagar ? (
            <Bloque titulo="Por pagar">
              <div className="mt-2 rounded-xl border border-proceso px-4 py-3">
                <p className="font-semibold">{TIPO_COMPRA[d.por_pagar.tipo]}: {d.por_pagar.paquete}</p>
                <p className="text-[0.9375rem] text-secundario">
                  Transfiere {pesos(num(d.por_pagar.precio))} (IVA incluido). Recibirás {pesos(num(d.por_pagar.credito))} de crédito cuando
                  Administración confirme tu pago.
                </p>
                {d.cuenta ? <div className="mt-3"><DatosBancarios cuenta={d.cuenta} /></div>
                  : <p className="mt-2 text-[0.9375rem] text-error">Administración todavía no define la cuenta para paquetes.</p>}
                <CancelarCompra compra={d.por_pagar.id} />
              </div>
            </Bloque>
          ) : null}

          {!d.por_pagar && d.terminos ? (
            !v ? (
              <Bloque titulo="Comprar un paquete">
                <ComprarPaquete tipo="compra" opciones={todos} terminos={d.terminos} comision={num(d.comision_por_cobrar)} texto="Comprar" />
              </Bloque>
            ) : (
              <>
                {v.puede_subir && mayores.length ? (
                  <Bloque titulo="Subir de paquete">
                    <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
                      Hasta el {fechaCorta(v.subir_hasta)}: pagas la diferencia y recibes el crédito del paquete mayor. La vigencia cuenta desde tu
                      compra original.
                    </p>
                    <ComprarPaquete tipo="subida" opciones={mayores} terminos={d.terminos} comision={0} texto="Subir de paquete" />
                  </Bloque>
                ) : null}
                <Bloque titulo="Renovar">
                  <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
                    Al renovar antes del {fechaCorta(v.vence)}, tu saldo de {pesos(num(d.saldo))} se suma al nuevo paquete.
                  </p>
                  <ComprarPaquete tipo="renovacion" opciones={todos} terminos={d.terminos} comision={num(d.comision_por_cobrar)} texto="Renovar" />
                </Bloque>
              </>
            )
          ) : null}

          <Bloque titulo="Movimientos">
            {d.movimientos.length ? (
              <ul className="mt-2 flex flex-col divide-y divide-linea rounded-xl border border-linea">
                {d.movimientos.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3 text-[0.9375rem]">
                    <span className="min-w-0">
                      <span className="block font-semibold">{TIPO_MOVIMIENTO[m.tipo]}</span>
                      <span className="block text-secundario">{fechaCorta(m.creado_en)} · {detalleMovimiento(m)}</span>
                    </span>
                    <span className={`shrink-0 font-semibold tabular-nums ${num(m.monto) < 0 ? "text-secundario" : "text-exito"}`}>
                      {num(m.monto) > 0 ? "+" : "−"}{pesos(Math.abs(num(m.monto)))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-[0.9375rem] text-secundario">Todavía no hay movimientos.</p>}
          </Bloque>

          {d.compras.length ? (
            <Bloque titulo="Tus compras">
              <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
                {d.compras.map((c) => (
                  <li key={c.id} className="text-secundario">
                    {fechaCorta(c.creado_en)} · {TIPO_COMPRA[c.tipo]} {c.paquete} · {pesos(num(c.precio))}
                    {c.forma_pago === "comision" ? " con tu comisión" : ""} · {c.estado === "confirmada" ? "pagada" : c.estado === "por_pagar" ? "por pagar" : "cancelada"}
                    {` · términos v${c.terminos_version} aceptados el ${fechaCorta(c.terminos_aceptados_en)}`}
                  </li>
                ))}
              </ul>
            </Bloque>
          ) : null}
        </div>
      </main>
    </>
  );
}
