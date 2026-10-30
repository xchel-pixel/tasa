import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

/**
 * supabase/produccion/demo.sql (npm run demo) contra un Postgres de verdad: crea DEMO con datos
 * en cada estatus y cada tipo de honorario, se puede correr las veces que sea y NUNCA toca otra
 * organización.
 */

const raiz = join(import.meta.dirname, "..");
const leer = (...ruta: string[]) => readFileSync(join(raiz, ...ruta), "utf8");
const db = new PGlite();

const TABLAS_CON_ORG = [
  "aceptaciones_terminos", "ajustes", "alertas", "aplicaciones_pago_comision", "cierres", "comisiones", "comisionistas",
  "conectores", "convenio_precios", "convenios", "cotizaciones", "csf_reemplazadas", "cuentas_receptoras", "eventos_trabajo",
  "folios_contador", "historial_estatus", "mapeo_estatus", "marcas", "membresia_marcas", "membresias", "niveles",
  "niveles_mensuales", "origenes_pago", "pagos", "pagos_comision", "pendientes_comision", "servicios", "solicitudes",
  "solicitudes_alta",
];

/** Cuántas filas tiene cada tabla de las organizaciones que NO son demo. */
async function huellaDeOtras(): Promise<Record<string, number>> {
  const huella: Record<string, number> = {};
  for (const t of TABLAS_CON_ORG) {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from ${t} where organizacion_id not in (select id from organizaciones where slug = 'demo')`
    );
    huella[t] = r.rows[0].n;
  }
  const personas = await db.query<{ n: number }>(`select count(*)::int as n from personas p where exists (select 1 from membresias m join organizaciones o on o.id = m.organizacion_id where m.persona_id = p.id and o.slug <> 'demo')`);
  huella.personas = personas.rows[0].n;
  return huella;
}

beforeAll(async () => {
  await db.exec(leer("pruebas", "supabase_simulado.sql"));
  const dir = join(raiz, "supabase", "migrations");
  for (const archivo of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(leer("supabase", "migrations", archivo));
  }
  await db.exec(leer("supabase", "semilla_prueba.sql"));
  // La semilla de pruebas trae su propia "Demo Valuadores" (slug demo): aquí hace de DEMO.
  await db.exec("update organizaciones set demo = true where slug = 'demo'");
}, 90_000);

describe("Datos DEMO", () => {
  test("se niega a tocar una organización que no está marcada como demo", async () => {
    await db.exec("update organizaciones set demo = false where slug = 'demo'");
    await expect(db.exec(leer("supabase", "produccion", "demo.sql"))).rejects.toThrow(/no está marcada como demo/);
    await db.exec("update organizaciones set demo = true where slug = 'demo'");
  });

  test("la marca para regenerar no abre los candados de otra organización", async () => {
    await expect(
      db.exec("begin; select set_config('tasa.regenerar_demo', 'si', true); delete from cierres where estado = 'aprobado' and organizacion_id = (select id from organizaciones where slug = 'xg'); commit;")
    ).rejects.toThrow(/está aprobado: no se borra/);
    await db.exec("rollback").catch(() => {});
  });

  test("dos corridas: DEMO con datos completos y las demás organizaciones intactas", async () => {
    const antes = await huellaDeOtras();
    await db.exec(leer("supabase", "produccion", "demo.sql"));
    const primera = await db.query<{ n: number }>(`select count(*)::int as n from solicitudes s join organizaciones o on o.id = s.organizacion_id and o.slug = 'demo'`);
    await db.exec(leer("supabase", "produccion", "demo.sql"));
    expect(await huellaDeOtras()).toEqual(antes);

    const demo = async (sql: string) => (await db.query<{ v: string }>(sql)).rows.map((r) => r.v);
    const enDemo = "organizacion_id = (select id from organizaciones where slug = 'demo')";
    const segunda = await db.query<{ n: number }>(`select count(*)::int as n from solicitudes where ${enDemo}`);
    expect(segunda.rows[0].n).toBe(primera.rows[0].n);

    expect(await demo(`select distinct estatus_publico as v from solicitudes where ${enDemo} order by 1`)).toEqual(
      expect.arrayContaining(["aceptada", "cancelada", "cotizada", "en_elaboracion", "en_revision", "entregado", "pagado", "solicitada", "vencida", "visita_agendada"])
    );
    expect(await demo(`select distinct honorario_tipo as v from solicitudes where ${enDemo} order by 1`)).toEqual(["estimado", "fijo", "sin_costo"]);
    expect(await demo(`select (count(*) filter (where honorario_final_en is null))::text || ' ' || (count(*) filter (where honorario_final_en is not null))::text as v
                         from solicitudes where ${enDemo} and honorario_tipo = 'estimado'`)).toEqual(["1 1"]);
    expect(await demo(`select string_agg(honorario_tipo, ',' order by honorario_tipo) as v from convenio_precios where ${enDemo}`)).toEqual(["estimado,fijo,sin_costo"]);
    expect(await demo(`select count(*)::text as v from solicitudes where ${enDemo} and origen = 'liga_cliente'`)).toEqual(["2"]);
    // Sin costo → conversión: uno ligado a trabajo contratado y uno sin ligar con más de 30 días (mes pasado), más el de este mes.
    expect(await demo(`select (count(*) filter (where ligada_a is not null))::text || ' ' || (count(*) filter (where ligada_a is null and aceptada_en < now() - interval '30 days'))::text as v
                         from solicitudes where ${enDemo} and honorario_tipo = 'sin_costo'`)).toEqual(["2 1"]);
    expect(await demo(`select (count(*) filter (where referidor_id is not null))::text || ' ' || (count(*) filter (where referidor_miembro_id is not null))::text as v
                         from solicitudes_alta where ${enDemo}`)).toEqual(["1 1"]);
    expect(await demo(`select estado as v from cierres where ${enDemo}`)).toEqual(["aprobado"]);
    // Bono de referidos del cierre: Ana con 3 activos (3%), uno recortado por tope; ni vencido ni inactivo generan; equipo aparte.
    expect(await demo(`select string_agg(porcentaje || ':' || monto || ':' || tope_ajustado, ' ' order by monto) as v from comisiones where ${enDemo} and tipo = 'referido'`))
      .toEqual(["3.00:160.00:true 3.00:180.00:false 3.00:300.00:false"]);
    expect(await demo(`select count(*)::text || ' ' || max(porcentaje)::text || ' ' || max(monto)::text as v from bonos_equipo where ${enDemo}`)).toEqual(["1 2.50 200.00"]);
    expect(await demo(`select string_agg(porcentaje::text, ',' order by porcentaje) as v from comisiones where ${enDemo}`)).toEqual(
      expect.arrayContaining([expect.stringContaining("8.00")])
    );
    expect(await demo(`select string_agg(rol, ',' order by rol) as v from membresias where ${enDemo} and persona_id in (select id from personas where correo like 'xchel+demo-%')`)).toEqual(
      ["admin_org,comisionista,comisionista,comisionista,equipo,finanzas"]
    );
  });
});
