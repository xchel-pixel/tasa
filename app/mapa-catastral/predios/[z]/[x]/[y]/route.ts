import type { NextRequest } from "next/server";
import { servirMosaico } from "@/lib/catastro/servir-mosaico";

/** Las líneas de predios (urbanos y rústicos) del mapa. Permiso, límites y caché: lib/catastro/servir-mosaico.ts. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  return servirMosaico("predios", await params, request);
}
