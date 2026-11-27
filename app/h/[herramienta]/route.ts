import type { NextRequest } from "next/server";
import { servirHerramienta } from "@/lib/herramientas-asesor/servir";

/**
 * Las herramientas de asesor (0100), servidas por Tasa: solo con sesión, si la persona las tiene en el catálogo y con
 * una CSP propia (lib/herramientas-asesor). Se abren dentro de /herramientas/[herramienta], nunca como archivo público.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ herramienta: string }> }) {
  const { herramienta } = await params;
  return servirHerramienta(herramienta, request.nextUrl.searchParams.get("trabajo"));
}
