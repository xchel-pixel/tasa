import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Humo contra producción, solo lectura: entra como admin_org y como finanzas y abre TODAS las
 * pantallas. Cada una debe abrir sin errores o, si no le toca a ese rol, regresarlo al inicio.
 * No llena formularios ni escribe nada. La sesión se arma sin mandar correo: la clave secreta
 * genera el código de acceso (generateLink no envía nada) y con él se entra como la persona.
 *
 * La lista de pantallas sale de las rutas reales (app/**\/page.tsx): si se agrega una ruta y no
 * está en PANTALLAS, la primera prueba falla. Necesita en .env.local NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SECRET_KEY; sin la secreta, se salta.
 */

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SECRETA = process.env.SUPABASE_SECRET_KEY ?? "";

const QUIENES = [
  { rol: "admin_org", correo: process.env.HUMO_ADMIN ?? "xchel@arqosuv.com" },
  { rol: "finanzas", correo: process.env.HUMO_FINANZAS ?? "xchel+finanzas@arqosuv.com" },
] as const;
type Rol = (typeof QUIENES)[number]["rol"];

/** abre: carga y se queda ahí · inicio: la regresa a "/". */
type Espera = "abre" | "inicio";

/** Datos reales para llenar las rutas con [parámetros]. Solo se leen. */
type Datos = {
  org: string;
  codigo: string | null;
  porCotizar: string | null;
  trabajo: string | null;
  trabajoPorPagar: string | null;
  comisionista: string | null;
  alta: string | null;
  /** El mes anterior, AAAA-MM. */
  mesCierre: string;
};

type Pantalla = {
  /** Lo que hay que abrir; nulo si no hay datos para esa ruta (se anota y se salta). */
  rutas: (d: Datos) => (string | null)[];
  espera: Record<Rol, Espera>;
  /** Sin sesión (páginas públicas): no se prueba por rol, solo que abra. */
  publica?: boolean;
};

const AMBOS: Record<Rol, Espera> = { admin_org: "abre", finanzas: "abre" };
const SOLO_ADMIN: Record<Rol, Espera> = { admin_org: "abre", finanzas: "inicio" };
const NINGUNO: Record<Rol, Espera> = { admin_org: "inicio", finanzas: "inicio" };

/** Cada ruta real de la aplicación y qué le pasa a cada rol. */
const PANTALLAS: Record<string, Pantalla> = {
  "/": { rutas: () => ["/"], espera: AMBOS },
  "/admin/alertas": { rutas: () => ["/admin/alertas"], espera: AMBOS },
  "/admin/altas": { rutas: () => ["/admin/altas"], espera: AMBOS },
  "/admin/altas/[id]": { rutas: (d) => [d.alta && `/admin/altas/${d.alta}`], espera: AMBOS },
  "/admin/altas/nueva": { rutas: () => ["/admin/altas/nueva"], espera: AMBOS },
  "/admin/catalogos": { rutas: () => ["/admin/catalogos"], espera: SOLO_ADMIN },
  "/admin/cierres": { rutas: () => ["/admin/cierres"], espera: AMBOS },
  "/admin/cierres/[mes]": { rutas: (d) => [`/admin/cierres/${d.mesCierre}`], espera: AMBOS },
  "/admin/comisiones": { rutas: () => ["/admin/comisiones"], espera: AMBOS },
  "/admin/comisiones/pagar": { rutas: (d) => [d.comisionista && `/admin/comisiones/pagar?c=${d.comisionista}`], espera: AMBOS },
  "/admin/comisionistas": { rutas: () => ["/admin/comisionistas"], espera: AMBOS },
  "/admin/comisionistas/[id]": { rutas: (d) => [d.comisionista && `/admin/comisionistas/${d.comisionista}`], espera: AMBOS },
  "/admin/comisionistas/importar": { rutas: () => ["/admin/comisionistas/importar"], espera: SOLO_ADMIN },
  "/admin/comisionistas/nuevo": { rutas: () => ["/admin/comisionistas/nuevo"], espera: SOLO_ADMIN },
  "/admin/configuracion": { rutas: () => ["/admin/configuracion"], espera: SOLO_ADMIN },
  "/admin/equipo": { rutas: () => ["/admin/equipo"], espera: AMBOS },
  "/admin/niveles": { rutas: () => ["/admin/niveles"], espera: SOLO_ADMIN },
  "/admin/pagos": { rutas: () => ["/admin/pagos"], espera: AMBOS },
  "/admin/referidos": { rutas: () => ["/admin/referidos"], espera: AMBOS },
  "/admin/reportes": { rutas: () => ["/admin/reportes"], espera: AMBOS },
  "/admin/solicitudes": { rutas: () => ["/admin/solicitudes"], espera: AMBOS },
  "/admin/solicitudes/[id]": { rutas: (d) => [d.porCotizar && `/admin/solicitudes/${d.porCotizar}`], espera: AMBOS },
  "/admin/tramites": {
    rutas: () => [
      "/admin/tramites",
      "/admin/tramites?estatus=todos&origen=liga",
      "/admin/tramites?folio=1",
      "/admin/tramites?cobro=1&todos=1",
      "/admin/tramites?q=MGP",
    ],
    espera: AMBOS,
  },
  "/ajustes": { rutas: () => ["/ajustes"], espera: SOLO_ADMIN },
  "/alta/[org]": { rutas: (d) => [`/alta/${d.org}`], espera: AMBOS, publica: true },
  "/entrar": { rutas: () => ["/entrar"], espera: AMBOS, publica: true },
  "/estado-de-cuenta": { rutas: () => ["/estado-de-cuenta"], espera: NINGUNO },
  "/mis-tramites": { rutas: () => ["/mis-tramites", "/mis-tramites?ver=por_cobrar"], espera: AMBOS },
  "/organizacion": { rutas: () => ["/organizacion"], espera: AMBOS },
  "/perfil": { rutas: () => ["/perfil"], espera: NINGUNO },
  // Solo super plataforma: admin_org (Xchel) lo es; finanzas no.
  "/plataforma": { rutas: () => ["/plataforma"], espera: SOLO_ADMIN },
  "/privacidad": { rutas: (d) => [`/privacidad?org=${d.org}`], espera: AMBOS, publica: true },
  "/s/[org]/[codigo]": { rutas: (d) => [d.codigo && `/s/${d.org}/${d.codigo}`], espera: AMBOS, publica: true },
  "/solicitudes/nueva": { rutas: () => ["/solicitudes/nueva"], espera: NINGUNO },
  // Ya aceptados, se pueden volver a leer.
  "/terminos": { rutas: () => ["/terminos"], espera: AMBOS },
  "/trabajos/[id]": { rutas: (d) => [d.trabajo && `/trabajos/${d.trabajo}`, d.porCotizar && `/trabajos/${d.porCotizar}`], espera: AMBOS },
  "/trabajos/[id]/pagar": { rutas: (d) => [d.trabajoPorPagar && `/trabajos/${d.trabajoPorPagar}/pagar`], espera: AMBOS },
};

// Lo que pinta una pantalla cuando una consulta falla o la página truena.
const ERROR = /No se pudo leer|No se pudieron|Application error|server-side exception|Algo salió mal|permission denied|This page couldn.t load/i;

/** Las rutas reales: cada app/**\/page.tsx, como "/admin/altas/[id]". */
function rutasReales(): string[] {
  // Playwright corre desde la raíz del proyecto (donde está playwright.config.ts).
  const raiz = join(process.cwd(), "app");
  const rutas: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (nombre === "page.tsx") {
        const r = relative(raiz, dir).split(sep).filter((s) => !/^\(.*\)$/.test(s)).join("/");
        rutas.push("/" + r);
      }
    }
  };
  recorrer(raiz);
  return rutas.sort();
}

