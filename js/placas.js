// Placas para WhatsApp (1080×1350 PNG), dibujadas en canvas en el mismo celular.
import {
  cfg, calcularTabla, calcularGoleadores, fechasOrdenadas, ganadorPartido, armarCruces, hayPlayoff, NOMBRE_RONDA,
  nombreCruce, esReprogramado, tieneResultado,
} from './calculos.js';
import { itemsDeFecha } from './fixture.js';
import { fechaLarga, fechaLargaMin, hora, inicial, textoSobre, toISO } from './util.js';
import { golesPorLado, hayPenales, mapaEquipos, nombreLado } from './ui.js';
import { SITIO } from './config.js';

const W = 1080;
const H = 1350;
const AZUL = '#0b2d5b';
const CLARO = '#b8c9e3';
const TIT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const TXT = 'Inter, system-ui, sans-serif';

// ── Recursos ───────────────────────────────────────────────

const imagenes = new Map();
function cargarImagen(src) {
  if (!src) return Promise.resolve(null);
  if (imagenes.has(src)) return imagenes.get(src);
  const p = new Promise((ok) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
  imagenes.set(src, p);
  return p;
}

async function prepararFuentes() {
  if (!document.fonts) return;
  await Promise.all([
    document.fonts.load(`700 76px ${TIT}`),
    document.fonts.load(`600 40px ${TIT}`),
    document.fonts.load(`400 30px ${TXT}`),
    document.fonts.load(`600 30px ${TXT}`),
    document.fonts.load(`700 30px ${TXT}`),
  ].map((p) => p.catch(() => {})));
  await document.fonts.ready;
}

async function precargarEscudos(equipos) {
  await Promise.all(equipos.filter((e) => e && e.escudo_url).map((e) => cargarImagen(e.escudo_url)));
}

// ── Dibujo ─────────────────────────────────────────────────

function rect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fill();
}

function fuente(ctx, peso, tam, fam = TXT) {
  ctx.font = `${peso} ${tam}px ${fam}`;
}

/** Escribe texto achicándolo (y si hace falta cortándolo con …) para que entre en maxW. */
function texto(ctx, t, x, y, { maxW = 9999, tam = 30, peso = 600, fam = TXT, color = '#1a1a1a', align = 'left', min = 18 } = {}) {
  t = String(t ?? '');
  let s = tam;
  fuente(ctx, peso, s, fam);
  while (s > min && ctx.measureText(t).width > maxW) { s -= 1; fuente(ctx, peso, s, fam); }
  let out = t;
  if (ctx.measureText(out).width > maxW) {
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
    out += '…';
  }
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(out, x, y);
  return s;
}

