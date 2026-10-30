import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Humo contra producción, solo lectura: entra con cada usuario y abre TODAS las pantallas. Cada una
 * debe abrir sin errores o, si no le toca a ese rol, regresarlo al inicio. No llena formularios ni
 * escribe nada. La sesión se arma sin mandar correo: la clave secreta genera el código de acceso
 * (generateLink no envía nada) y con él se entra como la persona.
 *
 * Dos organizaciones:
 *   · XG (la real): admin_org y finanzas.
 *   · DEMO (datos sintéticos de `npm run demo`): admin_org, finanzas, equipo y comisionista. Tiene
 *     datos en cada estatus y tipo de honorario, para que una pantalla que solo truena con datos
 *     (como Catálogos con un convenio) no pase en verde por tener la lista vacía.
 *
 * La lista de pantallas sale de las rutas reales (app/**\/page.tsx): si se agrega una ruta y no
 * está en PANTALLAS, la primera prueba falla. Necesita en .env.local NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SECRET_KEY; sin la secreta, se salta.
 */

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SECRETA = process.env.SUPABASE_SECRET_KEY ?? "";

type Rol = "admin_org" | "finanzas" | "equipo" | "comisionista";

const QUIENES: { org: "XG" | "DEMO"; rol: Rol; correo: string }[] = [
  { org: "XG", rol: "admin_org", correo: process.env.HUMO_ADMIN ?? "xchel@arqosuv.com" },
  { org: "XG", rol: "finanzas", correo: process.env.HUMO_FINANZAS ?? "xchel+finanzas@arqosuv.com" },
  { org: "DEMO", rol: "admin_org", correo: "xchel+demo-admin@arqosuv.com" },
  { org: "DEMO", rol: "finanzas", correo: "xchel+demo-finanzas@arqosuv.com" },
  { org: "DEMO", rol: "equipo", correo: "xchel+demo-equipo@arqosuv.com" },
  { org: "DEMO", rol: "comisionista", correo: "xchel+demo-ana@arqosuv.com" },
];

/** abre: carga y se queda ahí · inicio: la regresa a "/". */
type Espera = "abre" | "inicio";

/** Datos reales para llenar las rutas con [parámetros], vistos por quien entra. Solo se leen. */
type Datos = {
  org: string;
  codigo: string | null;
  porCotizar: string | null;
  trabajo: string | null;
  trabajoPorPagar: string | null;
  comisionista: string | null;
  alta: string | null;
  /** Slug de una tarjeta publicada de la organización (para /t/…). */
  tarjeta: string | null;
  /** El mes anterior, AAAA-MM. */
  mesCierre: string;
};

type Pantalla = {
  /** Lo que hay que abrir; nulo si no hay datos para esa ruta (se anota y se salta). */
  rutas: (d: Datos) => (string | null)[];
  espera: Record<Rol, Espera>;
  /** Sin sesión (páginas públicas): no se prueba por rol, solo que abra. */
  publica?: boolean;
  /** Abre solo para super_plataforma (el admin_org de XG); a todos los demás los regresa al inicio. */
  soloSuperPlataforma?: boolean;
};

const TODOS: Record<Rol, Espera> = { admin_org: "abre", finanzas: "abre", equipo: "abre", comisionista: "abre" };
const OPERACION: Record<Rol, Espera> = { admin_org: "abre", finanzas: "abre", equipo: "inicio", comisionista: "inicio" };
const SOLO_ADMIN: Record<Rol, Espera> = { admin_org: "abre", finanzas: "inicio", equipo: "inicio", comisionista: "inicio" };
const SOLO_COMISIONISTA: Record<Rol, Espera> = { admin_org: "inicio", finanzas: "inicio", equipo: "inicio", comisionista: "abre" };
const EQUIPO_Y_STAFF: Record<Rol, Espera> = { admin_org: "abre", finanzas: "abre", equipo: "abre", comisionista: "inicio" };
const COMISIONISTA_Y_STAFF: Record<Rol, Espera> = { admin_org: "abre", finanzas: "abre", equipo: "inicio", comisionista: "abre" };

/** Cada ruta real de la aplicación y qué le pasa a cada rol. */
const PANTALLAS: Record<string, Pantalla> = {
  "/": { rutas: () => ["/"], espera: TODOS },
  "/admin/alertas": { rutas: () => ["/admin/alertas"], espera: OPERACION },
  "/admin/altas": { rutas: () => ["/admin/altas", "/admin/altas?ver=todas"], espera: OPERACION },
  "/admin/altas/[id]": { rutas: (d) => [d.alta && `/admin/altas/${d.alta}`], espera: OPERACION },
  "/admin/altas/nueva": { rutas: () => ["/admin/altas/nueva"], espera: OPERACION },
  "/admin/catalogos": { rutas: () => ["/admin/catalogos"], espera: SOLO_ADMIN },
  "/admin/cierres": { rutas: () => ["/admin/cierres"], espera: OPERACION },
  "/admin/cierres/[mes]": { rutas: (d) => [`/admin/cierres/${d.mesCierre}`], espera: OPERACION },
  "/admin/comisiones": { rutas: () => ["/admin/comisiones"], espera: OPERACION },
  "/admin/comisiones/pagar": { rutas: (d) => [d.comisionista && `/admin/comisiones/pagar?c=${d.comisionista}`], espera: OPERACION },
  "/admin/comisionistas": { rutas: () => ["/admin/comisionistas"], espera: OPERACION },
  "/admin/comisionistas/[id]": { rutas: (d) => [d.comisionista && `/admin/comisionistas/${d.comisionista}`], espera: OPERACION },
  "/admin/comisionistas/importar": { rutas: () => ["/admin/comisionistas/importar"], espera: SOLO_ADMIN },
  "/admin/comisionistas/nuevo": { rutas: () => ["/admin/comisionistas/nuevo"], espera: SOLO_ADMIN },
  "/admin/configuracion": { rutas: () => ["/admin/configuracion"], espera: SOLO_ADMIN },
  "/admin/equipo": { rutas: () => ["/admin/equipo"], espera: OPERACION },
  "/admin/niveles": { rutas: () => ["/admin/niveles"], espera: SOLO_ADMIN },
  "/admin/pagos": { rutas: () => ["/admin/pagos"], espera: OPERACION },
  "/admin/referidos": { rutas: () => ["/admin/referidos"], espera: OPERACION },
  "/admin/reportes": { rutas: (d) => ["/admin/reportes", `/admin/reportes?mes=${d.mesCierre}-01`], espera: OPERACION },
  "/admin/solicitudes": { rutas: () => ["/admin/solicitudes"], espera: OPERACION },
  "/admin/solicitudes/[id]": { rutas: (d) => [d.porCotizar && `/admin/solicitudes/${d.porCotizar}`], espera: OPERACION },
  "/admin/testimonios": { rutas: () => ["/admin/testimonios"], espera: SOLO_ADMIN },
  "/admin/tramites": {
    rutas: () => [
      "/admin/tramites",
      "/admin/tramites?estatus=todos&origen=liga",
      "/admin/tramites?folio=1",
      "/admin/tramites?cobro=1&todos=1",
      "/admin/tramites?estimado=1",
      "/admin/tramites?q=DEMO",
    ],
    espera: OPERACION,
  },
  "/ajustes": { rutas: () => ["/ajustes"], espera: SOLO_ADMIN },
  "/alta/[org]": { rutas: (d) => [`/alta/${d.org}`], espera: TODOS, publica: true },
  "/entrar": { rutas: () => ["/entrar"], espera: TODOS, publica: true },
  "/estado-de-cuenta": { rutas: () => ["/estado-de-cuenta"], espera: SOLO_COMISIONISTA },
  "/mis-tramites": { rutas: () => ["/mis-tramites", "/mis-tramites?ver=por_cobrar"], espera: EQUIPO_Y_STAFF },
  "/organizacion": { rutas: () => ["/organizacion"], espera: TODOS },
  "/perfil": { rutas: () => ["/perfil"], espera: SOLO_COMISIONISTA },
  // Solo super plataforma: el admin_org de XG (Xchel) lo es; el admin de DEMO, no.
  "/plataforma": { rutas: () => ["/plataforma"], espera: SOLO_ADMIN, soloSuperPlataforma: true },
  "/privacidad": { rutas: (d) => [`/privacidad?org=${d.org}`], espera: TODOS, publica: true },
  "/s/[org]/[codigo]": { rutas: (d) => [d.codigo && `/s/${d.org}/${d.codigo}`], espera: TODOS, publica: true },
  "/solicitudes/nueva": { rutas: () => ["/solicitudes/nueva"], espera: SOLO_COMISIONISTA },
  // Ya aceptados, se pueden volver a leer.
  "/t/[org]/[clave]": { rutas: (d) => [d.tarjeta && `/t/${d.org}/${d.tarjeta}`], espera: TODOS, publica: true },
  "/tarjeta": { rutas: () => ["/tarjeta"], espera: SOLO_COMISIONISTA },
  "/terminos": { rutas: () => ["/terminos"], espera: TODOS },
  "/trabajos/[id]": { rutas: (d) => [d.trabajo && `/trabajos/${d.trabajo}`, d.porCotizar && `/trabajos/${d.porCotizar}`], espera: TODOS },
  "/trabajos/[id]/pagar": { rutas: (d) => [d.trabajoPorPagar && `/trabajos/${d.trabajoPorPagar}/pagar`], espera: COMISIONISTA_Y_STAFF },
};

// Lo que pinta una pantalla cuando una consulta falla o la página truena.
const ERROR = /No se pudo leer|No se pudieron|Application error|server-side exception|Algo salió mal|permission denied|This page couldn.t load/i;
// Un id que no existe, para las rutas de staff que a los demás los regresan al inicio antes de buscar.
const NINGUNO = "00000000-0000-4000-8000-000000000000";

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

/** Los datos para llenar las rutas, como los vería quien entra: el comisionista, lo suyo; el equipo, su liga. */
const SLUG_ORG = { XG: "xg", DEMO: "demo" } as const;

async function datosPara(correo: string, rol: Rol, orgSlug: string): Promise<Datos> {
  const db: SupabaseClient = createClient(URL_SUPABASE, SECRETA, { auth: { persistSession: false } });
  const { data: yo, error } = await db.from("personas").select("id, organizacion_activa").eq("correo", correo).single();
  if (error || !yo) throw new Error(`Datos para la prueba: no existe ${correo} (¿falta npm run demo?)`);
  const { data: laOrg } = await db.from("organizaciones").select("id").eq("slug", orgSlug).single();
  if (!laOrg) throw new Error(`Datos para la prueba: no existe la organización ${orgSlug}`);
  const org = laOrg.id as string;
  // Una consulta que falla truena la prueba: nunca se confunde con "no hay datos".
  const uno = async (consulta: PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>) => {
    const { data, error: e } = await consulta;
    if (e) throw new Error(`Datos para la prueba: ${e.message}`);
    return data?.[0]?.id ?? null;
  };
  const solicitudes = () => {
    const q = db.from("solicitudes").select("id").eq("organizacion_id", org);
    return rol === "comisionista" ? q.eq("comisionista_id", yo.id) : rol === "equipo" ? q.eq("liga_de", yo.id) : q;
  };
  const [slug, codigoMembresia, codigoComisionista, porCotizar, trabajo, trabajoPorPagar, comisionista] = await Promise.all([
    db.from("organizaciones").select("slug").eq("id", org).single(),
    db.from("membresias").select("codigo_referido").eq("persona_id", yo.id).eq("organizacion_id", org).single(),
    db.from("comisionistas").select("codigo_referido").eq("persona_id", yo.id).eq("organizacion_id", org).maybeSingle(),
    uno(solicitudes().eq("estado", "solicitada").limit(1)),
    uno(rol === "equipo" ? solicitudes().limit(1) : solicitudes().eq("estado", "tramite").not("folio", "is", null).limit(1)),
    rol === "equipo" ? Promise.resolve(NINGUNO) : uno(solicitudes().eq("estado", "tramite").is("pagado_en", null).limit(1)),
    (async () => (await db.from("comisionistas").select("persona_id").eq("organizacion_id", org).limit(1)).data?.[0]?.persona_id ?? null)(),
  ]);
  const hoy = new Date();
  const anterior = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const staff = rol === "admin_org" || rol === "finanzas";
  return {
    org: slug.data!.slug as string,
    codigo: ((codigoComisionista.data?.codigo_referido ?? codigoMembresia.data?.codigo_referido) as string | null) ?? null,
    porCotizar: staff ? porCotizar : (porCotizar ?? NINGUNO),
    trabajo,
    trabajoPorPagar,
    comisionista: comisionista ?? (staff ? null : NINGUNO),
    // solicitudes_alta está cerrada aun para la clave secreta: el staff la toma de la pantalla.
    alta: staff ? null : NINGUNO,
    tarjeta: await tarjetaPublicada(db, org),
    mesCierre: anterior,
  };
}

/**
 * El slug de una tarjeta publicada, buscada como la vería cualquiera: con la función pública (la tabla
 * está cerrada aun para la clave secreta).
 */
async function tarjetaPublicada(db: SupabaseClient, org: string): Promise<string | null> {
  const anon = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } });
  const [{ data: o }, { data: slugs }] = await Promise.all([
    db.from("organizaciones").select("slug").eq("id", org).single(),
    db.from("comisionistas").select("slug").eq("organizacion_id", org).limit(50),
  ]);
  for (const c of (slugs ?? []) as { slug: string }[]) {
    const { data } = await anon.rpc("datos_tarjeta", { p_org: o?.slug, p_clave: c.slug });
    if ((data as { disponible?: boolean } | null)?.disponible) return c.slug;
  }
  return null;
}

