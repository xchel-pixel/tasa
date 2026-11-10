import { salirVerComo } from "@/app/ver-como/acciones";
import { obtenerSesion } from "@/lib/sesion";
import { verComoId } from "@/lib/supabase/server";

/** La barra fija de "ver como" (0080): a quién se está viendo, que es solo lectura, y salir. */
export async function BarraVerComo() {
  if (!(await verComoId())) return null;
  const sesion = await obtenerSesion().catch(() => null);
  const nombre = sesion?.persona?.nombre ?? "el comisionista (la vista ya venció)";
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 flex min-h-11 items-center justify-center gap-3 bg-primario px-4 py-2 text-[0.9375rem] text-sobre-primario">
        <span className="min-w-0 truncate">Viendo como <strong>{nombre}</strong> · solo lectura</span>
        <form action={salirVerComo}>
          <button type="submit" className="shrink-0 rounded-md border border-sobre-primario px-3 py-1 font-semibold">Salir</button>
        </form>
      </div>
      <div aria-hidden className="h-11 shrink-0" />
    </>
  );
}
