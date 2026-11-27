// Cálculos del torneo: tabla, desempates, goleadores, valla, zonas y cruces.
// Módulo PURO: sin dependencias, sin DOM, sin red. Lo usan la vista pública, el admin y las placas.
//
// D = { config, equipos, jugadores, fechas, partidos, goles, actividades }

export const CONFIG_DEFECTO = {
  nombre: 'Nocturno Comercial',
  subtitulo: 'C.D. Mitre · 75 aniversario',
  fecha_inicio: '2026-12-04',
  dias_juego: [2, 5],
  hora_primer_partido: '20:30',
  minutos_entre_partidos: 60,
  puntos_ganado: 3,
  puntos_empate: 1,
  puntos_perdido: 0,
  desempate: ['puntos', 'diferencia', 'goles_favor', 'entre_ellos'],
  primero_modo: 'final',
  playoff_cantidad: 4,
  tercer_puesto: false,
};

/** Gol que suma al marcador pero no se sabe quién lo hizo: no cuenta para goleadores. */
export const SIN_IDENTIFICAR = 'Sin identificar';
export const esSinIdentificar = (g) => !g.jugador_id && String(g.jugador_nombre || '').trim().toLowerCase() === SIN_IDENTIFICAR.toLowerCase();

export const NOMBRE_DESEMPATE = {
  puntos: 'Puntos',
  diferencia: 'Diferencia de gol',
  goles_favor: 'Goles a favor',
  entre_ellos: 'Resultado entre ellos',
};

export const NOMBRE_RONDA = {
  todos: 'Todos contra todos',
  cuartos: 'Cuartos de final',
  semi: 'Semifinales',
  final_playoff: 'Final del playoff',
  gran_final: 'Gran final',
  tercer_puesto: '3er puesto',
  final: 'Final',
};

/** Nombre corto de un partido de playoff: "Semi 1", "Final del playoff" */
export function nombreCruce(ronda, llave) {
  if (ronda === 'cuartos') return `Cuartos ${llave}`;
  if (ronda === 'semi') return `Semi ${llave}`;
  return NOMBRE_RONDA[ronda] || '';
}

export function cfg(D) {
  return { ...CONFIG_DEFECTO, ...(D && D.config ? D.config : {}) };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function tieneResultado(p) {
  return num(p.goles_local) !== null && num(p.goles_visitante) !== null;
}

/** Un partido suma en la tabla si es de la 1ª fase, está finalizado y tiene resultado. */
export function cuentaParaTabla(p) {
  return p.ronda === 'todos' && p.estado === 'finalizado' && p.local_id && p.visitante_id && tieneResultado(p);
}

const porNombre = (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' });

function filaVacia(eq) {
  return {
    equipo_id: eq.id,
    nombre: eq.nombre,
    color: eq.color,
    escudo_url: eq.escudo_url || null,
    pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, dg: 0, pts: 0,
  };
}

function acumular(filas, partidos, c) {
  for (const p of partidos) {
    const L = filas.get(p.local_id);
    const V = filas.get(p.visitante_id);
    if (!L || !V) continue;
    const gl = num(p.goles_local);
    const gv = num(p.goles_visitante);
    L.pj++; V.pj++;
    L.gf += gl; L.gc += gv;
    V.gf += gv; V.gc += gl;
    if (gl > gv) { L.g++; V.p++; L.pts += c.puntos_ganado; V.pts += c.puntos_perdido; }
    else if (gl < gv) { V.g++; L.p++; V.pts += c.puntos_ganado; L.pts += c.puntos_perdido; }
    else { L.e++; V.e++; L.pts += c.puntos_empate; V.pts += c.puntos_empate; }
  }
  for (const f of filas.values()) f.dg = f.gf - f.gc;
}

function compararClaves(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i]; // mayor primero
  }
  return 0;
}

