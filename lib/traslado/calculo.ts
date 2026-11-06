/**
 * Gastos de traslado de dominio en Querétaro: puerto a TypeScript de las skills `gastos-traslado-qro`
 * (gastos.py, isr.py, recargos.py) e `istd-fus-sub-qro` (calc.py: ISTD). Sin tarifas propias: todo sale
 * de `Parametros` (en la base, editables en Ajustes → Parámetros fiscales; semilla en parametros-2026.json).
 * Las pruebas comparan contra docs/fuentes-traslado/casos-referencia.json (±1 peso).
 *
 * Solo servidor: los números se calculan aquí y la pantalla recibe el resultado.
 */

// ---------------------------------------------------------------- tipos

export type TramoIstd = [number, number | null, number, number];
export type TarifaIstd = {
  ley: string;
  url: string;
  estado: string;
  tipo: "tasa" | "tarifa";
  tasa?: number;
  tabla?: TramoIstd[];
  base?: "op_com" | "cat_com" | "op_com_cat";
  art?: string;
  deduccion?: string | null;
  donacion_familiar?: number;
  notas?: string[];
};

export type Parametros = {
  uma: number;
  uma_anual: number;
  salario_minimo: number;
  udi: number;
  tope_udis: number;
  tarifa_126: [number, number | null, number, number][];
  arancel_147: [number, number | null, number][];
  arancel_158: [number | null, number][];
  consejo: [number, number, number, number][];
  recargos: Record<string, number[]>;
  inpc: Record<string, number>;
  istd: Record<string, TarifaIstd>;
};

export type Mejora = { monto: number; fecha: string; comprobante?: "cfdi" | "aviso" | "avaluo" };
export type Gasto = { monto: number; fecha?: string; concepto?: string };
export type DatosIsr = {
  fecha_adq: string;
  costo_adq: number;
  costo_terreno?: number | null;
  pct_terreno?: number | null;
  mejoras?: Mejora[];
  gastos?: Gasto[];
  casa_habitacion?: boolean;
  fecha_mejora_cero?: string | null;
};
export type Extemporaneo = {
  fecha_operacion: string;
  /** 0: se estima el valor referido con INPC desde el avalúo actual (LH art. 69). */
  valor: number;
  tasa_pct: number;
  adicional_25?: boolean;
  actualizar?: boolean;
  tope_meses?: number;
};

export type Caso = {
  lado: "C" | "V" | "ambos" | "AMBOS";
  municipio: string;
  fecha_firma: string;
  referencia?: string;
  /** Solo para prellenar la solicitud del avalúo; el cálculo no la usa. */
  clave_catastral?: string;
  operacion?: "compraventa" | "donacion" | "herencia";
  donacion_exenta?: boolean;
  valor_operacion: number;
  avaluo: number;
  valor_catastral?: number;
  comprador?: { vivienda_primera?: null | "social" | "popular"; incluir_avaluo?: boolean; certificados_gravamen?: number };
  vendedor?: { isr?: DatosIsr | null; cancelar_hipoteca?: number };
  extemporaneo?: Extemporaneo | null;
  detalle?: boolean;
};

export type Concepto = [grupo: string, concepto: string, importe: number];

export type Resultado = {
  lado: "C" | "V" | "AMBOS";
  municipio: string;
  fecha: string;
  vo: number;
  va: number;
  vk: number;
  C: Concepto[];
  V: Concepto[];
  totC: number;
  totV: number;
  det: [string, string[]][];
  notas: string[];
  mejora: [number, string] | null;
  ley_istd: string;
  SC: string[];
  SV: string[];
};

// ---------------------------------------------------------------- utilidades (como en Python)

const IVA = 0.16;
/** round() de Python a 2 decimales (con el mismo empujón de calc.py). */
const r2 = (x: number) => Math.round((x + 1e-9) * 100) / 100;
const m = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const g = (x: number) => String(Number(x.toFixed(10)));
const mesDe = (f: string) => f.slice(0, 7);
const mesAnterior = (mm: string) => {
  const a = Number(mm.slice(0, 4)), n = Number(mm.slice(5, 7));
  return n === 1 ? `${a - 1}-12` : `${a}-${String(n - 1).padStart(2, "0")}`;
};
const ultimoInpc = (p: Parametros, mm: string) =>
  mm in p.inpc ? mm : Object.keys(p.inpc).filter((k) => k <= mm).sort().at(-1)!;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** El municipio con tarifa: exacto, luego "empieza con", luego "contiene" (como norm() de calc.py). */
