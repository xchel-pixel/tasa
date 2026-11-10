import { salirVerComo } from "@/app/ver-como/acciones";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor, verComoId } from "@/lib/supabase/server";

/** La barra fija de "ver como" (0080): a quién se está viendo, que es solo lectura, y salir. */
export async function BarraVerComo() {
  if (!(await verComoId())) return null;
  const sesion = await obtenerSesion().catch(() => null);
  const nombre = sesion?.persona?.nombre ?? "el comisionista (la vista ya venció)";
  // Lo que tiene pendiente de aceptar (en "ver como" no se le muestra la pantalla de aceptación).
  const pendientes: string[] = [];
  if (sesion?.persona) {
    const supabase = await crearClienteServidor();
    const [{ data: aviso }, { data: ajustes }] = await Promise.all([
      supabase.rpc("aviso_por_ver"),
      sesion.persona.debeAceptarTerminos ? supabase.from("ajustes").select("terminos_version").maybeSingle<{ terminos_version: number }>() : Promise.resolve({ data: null }),
    ]);
    if (sesion.persona.debeAceptarTerminos) pendientes.push(`no ha aceptado los términos${ajustes?.terminos_version ? ` v${ajustes.terminos_version}` : ""}`);
    const v = (aviso as { version?: number } | null)?.version;
    if (v) pendientes.push(`no ha aceptado el aviso de privacidad v${v}`);
  }
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 flex min-h-11 items-center justify-center gap-3 bg-primario px-4 py-2 text-[0.9375rem] text-sobre-primario">
        <span className="min-w-0">
          Viendo como <strong>{nombre}</strong> · solo lectura
          {pendientes.length ? <span className="block text-[0.8125rem] font-semibold">Pendiente: {pendientes.join("; ")}</span> : null}
        </span>
        <form action={salirVerComo}>
          <button type="submit" className="shrink-0 rounded-md border border-sobre-primario px-3 py-1 font-semibold">Salir</button>
        </form>
      </div>
      <div aria-hidden className={pendientes.length ? "h-16 shrink-0" : "h-11 shrink-0"} />
    </>
  );
}