function ordenarConDesempate(filas, partidosTabla, c) {
  const criterios = (c.desempate && c.desempate.length ? c.desempate : CONFIG_DEFECTO.desempate)
    .filter((k) => k in NOMBRE_DESEMPATE);

  const clave = (crit, grupo) => {
    if (crit === 'puntos') return (f) => [f.pts];
    if (crit === 'diferencia') return (f) => [f.dg];
    if (crit === 'goles_favor') return (f) => [f.gf];
    if (crit === 'entre_ellos') {
      const ids = new Set(grupo.map((f) => f.equipo_id));
      const mini = new Map(grupo.map((f) => [f.equipo_id, { ...filaVacia({ id: f.equipo_id, nombre: f.nombre }) }]));
      acumular(mini, partidosTabla.filter((p) => ids.has(p.local_id) && ids.has(p.visitante_id)), c);
      return (f) => [mini.get(f.equipo_id).pts, mini.get(f.equipo_id).dg];
    }
    return () => [0];
  };

  const rec = (grupo, i) => {
    if (grupo.length <= 1) return grupo;
    if (i >= criterios.length) return grupo.slice().sort(porNombre);
    const k = clave(criterios[i], grupo);
    const conClave = grupo.map((f) => ({ f, k: k(f) }));
    conClave.sort((a, b) => compararClaves(a.k, b.k));
    const salida = [];
    let actual = [conClave[0]];
    for (let j = 1; j < conClave.length; j++) {
      if (compararClaves(conClave[j].k, actual[0].k) === 0) actual.push(conClave[j]);
      else { salida.push(actual); actual = [conClave[j]]; }
    }
    salida.push(actual);
    return salida.flatMap((g) => rec(g.map((x) => x.f), i + 1));
  };

  return rec(filas, 0);
}

/**
 * Tabla de posiciones de la 1ª fase.
 * Incluye a los equipos activos y a los inactivos que ya jugaron.
 */
export function calcularTabla(D) {
  const c = cfg(D);
  const partidosTabla = (D.partidos || []).filter(cuentaParaTabla);
  const jugaron = new Set(partidosTabla.flatMap((p) => [p.local_id, p.visitante_id]));
  const equipos = (D.equipos || []).filter((e) => e.activo !== false || jugaron.has(e.id));
  const filas = new Map(equipos.map((e) => [e.id, filaVacia(e)]));
  acumular(filas, partidosTabla, c);
  const ordenadas = ordenarConDesempate([...filas.values()], partidosTabla, c);
  return ordenadas.map((f, i) => ({ ...f, pos: i + 1, zona: zonaDe(i + 1, c) }));
}

/** 'final' | 'playoff' | 'campeon' | null */
export function zonaDe(pos, c) {
  const n = Number(c.playoff_cantidad) || 4;
  if (c.primero_modo === 'final') {
    if (pos === 1) return 'final';
    if (pos >= 2 && pos <= 1 + n) return 'playoff';
    return null;
  }
  if (c.primero_modo === 'playoff') return pos <= n ? 'playoff' : null;
  if (c.primero_modo === 'campeon') return pos === 1 ? 'campeon' : null;
  return null;
}

export function leyendaZonas(c) {
  const n = Number(c.playoff_cantidad) || 4;
  if (c.primero_modo === 'final') {
    return [
      { zona: 'final', texto: 'Pasa directo a la final' },
      { zona: 'playoff', texto: `Juega el playoff (del 2º al ${1 + n}º)` },
    ];
  }
  if (c.primero_modo === 'playoff') return [{ zona: 'playoff', texto: `Juega el playoff (del 1º al ${n}º)` }];
  return [{ zona: 'campeon', texto: 'Campeón' }];
}

export function textoDesempate(c) {
  const lista = (c.desempate || CONFIG_DEFECTO.desempate).map((k) => NOMBRE_DESEMPATE[k]).filter(Boolean);
  const t = lista.map((s, i) => (i === 0 ? s : s.toLowerCase())).join(', ');
  return `Desempate: ${t}. Si sigue el empate, orden alfabético.`;
}