export function municipio(p: Parametros, nombre: string): string {
  const q = sinAcentos(nombre.trim());
  for (const regla of [(k: string) => k === q, (k: string) => k.startsWith(q), (k: string) => k.includes(q)]) {
    const hits = Object.keys(p.istd).filter((k) => regla(sinAcentos(k)));
    if (hits.length === 1) return hits[0];
  }
  throw new Error(`No hay tarifa de ISTD para "${nombre}".`);
}

/** Municipio por los dos primeros dígitos de la clave catastral. */
const POR_CLAVE: Record<string, string> = {
  "01": "Amealco de Bonfil", "02": "Pinal de Amoles", "03": "Arroyo Seco", "04": "Cadereyta de Montes", "05": "Colón",
  "06": "Corregidora", "07": "Ezequiel Montes", "08": "Huimilpan", "09": "Jalpan de Serra", "10": "Landa de Matamoros",
  "11": "El Marqués", "12": "Pedro Escobedo", "13": "Peñamiller", "14": "Querétaro", "15": "San Joaquín",
  "16": "San Juan del Río", "17": "Tequisquiapan", "18": "Tolimán",
};
/** La clave como se guarda: solo dígitos y guiones ("14 01 001…" → "14010010…"), hasta 40. */
export function limpiarClave(clave: string): string {
  return clave.replace(/[^\d-]/g, "").slice(0, 40);
}

export function municipioPorClave(clave: string): string | null {
  return POR_CLAVE[clave.replace(/\D/g, "").slice(0, 2)] ?? null;
}

// ---------------------------------------------------------------- ISTD (calc.py)

function tarifaIstd(ist: TarifaIstd, base: number): [number, string] {
  if (base <= 0) return [0, "—"];
  if (ist.tipo === "tasa") return [base * ist.tasa!, `${g(ist.tasa! * 100)} % × ${m(base)}`];
  for (const [li, ls, cf, fac] of ist.tabla!) {
    if (ls === null || base <= ls + 0.0049) {
      const exc = Math.max(0, base - li);
      return [cf + exc * fac, `cuota fija ${m(cf)} + (${m(base)} − ${m(li)}) × ${fac}`];
    }
  }
  throw new Error("Base fuera de la tarifa del ISTD.");
}

function deduccionIstd(p: Parametros, clave: string | null | undefined, base: number, vivienda: string | null | undefined): [number, string] {
  if (!vivienda || !clave) return [base, ""];
  const { salario_minimo: SM, uma_anual: UA } = p;
  if (clave === "LH") {
    const tope = (vivienda === "social" ? 20 : 30) * SM * 365;
    if (base > tope) return [base, `No aplica deducción: el valor excede el tope de vivienda ${vivienda} (${m(tope)}).`];
    const d = 15 * SM * 365;
    return [Math.max(0, base - d), `Deducción LH art. 60: 15 VSMGZ anuales = ${m(d)} (salario mínimo ${SM}; verificar si Tesorería aplica UMA).`];
  }
  if (clave === "COLON") {
    const tope = vivienda === "social" ? 1_500_000 : 2_000_000;
    if (base > tope) return [base, `No aplica reducción: el valor excede ${tope.toLocaleString("en-US")}.`];
    return [base * 0.5, "Reducción art. 49 fr. II num. 13: base al 50 % (primera adquisición)."];
  }
  if (clave === "CADEREYTA") {
    if (vivienda !== "social") return [base, "La reducción de Cadereyta solo es para vivienda de interés social."];
    const tope = 22 * UA;
    if (base > tope) return [base, `No aplica: el valor excede 22 UMA anuales (${m(tope)}).`];
    return [base * 0.5, 'Deducción art. 48 fr. II num. 6: "hasta" 50 % de la base (se toma el máximo; confirmar).'];
  }
  if (clave === "CORREGIDORA") {
    const tope = vivienda === "social" ? 908_514 : 1_362_771;
    if (base > tope) return [base, `No aplica deducción: el valor excede el tope de vivienda ${vivienda} (${tope.toLocaleString("en-US")}).`];
    return [Math.max(0, base - 681_386), "Deducción art. 50 fr. II num. 23: $681,386.00 (primera adquisición)."];
  }
  if (clave === "SIETE_UMA_SIN_TOPE") {
    const d = 7 * UA;
    return [Math.max(0, base - d), `Reducción de 7 UMA anuales = ${m(d)} (primera adquisición; la ley no define tope de valor, confirmar).`];
  }
  if (clave === "EZEQUIEL" || clave === "TOLIMAN" || clave === "SIETE_UMA") {
    const tope = (vivienda === "social" ? 15 : 30) * UA;
    if (base > tope) return [base, `No aplica deducción: el valor excede el tope de vivienda ${vivienda} (${m(tope)}).`];
    const d = 7 * UA;
    return [Math.max(0, base - d), `Deducción de 7 UMA anuales = ${m(d)} (primera adquisición).`];
  }
  return [base, ""];
}

