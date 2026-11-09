/**
 * "Chrome en Android", "Safari en iPhone"… a partir del User-Agent, para el registro de accesos (0070) y la
 * pantalla de Accesos. Solo el resumen: nunca se guarda el User-Agent completo ni la IP. Sin expresiones
 * regulares (regla de CLAUDE.md): solo búsquedas de texto.
 */
export function resumenNavegador(ua: string): string {
  const t = ua.toLowerCase();
  if (!t.trim()) return "Desconocido";
  const sistema = t.includes("iphone") ? "iPhone"
    : t.includes("ipad") ? "iPad"
    : t.includes("android") ? "Android"
    : t.includes("windows") ? "Windows"
    : t.includes("mac os") || t.includes("macintosh") ? "Mac"
    : t.includes("linux") ? "Linux"
    : null;
  const navegador = t.includes("edg/") || t.includes("edga/") || t.includes("edgios/") ? "Edge"
    : t.includes("opr/") || t.includes("opera") ? "Opera"
    : t.includes("samsungbrowser") ? "Samsung Internet"
    : t.includes("crios/") || t.includes("chrome/") ? "Chrome"
    : t.includes("fxios/") || t.includes("firefox/") ? "Firefox"
    : t.includes("safari/") ? "Safari"
    : t.startsWith("node") || t.includes("undici") ? "Servidor"
    : null;
  if (navegador && sistema) return `${navegador} en ${sistema}`;
  return navegador ?? sistema ?? "Otro";
}
