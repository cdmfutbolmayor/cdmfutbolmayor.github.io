// Utilidades compartidas: textos, fechas, escapes.

export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** plural(1,'gol','goles') → "1 gol"; plural(3,'gol','goles') → "3 goles" */
export function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** '2026-12-11' → Date local (sin corrimiento por zona horaria) */
export function parseISO(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date → '2026-12-11' */
export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function sumarDias(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** '2026-12-11' → "Viernes 11/12" */
export function fechaLarga(iso) {
  if (!iso) return '';
  const d = parseISO(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** '2026-12-11' → "viernes 11/12" */
export function fechaLargaMin(iso) {
  const t = fechaLarga(iso);
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** '2026-12-11' → "Vie 11/12" */
export function fechaCorta(iso) {
  if (!iso) return '';
  const d = parseISO(iso);
  return `${DIAS_CORTOS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** '20:30:00' → '20:30' */
export function hora(h) {
  return h ? String(h).slice(0, 5) : '';
}

/** Suma minutos a 'HH:MM' → 'HH:MM' (puede pasar de 24 → se ajusta) */
export function sumarMinutos(h, min) {
  const [hh, mm] = hora(h).split(':').map(Number);
  const total = (hh * 60 + mm + min) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Clave para ordenar por día y hora */
export function claveDiaHora(dia, h) {
  return `${String(dia).slice(0, 10)} ${hora(h)}`;
}

export function esFeriadoEspecial(iso) {
  const d = parseISO(iso);
  if (d.getMonth() === 11 && d.getDate() === 25) return 'Esta fecha cae en Navidad.';
  if (d.getMonth() === 0 && d.getDate() === 1) return 'Esta fecha cae en Año Nuevo.';
  if (d.getMonth() === 11 && d.getDate() === 24) return 'Esta fecha cae en Nochebuena.';
  if (d.getMonth() === 11 && d.getDate() === 31) return 'Esta fecha cae en la víspera de Año Nuevo.';
  return null;
}

/** Escapa texto para meterlo en HTML */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function ordinal(n) {
  return `${n}º`;
}

export function inicial(nombre) {
  const t = String(nombre || '').trim();
  return t ? t.charAt(0).toUpperCase() : '?';
}

/** Color de texto legible (blanco o negro) sobre un fondo hex */
export function textoSobre(hex) {
  const h = String(hex || '#0b2d5b').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.4 ? '#1a1a1a' : '#ffffff';
}

export function normalizarNombre(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
