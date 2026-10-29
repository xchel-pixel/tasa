import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext } from "@playwright/test";

/**
 * Humo: ¿abren las pantallas principales para admin_org y finanzas, sin errores de consulta?
 * Solo lectura. La sesión se arma sin mandar correo: la clave secreta genera el código de
 * acceso (generateLink no envía nada) y con él se entra como lo haría la persona.
 *
 * Necesita en .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SECRET_KEY. Sin la secreta, se salta.
 */

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SECRETA = process.env.SUPABASE_SECRET_KEY ?? "";

const QUIENES = [
  { rol: "admin_org", correo: process.env.HUMO_ADMIN ?? "xchel@arqosuv.com" },
  { rol: "finanzas", correo: process.env.HUMO_FINANZAS ?? "xchel+finanzas@arqosuv.com" },
];

const PANTALLAS = [
  { ruta: "/", ve: /Hola,/ },
  { ruta: "/admin/tramites", ve: /Trámites/ },
  { ruta: "/mis-tramites", ve: /Mis trámites/ },
  { ruta: "/admin/solicitudes", ve: /Solicitudes por cotizar/ },
  { ruta: "/admin/pagos", ve: /Pagos/ },
];

// Lo que pinta una pantalla cuando una consulta falla o la página truena.
const ERROR = /No se pudo leer|No se pudieron|Application error|Algo salió mal|permission denied/i;

/** La sesión en las cookies que lee @supabase/ssr (en trozos si es larga). */
async function entrar(contexto: BrowserContext, correo: string, sitio: string) {
  const admin = createClient(URL_SUPABASE, SECRETA, { auth: { persistSession: false } });
  const { data: liga, error: e1 } = await admin.auth.admin.generateLink({ type: "magiclink", email: correo });
  if (e1 || !liga.properties?.email_otp) throw new Error(`No se pudo generar el código de ${correo}: ${e1?.message}`);

  const anon = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } });
  const { data, error: e2 } = await anon.auth.verifyOtp({ email: correo, token: liga.properties.email_otp, type: "email" });
  if (e2 || !data.session) throw new Error(`No se pudo entrar como ${correo}: ${e2?.message}`);

  const ref = new URL(URL_SUPABASE).hostname.split(".")[0];
  const valor = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  const TROZO = 3180;
  const trozos = valor.length <= TROZO ? [valor] : valor.match(new RegExp(`.{1,${TROZO}}`, "g"))!;
  const dominio = new URL(sitio).hostname;
  await contexto.addCookies(
    trozos.map((v, i) => ({
      name: trozos.length === 1 ? `sb-${ref}-auth-token` : `sb-${ref}-auth-token.${i}`,
      value: v,
      domain: dominio,
      path: "/",
      sameSite: "Lax" as const,
      secure: sitio.startsWith("https"),
    }))
  );
}

test.skip(!SECRETA || !URL_SUPABASE || !ANON, "Falta SUPABASE_SECRET_KEY (o la URL/anon) en .env.local");

for (const q of QUIENES) {
  test(`humo: ${q.rol}`, async ({ browser, baseURL }) => {
    const contexto = await browser.newContext();
    await entrar(contexto, q.correo, baseURL!);
    const pagina = await contexto.newPage();
    for (const p of PANTALLAS) {
      const r = await pagina.goto(p.ruta);
      expect(r?.status(), `${p.ruta} responde`).toBeLessThan(400);
      expect(new URL(pagina.url()).pathname, `${p.ruta} no manda a entrar`).not.toBe("/entrar");
      await expect(pagina.locator("main"), `${p.ruta} muestra su contenido`).toContainText(p.ve);
      await expect(pagina.locator("body"), `${p.ruta} sin errores`).not.toContainText(ERROR);
    }
    await contexto.close();
  });
}
