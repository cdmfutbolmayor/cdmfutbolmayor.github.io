// Generación del fixture (todos contra todos, método del círculo) y de los días de juego.
// Puro: devuelve filas listas para guardar, sin tocar la base.

import { cfg, armarCruces, calcularTabla, NOMBRE_RONDA } from './calculos.js';
import { parseISO, sumarDias, sumarMinutos, hora, esFeriadoEspecial, claveDiaHora } from './util.js';

/**
 * Método del círculo. Con N impar se agrega un "Libre" (null).
 * Devuelve rondas: [[{local, visitante}], …] con N-1 rondas (o N si es impar).
 */
export function roundRobin(ids) {
  const lista = ids.slice();
  if (lista.length < 2) return [];
  if (lista.length % 2 === 1) lista.push(null);
  const n = lista.length;
  const rondas = [];
  let rot = lista.slice();
  for (let r = 0; r < n - 1; r++) {
    const partidos = [];
    for (let i = 0; i < n / 2; i++) {
      let a = rot[i];
      let b = rot[n - 1 - i];
      // Alternar local/visitante para que nadie sea siempre local.
      if (i === 0 ? r % 2 === 1 : (r + i) % 2 === 1) [a, b] = [b, a];
      if (a !== null && b !== null) partidos.push({ local: a, visitante: b });
    }
    rondas.push(partidos);
    // Rotar todos menos el primero.
    rot = [rot[0], rot[n - 1], ...rot.slice(1, n - 1)];
  }
  return rondas;
}

/** Los próximos `cantidad` días de juego a partir de `desde` (inclusive). */
export function diasDeJuego(desde, diasSemana, cantidad) {
  const dias = (diasSemana && diasSemana.length ? diasSemana : [2, 5]).map(Number);
  const res = [];
  let iso = String(desde).slice(0, 10);
  let guard = 0;
  while (res.length < cantidad && guard < 2000) {
    if (dias.includes(parseISO(iso).getDay())) res.push(iso);
    iso = sumarDias(iso, 1);
    guard++;
  }
  return res;
}

/** El siguiente día de juego estrictamente posterior a `iso`. */
export function siguienteDiaDeJuego(iso, diasSemana) {
  return diasDeJuego(sumarDias(iso, 1), diasSemana, 1)[0];
}

export function horarios(c, cantidad) {
  const h0 = hora(c.hora_primer_partido) || '20:30';
  const paso = Number(c.minutos_entre_partidos) || 60;
  return Array.from({ length: cantidad }, (_, i) => sumarMinutos(h0, i * paso));
}

/**
 * Arma el fixture de la 1ª fase.
 * Devuelve { fechas:[{numero, fase, nombre, dia_previsto, partidos:[{local_id, visitante_id, dia, hora, ronda}] }], avisos:[texto] }
 */
export function armarFixture(D) {
  const c = cfg(D);
  const equipos = (D.equipos || []).filter((e) => e.activo !== false);
  const rondas = roundRobin(equipos.map((e) => e.id));
  const dias = diasDeJuego(c.fecha_inicio, c.dias_juego, rondas.length);
  const avisos = [];
  const fechas = rondas.map((partidos, i) => {
    const dia = dias[i];
    const aviso = esFeriadoEspecial(dia);
    if (aviso) avisos.push(`Fecha ${i + 1}: ${aviso}`);
    const hs = horarios(c, partidos.length);
    return {
      numero: i + 1,
      fase: 'todos',
      nombre: null,
      dia_previsto: dia,
      partidos: partidos.map((p, j) => ({
        ronda: 'todos',
        local_id: p.local,
        visitante_id: p.visitante,
        dia,
        hora: hs[j],
      })),
    };
  });
  return { fechas, avisos };
}

/** Puede regenerarse solo si no hay resultados cargados. */
export function puedeRegenerarFixture(D) {
  return !(D.partidos || []).some(
    (p) => p.estado !== 'programado' || p.goles_local !== null && p.goles_local !== undefined
  ) && !(D.goles || []).length;
}

/** Último día con algo programado (partidos o actividades). */
function ultimoDia(D) {
  const dias = [
    ...(D.partidos || []).map((p) => p.dia),
    ...(D.fechas || []).map((f) => f.dia_previsto),
    ...(D.actividades || []).map((a) => a.dia),
  ].filter(Boolean).map((d) => String(d).slice(0, 10)).sort();
  return dias[dias.length - 1] || cfg(D).fecha_inicio;
}

/**
 * Arma las fechas y partidos del playoff según la tabla actual.
 * Devuelve { fechas:[{numero, fase:'playoff', nombre, dia_previsto, partidos:[…]}], avisos }
 */
export function armarPlayoff(D) {
  const c = cfg(D);
  const tabla = calcularTabla(D);
  const rondas = armarCruces(c, tabla);
  const numeroBase = Math.max(0, ...(D.fechas || []).map((f) => Number(f.numero) || 0));
  let dia = ultimoDia(D);
  const avisos = [];
  const fechas = rondas.map((r, i) => {
    dia = siguienteDiaDeJuego(dia, c.dias_juego);
    const aviso = esFeriadoEspecial(dia);
    if (aviso) avisos.push(`${NOMBRE_RONDA[r.ronda]}: ${aviso}`);
    const hs = horarios(c, r.partidos.length);
    return {
      numero: numeroBase + i + 1,
      fase: 'playoff',
      nombre: r.nombre,
      dia_previsto: dia,
      partidos: r.partidos.map((p, j) => ({
        ronda: p.ronda,
        llave: p.llave,
        local_id: p.local.equipo_id,
        visitante_id: p.visitante.equipo_id,
        local_origen: p.local.origen,
        visitante_origen: p.visitante.origen,
        dia,
        hora: hs[j],
      })),
    };
  });
  return { fechas, avisos };
}

/**
 * "Mover toda la fecha": nuevo día previsto y se corren los partidos/actividades que estaban en el día previsto.
 * Devuelve { partidos:[{id, dia}], actividades:[{id, dia}] }
 */
export function moverFecha(D, fecha, nuevoDia) {
  const viejo = String(fecha.dia_previsto).slice(0, 10);
  const mismos = (x) => x.fecha_id === fecha.id && String(x.dia).slice(0, 10) === viejo;
  return {
    partidos: (D.partidos || []).filter(mismos).map((p) => ({ id: p.id, dia: nuevoDia })),
    actividades: (D.actividades || []).filter(mismos).map((a) => ({ id: a.id, dia: nuevoDia })),
  };
}

/** Partidos y actividades de una fecha, intercalados por día y hora. */
export function itemsDeFecha(D, fecha) {
  if (!fecha) return [];
  const orden = { cuartos: 1, semi: 2, tercer_puesto: 3, final_playoff: 4, final: 5, gran_final: 6, todos: 0 };
  const ps = (D.partidos || []).filter((p) => p.fecha_id === fecha.id).map((p) => ({ tipo: 'partido', ...p }));
  const as = (D.actividades || []).filter((a) => a.fecha_id === fecha.id).map((a) => ({ tipo: 'actividad', ...a }));
  return [...ps, ...as].sort((a, b) => {
    const k = claveDiaHora(a.dia, a.hora).localeCompare(claveDiaHora(b.dia, b.hora));
    if (k) return k;
    return (orden[a.ronda] || 0) - (orden[b.ronda] || 0) || (a.llave || 0) - (b.llave || 0);
  });
}
