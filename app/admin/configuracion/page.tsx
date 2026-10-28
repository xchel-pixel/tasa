import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { clabeValida } from "@/lib/clabe";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export const metadata = { title: "Configuración — Tasa" };

type Paso = { titulo: string; detalle: string; listo: boolean; href: string; opcional?: boolean };

/**
 * Lo que una organización necesita antes de operar, en orden. Cada paso
 * dice si ya está y lleva a la pantalla donde se resuelve. No guarda
 * nada propio: lo calcula de lo que ya hay.
 */
export default async function Configuracion() {
  const persona = await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const [marcas, cuentas, servicios, niveles, ajustes, equipo, comisionistas] = await Promise.all([
    supabase.from("marcas").select("id, clave, nombre_legal, firmante, logo_ruta").eq("activa", true)
      .returns<{ id: string; clave: string; nombre_legal: string | null; firmante: string | null; logo_ruta: string | null }[]>(),
    supabase.from("cuentas_receptoras").select("marca_id, clabe").eq("activa", true).returns<{ marca_id: string; clabe: string }[]>(),
    supabase.from("servicios").select("alcance").eq("activo", true).returns<{ alcance: string | null }[]>(),
    supabase.from("niveles").select("umbral_minimo, es_forzado").returns<{ umbral_minimo: number | null; es_forzado: boolean }[]>(),
    supabase.from("ajustes").select("contacto_soporte, terminos, aviso_privacidad").eq("organizacion_id", persona.organizacion.id)
      .maybeSingle<{ contacto_soporte: string | null; terminos: string | null; aviso_privacidad: string | null }>(),
    supabase.from("membresias").select("persona_id", { count: "exact", head: true }).eq("organizacion_id", persona.organizacion.id).eq("activa", true).neq("rol", "comisionista"),
    supabase.from("comisionistas").select("persona_id", { count: "exact", head: true }),
  ]);

  const listaMarcas = marcas.data ?? [];
  const listaCuentas = cuentas.data ?? [];
  const sinDatosPdf = listaMarcas.filter((m) => !m.nombre_legal || !m.firmante).map((m) => m.clave);
  const sinLogo = listaMarcas.filter((m) => !m.logo_ruta).map((m) => m.clave);
  const sinCuenta = listaMarcas.filter((m) => !listaCuentas.some((c) => c.marca_id === m.id)).map((m) => m.clave);
  const clabesMalas = listaCuentas.filter((c) => !clabeValida(c.clabe)).length;
  const serviciosSinTexto = (servicios.data ?? []).filter((s) => !s.alcance).length;
  const nivelCero = (niveles.data ?? []).some((n) => !n.es_forzado && Number(n.umbral_minimo) === 0);
  const a = ajustes.data;

  const pasos: Paso[] = [
    {
      titulo: "Marcas y lo que imprime su cotización",
      detalle: listaMarcas.length === 0
        ? "Agrega al menos una marca."
        : sinDatosPdf.length
          ? `Falta razón social o firmante en ${sinDatosPdf.join(", ")}.`
          : `${listaMarcas.length} activa${listaMarcas.length === 1 ? "" : "s"}, con datos para el PDF.`,
      listo: listaMarcas.length > 0 && sinDatosPdf.length === 0,
      href: "/admin/catalogos",
    },
    {
      titulo: "Logos",
      detalle: sinLogo.length ? `Sin logo: ${sinLogo.join(", ")} (el PDF imprime la clave).` : "Todas las marcas tienen logo.",
      listo: listaMarcas.length > 0 && sinLogo.length === 0,
      href: "/admin/catalogos",
      opcional: true,
    },
    {
      titulo: "Cuentas receptoras",
      detalle: clabesMalas
        ? `${clabesMalas} con CLABE por corregir.`
        : sinCuenta.length
          ? `Sin cuenta: ${sinCuenta.join(", ")}.`
          : "Cada marca tiene cuenta y las CLABE cuadran.",
      listo: listaMarcas.length > 0 && sinCuenta.length === 0 && clabesMalas === 0,
      href: "/admin/catalogos",
    },
    {
      titulo: "Servicios",
      detalle: (servicios.data ?? []).length === 0
        ? "Agrega los servicios que se pueden pedir."
        : serviciosSinTexto
          ? `${serviciosSinTexto} sin alcance para la cotización.`
          : "Todos con sus textos para la cotización.",
      listo: (servicios.data ?? []).length > 0 && serviciosSinTexto === 0,
      href: "/admin/catalogos",
    },
    {
      titulo: "Niveles de comisión",
      detalle: nivelCero ? "Revisa umbrales y porcentajes." : "Falta un nivel con promedio mínimo de $0.",
      listo: nivelCero,
      href: "/admin/niveles",
    },
    {
      titulo: "Términos y aviso de privacidad",
      detalle: a?.terminos && a?.aviso_privacidad
        ? "Publicados. Los comisionistas aceptan los términos al entrar."
        : "Falta el texto de los términos o del aviso de privacidad.",
      listo: Boolean(a?.terminos && a?.aviso_privacidad),
      href: "/ajustes",
    },
    {
      titulo: "Contacto de soporte",
      detalle: a?.contacto_soporte ? a.contacto_soporte : "A quién escriben los comisionistas si algo falla.",
      listo: Boolean(a?.contacto_soporte),
      href: "/ajustes",
    },
    {
      titulo: "Equipo",
      detalle: (equipo.count ?? 0) > 1
        ? `${equipo.count} personas con acceso al panel.`
        : "Solo tú tienes acceso al panel. Agrega a finanzas o a quien administre una marca.",
      listo: (equipo.count ?? 0) > 1,
      href: "/admin/equipo",
      opcional: true,
    },
    {
      titulo: "Comisionistas",
      detalle: (comisionistas.count ?? 0) > 0
        ? `${comisionistas.count} dado${comisionistas.count === 1 ? "" : "s"} de alta.`
        : "Impórtalos de una tabla o dalos de alta uno por uno.",
      listo: (comisionistas.count ?? 0) > 0,
      href: "/admin/comisionistas/importar",
    },
  ];
  const faltan = pasos.filter((p) => !p.listo && !p.opcional).length;

  return (
    <PantallaAdmin titulo="Configuración">
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        {faltan === 0 ? "Todo listo para operar." : `Faltan ${faltan} paso${faltan === 1 ? "" : "s"} antes de operar.`}
      </p>
      <ol className="mt-4 flex flex-col gap-2">
        {pasos.map((p, i) => (
          <li key={p.titulo}>
            <Link href={p.href} className="flex items-start justify-between gap-3 rounded-xl border border-linea px-4 py-3">
              <span className="min-w-0">
                <span className="block font-semibold">
                  {i + 1}. {p.titulo}
                </span>
                <span className="block text-[0.9375rem] leading-6 text-secundario">{p.detalle}</span>
              </span>
              <span className="shrink-0">
                {p.listo ? (
                  <Etiqueta tono="exito">Listo</Etiqueta>
                ) : (
                  <Etiqueta tono={p.opcional ? "neutro" : "proceso"}>{p.opcional ? "Opcional" : "Pendiente"}</Etiqueta>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-[0.9375rem] leading-6 text-secundario">
        <Link href="/admin/niveles" className="toque font-semibold text-acento underline underline-offset-4">Niveles</Link>
        {" · "}
        <Link href="/admin/comisionistas/importar" className="toque font-semibold text-acento underline underline-offset-4">
          Importar comisionistas
        </Link>
      </p>
    </PantallaAdmin>
  );
}