/** Goleadores: goles a favor (no en contra) de partidos finalizados o en juego. */
export function calcularGoleadores(D) {
  const estados = new Set(['finalizado', 'en_juego']);
  const partidos = new Map((D.partidos || []).map((p) => [p.id, p]));
  const jugadores = new Map((D.jugadores || []).map((j) => [j.id, j]));
  const grupos = new Map();
  for (const g of D.goles || []) {
    if (g.en_contra || esSinIdentificar(g)) continue;
    const p = partidos.get(g.partido_id);
    if (!p || !estados.has(p.estado)) continue;
    const key = g.jugador_id ? `id:${g.jugador_id}` : `n:${String(g.jugador_nombre || '').trim().toLowerCase()}|${g.equipo_id}`;
    let x = grupos.get(key);
    if (!x) {
      const j = g.jugador_id ? jugadores.get(g.jugador_id) : null;
      x = {
        key,
        jugador_id: g.jugador_id || null,
        nombre: (j && j.nombre) || String(g.jugador_nombre || '').trim(),
        equipo_id: (j && j.equipo_id) || g.equipo_id,
        goles: 0,
      };
      grupos.set(key, x);
    }
    x.goles++;
  }
  const lista = [...grupos.values()].sort((a, b) => b.goles - a.goles || porNombre(a, b));
  return conPosicionCompartida(lista, (a, b) => a.goles === b.goles);
}

/** Valla menos vencida, por equipo: menos goles en contra → más PJ → nombre. Solo equipos que jugaron. */
export function calcularValla(D, tabla = calcularTabla(D)) {
  const lista = tabla
    .filter((f) => f.pj > 0)
    .map((f) => ({ ...f }))
    .sort((a, b) => a.gc - b.gc || b.pj - a.pj || porNombre(a, b));
  return conPosicionCompartida(lista, (a, b) => a.gc === b.gc && a.pj === b.pj);
}

function conPosicionCompartida(lista, iguales) {
  let pos = 0;
  return lista.map((x, i) => {
    if (i === 0 || !iguales(lista[i - 1], x)) pos = i + 1;
    return { ...x, pos };
  });
}

// ─────────────────────────────────────────────────────────────
// Playoff
// ─────────────────────────────────────────────────────────────

const ETIQUETA_ORIGEN = { cuartos: 'cuartos', semi: 'semi' };

export function origenGanador(ronda, llave) {
  if (ronda === 'final_playoff') return 'Ganador del playoff';
  return `Ganador ${ETIQUETA_ORIGEN[ronda]} ${llave}`;
}
export function origenPerdedor(ronda, llave) {
  if (ronda === 'final_playoff') return 'Perdedor del playoff';
  return `Perdedor ${ETIQUETA_ORIGEN[ronda]} ${llave}`;
}

/** 'Ganador semi 1' → { tipo:'ganador', ronda:'semi', llave:1 } */
export function parsearOrigen(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^(Ganador|Perdedor) (cuartos|semi) (\d+)$/);
  if (m) return { tipo: m[1].toLowerCase(), ronda: m[2], llave: Number(m[3]) };
  m = t.match(/^(Ganador|Perdedor) del playoff$/);
  if (m) return { tipo: m[1].toLowerCase(), ronda: 'final_playoff', llave: 1 };
  m = t.match(/^(\d+)º$/);
  if (m) return { tipo: 'posicion', pos: Number(m[1]) };
  return null;
}

/** Ganador y perdedor de un partido finalizado (por goles, o por penales si empataron). */
export function ganadorPartido(p) {
  if (!p || p.estado !== 'finalizado' || !tieneResultado(p) || !p.local_id || !p.visitante_id) return null;
  const gl = num(p.goles_local);
  const gv = num(p.goles_visitante);
  let localGana;
  if (gl !== gv) localGana = gl > gv;
  else {
    const pl = num(p.penales_local);
    const pv = num(p.penales_visitante);
    if (pl === null || pv === null || pl === pv) return null;
    localGana = pl > pv;
  }
  return localGana
    ? { ganador: p.local_id, perdedor: p.visitante_id }
    : { ganador: p.visitante_id, perdedor: p.local_id };
}