async function leerDatos(): Promise<Datos> {
  const db: SupabaseClient = createClient(URL_SUPABASE, SECRETA, { auth: { persistSession: false } });
  const { data: yo } = await db.from("personas").select("id, organizacion_activa").eq("correo", QUIENES[0].correo).single();
  const org = yo!.organizacion_activa as string;
  // Una consulta que falla truena la prueba: nunca se confunde con "no hay datos".
  const uno = async (consulta: PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>) => {
    const { data, error } = await consulta;
    if (error) throw new Error(`Datos para la prueba: ${error.message}`);
    return data?.[0]?.id ?? null;
  };
  const [slug, membresia, porCotizar, trabajo, trabajoPorPagar, comisionista] = await Promise.all([
    db.from("organizaciones").select("slug").eq("id", org).single(),
    db.from("membresias").select("codigo_referido").eq("persona_id", yo!.id).eq("organizacion_id", org).single(),
    uno(db.from("solicitudes").select("id").eq("organizacion_id", org).eq("estado", "solicitada").limit(1)),
    uno(db.from("solicitudes").select("id").eq("organizacion_id", org).eq("estado", "tramite").not("folio", "is", null).limit(1)),
    uno(db.from("solicitudes").select("id").eq("organizacion_id", org).eq("estado", "tramite").is("pagado_en", null).limit(1)),
    (async () => (await db.from("comisionistas").select("persona_id").eq("organizacion_id", org).limit(1)).data?.[0]?.persona_id ?? null)(),
  ]);
  const hoy = new Date();
  const anterior = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  return {
    org: slug.data!.slug as string,
    codigo: (membresia.data?.codigo_referido as string | null) ?? null,
    porCotizar,
    trabajo,
    trabajoPorPagar,
    comisionista,
    // solicitudes_alta está cerrada aun para la clave secreta: se toma de la pantalla, con sesión.
    alta: null,
    mesCierre: anterior,
  };
}

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

