// Vista pública del torneo.
import { iniciarDatos } from './datos.js';
import { MODO } from './db.js';
import {
  cfg, calcularTabla, calcularGoleadores, calcularValla, leyendaZonas, textoDesempate, fechasOrdenadas, fechaEnCurso,
  esReprogramado, libresDeFecha, armarCruces, hayPlayoff, primeraFaseTerminada, podio, ganadorPartido, NOMBRE_RONDA,
  nombreCruce, tieneResultado,
} from './calculos.js';
import { itemsDeFecha } from './fixture.js';
import { esc, plural, fechaLarga, hora } from './util.js';
import {
  ICONO, escudo, mapaEquipos, nombreLado, estadoPartido, textoReprogramado, golesPorLado, hayPenales, etiquetaCruce,
} from './ui.js';

const PESTANAS = [
  ['partidos', 'Partidos'],
  ['tabla', 'Tabla'],
  ['equipos', 'Equipos'],
  ['goleadores', 'Goleadores'],
  ['valla', 'Valla'],
  ['playoff', 'Playoff'],
];

const estado = {
  pestana: 'partidos',
  fechaId: null,      // null = la fecha en curso
  equipoId: null,
  D: null,
  sinConexion: false,
  desdeCache: false,
};

const $ = (s) => document.querySelector(s);

// ── Navegación ─────────────────────────────────────────────

function leerHash() {
  const [p, extra] = location.hash.replace('#', '').split('/');
  estado.pestana = PESTANAS.some(([k]) => k === p) ? p : 'partidos';
  estado.equipoId = estado.pestana === 'equipos' && extra ? extra : null;
}

function ir(pestana, extra) {
  const h = `#${pestana}${extra ? `/${extra}` : ''}`;
  if (location.hash !== h) location.hash = h;
  else render();
}

function pintarPestanas() {
  $('#pestanas').innerHTML = PESTANAS.map(([k, l]) =>
    `<button class="pestana" role="tab" aria-selected="${estado.pestana === k}" data-tab="${k}">${l}</button>`).join('');
}

// ── Render principal ───────────────────────────────────────

function render() {
  pintarPestanas();
  const D = estado.D;
  if (!D) return;
  const c = cfg(D);
  $('#titulo').textContent = c.nombre || 'Nocturno Comercial';
  $('#subtitulo').textContent = c.subtitulo || '';
  document.title = `${c.nombre || 'Nocturno Comercial'} · C.D. Mitre`;

  const bandas = [];
  if (estado.sinConexion) bandas.push('<div class="banda sin-conexion" role="status">Sin conexión. Estás viendo los últimos datos guardados.</div>');
  if (MODO === 'demo') bandas.push('<div class="banda prueba">Modo de prueba: los datos quedan guardados solo en este navegador.</div>');
  $('#bandas').innerHTML = bandas.join('');

  const vistas = { partidos: vistaPartidos, tabla: vistaTabla, equipos: vistaEquipos, goleadores: vistaGoleadores, valla: vistaValla, playoff: vistaPlayoff };
  $('#contenido').innerHTML = vistas[estado.pestana](D);
}

// ── Partidos ───────────────────────────────────────────────

function marcadorHTML(p) {
  const jugado = tieneResultado(p) && p.estado !== 'programado';
  const vivo = p.estado === 'en_juego';
  const clase = vivo ? 'caja vivo' : jugado ? 'caja' : 'caja vacia';
  const pen = hayPenales(p);
  const g = (lado) => {
    if (!jugado) return '-';
    const n = p[`goles_${lado}`];
    return pen ? `${n} <span class="pen" style="color:inherit;opacity:.85">(${p[`penales_${lado}`]})</span>` : `${n}`;
  };
  const etiqueta = jugado
    ? `${p.goles_local} a ${p.goles_visitante}${pen ? `, penales ${p.penales_local} a ${p.penales_visitante}` : ''}`
    : 'sin resultado';
  return `<div class="p-marcador" aria-label="${esc(etiqueta)}"><span class="${clase}" aria-hidden="true">${g('local')}</span><span class="${clase}" aria-hidden="true">${g('visitante')}</span></div>`;
}

