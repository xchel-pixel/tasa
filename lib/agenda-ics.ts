/**
 * La liga de calendario (iCal, RFC 5545) de la Agenda (0091). Solo lo de Tasa, con folio y municipio (nunca el nombre
 * del cliente). Visitas con hora: evento de 1 hora con alarma 1 hora antes (Apple la respeta si no se quitan las
 * alertas; Google y Outlook las ignoran en calendarios suscritos). Lo demás: eventos de día completo, sin alarma.
 */

export type EventoIcs = { tipo: string; dia: string; hora: string | null; titulo: string; uid: string };

const AVISO = "Las alarmas y cambios de último momento míralos en la Agenda de Tasa.";
const DOMINIO = "tasa.xgplataform.com";

/** Escapa texto para iCal: barra invertida, punto y coma, coma y saltos de línea. */
export function escaparIcs(texto: string): string {
  return texto.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\r\n", "\\n").replaceAll("\n", "\\n");
}

/** Renglones de máximo 75 bytes; los que siguen empiezan con un espacio. */
export function plegar(renglon: string): string {
  const bytes = new TextEncoder();
  const partes: string[] = [];
  let actual = "";
  for (const ch of renglon) {
    const limite = partes.length ? 74 : 75;
    if (bytes.encode(actual + ch).length > limite) {
      partes.push(actual);
      actual = ch;
    } else actual += ch;
  }
  partes.push(actual);
  return partes.join("\r\n ");
}

const compacto = (dia: string) => dia.replaceAll("-", "");

function siguienteDia(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "2026-11-19" + "10:15:00" (México, UTC−6 todo el año) → "20261119T161500Z". */
function utc(dia: string, hora: string, masMinutos = 0): string {
  const d = new Date(`${dia}T${hora.slice(0, 5)}:00-06:00`);
  d.setUTCMinutes(d.getUTCMinutes() + masMinutos);
  return d.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/[.][0-9]{3}/, "");
}

export function construirIcs(eventos: EventoIcs[], ahora = new Date()): string {
  const sello = ahora.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/[.][0-9]{3}/, "");
  const r: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tasa//Agenda//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Tasa", "X-WR-TIMEZONE:America/Mexico_City", `X-WR-CALDESC:${escaparIcs(AVISO)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of eventos) {
    r.push("BEGIN:VEVENT", `UID:${e.uid}@${DOMINIO}`, `DTSTAMP:${sello}`);
    if (e.hora) {
      r.push(`DTSTART:${utc(e.dia, e.hora)}`, `DTEND:${utc(e.dia, e.hora, 60)}`);
    } else {
      r.push(`DTSTART;VALUE=DATE:${compacto(e.dia)}`, `DTEND;VALUE=DATE:${compacto(siguienteDia(e.dia))}`, "TRANSP:TRANSPARENT");
    }
    r.push(`SUMMARY:${escaparIcs(e.titulo)}`, `DESCRIPTION:${escaparIcs(AVISO)}`, `URL:https://${DOMINIO}/agenda?dia=${e.dia}`);
    if (e.hora && e.tipo === "visita") {
      r.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escaparIcs(e.titulo)}`, "TRIGGER:-PT1H", "END:VALARM");
    }
    r.push("END:VEVENT");
  }
  r.push("END:VCALENDAR");
  return r.map(plegar).join("\r\n") + "\r\n";
}
