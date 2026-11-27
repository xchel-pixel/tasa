import Link from "next/link";
import { EncabezadoSeccion, Ilustracion } from "@/components/centro-seccion";
import { Encabezado } from "@/components/encabezado";
import { misHerramientas, TODOS_LOS_ROLES, type ClaveHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";

export const metadata = { title: "Herramientas — Tasa" };

/**
 * Sección "Herramientas": tarjetas agrupadas por tema. Cada tarjeta sale solo si la base dice que la persona tiene esa
 * herramienta (catálogo 0053: rol y nivel), igual que antes en la portada. Un grupo sin tarjetas no sale; Calculadoras
 * muestra su estado vacío mientras no haya ninguna.
 */

type Tarjeta = { clave: ClaveHerramienta; href: string; detalle: string; ilustracion: string; soloStaff?: boolean };

const GRUPOS: { titulo: string; tarjetas: Tarjeta[]; vacio?: string }[] = [
  { titulo: "Predio y catastro", tarjetas: [
    { clave: "mapa_catastral", href: "/mapa-catastral", detalle: "Pica un terreno y ve su clave, superficies y valores.", ilustracion: "herramienta-mapa-catastral" },
    { clave: "calculadora_traslado", href: "/calculadora", detalle: "Gastos de escrituración en Querétaro.", ilustracion: "herramienta-calculadora-traslado" },
  ] },
  { titulo: "Comercialización", tarjetas: [
    { clave: "mi_tarjeta", href: "/tarjeta", detalle: "Tu tarjeta digital para compartir.", ilustracion: "herramienta-tarjeta" },
    { clave: "para_tus_clientes", href: "/para-tus-clientes", detalle: "Tu liga y QR para que te pidan cotización.", ilustracion: "herramienta-clientes" },
    // El comisionista la tiene en Mis trabajos (Referidos).
    { clave: "invitar", href: "/invitar", detalle: "Tu liga para invitar a otros aliados.", ilustracion: "herramienta-invitar", soloStaff: true },
  ] },
  { titulo: "Calculadoras", tarjetas: [], vacio: "Capacidad de crédito y rentabilidad de una renta." },
];

export default async function Herramientas() {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  const mias = await misHerramientas();
  const nombre = (c: ClaveHerramienta) => mias.find((h) => h.clave === c)?.nombre;
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md md:max-w-3xl">
          <EncabezadoSeccion titulo="Herramientas" bajada="Todo lo que te ayuda a cerrar una operación, en un solo lugar." ilustracion="seccion-herramientas"
            texto="Elige una herramienta. Cada una revisa tus permisos y lo que cuentas en tu plan." />
          {GRUPOS.map((g) => {
            const tarjetas = g.tarjetas.filter((t) => nombre(t.clave) && !(t.soloStaff && persona.rol === "comisionista"));
            if (!tarjetas.length && !g.vacio) return null;
            return (
              <section key={g.titulo} aria-label={g.titulo} className="mt-6">
                <h2 className="text-[1rem] font-bold">{g.titulo}</h2>
                {tarjetas.length ? (
                  <ul className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {tarjetas.map((t) => (
                      <li key={t.clave}>
                        <Link href={t.href} className="flex h-full items-center gap-3 rounded-xl border border-linea bg-fondo p-3 hover:border-acento md:flex-col md:items-start md:p-4">
                          <Ilustracion nombre={t.ilustracion} className="h-[63px] w-[84px] md:h-[90px] md:w-[120px]" />
                          <span>
                            <span className="block font-bold leading-tight">{nombre(t.clave)}</span>
                            <span className="mt-1 block text-[0.875rem] leading-5 text-secundario">{t.detalle}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 flex items-center gap-4 rounded-xl border border-dashed border-linea bg-alterno p-4">
                    <Ilustracion nombre="vacio-calculadoras" className="h-[72px] w-[96px]" />
                    <p className="text-[0.9375rem] leading-6 text-secundario"><b className="text-texto">Muy pronto.</b> {g.vacio}</p>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
