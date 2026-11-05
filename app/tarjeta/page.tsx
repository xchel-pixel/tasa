import Link from "next/link";
import { redirect } from "next/navigation";
import { Encabezado } from "@/components/encabezado";
import { Etiqueta } from "@/components/etiqueta";
import { urlDelSitio } from "@/lib/altas";
import { mesLargo } from "@/lib/formato";
import { tengoHerramienta } from "@/lib/herramientas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { EditorTarjeta, type TarjetaGuardada } from "./editor";
import { NuevoTestimonio, PublicarTarjeta } from "./formularios";
import { FormularioRedes, MisServicios, Portafolio, type InmuebleEditable, type Limites, type ServicioEditable } from "./presentacion";
import { urlImagenTarjeta } from "@/components/tarjeta-vista";
import { MiPerfilFormulario } from "@/components/mi-perfil";
import { leerPerfil } from "@/lib/perfil";

export const metadata = { title: "Mi tarjeta — Tasa" };

type Fila = TarjetaGuardada & {
  estado: "borrador" | "publicada" | "pausada" | "despublicada";
  motivo_estado: string | null;
  facebook: string | null;
  instagram: string | null;
  tiktok: string | null;
  linkedin: string | null;
  sitio_web: string | null;
  despacho_arriba: boolean;
};
const NIVELES = ["", "Enlace", "Aliado", "Socio", "Socio Plus"];
const ESTADO = {
  borrador: { texto: "Sin publicar", tono: "neutro" },
  publicada: { texto: "Publicada", tono: "exito" },
  pausada: { texto: "En pausa", tono: "proceso" },
  despublicada: { texto: "Despublicada por Administración", tono: "error" },
} as const;

/**
 * "Mi tarjeta": el comisionista arma su tarjeta digital con vista previa en vivo y la publica o
 * pausa. Lo que tiene según su nivel del mes: Enlace básica + QR; Aliado logo y color; Socio
 * estadísticas; Socio Plus servicios destacados y testimonios.
 */