/** Abre una ruta y devuelve el problema, o nulo si se comportó como se esperaba. */
async function revisar(pagina: Page, ruta: string, espera: Espera): Promise<string | null> {
  const r = await pagina.goto(ruta);
  const status = r?.status() ?? 0;
  if (status >= 400) return `${ruta}: respondió ${status}`;
  const donde = new URL(pagina.url()).pathname;
  if (donde === "/entrar" && ruta !== "/entrar") return `${ruta}: mandó a entrar (sin sesión)`;
  const cuerpo = (await pagina.locator("body").innerText()).slice(0, 4000);
  const error = cuerpo.match(ERROR);
  if (error) return `${ruta}: muestra "${error[0]}"`;
  const esperado = ruta.split("?")[0];
  if (espera === "abre") {
    if (donde !== esperado) return `${ruta}: debía abrir, terminó en ${donde}`;
    if ((await pagina.locator("h1").count()) === 0) return `${ruta}: abrió sin título`;
  } else if (donde !== "/") {
    return `${ruta}: debía regresar al inicio, se quedó en ${donde}`;
  }
  return null;
}

test.skip(!SECRETA || !URL_SUPABASE || !ANON, "Falta SUPABASE_SECRET_KEY (o la URL/anon) en .env.local");

let datos: Datos;
test.beforeAll(async () => {
  datos = await leerDatos();
});

test("humo: cada ruta real tiene su expectativa", () => {
  const reales = rutasReales();
  const faltan = reales.filter((r) => !(r in PANTALLAS));
  const sobran = Object.keys(PANTALLAS).filter((r) => !reales.includes(r));
  expect(faltan, "Rutas nuevas sin expectativa en humo/humo.spec.ts").toEqual([]);
  expect(sobran, "Rutas en la prueba que ya no existen").toEqual([]);
});

test("humo: páginas públicas sin sesión", async ({ browser }) => {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  const problemas: string[] = [];
  for (const [patron, p] of Object.entries(PANTALLAS)) {
    if (!p.publica) continue;
    for (const ruta of p.rutas(datos)) {
      if (!ruta) {
        test.info().annotations.push({ type: "sin datos", description: patron });
        continue;
      }
      const problema = await revisar(pagina, ruta, "abre");
      if (problema) problemas.push(problema);
    }
  }
  await contexto.close();
  expect(problemas).toEqual([]);
});

for (const q of QUIENES) {
  test(`humo: ${q.rol}`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const contexto = await browser.newContext();
    await entrar(contexto, q.correo, baseURL!);
    const pagina = await contexto.newPage();
    const problemas: string[] = [];
    let abiertas = 0;
    await pagina.goto("/admin/altas?ver=todas");
    const ligas = pagina.locator('main a[href^="/admin/altas/"]:not([href="/admin/altas/nueva"])');
    const liga = (await ligas.count()) > 0 ? await ligas.first().getAttribute("href") : null;
    const datosRol: Datos = { ...datos, alta: liga?.split("/").pop() ?? null };
    for (const [patron, p] of Object.entries(PANTALLAS)) {
      if (p.publica) continue;
      for (const ruta of p.rutas(datosRol)) {
        if (!ruta) {
          test.info().annotations.push({ type: "sin datos", description: patron });
          continue;
        }
        const problema = await revisar(pagina, ruta, p.espera[q.rol]);
        abiertas++;
        if (problema) problemas.push(problema);
      }
    }
    test.info().annotations.push({ type: "pantallas", description: String(abiertas) });
    await contexto.close();
    expect(problemas).toEqual([]);
  });
}