type DatosIstd = { valor_operacion: number; valor_comercial: number; valor_catastral: number; vivienda_primera?: string | null; donacion_familiar?: boolean };

function calcIstd(p: Parametros, ist: TarifaIstd, d: DatosIstd) {
  const vo = d.valor_operacion || 0, vc = d.valor_comercial || 0, vk = d.valor_catastral || 0;
  const cands: Record<string, number> = {
    op_com: { operación: vo, comercial: vc }, cat_com: { catastral: vk, comercial: vc }, op_com_cat: { operación: vo, comercial: vc, catastral: vk },
  }[ist.base ?? "op_com"] as unknown as Record<string, number>;
  const entradas = Object.entries(cands);
  const [cual, base] = entradas.reduce((a, b) => (b[1] > a[1] ? b : a));
  const lista = entradas.map(([k, v]) => `${k} $${m(v)}`);
  const enumeradas = lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}` : lista[0];
  const tomada = ({ operación: "la operación", comercial: "el valor comercial", catastral: "el valor catastral" } as Record<string, string>)[cual];
  const pasos = [`Base: el mayor entre ${enumeradas}: se toma ${tomada}.`];
  const [base2, txt] = deduccionIstd(p, ist.deduccion, base, d.vivienda_primera);
  if (txt) pasos.push(txt);
  const [bruto, form] = tarifaIstd(ist, base2);
  let imp = bruto;
  if (d.donacion_familiar && ist.donacion_familiar) {
    imp *= ist.donacion_familiar;
    pasos.push(`Donación entre cónyuges o línea recta: reducción del ${g((1 - ist.donacion_familiar) * 100)} % sobre el impuesto.`);
  }
  return { fundamento: ist.art ?? "", base: r2(base2), formula: form, importe: r2(imp), pasos, notas: [...(ist.notas ?? [])] };
}

// ---------------------------------------------------------------- recargos (recargos.py)

function tasaRecargo(p: Parametros, anio: number, mes: number) {
  const anios = Object.keys(p.recargos).map(Number);
  return (p.recargos[String(anio)] ?? p.recargos[String(Math.max(...anios))])[mes - 1];
}
export function factorRecargos(p: Parametros, anio: number, mes: number, meses: number, tope = 60) {
  let s = 0, a = anio, mm = mes;
  for (let i = 0; i < Math.min(meses, tope); i++) {
    s += tasaRecargo(p, a, mm);
    mm += 1;
    if (mm === 13) { a += 1; mm = 1; }
  }
  return Math.round(s * 100) / 100;
}

// ---------------------------------------------------------------- ISR (isr.py)

/** Factor de actualización INPC(mes anterior a la venta) / INPC(mes de origen), truncado a 4 decimales (CFF 17-A). */
function fa(p: Parametros, origen: string, venta: string): [number, string, string] {
  const md = ultimoInpc(p, mesAnterior(mesDe(venta)));
  const mo = ultimoInpc(p, mesDe(origen));
  return [Math.floor((p.inpc[md] / p.inpc[mo]) * 10000) / 10000, mo, md];
}
function aniosCompletos(f1: string, f2: string) {
  const [a1, m1, d1] = f1.split("-").map(Number), [a2, m2, d2] = f2.split("-").map(Number);
  const antes = m2 < m1 || (m2 === m1 && d2 < d1);
  return Math.max(1, a2 - a1 - (antes ? 1 : 0));
}
function tarifa126(p: Parametros, gan: number): [number, [number, number, number]] {
  for (const [li, ls, cf, pct] of p.tarifa_126) if (ls === null || gan <= ls) return [cf + ((gan - li) * pct) / 100, [li, cf, pct]];
  throw new Error("Ganancia fuera de la tarifa del art. 126.");
}

type DatosEnajenacion = DatosIsr & { precio: number };

export function isrEnajenacion(p: Parametros, d: DatosEnajenacion, venta: string) {
  const I = Number(d.precio), pasos: string[] = [];
  const n = aniosCompletos(d.fecha_adq, venta), n20 = Math.min(n, 20);
  const [f, mo, md] = fa(p, d.fecha_adq, venta);
  const C = Number(d.costo_adq || 0);
  const T = d.costo_terreno !== null && d.costo_terreno !== undefined ? Number(d.costo_terreno) : (C * Number(d.pct_terreno || 20)) / 100;
  const K = C - T;
  const dep = Math.max(1 - 0.03 * n, 0.2), Kd = K * dep;
  const Tact = T * f, Kact = Kd * f;
  pasos.push(`Adquisición ${d.fecha_adq} · enajenación ${venta} · ${n} año(s) (se usan ${n20}).`);
  pasos.push(`Factor de actualización INPC ${md} / ${mo} = ${f.toFixed(4)}.`);
  pasos.push(`Terreno $${m(T)} × ${f.toFixed(4)} = $${m(Tact)}.`);
  if (K > 0) pasos.push(`Construcción $${m(K)} − depreciación ${(Math.min(0.03 * n, 0.8) * 100).toFixed(0)} % = $${m(Kd)} × ${f.toFixed(4)} = $${m(Kact)}.`);
  let mej = 0;
  for (const x of d.mejoras ?? []) {
    const nm = aniosCompletos(x.fecha, venta), [fm] = fa(p, x.fecha, venta);
    const comp = (x.comprobante || "cfdi").toLowerCase();
    const monto = Number(x.monto) * (comp === "avaluo" ? 0.8 : 1);
    const v = monto * Math.max(1 - 0.03 * nm, 0.2) * fm;
    mej += v;
    const etq = { cfdi: "CFDI", aviso: "aviso de terminación de obra", avaluo: "avalúo referido, 80 %" }[comp] ?? comp;
    pasos.push(`Mejora ${x.fecha} (${etq}) ${m(Number(x.monto))}, depreciada y actualizada: ${m(v)}.`);
  }
  let costo = Tact + Kact + mej;
  if (costo < 0.1 * I) {
    pasos.push(`Costo actualizado menor al 10 % del precio: se toma $${m(0.1 * I)} (art. 121 fr. I).`);
    costo = 0.1 * I;
  }
  let gas = 0;
  for (const x of d.gastos ?? []) {
    const [fg] = fa(p, x.fecha || venta, venta), v = Number(x.monto) * fg;
    gas += v;
    pasos.push(`Gasto deducible (${x.concepto || "gasto"}) actualizado = $${m(v)}.`);
  }
  const D = costo + gas;
  let G = I - D;
  if (d.casa_habitacion) {
    const tope = p.tope_udis * p.udi, exc = Math.max(0, I - tope);
    G = exc > 0 ? exc - D * (exc / I) : 0;
    pasos.push(`Casa habitación exenta hasta ${p.tope_udis.toLocaleString("en-US")} UDIS ($${m(tope)}); excedente gravado $${m(exc)}.`);
  }
  pasos.push(`Ingreso $${m(I)} − deducciones ${m(D)} = ganancia gravable ${m(Math.max(G, 0))}.`);
  if (G <= 0) return { ganancia: 0, isr126: 0, estatal: 0, federal: 0, pasos: [...pasos, "Sin ganancia: no hay pago provisional."], deducciones: D, ingreso: I, n: n20 };
  const g1 = G / n20, [i1, [li, cf, pct]] = tarifa126(p, g1), isr = i1 * n20;
  pasos.push(`Ganancia / ${n20} años = ${m(g1)}; cuota fija ${m(cf)} + ($${m(g1)} − $${m(li)}) × ${pct} % = $${m(i1)} × ${n20} = $${m(isr)}.`);
  const est = Math.min(0.05 * G, isr), fed = isr - est;
  pasos.push(`Pago al Estado (art. 127): 5 % × ganancia = $${m(est)}; pago federal = $${m(fed)}.`);
  return { ganancia: G, isr126: isr, estatal: est, federal: fed, pasos, deducciones: D, ingreso: I, n: n20 };
}

/** Mejoras comprobables (a la fecha indicada) que dejarían la ganancia en cero. */
function mejoraParaCero(p: Parametros, d: DatosEnajenacion, venta: string, fechaMejora?: string | null): [number, string] {
  const r = isrEnajenacion(p, { ...d, mejoras: [...(d.mejoras ?? [])] }, venta);
  const fecha = fechaMejora || d.fecha_adq;
  if (r.ganancia <= 0) return [0, fecha];
  const nm = aniosCompletos(fecha, venta), [fm] = fa(p, fecha, venta), k = Math.max(1 - 0.03 * nm, 0.2) * fm;
  return [Math.ceil((r.ingreso - r.deducciones) / k / 100) * 100, fecha];
}

/** Costo de adquisición (referido a la fecha de adquisición) que dejaría la ganancia en cero, misma proporción de terreno. */
function costoReferidoParaCero(p: Parametros, d: DatosEnajenacion, venta: string) {
  const I = Number(d.precio), n = aniosCompletos(d.fecha_adq, venta), [f] = fa(p, d.fecha_adq, venta);
  const C = Number(d.costo_adq || 0);
  const pt = d.costo_terreno !== null && d.costo_terreno !== undefined && C ? Number(d.costo_terreno) / C : Number(d.pct_terreno || 20) / 100;
  let otros = 0;
  for (const x of d.mejoras ?? []) {
    const nm = aniosCompletos(x.fecha, venta), [fm] = fa(p, x.fecha, venta);
    otros += Number(x.monto) * ((x.comprobante || "").toLowerCase() === "avaluo" ? 0.8 : 1) * Math.max(1 - 0.03 * nm, 0.2) * fm;
  }
  for (const x of d.gastos ?? []) otros += Number(x.monto) * fa(p, x.fecha || venta, venta)[0];
  const k = f * (pt + (1 - pt) * Math.max(1 - 0.03 * n, 0.2));
  return Math.max(0, Math.ceil((I - otros) / k / 1000) * 1000);
}

function isrAdquisicion(precio: number, avaluo: number, donacion: boolean, exenta: boolean): [number, string] {
  if (donacion) {
    if (exenta) return [0, "Donación exenta (art. 93 fr. XXIII: cónyuges o línea recta)."];
    return [0.2 * avaluo, `Donación: 20 % × avalúo $${m(avaluo)} (art. 132).`];
  }
  if (avaluo > 1.1 * precio) {
    const dif = avaluo - precio;
    return [0.2 * dif, `Avalúo excede en más de 10 % el precio: 20 % × diferencia $${m(dif)} (arts. 125 y 132).`];
  }
  return [0, "Avalúo no excede en más de 10 % el precio: no hay ISR por adquisición."];
}

// ---------------------------------------------------------------- arancel, avalúo, derechos (gastos.py)

function honorarios147(p: Parametros, valor: number): [number, string] {
  const u = valor / p.uma, fija = u <= 200 ? 18 : 36;
  let variable = 0;
  for (const [a, b, t] of p.arancel_147) if (u > a) variable += ((Math.min(u, b ?? Infinity) - a) * t) / 1000;
  return [(fija + variable) * p.uma, `${fija} UMA fijas + ${m(variable)} UMA progresivas sobre ${u.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} UMA`];
}
function honorarios158(p: Parametros, monto: number) {
  const u = monto / p.uma;
  return p.arancel_158.find(([t]) => t === null || u <= t)![1] * p.uma;
}
/** Arancel del Consejo (tabulador AP73, incluye folio), sobre el valor redondeado a miles hacia arriba. */
function avaluoHacendario(p: Parametros, valor: number) {
  const v = Math.ceil(valor / 1000) * 1000, ua = v / (p.uma * 364.8);
  const t = ua > 0 ? p.consejo.filter((x) => x[0] < ua).at(-1)! : p.consejo[0];
  return Math.max(3500, Math.ceil((t[2] * p.uma + (v * t[3]) / 1000) / 100) * 100);
}
function noAdeudo(p: Parametros, mun: string): number | null {
  return ({ "Querétaro": 1.25 * p.uma, "Corregidora": 200, "El Marqués": 3 * p.uma } as Record<string, number>)[mun] ?? null;
}
function rppc(p: Parametros, valor: number, social: boolean): [number, string] {
  if (social) return [5 * p.uma, "Vivienda de interés social o popular: cuota fija 5 UMA (LHEQ, transitorio 2026)"];
  return [Math.max((valor * 7.5) / 1000, 3.75 * p.uma), `7.5 al millar sobre ${m(valor)} (LHEQ arts. 90, 97 y 110)`];
}

// ---------------------------------------------------------------- extemporáneo (LH arts. 67, 69, 71; CFEQ 44)

function valorReferido(p: Parametros, actual: number, fechaRef: string) {
  const mo = mesDe(fechaRef), md = Object.keys(p.inpc).sort().at(-1)!, f = p.inpc[md] / p.inpc[mo];
  return { v: actual / f, f, mo, md };
}

function istdExtemporaneo(p: Parametros, x0: Extemporaneo, fechaPago: string, valorActual: number) {
  let x = x0;
  const pre: string[] = [];
  if (!x.valor) {
    const { v, f, mo, md } = valorReferido(p, valorActual, x.fecha_operacion);
    x = { ...x, valor: Math.round(v * 100) / 100 };
    pre.push(`Valor referido estimado a ${mo}: $${m(valorActual)} ÷ factor INPC ${md}/${mo} = ${f.toFixed(4)}; valor referido ${m(v)} (LH art. 69; el definitivo lo da el avalúo referido).`);
  }
  let imp = (Number(x.valor) * Number(x.tasa_pct)) / 100;
  const pasos = [...pre, `ISTD original: ${x.tasa_pct} % × $${m(Number(x.valor))} = $${m(imp)} (tasa vigente a la fecha de la operación).`];
  if (x.adicional_25) {
    const ad = imp * 0.25;
    imp += ad;
    pasos.push(`Impuesto adicional para educación y obras públicas 25 % = $${m(ad)}.`);
  }
  const fo = new Date(`${x.fecha_operacion}T12:00:00Z`);
  const venc = new Date(fo.getTime() + 21 * 864e5); // ~15 días hábiles (LH art. 71)
  const fp = new Date(`${fechaPago}T12:00:00Z`);
  let act = 0;
  if (x.actualizar !== false) {
    const ant = (d: Date) => (d.getUTCMonth() === 0 ? `${d.getUTCFullYear() - 1}-12` : `${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, "0")}`);
    const md = Object.keys(p.inpc).filter((k) => k <= ant(fp)).sort().at(-1)!, mo = ant(fo);
    const f = Math.floor((p.inpc[md] / p.inpc[mo]) * 10000) / 10000;
    act = imp * (f - 1);
    pasos.push(`Actualización INPC ${md} / ${mo} = ${f.toFixed(4)}; actualización ${m(act)}.`);
  }
  const meses = (fp.getUTCFullYear() - venc.getUTCFullYear()) * 12 + fp.getUTCMonth() - venc.getUTCMonth();
  const tope = Number(x.tope_meses || 60);
  const fr = factorRecargos(p, venc.getUTCFullYear(), venc.getUTCMonth() + 1, meses, tope);
  const rec = ((imp + act) * fr) / 100;
  const mmVenc = `${String(venc.getUTCMonth() + 1).padStart(2, "0")}/${venc.getUTCFullYear()}`;
  pasos.push(`Recargos: suma de tasas de mora desde ${mmVenc} por ${Math.min(meses, tope)} meses (tope ${tope}) = ${fr.toFixed(2)} %; recargos ${m(rec)}.`);
  return { imp, act, rec, pasos };
}

// ---------------------------------------------------------------- cálculo completo (gastos.calcular)

export function calcular(c: Caso, p: Parametros): Resultado {
  const ladoTxt = (c.lado || "ambos").toUpperCase();
  const lado: Resultado["lado"] = ladoTxt === "C" || ladoTxt === "V" ? ladoTxt : "AMBOS";
  const mun = municipio(p, c.municipio), ist = p.istd[mun];
  const ff = c.fecha_firma || new Date().toISOString().slice(0, 10);
  const vo = Number(c.valor_operacion || 0), va = Number(c.avaluo || 0), vk = Number(c.valor_catastral || 0);
  const baseMax = Math.max(vo, va, vk);
  const C: Concepto[] = [], V: Concepto[] = [], det: [string, string[]][] = [], SC: string[] = [], SV: string[] = [];
  let notas: string[] = [];
  const comp = c.comprador ?? {}, vend = c.vendedor ?? {};
  const UMA = p.uma;

  if (lado === "C" || lado === "AMBOS") {
    const ext = c.extemporaneo;
    if (ext) {
      const { imp, act, rec, pasos } = istdExtemporaneo(p, ext, ff, va || vo);
      C.push(["Impuestos", "Impuesto sobre traslado de dominio (ISTD)", imp], ["Impuestos", "Actualización del ISTD", act], ["Impuestos", "Recargos del ISTD", rec]);
      det.push(["ISTD extemporáneo", pasos]);
    } else {
      const r = calcIstd(p, ist, {
        valor_operacion: vo, valor_comercial: va, valor_catastral: vk, vivienda_primera: comp.vivienda_primera,
        donacion_familiar: c.operacion === "donacion" && Boolean(c.donacion_exenta),
      });
      C.push(["Impuestos", "Impuesto sobre traslado de dominio (ISTD)", r.importe]);
      det.push([`ISTD · ${mun} (${r.fundamento})`, [...r.pasos, `Cálculo: ${r.formula} = $${m(r.importe)}.`]]);
      notas = notas.concat(r.notas);
    }
    const [ia, txt] = isrAdquisicion(vo, va, c.operacion === "donacion", Boolean(c.donacion_exenta));
    if (ia) C.push(["Impuestos", "ISR por adquisición", ia]);
    det.push(["ISR por adquisición", [txt]]);
    if (ext) {
      const hoy = calcIstd(p, ist, { valor_operacion: vo, valor_comercial: va, valor_catastral: vk }).importe;
      const totExt = C.filter(([, k]) => k.includes("ISTD")).reduce((s, [, , v]) => s + v, 0);
      SC.push(`Comparativo: ISTD extemporáneo con valor referido, actualización y recargos $${m(totExt)} frente a ISTD calculado a valor actual $${m(hoy)}. `
        + "La fecha de causación la determinan los documentos (contrato privado, resolución); el notario decide con base en ellos.");
      SC.push(`Se requiere <b>avalúo hacendario referido a la fecha de la operación</b> (${ext.fecha_operacion}): el ISTD se causa con el valor de esa fecha (LH arts. 65 y 69).`);
    }
    if (c.operacion === "herencia") SC.push("En adjudicación por herencia, el avalúo hacendario debe estar <b>referido a la fecha de adjudicación</b>.");
    if (c.operacion !== "donacion" && vo) {
      const tope = vo * 1.1;
      if (ia) SC.push(`El avalúo excede en más de 10 % el precio y genera ISR por adquisición de $${m(ia)}. Con un avalúo de hasta <b>$${m(tope)}</b> (110 % del precio) no se causa.`);
      else if (va && va < vo) SC.push("El avalúo es menor al precio: el ISTD y los derechos se calculan sobre el precio pactado.");
      else if (va > vo) SC.push(`El ISTD y los derechos se calculan sobre el avalúo ($${m(va)}), mayor al precio. Un avalúo igual al precio ($${m(vo)}) los reduciría; el avalúo debe reflejar el valor real.`);
    }
    const [h, htxt] = honorarios147(p, baseMax), gi = 4 * UMA;
    C.push(["Honorarios notariales", "Honorarios por la escritura", h], ["Honorarios notariales", "Trámite de inscripción en el Registro Público", gi],
      ["Honorarios notariales", "IVA de honorarios (16 %)", (h + gi) * IVA]);
    det.push(["Honorarios notariales (Ley del Notariado, arts. 147 y 171-V)", [`Base: el mayor entre operación, comercial y fiscal = $${m(baseMax)}.`, `${htxt} = $${m(h)}.`, `Trámite de inscripción 4 UMA = $${m(gi)}.`]]);
    const social = (comp.vivienda_primera === "social" || comp.vivienda_primera === "popular") && baseMax <= 30 * p.uma_anual;
    const [dr, dtxt] = rppc(p, Math.max(vo, va) || vk, social);
    const ncert = Number(comp.certificados_gravamen || 1);
    C.push(["Derechos y trámites", "Inscripción en el Registro Público", dr], ["Derechos y trámites", "Avisos preventivo y definitivo", 6 * UMA],
      ["Derechos y trámites", "Certificado de libertad de gravamen", 5 * UMA * ncert]);
    det.push(["Registro Público de la Propiedad (LHEQ)", [`${dtxt} = $${m(dr)}.`, `Avisos preventivo (4 UMA) y definitivo (2 UMA) = $${m(6 * UMA)}.`, `Certificado de libertad de gravamen 5 UMA × ${ncert} = $${m(5 * UMA * ncert)}.`]]);
    if (comp.incluir_avaluo !== false) {
      const a = avaluoHacendario(p, va || vo);
      C.push(["Derechos y trámites", "Avalúo hacendario (incluye folio)", a], ["Derechos y trámites", "IVA del avalúo (16 %)", a * IVA]);
      det.push(["Avalúo hacendario", [`Arancel del Consejo de Valuadores sobre $${m(va || vo)} = $${m(a)} + IVA (incluye derechos de folio).`]]);
    }
  }

  let mejora: [number, string] | null = null;
  if (lado === "V" || lado === "AMBOS") {
    const x = vend.isr;
    if (x) {
      const d: DatosEnajenacion = { ...x, precio: vo || va };
      const r = isrEnajenacion(p, d, ff);
      V.push(["Impuestos", "ISR por enajenación · pago federal", r.federal], ["Impuestos", "ISR por enajenación · pago al Estado (5 %)", r.estatal]);
      det.push(["ISR por enajenación (LISR arts. 119-127)", r.pasos]);
      if (r.ganancia > 0) {
        const [mej, fm] = mejoraParaCero(p, d, ff, x.fecha_mejora_cero);
        mejora = [mej, fm];
        const cref = costoReferidoParaCero(p, d, ff), isrTot = r.federal + r.estatal, conAvaluo = Math.ceil(mej / 0.8 / 100) * 100;
        SV.push(`<b>Mejoras para no causar ISR</b> (ISR estimado $${m(isrTot)}): con CFDI o aviso de terminación de obra por <b>$${m(mej)}</b> (fecha ${fm}); `
          + `si se comprueban con avalúo referido a la terminación de la obra, el valor de construcciones del avalúo debe ser de <b>$${m(conAvaluo)}</b> (se reconoce el 80 %, RLISR art. 205).`);
        SV.push(`<b>Valor referido a la fecha de adquisición</b> (${x.fecha_adq}) que dejaría el ISR en cero: <b>$${m(cref)}</b> `
          + `(costo capturado $${m(Number(x.costo_adq || 0))}). Solo procede cuando el costo no se puede comprobar con escritura (herencia o donación sin costo conocido, prescripción); si la escritura consigna el costo, ese es el que se deduce.`);
        det.push(["Mejoras y valor referido para no causar ISR", [
          `Mejoras comprobables (CFDI o aviso) de aprox. $${m(mej)} con fecha ${fm}; con avalúo referido (80 %), aprox. $${m(conAvaluo)}.`,
          `Costo de adquisición referido de aprox. $${m(cref)} a ${x.fecha_adq} (misma proporción de terreno).`,
          "Las mejoras deben ser inversiones reales en construcción, mejoras o ampliaciones (no conservación).",
        ]]);
      }
      if (!Number(x.costo_adq || 0)) {
        SV.push(`No hay costo de adquisición comprobado: se requiere <b>avalúo referido a la fecha de adquisición</b> (${x.fecha_adq}); sin él, la ley solo reconoce como costo el 10 % del precio.`);
      }
      if ((x.costo_terreno === null || x.costo_terreno === undefined) && !x.pct_terreno) {
        SV.push("La escritura no separa terreno y construcción: se tomó 20 % terreno. Un avalúo referido a la fecha de adquisición o los valores catastrales de esa fecha pueden dar otra proporción (RLISR art. 209).");
      }
      if ((x.mejoras ?? []).some((mm) => (mm.comprobante || "cfdi") === "avaluo")) {
        SV.push("Mejoras comprobadas con avalúo referido a la fecha de terminación: se reconoce el 80 % del valor de las construcciones.");
      }
      const h = 3 * UMA;
      V.push(["Honorarios notariales", "Liquidaciones fiscales del vendedor", h], ["Honorarios notariales", "IVA de honorarios (16 %)", h * IVA]);
    }
    if (vend.cancelar_hipoteca) {
      const hc = honorarios158(p, Number(vend.cancelar_hipoteca));
      V.push(["Honorarios notariales", "Cancelación de hipoteca", hc], ["Honorarios notariales", "IVA cancelación (16 %)", hc * IVA],
        ["Derechos y trámites", "Registro de la cancelación de hipoteca", 4 * UMA]);
    }
    const na = noAdeudo(p, mun);
    if (na !== null) V.push(["Derechos y trámites", "Constancia de no adeudo de predial", na]);
    else notas.push("Constancia de no adeudo de predial: costo no incluido para este municipio.");
    notas.push("Constancia de no adeudo de agua: costo no incluido.");
  }

  const Cf = C.map(([gg, k, v]): Concepto => [gg, k, r2(v)]).filter(([, , v]) => v > 0);
  const Vf = V.map(([gg, k, v]): Concepto => [gg, k, r2(v)]).filter(([, k, v]) => v > 0 || k.includes("ISR"));
  if (ist.estado !== "verificado") notas.push(`Tarifa de ISTD de ${mun} marcada como parcial; confirmar con Tesorería.`);
  return {
    lado, municipio: mun, fecha: ff, vo, va, vk, C: Cf, V: Vf,
    totC: r2(Cf.reduce((s, [, , v]) => s + v, 0)), totV: r2(Vf.reduce((s, [, , v]) => s + v, 0)),
    det, notas: [...new Set(notas)], mejora, ley_istd: ist.ley, SC, SV,
  };
}
