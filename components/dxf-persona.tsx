import { AgregarDxf, AutorizarDxf, QuitarDxf } from "@/components/formularios-dxf";
import { dxfDePersona } from "@/lib/dxf-saldo";
import { fechaCorta } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * "DXF del mapa catastral" en la ficha de una persona (comisionista o equipo), 0065. Saldo, historial de
 * descargas y bitácora (quién, cuándo, cuánto, motivo). Solo admin_org edita; finanzas lo ve.
 */

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
const cuando = (iso: string) => `${fechaCorta(iso)}, ${hora(iso)}`;

const ACCION: Record<string, string> = { autorizar: "Autorizó", agregar: "Agregó", quitar: "Quitó la autorización" };

export async function DxfPersona({ personaId, edita }: { personaId: string; edita: boolean }) {
  const supabase = await crearClienteServidor();
  const [estado, movimientos, descargas] = await Promise.all([
    dxfDePersona(personaId),
    supabase.from("dxf_movimientos").select("id, accion, cantidad, sin_limite, saldo_despues, motivo, creado_en, personas!dxf_movimientos_hecho_por_fkey(nombre)")
      .eq("persona_id", personaId).order("creado_en", { ascending: false }).limit(30)
      .returns<{ id: number; accion: string; cantidad: number | null; sin_limite: boolean; saldo_despues: number | null; motivo: string; creado_en: string;
        personas: { nombre: string } | null }[]>(),
    supabase.from("dxf_descargas").select("id, clave, saldo_despues, veces, creado_en")
      .eq("persona_id", personaId).order("creado_en", { ascending: false }).limit(50)
      .returns<{ id: number; clave: string; saldo_despues: number | null; veces: number; creado_en: string }[]>(),
  ]);
  const bitacora = movimientos.data ?? [];
  const historial = descargas.data ?? [];
  const resumen = !estado.autorizado
    ? "Sin autorización"
    : estado.sin_limite ? "Autorizada · sin límite" : `Autorizada · saldo: ${estado.saldo} DXF`;

  return (
    <details className="mt-3 rounded-xl border border-linea px-4 py-3">
      <summary className="toque cursor-pointer font-semibold text-acento">DXF del mapa catastral</summary>
      <p className="mt-2 text-[0.9375rem] leading-6"><span className="font-semibold">{resumen}</span></p>
      {!estado.tiene_mapa ? (
        <p className="text-[0.875rem] leading-6 text-secundario">Hoy no tiene el Mapa catastral en su catálogo: el botón no le aparece aunque la autorices.</p>
      ) : null}

      {edita ? (
        <>
          <AutorizarDxf personaId={personaId} yaAutorizada={estado.autorizado} />
          {estado.autorizado && !estado.sin_limite ? <AgregarDxf personaId={personaId} /> : null}
          {estado.autorizado ? <QuitarDxf personaId={personaId} /> : null}
        </>
      ) : null}

      <h3 className="mt-4 font-semibold">Descargas</h3>
      {historial.length ? (
        <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem]">
          {historial.map((d) => (
            <li key={d.id} className="flex justify-between gap-3">
              <span className="text-secundario">{cuando(d.creado_en)} · <span className="font-mono">{d.clave}</span>{d.veces > 1 ? ` · ${d.veces} veces` : ""}</span>
              <span className="shrink-0 font-semibold">{d.saldo_despues === null ? "sin límite" : `quedaron ${d.saldo_despues}`}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-[0.9375rem] text-secundario">Todavía no baja ningún DXF.</p>}

      <h3 className="mt-4 font-semibold">Bitácora</h3>
      {bitacora.length ? (
        <ul className="mt-1 flex flex-col gap-2 text-[0.9375rem]">
          {bitacora.map((m) => (
            <li key={m.id}>
              <span className="font-semibold">
                {ACCION[m.accion] ?? m.accion}
                {m.accion === "autorizar" ? (m.sin_limite ? " sin límite" : ` con ${m.cantidad}`) : m.accion === "agregar" ? ` ${m.cantidad}` : ""}
                {m.saldo_despues !== null && m.accion !== "quitar" ? ` (saldo: ${m.saldo_despues})` : ""}
              </span>
              <span className="block text-secundario">{cuando(m.creado_en)} · {m.personas?.nombre ?? "—"} · {m.motivo}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-[0.9375rem] text-secundario">Sin movimientos.</p>}
    </details>
  );
}