export function filaPartido(D, p, fecha, eqs) {
  const st = estadoPartido(p, fecha);
  const r = ganadorPartido(p);
  const lado = (l) => {
    const eq = eqs.get(p[`${l}_id`]);
    const gana = r && r.ganador === p[`${l}_id`];
    const nombre = `<span class="nombre ${gana ? 'gana' : ''} ${eq ? '' : 'origen'}">${esc(nombreLado(p, l, eqs))}</span>`;
    const esc_ = escudo(eq, 20);
    return `<div class="p-lado ${l}">${l === 'local' ? nombre + esc_ : esc_ + nombre}</div>`;
  };
  const goles = golesPorLado(D, p);
  const extras = [];
  if (p.estado === 'suspendido') extras.push('<div class="etiqueta susp">Suspendido</div>');
  else if (esReprogramado(p, fecha) && p.estado !== 'finalizado') extras.push(`<div class="etiqueta reprog">${esc(textoReprogramado(p))}</div>`);
  const cruce = etiquetaCruce(p);
  return `
    <div class="partido">
      <div class="linea">
        <span class="p-estado ${st.clase}">${esc(st.texto)}</span>
        ${lado('local')}
        ${marcadorHTML(p)}
        ${lado('visitante')}
      </div>
      ${goles.local || goles.visitante ? `<div class="p-goles"><span class="l">${esc(goles.local)}</span><span class="v">${esc(goles.visitante)}</span></div>` : ''}
      ${cruce && fecha && fecha.fase === 'playoff' && cruce !== fecha.nombre ? `<div class="etiqueta cruce">${esc(cruce)}</div>` : ''}
      ${extras.join('')}
    </div>`;
}

function filaActividad(a) {
  return `<div class="actividad"><span class="p-estado">${esc(hora(a.hora))}</span><span class="txt">${esc(a.titulo)}</span></div>`;
}

function tituloFecha(D, f) {
  if (f.fase === 'playoff') return f.nombre || `Fecha ${f.numero}`;
  const total = (D.fechas || []).filter((x) => x.fase === 'todos').length;
  return `Fecha ${f.numero} de ${total}`;
}

function vistaPartidos(D) {
  const fechas = fechasOrdenadas(D);
  if (!fechas.length) return '<div class="tarjeta"><div class="vacio">Todavía no se armó el fixture. Muy pronto vas a ver acá los partidos.</div></div>';
  let f = fechas.find((x) => x.id === estado.fechaId);
  if (!f) f = fechaEnCurso(D);
  const i = fechas.indexOf(f);
  const eqs = mapaEquipos(D);
  const items = itemsDeFecha(D, f);
  const filas = items.map((it) => (it.tipo === 'actividad' ? filaActividad(it) : filaPartido(D, it, f, eqs))).join('');
  const libres = libresDeFecha(D, f).map((e) => `<div class="libre">Libre: ${esc(e.nombre)}</div>`).join('');
  return `
    <section class="tarjeta" aria-label="Partidos">
      <div class="selector-fecha">
        <button class="btn-icono" data-fecha="${i - 1}" aria-label="Fecha anterior" ${i <= 0 ? 'disabled' : ''}>${ICONO.izq}</button>
        <div class="centro">
          <span class="nombre">${esc(tituloFecha(D, f))}</span>
          <span class="dia">${esc(fechaLarga(f.dia_previsto))}</span>
        </div>
        <button class="btn-icono" data-fecha="${i + 1}" aria-label="Fecha siguiente" ${i >= fechas.length - 1 ? 'disabled' : ''}>${ICONO.der}</button>
      </div>
      ${filas || '<div class="vacio">Esta fecha todavía no tiene partidos.</div>'}
      ${libres}
    </section>
    <p class="pie">Los resultados se actualizan solos.</p>`;
}

// ── Tabla ──────────────────────────────────────────────────