export default async function MiTarjeta() {
  const persona = await exigirRol("comisionista");
  if (!(await tengoHerramienta("mi_tarjeta"))) redirect("/");
  const supabase = await crearClienteServidor();
  const [tarjeta, nivelR, servicios, yo, testimonios, ajustes, propios, inmueblesR, limitesR] = await Promise.all([
    supabase
      .from("tarjetas")
      .select("frase, telefono, correo, mostrar_correo, zona, foto_ruta, logo_ruta, color, servicios, estado, motivo_estado, facebook, instagram, tiktok, linkedin, sitio_web, despacho_arriba")
      .eq("comisionista_id", persona.id)
      .maybeSingle()
      .returns<Fila | null>(),
    supabase.rpc("mi_nivel_tarjeta"),
    supabase.from("servicios").select("id, nombre").eq("activo", true).order("orden").order("nombre").returns<{ id: string; nombre: string }[]>(),
    supabase
      .from("comisionistas")
      .select("slug, codigo_referido, personas!comisionistas_persona_id_fkey(telefono, nombre_para_mostrar, nombre)")
      .eq("persona_id", persona.id)
      .maybeSingle()
      .returns<{ slug: string; codigo_referido: string; personas: { telefono: string | null; nombre_para_mostrar: string | null; nombre: string } | null } | null>(),
    supabase
      .from("testimonios")
      .select("id, cliente, texto, estado, motivo, creado_en")
      .eq("comisionista_id", persona.id)
      .order("creado_en", { ascending: false })
      .returns<{ id: string; cliente: string; texto: string; estado: "pendiente" | "aprobado" | "rechazado"; motivo: string | null; creado_en: string }[]>(),
    supabase.from("ajustes").select("nota_tarjeta").maybeSingle<{ nota_tarjeta: string }>(),
    supabase.from("tarjeta_servicios").select("id, titulo, descripcion, icono, enlace, oculto_motivo")
      .eq("comisionista_id", persona.id).order("orden").order("creado_en").returns<ServicioEditable[]>(),
    supabase.from("tarjeta_inmuebles").select("id, titulo, operacion, precio, zona, foto_ruta, enlace, oculto_motivo")
      .eq("comisionista_id", persona.id).order("orden").order("creado_en").returns<InmuebleEditable[]>(),
    // Cuántos muestra cada nivel, con la regla de la base.
    Promise.all(
      [1, 2, 3, 4].flatMap((n) => (["servicio", "inmueble"] as const).map((q) => supabase.rpc("limite_tarjeta", { p_nivel: n, p_que: q })))
    ),
  ]);
  const t = oExplota(tarjeta, "tu tarjeta");
  const nivel = Number(oExplota(nivelR, "tu nivel") ?? 1);
  const c = oExplota(yo, "tus datos");
  const lista = oExplota(testimonios, "tus testimonios") ?? [];
  const [{ data: estadisticas }, { data: clics }] =
    nivel >= 3
      ? await Promise.all([supabase.rpc("mis_estadisticas_tarjeta", { p_meses: 6 }), supabase.rpc("mis_clics_tarjeta")])
      : [{ data: null }, { data: null }];
  const limites: Limites = { servicio: [0, 0, 0, 0, 0], inmueble: [0, 0, 0, 0, 0] };
  limitesR.forEach((r, k) => {
    limites[k % 2 === 0 ? "servicio" : "inmueble"][Math.floor(k / 2) + 1] = Number(r.data ?? 0);
  });
  const misServicios = oExplota(propios, "tus servicios") ?? [];
  const perfil = await leerPerfil(supabase, persona.id);
  const misInmuebles = (oExplota(inmueblesR, "tu portafolio") ?? []).map((i) => ({ ...i, precio: i.precio === null ? null : Number(i.precio) }));
  // Lo que hoy se ve en la tarjeta (sin lo oculto por Administración y hasta el límite de su nivel).
  const visibles = <T extends { oculto_motivo: string | null }>(lista: T[], tope: number) => lista.filter((x) => !x.oculto_motivo).slice(0, tope);
  const nombre = c?.personas?.nombre_para_mostrar?.trim() || c?.personas?.nombre || persona.nombre;
  const liga = c ? `${await urlDelSitio()}/t/${persona.organizacion.slug}/${c.slug}` : null;
  const estado = t?.estado ?? "borrador";

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">← Inicio</Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Mi tarjeta</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Etiqueta tono={ESTADO[estado].tono}>{ESTADO[estado].texto}</Etiqueta>
            <Etiqueta tono="neutro">Nivel {NIVELES[nivel]}</Etiqueta>
          </div>
          {estado === "despublicada" && t?.motivo_estado ? (
            <p className="mt-3 rounded-lg bg-error-fondo px-4 py-3 text-[0.9375rem] leading-6 text-error">
              Motivo: {t.motivo_estado}. Escríbele a Administración para revisarla.
            </p>
          ) : null}
          {liga && estado === "publicada" ? (
            <p className="mt-3 text-[0.9375rem] break-all">
              <a href={liga} target="_blank" rel="noopener" className="font-semibold text-acento underline underline-offset-4">{liga}</a>
            </p>
          ) : null}

          <div className="mt-4">
            {c ? (
              <EditorTarjeta
                inicial={{
                  frase: t?.frase ?? null,
                  telefono: t?.telefono ?? (c.personas?.telefono?.replace(/\D/g, "").slice(-10) || null),
                  correo: t?.correo ?? persona.correo,
                  mostrar_correo: t?.mostrar_correo ?? false,
                  zona: t?.zona ?? null,
                  foto_ruta: t?.foto_ruta ?? null,
                  logo_ruta: t?.logo_ruta ?? null,
                  color: t?.color ?? null,
                  servicios: t?.servicios ?? [],
                }}
                nivel={nivel}
                nombre={nombre}
                org={persona.organizacion.slug}
                orgId={persona.organizacion.id}
                personaId={persona.id}
                codigo={c.codigo_referido}
                nota={ajustes.data?.nota_tarjeta ?? null}
                extras={{
                  perfil: perfil.actual,
                  misServicios: visibles(misServicios, limites.servicio[nivel]),
                  inmuebles: visibles(misInmuebles, limites.inmueble[nivel]).map((i) => ({ ...i, fotoUrl: urlImagenTarjeta(i.foto_ruta) })),
                  redes: Object.fromEntries(
                    ([["facebook", t?.facebook], ["instagram", t?.instagram], ["tiktok", t?.tiktok], ["linkedin", t?.linkedin], ["sitio", t?.sitio_web]] as const)
                      .filter(([, v]) => v)
                  ),
                  despachoArriba: t?.despacho_arriba ?? true,
                }}
                servicios={oExplota(servicios, "los servicios") ?? []}
              />
            ) : null}
          </div>

          {t && estado !== "despublicada" ? (
            <div className="mt-4">
              {estado === "publicada" ? (
                <PublicarTarjeta publicar={false} texto="Pausar mi tarjeta" />
              ) : (
                <PublicarTarjeta publicar texto="Publicar mi tarjeta" />
              )}
            </div>
          ) : !t ? (
            <p className="mt-4 text-[0.9375rem] text-secundario">Guarda tu tarjeta para poder publicarla.</p>
          ) : null}

          <MiPerfilFormulario perfil={perfil} />

          <section className="mt-8">
            <h2 className="font-bold">Mis servicios</h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
              Los que ofreces tú, aparte del despacho. Ordénalos arrastrando (⠿) o con las flechas. Enlace: {NIVELES[1]} hasta{" "}
              {limites.servicio[1]}, {NIVELES[2]} y {NIVELES[3]} hasta {limites.servicio[2]}, {NIVELES[4]} sin límite.
            </p>
            <div className="mt-3">
              <MisServicios servicios={misServicios} limites={limites} nivel={nivel} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-bold">Portafolio</h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
              Inmuebles que promueves, con foto, zona y precio. {NIVELES[3]} hasta {limites.inmueble[3]}, {NIVELES[4]} sin límite.
            </p>
            <div className="mt-3">
              <Portafolio inmuebles={misInmuebles} limites={limites} nivel={nivel} orgId={persona.organizacion.id} personaId={persona.id} />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-bold">Redes sociales</h2>
            <div className="mt-3">
              <FormularioRedes
                redes={{ facebook: t?.facebook ?? null, instagram: t?.instagram ?? null, tiktok: t?.tiktok ?? null, linkedin: t?.linkedin ?? null, sitio: t?.sitio_web ?? null }}
                despachoArriba={t?.despacho_arriba ?? true}
              />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-bold">Estadísticas</h2>
            {nivel >= 3 ? (
              <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
                {((estadisticas ?? []) as { mes: string; visitas: number; whatsapp: number; solicitudes: number }[]).map((e) => (
                  <li key={e.mes} className="flex justify-between gap-3 border-b border-linea py-1">
                    <span className="first-letter:uppercase">{mesLargo(e.mes)}</span>
                    <span className="text-secundario">
                      {e.visitas} visitas · {e.whatsapp} WhatsApp · {e.solicitudes} solicitudes
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[0.9375rem] text-secundario">
                Disponible desde Socio: visitas, clics en WhatsApp, solicitudes por mes y clics por servicio e inmueble.
              </p>
            )}
            {nivel >= 3 && ((clics ?? []) as unknown[]).length > 0 ? (
              <>
                <h3 className="mt-4 font-semibold">Clics por servicio e inmueble</h3>
                <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem]">
                  {((clics ?? []) as { tipo: string; id: string; titulo: string; este_mes: number; seis_meses: number }[]).map((c) => (
                    <li key={c.id} className="flex justify-between gap-3 border-b border-linea py-1">
                      <span className="min-w-0 truncate">{c.tipo === "inmueble" ? "Inmueble: " : ""}{c.titulo}</span>
                      <span className="shrink-0 text-secundario">{c.este_mes} este mes · {c.seis_meses} en 6 meses</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="mt-8">
            <h2 className="font-bold">Testimonios</h2>
            {nivel >= 4 ? (
              <>
                <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">Se publican cuando Administración los aprueba.</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {lista.map((x) => (
                    <li key={x.id} className="rounded-lg border border-linea px-3 py-2 text-[0.9375rem]">
                      <p>“{x.texto}” — {x.cliente}</p>
                      <p className="text-secundario">
                        {x.estado === "aprobado" ? "Publicado" : x.estado === "pendiente" ? "Por aprobar" : `Rechazado${x.motivo ? `: ${x.motivo}` : ""}`}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="mt-3"><NuevoTestimonio /></div>
              </>
            ) : (
              <p className="mt-1 text-[0.9375rem] text-secundario">
                Disponible desde Socio Plus.{lista.length > 0 ? " Los que ya tienes se ocultan mientras tanto (no se borran)." : ""}
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
