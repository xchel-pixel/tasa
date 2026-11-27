import { NextResponse, type NextRequest } from "next/server";
import { leerColindancias, textoMedida } from "@/lib/catastro/colindancias";
import { consultarClave } from "@/lib/catastro/servicio";
import { SIN_DATO } from "@/lib/catastro/textos";
import { tengoHerramienta, TODOS_LOS_ROLES } from "@/lib/herramientas";
import { municipioPorClave } from "@/lib/traslado/calculo";
import { exigirRol } from "@/lib/sesion";

/**
 * TASA_catastro de las herramientas de asesor (0100): lo mismo que la persona vería en el Mapa catastral con esa clave
 * (misma consulta, mismos permisos por rol, mismo cupo; un predio guardado no cuenta), reducido a lo que la herramienta
 * llena: municipio, dirección, superficies y colindancias. Sin propietario ni nada privado, y sin nombrar la fuente.
 */
export async function GET(request: NextRequest) {
  const persona = await exigirRol(...TODOS_LOS_ROLES);
  const vacio = NextResponse.json(null, { headers: { "Cache-Control": "private, no-store" } });
  if (!(await tengoHerramienta("mapa_catastral"))) return vacio;
  const r = await consultarClave({ persona: persona.id, organizacion: persona.organizacion.id }, request.nextUrl.searchParams.get("clave") ?? "", false);
  if (!r.ok) return vacio;
  const c = r.ficha.campos;
  const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : null);
  const txt = (v: unknown) => (typeof v === "string" && v.trim() && v !== SIN_DATO ? v.trim() : "");
  const mc = txt(c.rppc_medid_colind);
  const col = mc ? leerColindancias(mc) : null;
  return NextResponse.json({
    clave: r.ficha.clave,
    municipio: municipioPorClave(r.ficha.clave) ?? "",
    direccion: txt(c.ubicacion) || [txt(c.calle), txt(c.num_ext), txt(c.colonia)].filter(Boolean).join(" "),
    sup_terreno: num(c.sup_terreno),
    sup_construccion: num(c.sup_construccion),
    ...(col?.seguro ? { colindancias: col.filas.map((f) => ({ orientacion: f.orientacion, medida: textoMedida(f.medidas), colinda: f.colinda })) } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