/** La sesión en las cookies que lee @supabase/ssr (en trozos si es larga). */
async function entrar(contexto: BrowserContext, correo: string, sitio: string): Promise<SupabaseClient> {
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
  return createClient(URL_SUPABASE, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

/**
 * La organización activa de la persona (la que la app le muestra). Si no es la que se prueba (p. ej.
 * Xchel entró a DEMO desde Plataforma), se elige la correcta con `elegir_organizacion`, como el
 * selector, y al terminar se le regresa la que tenía.
 */
async function organizacionActiva(correo: string): Promise<string | null> {
  const db = createClient(URL_SUPABASE, SECRETA, { auth: { persistSession: false } });
  const { data } = await db.from("personas").select("organizacion_activa").eq("correo", correo).single();
  return (data?.organizacion_activa as string | null) ?? null;
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

test("humo: cada ruta real tiene su expectativa", () => {
  const reales = rutasReales();
  const faltan = reales.filter((r) => !(r in PANTALLAS));
  const sobran = Object.keys(PANTALLAS).filter((r) => !reales.includes(r));
  expect(faltan, "Rutas nuevas sin expectativa en humo/humo.spec.ts").toEqual([]);
  expect(sobran, "Rutas en la prueba que ya no existen").toEqual([]);
});

for (const org of ["XG", "DEMO"] as const) {
  test(`humo: páginas públicas sin sesión (${org})`, async ({ browser }) => {
    const datos = await datosPara(QUIENES.find((q) => q.org === org && q.rol === "admin_org")!.correo, "admin_org", SLUG_ORG[org]);
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
    // DEMO tiene tarjetas publicadas: si no aparece ninguna, falta en npm run demo.
    if (org === "DEMO") expect(datos.tarjeta, "Tarjeta publicada en DEMO").not.toBeNull();
    expect(problemas).toEqual([]);
  });
}

for (const q of QUIENES) {
  test(`humo: ${q.org} ${q.rol}`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const datos = await datosPara(q.correo, q.rol, SLUG_ORG[q.org]);
    const contexto = await browser.newContext();
    const sesion = await entrar(contexto, q.correo, baseURL!);
    const db = createClient(URL_SUPABASE, SECRETA, { auth: { persistSession: false } });
    const { data: esperada } = await db.from("organizaciones").select("id").eq("slug", SLUG_ORG[q.org]).single();
    const original = await organizacionActiva(q.correo);
    const cambiada = original !== esperada?.id;
    if (cambiada) {
      const { error } = await sesion.rpc("elegir_organizacion", { p_org: esperada?.id });
      if (error) throw new Error(`No se pudo elegir ${q.org} para ${q.correo}: ${error.message}`);
    }
    const problemas: string[] = [];
    let abiertas = 0;
    try {
      const pagina = await contexto.newPage();
      if (q.rol === "admin_org" || q.rol === "finanzas") {
        await pagina.goto("/admin/altas?ver=todas");
        const ligas = pagina.locator('main a[href^="/admin/altas/"]:not([href="/admin/altas/nueva"])');
        datos.alta = (await ligas.count()) > 0 ? ((await ligas.first().getAttribute("href"))?.split("/").pop() ?? null) : null;
      }
      for (const [patron, p] of Object.entries(PANTALLAS)) {
        if (p.publica) continue;
        for (const ruta of p.rutas(datos)) {
          if (!ruta) {
            test.info().annotations.push({ type: "sin datos", description: patron });
            continue;
          }
          const espera = p.soloSuperPlataforma && q.org !== "XG" ? "inicio" : p.espera[q.rol];
          const problema = await revisar(pagina, ruta, espera);
          abiertas++;
          if (problema) problemas.push(problema);
        }
      }
      test.info().annotations.push({ type: "pantallas", description: String(abiertas) });
    } finally {
      // Se le deja la organización activa que tenía.
      if (cambiada && original) await sesion.rpc("elegir_organizacion", { p_org: original });
    }
    await contexto.close();
    // En DEMO hay datos para todo: una ruta sin datos es un hueco en `npm run demo`.
    if (q.org === "DEMO") {
      expect(test.info().annotations.filter((a) => a.type === "sin datos").map((a) => a.description), "Rutas sin datos en DEMO").toEqual([]);
    }
    expect(problemas).toEqual([]);
  });
}