function vistaTabla(D) {
  const c = cfg(D);
  const t = calcularTabla(D);
  if (!t.length) return '<div class="tarjeta"><div class="vacio">Todavía no hay equipos cargados.</div></div>';
  const filas = t.map((f) => `
    <div class="t-fila">
      <span><span class="pos ${f.zona || ''}">${f.pos}</span></span>
      <span class="eq">${escudo(f, 18)}<span>${esc(f.nombre)}</span></span>
      <span class="num">${f.pj}</span><span class="num">${f.g}</span><span class="num">${f.e}</span><span class="num">${f.p}</span>
      <span class="num dg">${f.dg > 0 ? '+' : ''}${f.dg}</span>
      <span class="num pts">${f.pts}</span>
    </div>`).join('');
  const leyenda = leyendaZonas(c).map((z) => `<span class="item"><span class="cuadro ${z.zona}"></span>${esc(z.texto)}</span>`).join('');
  return `
    <section class="tarjeta tabla-pos" aria-label="Tabla de posiciones">
      <div class="t-fila cab"><span>#</span><span>Equipo</span><span class="num">PJ</span><span class="num">G</span><span class="num">E</span><span class="num">P</span><span class="num">DG</span><span class="num">Pts</span></div>
      ${filas}
    </section>
    <div class="leyenda">${leyenda}<span style="color:var(--sec)">${esc(textoDesempate(c))}</span></div>`;
}

// ── Equipos ────────────────────────────────────────────────

function vistaEquipos(D) {
  const t = calcularTabla(D);
  if (estado.equipoId) {
    const f = t.find((x) => x.equipo_id === estado.equipoId);
    if (f) return detalleEquipo(D, f);
  }
  if (!t.length) return '<div class="tarjeta"><div class="vacio">Todavía no hay equipos cargados.</div></div>';
  const lista = t.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return `<div class="grilla-equipos">${lista.map((f) => `
    <button class="tarjeta-equipo" data-equipo="${esc(f.equipo_id)}">
      ${escudo(f, 52)}
      <span class="n">${esc(f.nombre)}</span>
      <span class="s">${f.pj ? `${f.pos}º · ${plural(f.pts, 'punto', 'puntos')}` : 'Sin partidos jugados'}</span>
    </button>`).join('')}</div>`;
}

function detalleEquipo(D, f) {
  const eqs = mapaEquipos(D);
  const fechas = new Map((D.fechas || []).map((x) => [x.id, x]));
  const goleadores = calcularGoleadores(D).filter((g) => g.equipo_id === f.equipo_id);
  const plantel = (D.jugadores || []).filter((j) => j.equipo_id === f.equipo_id && j.activo !== false);
  const golesDe = (j) => {
    const g = goleadores.find((x) => x.jugador_id === j.id || (!x.jugador_id && x.nombre.trim().toLowerCase() === j.nombre.trim().toLowerCase()));
    return g ? g.goles : 0;
  };
  const filasJug = plantel.map((j) => ({ nombre: j.nombre, goles: golesDe(j) }));
  // Goleadores que no están en el plantel (se cargaron solo con el nombre)
  for (const g of goleadores) {
    const yaEsta = filasJug.some((x) => x.nombre.trim().toLowerCase() === g.nombre.trim().toLowerCase());
    if (!yaEsta) filasJug.push({ nombre: g.nombre, goles: g.goles });
  }
  filasJug.sort((a, b) => b.goles - a.goles || a.nombre.localeCompare(b.nombre, 'es'));

  const partidos = (D.partidos || [])
    .filter((p) => p.local_id === f.equipo_id || p.visitante_id === f.equipo_id)
    .sort((a, b) => `${a.dia} ${a.hora}`.localeCompare(`${b.dia} ${b.hora}`));
  const filaP = (p) => {
    const fecha = fechas.get(p.fecha_id);
    const local = p.local_id === f.equipo_id;
    const rival = nombreLado(p, local ? 'visitante' : 'local', eqs);
    const etiqueta = p.ronda === 'todos' ? `Fecha ${fecha ? fecha.numero : ''}` : nombreCruce(p.ronda, p.llave);
    let res;
    if (p.estado === 'finalizado' && tieneResultado(p)) {
      const gf = local ? p.goles_local : p.goles_visitante;
      const gc = local ? p.goles_visitante : p.goles_local;
      const r = ganadorPartido(p);
      const letra = gf > gc ? 'G' : gf < gc ? 'P' : r ? (r.ganador === f.equipo_id ? 'G' : 'P') : 'E';
      const pen = hayPenales(p) ? ` (${local ? p.penales_local : p.penales_visitante}-${local ? p.penales_visitante : p.penales_local} pen.)` : '';
      res = `<span class="res ${letra}">${letra} ${gf}-${gc}${pen}</span>`;
    } else if (p.estado === 'en_juego') {
      res = `<span class="res vivo">En juego ${p.goles_local ?? 0}-${p.goles_visitante ?? 0}</span>`;
    } else if (p.estado === 'suspendido') {
      res = '<span class="res pend">Suspendido</span>';
    } else if (esReprogramado(p, fecha)) {
      res = `<span class="res pend" style="color:var(--reprog)">Reprog. ${esc(fechaLarga(p.dia).split(' ')[1] || '')} ${esc(hora(p.hora))}</span>`;
    } else {
      res = `<span class="res pend">${esc(fechaLarga(p.dia).split(' ')[0].slice(0, 3))} ${esc(fechaLarga(p.dia).split(' ')[1] || '')} ${esc(hora(p.hora))}</span>`;
    }
    return `<div class="fila" style="font-size:13px"><span style="width:62px;color:var(--sec);flex:0 0 auto">${esc(etiqueta)}</span><span style="flex:1;min-width:0">${local ? '' : '<span style="color:var(--sec)">en </span>'}${esc(rival)}</span>${res}</div>`;
  };

  return `
    <button class="volver" data-volver>‹ Todos los equipos</button>
    <section class="ficha">
      <div class="top">
        ${escudo(f, 64)}
        <div>
          <div class="nombre">${esc(f.nombre)}</div>
          <div class="sub">${f.pj ? `${f.pos}º en la tabla · ${plural(f.pts, 'punto', 'puntos')}` : 'Todavía no jugó'}</div>
        </div>
      </div>
      <div class="stats">${[['PJ', f.pj], ['G', f.g], ['E', f.e], ['P', f.p], ['GF', f.gf], ['GC', f.gc]]
        .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
    </section>
    <section class="tarjeta">
      <div class="tarjeta-cab"><span style="flex:1">Plantel</span><span>Goles</span></div>
      ${filasJug.length ? filasJug.map((j) => `<div class="fila"><span style="flex:1;font-weight:500">${esc(j.nombre)}</span><span class="num-grande ${j.goles ? '' : 'cero'}">${j.goles || '–'}</span></div>`).join('')
        : '<div class="vacio" style="text-align:left">Todavía no se cargó el plantel de este equipo.</div>'}
    </section>
    <section class="tarjeta">
      <div class="tarjeta-cab">Partidos</div>
      ${partidos.length ? partidos.map(filaP).join('') : '<div class="vacio">Todavía no tiene partidos en el fixture.</div>'}
    </section>`;
}

