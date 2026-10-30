import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { Etiqueta } from "@/components/etiqueta";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { ActivarNotion, ConfigNotion, VolverAManualBoton, type DatosNotion } from "./conector-notion";
import FormularioAjustes, { FilaOrigen, FormularioPrefijo, FormularioUltimoFolio } from "./formulario-ajustes";

export const metadata = { title: "Ajustes — Tasa" };

type Conector = Omit<DatosNotion, "mapeo_estatus"> & {
  tipo: "manual" | "notion" | "sheets" | "webhook";
  mapeo_estatus: { valor_externo: string; estatus_publico: string }[];
};

const CONECTORES: { tipo: Conector["tipo"]; nombre: string; detalle: string; listo: boolean }[] = [
  { tipo: "manual", nombre: "Manual", detalle: "Sin sistema externo. El estatus se mueve desde la ficha del trabajo y Tasa pone el folio.", listo: true },
  { tipo: "notion", nombre: "Notion", detalle: "Crea la página al aceptarse el trámite y lee etapa, folio y fecha de visita.", listo: true },
  { tipo: "sheets", nombre: "Google Sheets", detalle: "Una hoja de cálculo con columnas validadas.", listo: false },
  { tipo: "webhook", nombre: "Webhook", detalle: "Para Zapier, Make o un sistema propio, con firma secreta.", listo: false },
];

/** Lo que configura admin_org para su organización (nadie más ve esta pantalla). */
export default async function Ajustes() {
  const persona = await exigirRol("admin_org");
  const supabase = await crearClienteServidor();

  const [ajustes, origenes, organizacion, conector] = await Promise.all([
    supabase
      .from("ajustes")
      .select("contacto_soporte, dia_limite_pago_comision, terminos, aviso_privacidad, correo_bienvenida, correo_rechazo, bono_referido_equipo, referido_vigencia_meses, liga_max_por_telefono, liga_max_por_conexion")
      .maybeSingle()
      .returns<{
        contacto_soporte: string | null;
        dia_limite_pago_comision: number;
        terminos: string | null;
        aviso_privacidad: string | null;
        correo_bienvenida: string | null;
        correo_rechazo: string | null;
        bono_referido_equipo: boolean;
        referido_vigencia_meses: number;
        liga_max_por_telefono: number;
        liga_max_por_conexion: number;
      } | null>(),
    supabase
      .from("origenes_pago")
      .select("id, nombre, activo")
      .order("orden")
      .order("nombre")
      .returns<{ id: string; nombre: string; activo: boolean }[]>(),
    supabase
      .from("organizaciones")
      .select("prefijo_folio")
      .eq("id", persona.organizacion.id)
      .maybeSingle()
      .returns<{ prefijo_folio: string } | null>(),
    supabase
      .from("conectores")
      .select("id, tipo, activo, estado, configuracion, mapeo_campos, credencial_guardada_en, ultimo_sync, ultimo_error, mapeo_estatus(valor_externo, estatus_publico)")
      .returns<Conector[]>(),
  ]);
  const anio = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric" }).format(new Date()));
  const ultimoFolio = await supabase.rpc("ultimo_folio", { p_anio: anio });
  const a = oExplota(ajustes, "los ajustes");
  const conectores = oExplota(conector, "los conectores") ?? [];
  const activo = conectores.find((c) => c.activo) ?? null;
  const notion = conectores.find((c) => c.tipo === "notion") ?? null;

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-8">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← Inicio
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Ajustes</h1>
          <p className="mt-1 text-[0.9375rem] text-secundario">De {persona.organizacion.nombre}.</p>

          <FormularioAjustes
            contacto={a?.contacto_soporte ?? ""}
            diaLimite={a?.dia_limite_pago_comision ?? 10}
            terminos={a?.terminos ?? ""}
            aviso={a?.aviso_privacidad ?? ""}
            correoBienvenida={a?.correo_bienvenida ?? ""}
            correoRechazo={a?.correo_rechazo ?? ""}
            slug={persona.organizacion.slug}
            bonoEquipo={Boolean(a?.bono_referido_equipo)}
            vigenciaReferidos={a?.referido_vigencia_meses ?? 12}
            ligaPorTelefono={a?.liga_max_por_telefono ?? 10}
            ligaPorConexion={a?.liga_max_por_conexion ?? 20}
          />

          <section className="mt-10">
            <h2 className="text-[1.125rem] font-bold">Conector</h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
              Cómo se entera Tasa de lo que pasa con un trámite fuera de Tasa.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {CONECTORES.map((c) => {
                const esActivo = activo?.tipo === c.tipo;
                return (
                  <li key={c.tipo}
                    className={`rounded-lg border px-4 py-3 ${esActivo ? "border-acento bg-tinte" : "border-linea"} ${c.listo ? "" : "opacity-70"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{c.nombre}</span>
                      {esActivo ? (
                        <Etiqueta tono={activo?.estado === "error" ? "error" : "exito"}>
                          {activo?.estado === "error" ? "Con error" : "Activo"}
                        </Etiqueta>
                      ) : c.listo ? null : (
                        <Etiqueta tono="neutro">Próximamente</Etiqueta>
                      )}
                    </div>
                    <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">{c.detalle}</p>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 rounded-xl border border-linea px-4 py-4">
              <h3 className="font-bold">Notion</h3>
              {notion ? <ConfigNotion d={notion} /> : null}
              {activo?.tipo === "notion" ? (
                <div className="mt-4"><VolverAManualBoton /></div>
              ) : (
                <>
                  <p className="mt-3 text-[0.9375rem] leading-6 text-secundario">
                    Antes de activar: guarda el secreto y usa &quot;Probar conexión&quot;.
                  </p>
                  <ActivarNotion />
                </>
              )}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-[1.125rem] font-bold">Folios</h2>
            <FormularioPrefijo prefijo={oExplota(organizacion, "la organización")?.prefijo_folio ?? ""} />
            <FormularioUltimoFolio
              anio={anio}
              prefijo={oExplota(organizacion, "la organización")?.prefijo_folio ?? ""}
              ultimo={typeof ultimoFolio.data === "number" ? ultimoFolio.data : null}
            />
          </section>

          <section className="mt-10">
            <h2 className="text-[1.125rem] font-bold">Origen del dinero</h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
              De dónde sale el pago de una comisión. Solo lo ve Administración; el comisionista nunca.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {(oExplota(origenes, "los orígenes") ?? []).map((o) => (
                <FilaOrigen key={o.id} id={o.id} nombre={o.nombre} activo={o.activo} />
              ))}
              <FilaOrigen />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
