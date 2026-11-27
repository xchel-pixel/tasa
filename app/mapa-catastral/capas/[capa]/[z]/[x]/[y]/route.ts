import type { NextRequest } from "next/server";
import { servirMosaico } from "@/lib/catastro/servir-mosaico";

/**
 * Las demás capas del mapa para el equipo (construcciones, uso de suelo, colonias, ejidos, manzanas): solo ids de la
 * lista fija de lib/catastro/capas.ts. Permiso, límites y caché: lib/catastro/servir-mosaico.ts.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ capa: string; z: string; x: string; y: string }> }) {
  const { capa, ...p } = await params;
  // "predios" va por su ruta de siempre.
  return servirMosaico(capa === "predios" ? "" : capa, p, request);
}