// ── Goleadores y valla ─────────────────────────────────────

function vistaGoleadores(D) {
  const eqs = mapaEquipos(D);
  const g = calcularGoleadores(D);
  if (!g.length) return '<div class="tarjeta"><div class="vacio">Todavía no hay goles cargados.</div></div>';
  return `
    <section class="tarjeta" aria-label="Goleadores">
      <div class="tarjeta-cab"><span style="width:28px">#</span><span style="flex:1">Jugador</span><span>Goles</span></div>
      ${g.map((x) => {
        const eq = eqs.get(x.equipo_id);
        return `<div class="fila">
          <span style="width:28px;color:var(--sec);font-weight:600">${x.pos}</span>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column">
            <span style="font-weight:600">${esc(x.nombre)}</span>
            <span style="font-size:12px;color:var(--sec);display:flex;align-items:center;gap:5px">${escudo(eq, 14)}${esc(eq ? eq.nombre : '')}</span>
          </div>
          <span class="num-grande" style="font-size:22px">${x.goles}</span>
        </div>`;
      }).join('')}
    </section>`;
}

function vistaValla(D) {
  const v = calcularValla(D);
  if (!v.length) return '<div class="tarjeta"><div class="vacio">Todavía no hay partidos terminados.</div></div>';
  return `
    <section class="tarjeta" aria-label="Valla menos vencida">
      <div class="tarjeta-cab"><span style="width:28px">#</span><span style="flex:1">Equipo</span><span style="width:40px;text-align:center">PJ</span><span style="width:84px;text-align:right">Goles en contra</span></div>
      ${v.map((x) => `<div class="fila">
        <span style="width:28px;color:var(--sec);font-weight:600">${x.pos}</span>
        <span style="flex:1;display:flex;align-items:center;gap:6px;font-weight:600;min-width:0">${escudo(x, 18)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.nombre)}</span></span>
        <span style="width:40px;text-align:center">${x.pj}</span>
        <span class="num-grande" style="width:84px;color:var(--texto)">${x.gc}</span>
      </div>`).join('')}
    </section>
    <p class="pie">Cuenta los goles recibidos en la 1ª fase, por equipo.</p>`;
}

