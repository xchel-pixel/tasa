import Link from "next/link";
import { Encabezado } from "@/components/encabezado";
import { Etiqueta } from "@/components/etiqueta";
import { fechaCorta } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioAjustes, { FilaOrigen, FormularioPrefijo, VolverAManual } from "./formulario-ajustes";

export const metadata = { title: "Ajustes — Tasa" };

type Conector = {
  tipo: "manual" | "notion" | "sheets" | "webhook";
  estado: "activo" | "error" | "pausado";
  ultimo_sync: string | null;
  ultimo_error: string | null;
};

const CONECTORES: { tipo: Conector["tipo"]; nombre: string; detalle: string; listo: boolean }[] = [
  { tipo: "manual", nombre: "Manual", detalle: "Sin sistema externo. El estatus se mueve desde la ficha del trabajo y Tasa pone el folio.", listo: true },
  { tipo: "notion", nombre: "Notion", detalle: "Crea la página al aceptarse el trámite y lee etapa, folio y fecha de visita.", listo: false },
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
      .select("contacto_soporte, dia_limite_pago_comision, terminos, aviso_privacidad")
      .maybeSingle()
      .returns<{ contacto_soporte: string | null; dia_limite_pago_comision: number; terminos: string | null; aviso_privacidad: string | null } | null>(),
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
      .select("tipo, estado, ultimo_sync, ultimo_error")
      .eq("activo", true)
      .maybeSingle()
      .returns<Conector | null>(),
  ]);
  const a = oExplota(ajustes, "los ajustes");
  const activo = oExplota(conector, "el conector");

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
            {activo && activo.tipo !== "manual" ? (
              <>
                <p className="mt-3 text-[0.9375rem] leading-6 text-secundario">
                  {activo.ultimo_sync ? `Última sincronización: ${fechaCorta(activo.ultimo_sync)}.` : "Todavía no sincroniza."}
                  {activo.ultimo_error ? ` Último error: ${activo.ultimo_error}` : ""}
                </p>
                <VolverAManual />
              </>
            ) : null}
          </section>

          <section className="mt-10">
            <h2 className="text-[1.125rem] font-bold">Folios</h2>
            <FormularioPrefijo prefijo={oExplota(organizacion, "la organización")?.prefijo_folio ?? ""} />
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