/**
 * Cruces del playoff según la config y la tabla.
 * Devuelve [{ ronda, nombre, partidos:[{ ronda, llave, local:{equipo_id, origen}, visitante:{...} }] }]
 */
export function armarCruces(c, tabla) {
  c = { ...CONFIG_DEFECTO, ...c };
  if (c.primero_modo === 'campeon') return [];
  const n = Number(c.playoff_cantidad) || 4;
  const desde = c.primero_modo === 'final' ? 2 : 1;
  const porPos = (pos) => ({ equipo_id: (tabla && tabla[pos - 1] && tabla[pos - 1].equipo_id) || null, origen: `${pos}º` });
  const seed = (i) => porPos(desde + i - 1); // seed 1..n
  const rondas = [];
  const cruce = (ronda, llave, local, visitante) => ({ ronda, llave, local, visitante });
  const ganador = (ronda, llave) => ({ equipo_id: null, origen: origenGanador(ronda, llave) });
  const perdedor = (ronda, llave) => ({ equipo_id: null, origen: origenPerdedor(ronda, llave) });
  const ultima = c.primero_modo === 'final' ? 'final_playoff' : 'final';

  if (n === 8) {
    const q = [[1, 8], [4, 5], [2, 7], [3, 6]];
    rondas.push({ ronda: 'cuartos', partidos: q.map(([a, b], i) => cruce('cuartos', i + 1, seed(a), seed(b))) });
    rondas.push({
      ronda: 'semi',
      partidos: [
        cruce('semi', 1, ganador('cuartos', 1), ganador('cuartos', 2)),
        cruce('semi', 2, ganador('cuartos', 3), ganador('cuartos', 4)),
      ],
    });
  } else if (n === 4) {
    rondas.push({ ronda: 'semi', partidos: [cruce('semi', 1, seed(1), seed(4)), cruce('semi', 2, seed(2), seed(3))] });
  }

  const finalPartidos = [];
  if (n >= 4 && c.tercer_puesto) finalPartidos.push(cruce('tercer_puesto', 1, perdedor('semi', 1), perdedor('semi', 2)));
  finalPartidos.push(n === 2 ? cruce(ultima, 1, seed(1), seed(2)) : cruce(ultima, 1, ganador('semi', 1), ganador('semi', 2)));
  rondas.push({ ronda: ultima, partidos: finalPartidos });

  if (c.primero_modo === 'final') {
    rondas.push({ ronda: 'gran_final', partidos: [cruce('gran_final', 1, porPos(1), ganador('final_playoff', 1))] });
  }
  return rondas.map((r) => ({ ...r, nombre: NOMBRE_RONDA[r.ronda] }));
}

/**
 * Cambios a aplicar en los partidos del playoff cuyo equipo sale de un cruce anterior.
 * Devuelve [{ id, local_id?, visitante_id? }] solo para lo que cambia.
 */
export function resolverCruces(partidos) {
  const playoff = (partidos || []).filter((p) => p.ronda !== 'todos');
  const buscar = (ronda, llave) => playoff.find((p) => p.ronda === ronda && Number(p.llave) === Number(llave));
  const resolver = (origen) => {
    const o = parsearOrigen(origen);
    if (!o || o.tipo === 'posicion') return undefined;
    const r = ganadorPartido(buscar(o.ronda, o.llave));
    if (!r) return null;
    return o.tipo === 'ganador' ? r.ganador : r.perdedor;
  };
  const cambios = [];
  for (const p of playoff) {
    const cambio = { id: p.id };
    for (const lado of ['local', 'visitante']) {
      const v = resolver(p[`${lado}_origen`]);
      if (v === undefined) continue;
      if ((p[`${lado}_id`] || null) !== v) cambio[`${lado}_id`] = v;
    }
    if (Object.keys(cambio).length > 1) cambios.push(cambio);
  }
  return cambios;
}