function dibujarEscudo(ctx, eq, cx, cy, d) {
  const img = eq && eq.escudo_url ? imagenesListas.get(eq.escudo_url) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.closePath();
  if (img) {
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(img, cx - d / 2, cy - d / 2, d, d);
  } else {
    const color = (eq && eq.color) || '#98a2b0';
    ctx.fillStyle = color;
    ctx.fill();
    fuente(ctx, 700, Math.round(d * 0.48));
    ctx.fillStyle = textoSobre(color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(eq ? inicial(eq.nombre) : '?', cx, cy + d * 0.02);
  }
  ctx.restore();
}

const imagenesListas = new Map();

async function base(D, titulo, pie) {
  await prepararFuentes();
  const c = cfg(D);
  const logo = await cargarImagen(new URL('../assets/logo-mitre-75.jpg', import.meta.url).href);
  await precargarEscudos(D.equipos || []);
  for (const e of D.equipos || []) {
    if (e.escudo_url) imagenesListas.set(e.escudo_url, await cargarImagen(e.escudo_url));
  }
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = AZUL;
  ctx.fillRect(0, 0, W, H);

  // Encabezado
  rect(ctx, 64, 60, 136, 168, 14, '#fff');
  if (logo) {
    const s = Math.min(124 / logo.width, 156 / logo.height);
    ctx.drawImage(logo, 132 - (logo.width * s) / 2, 144 - (logo.height * s) / 2, logo.width * s, logo.height * s);
  }
  texto(ctx, `${(c.nombre || 'Nocturno Comercial').toUpperCase()} · C.D. MITRE`, 232, 104, { tam: 34, peso: 700, fam: TIT, color: CLARO, maxW: 784 });
  texto(ctx, titulo.toUpperCase(), 232, 176, { tam: 84, peso: 700, fam: TIT, color: '#fff', maxW: 784, min: 40 });

  // Pie
  const prox = pie === undefined ? textoProxima(D) : pie;
  if (prox) texto(ctx, prox, 64, 1290, { tam: 28, peso: 500, color: CLARO, maxW: 520 });
  texto(ctx, SITIO, W - 64, 1290, { tam: 28, peso: 700, color: '#fff', align: 'right', maxW: 440 });
  return { cv, ctx };
}

/** Primera fecha con partidos sin jugar desde hoy. */
export function proximaFecha(D, despuesDe = null) {
  const hoy = toISO(new Date());
  return fechasOrdenadas(D).find((f) => {
    if (despuesDe && f.numero <= despuesDe.numero) return false;
    const ps = (D.partidos || []).filter((p) => p.fecha_id === f.id);
    return ps.some((p) => p.estado === 'programado' && p.dia >= hoy);
  }) || null;
}

function textoProxima(D, despuesDe) {
  const f = proximaFecha(D, despuesDe);
  return f ? `Próxima fecha: ${fechaLargaMin(f.dia_previsto)}` : '';
}

function nombreFecha(D, f) {
  return f.fase === 'playoff' ? (f.nombre || `Fecha ${f.numero}`) : `Fecha ${f.numero}`;
}

// ── Filas comunes ──────────────────────────────────────────

function filaResultado(ctx, D, p, y, h, eqs) {
  rect(ctx, 64, y, W - 128, h, 16, '#fff');
  const r = ganadorPartido(p);
  const jugado = tieneResultado(p) && p.estado !== 'programado';
  const cy = y + h / 2;
  const pen = hayPenales(p);
  const cajaW = pen ? 210 : 150;
  const cx = W / 2;
  rect(ctx, cx - cajaW / 2, cy - 36, cajaW, 72, 10, p.estado === 'en_juego' ? '#c62828' : AZUL);
  const marcador = jugado
    ? `${p.goles_local}${pen ? ` (${p.penales_local})` : ''} - ${p.goles_visitante}${pen ? ` (${p.penales_visitante})` : ''}`
    : hora(p.hora);
  texto(ctx, marcador, cx, cy + 2, { tam: 52, peso: 700, fam: TIT, color: '#fff', align: 'center', maxW: cajaW - 16 });
  const eL = eqs.get(p.local_id);
  const eV = eqs.get(p.visitante_id);
  const ancho = cx - cajaW / 2 - 64 - 40 - 60;
  dibujarEscudo(ctx, eL, cx - cajaW / 2 - 44, cy, 48);
  dibujarEscudo(ctx, eV, cx + cajaW / 2 + 44, cy, 48);
  texto(ctx, nombreLado(p, 'local', eqs), cx - cajaW / 2 - 80, cy, { tam: 34, peso: r && r.ganador === p.local_id ? 700 : 500, align: 'right', maxW: ancho });
  texto(ctx, nombreLado(p, 'visitante', eqs), cx + cajaW / 2 + 80, cy, { tam: 34, peso: r && r.ganador === p.visitante_id ? 700 : 500, maxW: ancho });
}

// ── Tipos de placa ─────────────────────────────────────────

/** 1. Resultado de un partido */
export async function placaPartido(D, partidoId) {
  const p = D.partidos.find((x) => x.id === partidoId);
  const f = D.fechas.find((x) => x.id === p.fecha_id);
  const eqs = mapaEquipos(D);
  const titulo = p.estado === 'en_juego' ? 'En juego' : p.estado === 'finalizado' ? 'Resultado' : 'Partido';
  const { cv, ctx } = await base(D, `${titulo} · ${p.ronda === 'todos' ? nombreFecha(D, f) : nombreCruce(p.ronda, p.llave)}`, textoProxima(D, f));
  rect(ctx, 64, 290, W - 128, 900, 22, '#fff');
  const eL = eqs.get(p.local_id);
  const eV = eqs.get(p.visitante_id);
  const r = ganadorPartido(p);
  dibujarEscudo(ctx, eL, 270, 470, 220);
  dibujarEscudo(ctx, eV, W - 270, 470, 220);
  texto(ctx, nombreLado(p, 'local', eqs), 270, 640, { tam: 44, peso: r && r.ganador === p.local_id ? 700 : 600, align: 'center', maxW: 380 });
  texto(ctx, nombreLado(p, 'visitante', eqs), W - 270, 640, { tam: 44, peso: r && r.ganador === p.visitante_id ? 700 : 600, align: 'center', maxW: 380 });
  const jugado = tieneResultado(p) && p.estado !== 'programado';
  texto(ctx, jugado ? `${p.goles_local} - ${p.goles_visitante}` : 'vs', W / 2, 470, { tam: 150, peso: 700, fam: TIT, color: AZUL, align: 'center', maxW: 300 });
  if (hayPenales(p)) texto(ctx, `Penales ${p.penales_local} a ${p.penales_visitante}`, W / 2, 580, { tam: 34, peso: 600, color: '#4f5b6b', align: 'center' });
  if (p.estado === 'en_juego') texto(ctx, 'EN JUEGO', W / 2, 340, { tam: 34, peso: 700, color: '#c62828', align: 'center' });
  else if (p.estado === 'finalizado') texto(ctx, 'FINAL', W / 2, 340, { tam: 34, peso: 700, color: '#4f5b6b', align: 'center' });
  else texto(ctx, `${fechaLarga(p.dia)} · ${hora(p.hora)}`, W / 2, 340, { tam: 34, peso: 600, color: '#4f5b6b', align: 'center' });

  // Goleadores
  const g = golesPorLado(D, p);
  const lista = (s) => (s ? s.split(', ') : []);
  const gl = lista(g.local);
  const gv = lista(g.visitante);
  ctx.fillStyle = '#e2e7ef';
  ctx.fillRect(110, 700, W - 220, 2);
  if (!gl.length && !gv.length) {
    texto(ctx, jugado ? 'Sin goles cargados' : '', W / 2, 760, { tam: 30, peso: 500, color: '#4f5b6b', align: 'center' });
  }
  const filas = Math.max(gl.length, gv.length);
  const paso = Math.min(56, 440 / Math.max(filas, 1));
  for (let i = 0; i < filas; i++) {
    const y = 750 + i * paso;
    if (gl[i]) texto(ctx, gl[i], 500, y, { tam: 32, peso: 500, color: '#1a1a1a', align: 'right', maxW: 400 });
    if (gv[i]) texto(ctx, gv[i], 580, y, { tam: 32, peso: 500, color: '#1a1a1a', maxW: 400 });
  }
  return cv;
}

/** 2. Resultados de la fecha */
export async function placaFecha(D, fechaId) {
  const f = D.fechas.find((x) => x.id === fechaId);
  const eqs = mapaEquipos(D);
  const ps = itemsDeFecha(D, f).filter((x) => x.tipo === 'partido');
  const { cv, ctx } = await base(D, `Resultados · ${nombreFecha(D, f)}`, textoProxima(D, f));
  const disp = 1230 - 290;
  const h = Math.min(130, (disp - (ps.length - 1) * 18) / Math.max(ps.length, 1));
  ps.forEach((p, i) => filaResultado(ctx, D, p, 290 + i * (h + 18), h, eqs));
  if (!ps.length) texto(ctx, 'Esta fecha no tiene partidos.', W / 2, 500, { tam: 36, color: '#fff', align: 'center' });
  return cv;
}

/** 3. Tabla de posiciones */
export async function placaTabla(D) {
  const t = calcularTabla(D);
  const { cv, ctx } = await base(D, 'Tabla de posiciones');
  const filas = t.length;
  const top = 290;
  const h = Math.min(96, (1230 - top - 70) / Math.max(filas, 1));
  // Cabecera
  const cols = { pj: 590, gf: 676, gc: 762, dg: 852, pts: 956 };
  texto(ctx, 'PJ', cols.pj, top + 26, { tam: 26, peso: 700, color: CLARO, align: 'center' });
  texto(ctx, 'GF', cols.gf, top + 26, { tam: 26, peso: 700, color: CLARO, align: 'center' });
  texto(ctx, 'GC', cols.gc, top + 26, { tam: 26, peso: 700, color: CLARO, align: 'center' });
  texto(ctx, 'DG', cols.dg, top + 26, { tam: 26, peso: 700, color: CLARO, align: 'center' });
  texto(ctx, 'PTS', cols.pts, top + 26, { tam: 26, peso: 700, color: CLARO, align: 'center' });
  t.forEach((f, i) => {
    const y = top + 60 + i * h;
    rect(ctx, 64, y, W - 128, h - 10, 12, '#fff');
    const cy = y + (h - 10) / 2;
    const zc = f.zona === 'final' || f.zona === 'campeon' ? AZUL : f.zona === 'playoff' ? '#2f6fc2' : null;
    if (zc) rect(ctx, 84, cy - 24, 48, 48, 8, zc);
    texto(ctx, String(f.pos), 108, cy + 1, { tam: 30, peso: 700, color: zc ? '#fff' : '#4f5b6b', align: 'center' });
    dibujarEscudo(ctx, f, 180, cy, Math.min(52, h - 30));
    texto(ctx, f.nombre, 222, cy, { tam: 34, peso: 600, maxW: 320 });
    texto(ctx, String(f.pj), cols.pj, cy, { tam: 34, peso: 500, align: 'center' });
    texto(ctx, String(f.gf), cols.gf, cy, { tam: 34, peso: 500, align: 'center' });
    texto(ctx, String(f.gc), cols.gc, cy, { tam: 34, peso: 500, align: 'center' });
    texto(ctx, `${f.dg > 0 ? '+' : ''}${f.dg}`, cols.dg, cy, { tam: 34, peso: 500, color: '#4f5b6b', align: 'center' });
    texto(ctx, String(f.pts), cols.pts, cy, { tam: 44, peso: 700, fam: TIT, color: AZUL, align: 'center' });
  });
  return cv;
}

/** 4. Goleadores (top 10) */
export async function placaGoleadores(D) {
  const eqs = mapaEquipos(D);
  const g = calcularGoleadores(D).slice(0, 10);
  const { cv, ctx } = await base(D, 'Goleadores');
  const top = 290;
  const h = Math.min(92, (1230 - top) / Math.max(g.length, 1));
  if (!g.length) texto(ctx, 'Todavía no hay goles cargados.', W / 2, 500, { tam: 36, color: '#fff', align: 'center' });
  g.forEach((x, i) => {
    const y = top + i * h;
    rect(ctx, 64, y, W - 128, h - 10, 12, '#fff');
    const cy = y + (h - 10) / 2;
    texto(ctx, String(x.pos), 110, cy, { tam: 32, peso: 700, color: '#4f5b6b', align: 'center' });
    const eq = eqs.get(x.equipo_id);
    dibujarEscudo(ctx, eq, 180, cy, Math.min(50, h - 30));
    texto(ctx, x.nombre, 222, cy - 14, { tam: 32, peso: 700, maxW: 600 });
    texto(ctx, eq ? eq.nombre : '', 222, cy + 20, { tam: 24, peso: 500, color: '#4f5b6b', maxW: 600 });
    texto(ctx, String(x.goles), W - 120, cy, { tam: 56, peso: 700, fam: TIT, color: AZUL, align: 'center' });
  });
  return cv;
}

/** 5. Próxima fecha: partidos con día y hora, actividades y reprogramados */
export async function placaProxima(D, fechaId) {
  const f = fechaId ? D.fechas.find((x) => x.id === fechaId) : proximaFecha(D);
  const eqs = mapaEquipos(D);
  if (!f) {
    const { cv, ctx } = await base(D, 'Próxima fecha', '');
    texto(ctx, 'No hay partidos por jugar.', W / 2, 500, { tam: 36, color: '#fff', align: 'center' });
    return cv;
  }
  const items = itemsDeFecha(D, f);
  const { cv, ctx } = await base(D, `${nombreFecha(D, f)} · ${fechaLarga(f.dia_previsto)}`, textoProxima(D, f));
  const top = 290;
  const h = Math.min(130, (1230 - top - (items.length - 1) * 16) / Math.max(items.length, 1));
  items.forEach((it, i) => {
    const y = top + i * (h + 16);
    if (it.tipo === 'actividad') {
      rect(ctx, 64, y, W - 128, h, 16, '#fffbea');
      texto(ctx, hora(it.hora), 140, y + h / 2, { tam: 40, peso: 700, fam: TIT, color: '#3d3300', align: 'center' });
      texto(ctx, it.titulo, 230, y + h / 2, { tam: 34, peso: 600, color: '#3d3300', maxW: 760 });
      return;
    }
    rect(ctx, 64, y, W - 128, h, 16, '#fff');
    const reprog = esReprogramado(it, f);
    const cy = reprog ? y + h / 2 - 12 : y + h / 2;
    rect(ctx, 84, cy - 30, 112, 60, 10, reprog ? '#fff4e0' : AZUL);
    texto(ctx, hora(it.hora), 140, cy + 2, { tam: 42, peso: 700, fam: TIT, color: reprog ? '#8a4b00' : '#fff', align: 'center' });
    dibujarEscudo(ctx, eqs.get(it.local_id), 248, cy, 44);
    const n = `${nombreLado(it, 'local', eqs)}  vs  ${nombreLado(it, 'visitante', eqs)}`;
    texto(ctx, n, 284, cy, { tam: 34, peso: 600, maxW: 600 });
    dibujarEscudo(ctx, eqs.get(it.visitante_id), W - 108, cy, 44);
    if (reprog) texto(ctx, `Reprogramado · ${fechaLargaMin(it.dia)} a las ${hora(it.hora)}`, 284, cy + 40, { tam: 24, peso: 600, color: '#8a4b00', maxW: 640 });
    if (it.ronda !== 'todos' && !reprog) texto(ctx, nombreCruce(it.ronda, it.llave), 284, cy + 36, { tam: 22, peso: 600, color: '#2f6fc2', maxW: 600 });
  });
  return cv;
}

/** 6. Cruces del playoff */
export async function placaPlayoff(D) {
  const c = cfg(D);
  const eqs = mapaEquipos(D);
  const real = hayPlayoff(D);
  let partidos;
  if (real) partidos = D.partidos.filter((p) => p.ronda !== 'todos');
  else {
    partidos = armarCruces(c, calcularTabla(D)).flatMap((r) => r.partidos.map((p) => ({
      ronda: p.ronda, llave: p.llave, local_origen: p.local.origen, visitante_origen: p.visitante.origen,
      local_id: /º$/.test(p.local.origen) ? p.local.equipo_id : null,
      visitante_id: /º$/.test(p.visitante.origen) ? p.visitante.equipo_id : null,
    })));
  }
  const { cv, ctx } = await base(D, real ? 'Playoff' : 'Así quedarían los cruces', real ? undefined : 'Con la tabla de hoy');
  const orden = ['cuartos', 'semi', 'tercer_puesto', 'final_playoff', 'final', 'gran_final'];
  partidos.sort((a, b) => orden.indexOf(a.ronda) - orden.indexOf(b.ronda) || (a.llave || 0) - (b.llave || 0));
  if (!partidos.length) {
    texto(ctx, 'Este torneo no tiene playoff.', W / 2, 500, { tam: 36, color: '#fff', align: 'center' });
    return cv;
  }
  const top = 290;
  const h = Math.min(124, (1230 - top - (partidos.length - 1) * 14) / partidos.length);
  partidos.forEach((p, i) => {
    const y = top + i * (h + 14);
    const gran = p.ronda === 'gran_final' || (p.ronda === 'final' && c.primero_modo !== 'final');
    rect(ctx, 64, y, W - 128, h, 16, gran ? '#ffffff' : '#ffffff');
    if (gran) { ctx.strokeStyle = '#8fb6e8'; ctx.lineWidth = 6; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(64, y, W - 128, h, 16) : ctx.rect(64, y, W - 128, h); ctx.stroke(); }
    texto(ctx, nombreCruce(p.ronda, p.llave).toUpperCase(), 96, y + 28, { tam: 24, peso: 700, fam: TIT, color: '#2f6fc2', maxW: 400 });
    const cy = y + h / 2 + 14;
    const r = ganadorPartido(p);
    const jugado = real && tieneResultado(p) && p.estado !== 'programado';
    const nom = (l) => {
      const eq = eqs.get(p[`${l}_id`]);
      const o = p[`${l}_origen`] || '';
      return eq ? (/º$/.test(o) ? `${o} ${eq.nombre}` : eq.nombre) : (o || 'A definir');
    };
    texto(ctx, nom('local'), W / 2 - 110, cy, { tam: 32, peso: r && r.ganador === p.local_id ? 700 : 500, align: 'right', maxW: 380 });
    texto(ctx, nom('visitante'), W / 2 + 110, cy, { tam: 32, peso: r && r.ganador === p.visitante_id ? 700 : 500, maxW: 380 });
    const pen = hayPenales(p);
    texto(ctx, jugado ? `${p.goles_local}${pen ? ` (${p.penales_local})` : ''} - ${p.goles_visitante}${pen ? ` (${p.penales_visitante})` : ''}` : 'vs', W / 2, cy, { tam: 44, peso: 700, fam: TIT, color: AZUL, align: 'center', maxW: 190 });
  });
  return cv;
}

// ── Compartir ──────────────────────────────────────────────

/** Canvas → archivo PNG listo para compartir. */
export async function archivoDePlaca(cv, nombre = 'placa') {
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
  const archivo = `${nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
  return new File([blob], archivo, { type: 'image/png' });
}

/**
 * Abre el menú de compartir del celular (WhatsApp, etc.). Si no se puede, descarga el PNG.
 * Llamar directo desde el toque del botón (iPhone no deja compartir si pasa mucho tiempo).
 */
export async function compartirArchivo(file) {
  const blob = file;
  const archivo = file.name;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'compartida';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelada';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'descargada';
}

export const TIPOS_PLACA = [
  { id: 'fecha', texto: 'Resultados de la fecha' },
  { id: 'tabla', texto: 'Tabla de posiciones' },
  { id: 'goleadores', texto: 'Goleadores' },
  { id: 'proxima', texto: 'Próxima fecha' },
  { id: 'playoff', texto: 'Cruces del playoff' },
];

export { NOMBRE_RONDA };
