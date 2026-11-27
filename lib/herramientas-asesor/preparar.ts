/**
 * Las herramientas de asesor de Alex (MGP), v3: un HTML cada una (assets/herramientas). Tasa las entrega solo con sesión,
 * por su ruta (/h/[herramienta]), y antes de entregarlas les hace estos cambios. Cada uno revisa que el original traiga
 * lo que espera: si una versión nueva de Alex cambia algo, la ruta falla con un error claro en vez de servir a medias.
 *
 *  1. Dependencias servidas desde Tasa con versión fija (public/vendor), sin CDN; la letra de Tasa (Manrope).
 *  2. Cada <script> con el nonce de la petición (la CSP de la ruta solo deja correr esos).
 *  3. Sin su encabezado propio (va dentro de Tasa); queda solo el botón "Borrar datos de este equipo".
 *  4. Antes de su script: TASA_asesor, TASA_prellenar y TASA_catastro (si la persona tiene el Mapa catastral); el
 *     borrado a las 24 h de sus borradores (mgp_*, menos mgp_asesor_v1); el registro del PDF; la altura para el marco;
 *     y el botón "Solicitar a MGP" en los consejos (solo comisionistas).
 *  5. Checklist: la fecha de revisión de requisitos sale de Ajustes.
 */

export type ClaveHerramientaAsesor = "ficha_captacion" | "checklist_documentos" | "contrato_arrendamiento" | "acta_entrega";

export const ARCHIVO: Record<ClaveHerramientaAsesor, string> = {
  ficha_captacion: "ficha-captacion.html",
  checklist_documentos: "checklist-documentos.html",
  contrato_arrendamiento: "contrato-arrendamiento.html",
  acta_entrega: "acta-entrega-recepcion.html",
};

/** Los servicios del botón "Solicitar a MGP" (su id en el catálogo de la organización). */
export type ServiciosMgp = Partial<Record<"clg" | "renta" | "regimen" | "ov", string>>;

export type Inyeccion = {
  nonce: string;
  herramienta: ClaveHerramientaAsesor;
  asesor: { nombre: string; empresa: string; telefono: string; correo: string; logo: null } | null;
  prellenar: Record<string, string> | null;
  catastro: boolean;
  /** Nulo: sin botón (no es comisionista). */
  solicitar: ServiciosMgp | null;
  /** "27 de noviembre de 2026" (checklist). */
  revisado: string | null;
};

const VENDOR: [string, string][] = [
  ["https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", "/vendor/jspdf-2.5.1/jspdf.umd.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js", "/vendor/qrious-4.0.2/qrious.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "/vendor/pdfjs-3.11.174/pdf.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", "/vendor/pdfjs-3.11.174/pdf.worker.min.js"],
];

const FUENTES_GOOGLE = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">',
];

/** Sin su encabezado (lo pone Tasa); el botón de borrar se queda, con los colores de Tasa. */
const CSS_TASA = `<style>
body{font-family:Manrope,system-ui,sans-serif!important}
header{background:none!important;color:inherit!important;padding:10px 16px 0!important;justify-content:flex-end!important;box-shadow:none!important;border:0!important}
header>div{display:none!important}
.borrar{color:#04386c!important;border-color:#d5dbe3!important;background:#fff!important}
.borrar.conf{background:#b3261e!important;border-color:#b3261e!important;color:#fff!important}
.tasa-mgp{display:inline-block;margin:6px 0 0 8px;font:inherit;font-size:13px;font-weight:700;color:#fff;background:#04386c;border:0;border-radius:8px;padding:6px 10px;cursor:pointer}
</style>`;

/** JSON seguro dentro de un <script>: sin "<" que pueda cerrar la etiqueta. */
const json = (v: unknown) => JSON.stringify(v).replaceAll("<", "\\u003c");

/** El código que va antes del script de la herramienta. Corre en el navegador; no toca nada fuera de su página. */
function conexiones(i: Inyeccion): string {
  return `
(function(){
  var CLAVE=${json(i.herramienta)};
  ${i.asesor ? `window.TASA_asesor=${json(i.asesor)};` : ""}
  ${i.prellenar ? `window.TASA_prellenar=${json(i.prellenar)};` : ""}
  ${i.catastro ? `window.TASA_catastro=function(clave){return fetch("/h/catastro?clave="+encodeURIComponent(clave),{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})};` : ""}
  // Borradores: a las 24 h se borran solos (todos los mgp_*, menos los datos del propio asesor).
  var DIA=864e5,SELLO="tasa_sello_";
  try{
    for(var k=localStorage.length-1;k>=0;k--){var n=localStorage.key(k);
      if(!n||n.indexOf("mgp_")!==0||n==="mgp_asesor_v1")continue;
      var s=Number(localStorage.getItem(SELLO+n)||0);
      if(!s||Date.now()-s>DIA){localStorage.removeItem(n);localStorage.removeItem(SELLO+n);}}
    var poner=Storage.prototype.setItem,quitar=Storage.prototype.removeItem;
    Storage.prototype.setItem=function(n,v){poner.call(this,n,v);if(this===localStorage&&String(n).indexOf("mgp_")===0&&n!=="mgp_asesor_v1"&&!localStorage.getItem(SELLO+n))poner.call(this,SELLO+n,String(Date.now()));};
    Storage.prototype.removeItem=function(n){quitar.call(this,n);if(this===localStorage&&String(n).indexOf("mgp_")===0)quitar.call(this,SELLO+n);};
  }catch(e){}
  // El PDF bajado queda en el uso de la persona (solo que lo bajó; nada del contenido).
  var clic=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){try{if(this.download&&/[.]pdf$/i.test(this.download))navigator.sendBeacon("/h/"+CLAVE+"/uso",new Blob(["pdf"],{type:"text/plain"}));}catch(e){}return clic.call(this);};
  // La altura, para que el marco de Tasa no tenga barra propia.
  function altura(){try{parent.postMessage({tasaAltura:document.documentElement.scrollHeight,herramienta:CLAVE},location.origin);}catch(e){}}
  addEventListener("load",altura);
  try{new ResizeObserver(altura).observe(document.documentElement);}catch(e){}
  ${i.solicitar ? botonMgp(i.solicitar) : ""}
})();`;
}