// ── Playoff ────────────────────────────────────────────────

const ORDEN_RONDAS = ['cuartos', 'semi', 'tercer_puesto', 'final_playoff', 'final', 'gran_final'];

function cruceHTML(p, eqs, { proyeccion = false } = {}) {
  const r = ganadorPartido(p);
  const jugado = !proyeccion && tieneResultado(p) && p.estado !== 'programado';
  const pen = hayPenales(p);
  const ln = (lado) => {
    const id = p[`${lado}_id`];
    const eq = eqs.get(id);
    const origen = p[`${lado}_origen`];
    const nombre = eq ? eq.nombre : origen || 'A definir';
    return `<div class="ln">
      ${eq ? escudo(eq, 18) : ''}
      <span class="n ${r && r.ganador === id ? 'gana' : ''}">${eq && origen && /º$/.test(origen) ? `<span class="o">${esc(origen)}</span> ` : ''}${esc(nombre)}</span>
      <span class="g">${jugado ? `${p[`goles_${lado}`]}${pen ? ` (${p[`penales_${lado}`]})` : ''}` : '–'}</span>
    </div>`;
  };
  let meta = '';
  if (!proyeccion) {
    if (p.estado === 'en_juego') meta = '<span style="color:var(--vivo);font-weight:700">En juego</span>';
    else if (p.estado === 'programado' && p.dia) meta = `${esc(fechaLarga(p.dia))} · ${esc(hora(p.hora))}`;
    else if (p.estado === 'suspendido') meta = 'Suspendido';
  }
  return `<div class="cruce">${ln('local')}${ln('visitante')}${meta ? `<div class="meta">${meta}</div>` : ''}</div>`;
}

function granFinalHTML(p, eqs, c, proyeccion) {
  const r = ganadorPartido(p);
  const lado = (l, der) => {
    const eq = eqs.get(p[`${l}_id`]);
    const origen = p[`${l}_origen`];
    const sub = origen === '1º' ? '1º todos contra todos' : origen === 'Ganador del playoff' ? 'Ganador del playoff' : origen || '';
    return `<div class="lado ${der ? 'der' : ''}"><b>${esc(eq ? eq.nombre : 'A definir')}</b><small>${esc(sub)}</small></div>`;
  };
  const jugado = !proyeccion && tieneResultado(p) && p.estado !== 'programado';
  const centro = jugado
    ? `<span class="marcador">${p.goles_local}${hayPenales(p) ? ` (${p.penales_local})` : ''} – ${p.goles_visitante}${hayPenales(p) ? ` (${p.penales_visitante})` : ''}</span>`
    : '<span style="font-family:var(--titulos);font-size:18px;color:var(--sobre-azul)">vs</span>';
  const cuando = !proyeccion && p.estado === 'programado' && p.dia ? `<small>${esc(fechaLarga(p.dia))} · ${esc(hora(p.hora))}</small>` : '';
  const campeon = r ? `<b style="font-size:16px">Campeón: ${esc(eqs.get(r.ganador)?.nombre || '')}</b>` : '';
  return `
    <section class="gran-final">
      <span class="tit">${p.ronda === 'final' ? 'FINAL' : 'GRAN FINAL'}</span>
      <div class="vs">${lado('local')}${centro}${lado('visitante', true)}</div>
      ${cuando}${campeon}
      <small>En los cruces, si empatan se define por penales.</small>
    </section>`;
}