/** ¿Ya existe el playoff en la base? */
export function hayPlayoff(D) {
  return (D.fechas || []).some((f) => f.fase === 'playoff');
}

/** ¿Están finalizados todos los partidos de la 1ª fase? */
export function primeraFaseTerminada(D) {
  const todos = (D.partidos || []).filter((p) => p.ronda === 'todos');
  return todos.length > 0 && todos.every((p) => p.estado === 'finalizado');
}

/** Podio final (si ya se sabe). { campeon, segundo, tercero } con ids o null. */
export function podio(D) {
  const c = cfg(D);
  const P = D.partidos || [];
  const de = (ronda) => ganadorPartido(P.find((p) => p.ronda === ronda));
  if (c.primero_modo === 'campeon') {
    if (!primeraFaseTerminada(D)) return null;
    const t = calcularTabla(D);
    return { campeon: t[0]?.equipo_id || null, segundo: t[1]?.equipo_id || null, tercero: t[2]?.equipo_id || null };
  }
  const finalRonda = c.primero_modo === 'final' ? 'gran_final' : 'final';
  const f = de(finalRonda);
  if (!f) return null;
  let tercero = null;
  const tp = de('tercer_puesto');
  if (tp) tercero = tp.ganador;
  else if (c.primero_modo === 'final') tercero = de('final_playoff')?.perdedor || null;
  return { campeon: f.ganador, segundo: f.perdedor, tercero };
}

// ─────────────────────────────────────────────────────────────
// Fechas y partidos
// ─────────────────────────────────────────────────────────────

export function fechasOrdenadas(D) {
  return (D.fechas || []).slice().sort((a, b) => a.numero - b.numero);
}

/** La primera fecha con partidos sin terminar; si no queda ninguna, la última jugada. */
export function fechaEnCurso(D) {
  const fechas = fechasOrdenadas(D);
  if (!fechas.length) return null;
  const pend = new Set(['programado', 'en_juego']);
  const deFecha = (f) => (D.partidos || []).filter((p) => p.fecha_id === f.id);
  const abierta = fechas.find((f) => deFecha(f).some((p) => pend.has(p.estado)));
  if (abierta) return abierta;
  const jugadas = fechas.filter((f) => deFecha(f).some((p) => p.estado === 'finalizado'));
  return jugadas.length ? jugadas[jugadas.length - 1] : fechas[0];
}

/** ¿El partido se juega en otro día que el previsto para su fecha? */
export function esReprogramado(p, fecha) {
  return !!(fecha && p.dia && String(p.dia).slice(0, 10) !== String(fecha.dia_previsto).slice(0, 10));
}

/** Goles cargados que faltan (o sobran) respecto del marcador. [{ equipo_id, faltan }] (faltan<0 = sobran) */
export function diferenciaGoles(p, goles) {
  const res = [];
  for (const lado of ['local', 'visitante']) {
    const eq = p[`${lado}_id`];
    if (!eq) continue;
    const marcador = num(p[`goles_${lado}`]) || 0;
    const cargados = (goles || []).filter((g) => g.partido_id === p.id && g.equipo_id === eq).length;
    if (marcador !== cargados) res.push({ equipo_id: eq, faltan: marcador - cargados });
  }
  return res;
}

/** Equipos que tienen fecha libre en una fecha de 1ª fase (cuando la cantidad es impar). */
export function libresDeFecha(D, fecha) {
  if (!fecha || fecha.fase !== 'todos') return [];
  const ps = (D.partidos || []).filter((p) => p.fecha_id === fecha.id);
  if (!ps.length) return [];
  const juegan = new Set(ps.flatMap((p) => [p.local_id, p.visitante_id]));
  const enFixture = new Set((D.partidos || []).filter((p) => p.ronda === 'todos').flatMap((p) => [p.local_id, p.visitante_id]));
  return (D.equipos || []).filter((e) => enFixture.has(e.id) && !juegan.has(e.id));
}