/** "Solicitar a MGP" junto a cada consejo que dice que MGP lo hace; abre la solicitud con el servicio ya elegido. */
function botonMgp(s: ServiciosMgp): string {
  return `
  var SERV=${json(s)};
  var TEMAS=[["clg",/libertad de gravamen/i,"Certificado de libertad de gravamen"],["renta",/justipreciaci/i,"Justipreciación de rentas"],
    ["regimen",/r[eé]gimen en condominio/i,"Régimen en condominio"],["ov",/opini[oó]n de valor|aval[uú]o MGP/i,"Opinión de valor"]];
  function campo(k){var e=document.querySelector('[data-k="'+k+'"]');return e&&e.value?String(e.value).trim():"";}
  function marcar(){
    document.querySelectorAll("li, .t, .tip, .note").forEach(function(el){
      if(el.querySelector(".tasa-mgp")||el.closest(".tasa-mgp-hecho"))return;
      var txt=el.textContent||"";if(txt.indexOf("MGP")<0)return;
      for(var t=0;t<TEMAS.length;t++){var tema=TEMAS[t];if(!SERV[tema[0]]||!tema[1].test(txt))continue;
        var b=document.createElement("button");b.type="button";b.className="tasa-mgp";b.textContent="Solicitar a MGP";
        b.addEventListener("click",function(id,nombre){return function(){
          var clave=campo("cat")||campo("in_cat")||campo("ac_cat");
          var q=new URLSearchParams({desde:"herramienta",servicio_id:id,nota:"Solicito a MGP: "+nombre+(clave?" (clave "+clave+")":"")});
          if(/^[0-9]{15}$/.test(clave))q.set("clave",clave);
          top.location.href="/solicitudes/nueva?"+q.toString();};}(SERV[tema[0]],tema[2]));
        el.classList.add("tasa-mgp-hecho");el.appendChild(b);break;}
    });
  }
  addEventListener("load",function(){marcar();new MutationObserver(marcar).observe(document.body,{childList:true,subtree:true});});`;
}

function reemplazar(html: string, buscado: string, nuevo: string, que: string): string {
  if (!html.includes(buscado)) throw new Error(`Herramienta: no se encontró ${que}`);
  return html.split(buscado).join(nuevo);
}

export function prepararHerramienta(original: string, i: Inyeccion): string {
  let html = original.split("\r\n").join("\n");
  // La letra de Google (DM Sans) se quita: va la de Tasa, servida desde Tasa.
  if (!html.includes(FUENTES_GOOGLE[2])) throw new Error("Herramienta: no se encontró la letra de Google");
  html = html.split("\n").filter((l) => !/<link[^>]*fonts[.]g(oogleapis|static)[.]com/.test(l)).join("\n");
  for (const [cdn, local] of VENDOR) if (html.includes(cdn)) html = html.split(cdn).join(local);
  if (/https:[/][/](cdnjs|cdn[.]jsdelivr|unpkg|fonts[.]g)/.test(html.replace(/https:[/][/]wa[.]me/g, ""))) {
    throw new Error("Herramienta: quedó una dependencia externa");
  }
  html = html.split('"DM Sans"').join("Manrope");
  if (i.herramienta === "checklist_documentos" && i.revisado) {
    html = reemplazar(html, 'const REV="27 de noviembre de 2026";', `const REV=${json(i.revisado)};`, "la fecha del checklist");
    html = reemplazar(html, "Requisitos revisados al <b>27 de noviembre de 2026</b>", `Requisitos revisados al <b>${i.revisado}</b>`, "el aviso de la fecha");
  }
  // Sin ningún script ajeno: solo los suyos (con nonce) y el de Tasa.
  html = html.replace(/<script(?=[ >])/g, `<script nonce="${i.nonce}"`);
  html = reemplazar(html, "</head>", `<link rel="stylesheet" href="/vendor/manrope/manrope.css">\n${CSS_TASA}\n<script nonce="${i.nonce}">${conexiones(i)}</script>\n</head>`, "el </head>");
  return html;
}

/** La CSP de la ruta: solo lo de Tasa, scripts con el nonce, nada que salga a otro sitio. */
export function cspHerramienta(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}