function vistaPlayoff(D) {
  const c = cfg(D);
  const eqs = mapaEquipos(D);
  if (c.primero_modo === 'campeon') {
    const t = calcularTabla(D);
    const lider = t[0];
    return `<div class="tarjeta pad"><p style="margin:0">En este torneo no hay playoff: el 1º de la tabla sale campeón.</p>
      ${lider && lider.pj ? `<p class="ayuda">${primeraFaseTerminada(D) ? 'Campeón' : 'Hoy va 1º'}: <b>${esc(lider.nombre)}</b></p>` : ''}</div>`;
  }
  const real = hayPlayoff(D);
  let partidos;
  if (real) {
    partidos = (D.partidos || []).filter((p) => p.ronda !== 'todos');
  } else {
    partidos = armarCruces(c, calcularTabla(D)).flatMap((r) => r.partidos.map((p) => ({
      ronda: p.ronda, llave: p.llave,
      local_id: p.local.equipo_id, visitante_id: p.visitante.equipo_id,
      local_origen: p.local.origen, visitante_origen: p.visitante.origen,
    })));
    // En la proyección, los cruces que dependen de otros partidos no llevan equipo
    partidos.forEach((p) => {
      if (!/º$/.test(p.local_origen || '')) p.local_id = null;
      if (!/º$/.test(p.visitante_origen || '')) p.visitante_id = null;
    });
  }
  const proyeccion = !real;
  const hayTabla = calcularTabla(D).some((f) => f.pj > 0);
  if (proyeccion && !hayTabla) {
    partidos.forEach((p) => { p.local_id = null; p.visitante_id = null; });
  }

  const bloques = [];
  for (const ronda of ORDEN_RONDAS) {
    const ps = partidos.filter((p) => p.ronda === ronda).sort((a, b) => (a.llave || 0) - (b.llave || 0));
    if (!ps.length) continue;
    if (ronda === 'gran_final' || (ronda === 'final' && c.primero_modo !== 'final')) {
      bloques.push({ gran: true, html: granFinalHTML(ps[0], eqs, c, proyeccion) });
      continue;
    }
    let nota = '';
    if (ronda === 'final_playoff' && !c.tercer_puesto) nota = '<span class="ayuda">El que pierde queda 3º en el torneo.</span>';
    bloques.push({ html: `<span class="ronda-tit">${esc(ronda === 'semi' && c.primero_modo === 'final' ? 'Semifinales del playoff' : NOMBRE_RONDA[ronda])}</span>${ps.map((p) => cruceHTML(p, eqs, { proyeccion })).join('')}${nota}` });
  }
  const normales = bloques.filter((b) => !b.gran).map((b) => b.html).join('');
  const gran = bloques.filter((b) => b.gran).map((b) => b.html).join('');
  const pod = real ? podio(D) : null;
  const podioHTML = pod ? `
    <section class="tarjeta pad"><span class="titulo-seccion">Podio</span>
      <div class="podio">
        ${[['1º', pod.campeon], ['2º', pod.segundo], ['3º', pod.tercero]].filter(([, id]) => id).map(([k, id]) =>
          `<div style="display:flex;align-items:center;gap:8px"><b style="width:26px">${k}</b>${escudo(eqs.get(id), 22)}<span style="font-weight:600">${esc(eqs.get(id)?.nombre || '')}</span></div>`).join('')}
      </div></section>` : '';

  return `
    ${proyeccion ? `<p class="ayuda" style="margin:0 4px">${hayTabla ? 'Así quedarían los cruces con la tabla de hoy.' : 'Así se van a armar los cruces cuando termine la 1ª fase.'}</p>` : ''}
    ${podioHTML}
    ${normales ? `<section class="tarjeta pad" style="gap:10px">${normales}</section>` : ''}
    ${gran}
    ${!gran ? '<p class="pie">En los cruces, si empatan se define por penales.</p>' : ''}`;
}

// ── Eventos ────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) {
    if (t.dataset.tab === estado.pestana && !estado.equipoId) return;
    ir(t.dataset.tab);
    return;
  }
  const f = e.target.closest('[data-fecha]');
  if (f && !f.disabled) {
    const fechas = fechasOrdenadas(estado.D);
    const x = fechas[Number(f.dataset.fecha)];
    if (x) { estado.fechaId = x.id; render(); }
    return;
  }
  const eq = e.target.closest('[data-equipo]');
  if (eq) { ir('equipos', eq.dataset.equipo); scrollTo(0, 0); return; }
  if (e.target.closest('[data-volver]')) { ir('equipos'); }
});

addEventListener('hashchange', () => { leerHash(); render(); });

// ── Arranque ───────────────────────────────────────────────

leerHash();
pintarPestanas();
iniciarDatos({
  alCambiar(D, info) {
    estado.D = D;
    estado.desdeCache = !!info.desdeCache;
    render();
  },
  alEstado(e) {
    estado.sinConexion = e === 'sin_conexion';
    render();
  },
}).catch((err) => {
  console.warn('[torneo]', err);
  $('#contenido').innerHTML = '<div class="tarjeta"><div class="vacio">No pudimos cargar el torneo. Probá de nuevo en un rato.</div></div>';
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
