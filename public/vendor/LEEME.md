# Dependencias de las herramientas de asesor

Servidas desde Tasa (sin CDN) con versión fija. Cada archivo se bajó de cdnjs y se comprobó contra el SRI (sha512) que publica cdnjs el 27-nov-2026.

| Archivo | Versión | Origen |
|---|---|---|
| `jspdf-2.5.1/jspdf.umd.min.js` | jsPDF 2.5.1 | cdnjs `jspdf/2.5.1` |
| `qrious-4.0.2/qrious.min.js` | QRious 4.0.2 | cdnjs `qrious/4.0.2` |
| `pdfjs-3.11.174/pdf.min.js` y `pdf.worker.min.js` | pdf.js 3.11.174 | cdnjs `pdf.js/3.11.174` |
| `manrope/*.woff2` | Manrope (Google Fonts v23) | latín y latín extendido |

Para actualizar: bajar la nueva versión a una carpeta nueva con su número, comprobar el SRI y cambiar la ruta en `lib/herramientas-asesor/preparar.ts`.
