// Panel admin del torneo.
import { getDb, MODO, esErrorDeRed } from './db.js';
import { iniciarDatos } from './datos.js';
import {
  cfg, calcularTabla, calcularGoleadores, fechasOrdenadas, fechaEnCurso, esReprogramado, libresDeFecha, SIN_IDENTIFICAR,
  armarCruces, resolverCruces, hayPlayoff, primeraFaseTerminada, ganadorPartido, NOMBRE_DESEMPATE, NOMBRE_RONDA,
  nombreCruce, tieneResultado, CONFIG_DEFECTO,
} from './calculos.js';
import {
  armarFixture, armarPlayoff, moverFecha, puedeRegenerarFixture, itemsDeFecha, estadoSorteo, plantillaFixture, diasDeJuego,
} from './fixture.js';
import { esc, plural, fechaLarga, fechaCorta, hora, esFeriadoEspecial, normalizarNombre, ordinal } from './util.js';
import { protegerSalida } from './salida.js';
import { ICONO, escudo, mapaEquipos, nombreLado, aviso, dialogo, confirmar, hayPenales } from './ui.js';
import {
  placaPartido, placaFecha, placaTabla, placaGoleadores, placaProxima, placaPlayoff, archivoDePlaca, compartirArchivo, TIPOS_PLACA,
} from './placas.js';

const app = document.getElementById('app');

// ¿Se llegó desde el link del mail (invitación o "olvidé mi contraseña")?
const LLEGO_PARA_CREAR_CLAVE = new URLSearchParams(location.search).has('crear-clave')
  || /type=(invite|recovery)/.test(location.hash);
const LINK_VENCIDO = /error_code=otp_expired|error=access_denied/.test(location.hash);

/** Adónde vuelve el link del mail: esta misma página con ?crear-clave=1 */
function urlCrearClave() {
  return `${location.origin}${location.pathname}?crear-clave=1`;
}
let db;
let almacen;

const estado = {
  vista: 'resultados',
  conectado: true,
  yo: null,        // { id, email, nombre, rol }
  nombres: {},     // user_id → nombre, para "Cargó Juan"
  usuarios: null,  // lista de la pantalla Usuarios
  // Resultados
  fechaRes: null,
  partido: null,
  gol: { equipo: null, nombre: '', minuto: '', enContra: false },
  tarjeta: { equipo: null, nombre: '', minuto: '', tipo: 'amarilla' },
  directo: null, // partido en carga directa
  sugerirPlantel: null, // { equipo_id, nombre }
  // Fixture
  fechaFix: null,
  abierto: null,
  // Equipos
  equipo: null,
  nuevoJugador: '',
};

const D = () => almacen.D;
const soyAdmin = () => !!estado.yo && estado.yo.rol === 'admin';
const nombreDe = (userId) => (userId && estado.nombres[userId]) || null;

// ── Guardado ───────────────────────────────────────────────

const pendientes = [];
let reintentando = false;

async function guardar(fn, { ok, recargar = true } = {}) {
  try {
    const r = await fn();
    if (recargar) await almacen.recargar();
    if (ok) aviso(ok, 'ok', 1800);
    return r ?? true;
  } catch (err) {
    if (esErrorDeRed(err)) {
      aviso('Sin conexión. No se guardó. Lo vamos a reintentar solo.', 'error', 4500);
      pendientes.push(fn);
      estado.conectado = false;
      pintarCabecera();
    } else {
      console.warn('[torneo]', err);
      aviso(err && err.message && !err.detalle ? err.message : 'No se pudo guardar. Probá de nuevo.', 'error', 4500);
    }
    return null;
  }
}

async function reintentar() {
  if (reintentando || !pendientes.length || navigator.onLine === false) return;
  reintentando = true;
  try {
    while (pendientes.length) {
      await pendientes[0]();
      pendientes.shift();
    }
    await almacen.recargar();
    aviso('Listo: se guardó lo que había quedado pendiente.', 'ok');
  } catch (err) {
    if (!esErrorDeRed(err)) { pendientes.shift(); console.warn('[torneo]', err); }
  } finally {
    reintentando = false;
  }
}
setInterval(reintentar, 5000);
addEventListener('online', reintentar);

/** Cambia el dato en pantalla al instante y después lo guarda. */
function optimista(tabla, id, cambios) {
  const fila = (D()[tabla] || []).find((x) => x.id === id);
  if (fila) Object.assign(fila, cambios);
  render();
  return guardar(() => db.actualizar(tabla, id, cambios));
}

// ── Render seguro (no pisar lo que se está escribiendo) ───

let renderPendiente = false;
function renderSiSePuede() {
  const a = document.activeElement;
  if (a && a.closest && a.closest('main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox') {
    renderPendiente = true;
    return;
  }
  render();
}
document.addEventListener('focusout', () => {
  if (renderPendiente) setTimeout(() => { if (renderPendiente) { renderPendiente = false; renderSiSePuede(); } }, 150);
});

// ── Estructura ─────────────────────────────────────────────

const MENU = [
  ['resultados', 'Resultados', ICONO.resultados],
  ['fixture', 'Fixture', ICONO.calendario],
  ['equipos', 'Equipos', ICONO.equipos],
  ['formato', 'Formato', ICONO.formato],
  ['usuarios', 'Usuarios', ICONO.usuarios],
];

function esqueleto() {
  app.innerHTML = `
    <header class="cabecera"><div id="cab"></div><span id="conexion" class="conexion"></span></header>
    ${MODO === 'demo' ? '<div class="banda prueba">Modo de prueba: los datos quedan guardados solo en este navegador.</div>' : ''}
    <main class="contenido" id="contenido"></main>
    ${soyAdmin() ? `<nav class="menu-inferior" aria-label="Secciones del panel">
      ${MENU.map(([k, l, i]) => `<button data-vista="${k}">${i}<span>${l}</span></button>`).join('')}
    </nav>` : ''}`;
}

function pintarCabecera() {
  if (!almacen) return;
  const titulos = { resultados: soyAdmin() ? 'Panel del torneo' : 'Carga de resultados', fixture: 'Fixture y días', equipos: 'Equipos', formato: 'Formato del torneo', usuarios: 'Usuarios' };
  const c = cfg(D());
  let sub = c.nombre;
  if (estado.vista === 'resultados') {
    const f = fechaResultados();
    if (f) sub += ` · ${tituloFecha(f)} · ${fechaLarga(f.dia_previsto)}`;
  } else if (estado.vista === 'fixture') {
    const dias = (c.dias_juego || []).map((d) => ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][d]);
    sub = `Días de juego: ${dias.join(' y ')}`;
  } else if (estado.vista === 'equipos') {
    const eqs = D().equipos.filter((e) => e.activo !== false);
    const con = eqs.filter((e) => D().jugadores.some((j) => j.equipo_id === e.id)).length;
    sub = `${plural(eqs.length, 'equipo', 'equipos')} · ${con} con plantel`;
  } else if (estado.vista === 'formato') {
    sub = hayPlayoff(D()) ? 'El playoff ya está armado' : 'Se puede cambiar hasta que se arme el playoff';
  } else if (estado.vista === 'usuarios') {
    sub = 'Quién puede cargar datos del torneo';
  }
  const cab = document.getElementById('cab');
  if (!cab) return;
  cab.innerHTML = `<div class="titulo">${esc(titulos[estado.vista])}</div><div class="subtitulo">${esc(sub)}</div>`;
  const cx = document.getElementById('conexion');
  cx.className = `conexion ${estado.conectado ? 'ok' : 'no'}`;
  cx.textContent = estado.conectado ? 'Conectado' : 'Sin conexión';
  document.querySelectorAll('[data-vista]').forEach((b) => {
    if (b.dataset.vista === estado.vista) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function render() {
  if (!almacen) return;
  renderPendiente = false;
  pintarCabecera();
  if (!soyAdmin()) estado.vista = 'resultados'; // el cargador solo ve Resultados
  const vistas = { resultados: vistaResultados, fixture: vistaFixture, equipos: vistaEquipos, formato: vistaFormato, usuarios: vistaUsuarios };
  document.getElementById('contenido').innerHTML = vistas[estado.vista]();
}

function tituloFecha(f) {
  return f.fase === 'playoff' ? (f.nombre || `Fecha ${f.numero}`) : `Fecha ${f.numero}`;
}

function chipsFechas(seleccion, accion) {
  return `<div class="chips-fechas" role="group" aria-label="Fechas">${fechasOrdenadas(D()).map((f) => `
    <button class="chip-fecha" data-accion="${accion}" data-id="${f.id}" aria-pressed="${seleccion && seleccion.id === f.id}">
      <small>${f.fase === 'playoff' ? esc(abreviarRonda(f.nombre)) : 'Fecha'}</small><b>${f.numero}</b>
    </button>`).join('')}</div>`;
}

function abreviarRonda(n) {
  return ({ Semifinales: 'Semis', 'Final del playoff': 'Final P.', 'Gran final': 'Gran final', 'Cuartos de final': 'Cuartos', '3er puesto': '3º', Final: 'Final' })[n] || 'Playoff';
}

function chipEstado(p, fecha) {
  if (p.estado === 'finalizado') return '<span class="chip fin">Terminado</span>';
  if (p.estado === 'en_juego') return '<span class="chip vivo">En juego</span>';
  if (p.estado === 'suspendido') return '<span class="chip susp">Suspendido</span>';
  if (esReprogramado(p, fecha)) return `<span class="chip reprog">${esc(fechaCorta(p.dia))} ${esc(hora(p.hora))}</span>`;
  return `<span class="chip">${esc(hora(p.hora))}</span>`;
}

function textoPartido(p, eqs) {
  const res = tieneResultado(p) && p.estado !== 'programado' ? ` ${p.goles_local} – ${p.goles_visitante} ` : ' – ';
  return `${nombreLado(p, 'local', eqs)}${res}${nombreLado(p, 'visitante', eqs)}`;
}

// ═════════════════════════════════════════════════════════════
// RESULTADOS
// ═════════════════════════════════════════════════════════════

function fechaResultados() {
  const fechas = fechasOrdenadas(D());
  return fechas.find((f) => f.id === estado.fechaRes) || fechaEnCurso(D());
}

function vistaResultados() {
  if (estado.partido) {
    const p = D().partidos.find((x) => x.id === estado.partido);
    if (p) return vistaCarga(p);
    estado.partido = null;
  }
  const f = fechaResultados();
  if (!f) {
    return soyAdmin()
      ? `<div class="tarjeta pad"><p style="margin:0">Todavía no hay fixture. Primero cargá los equipos y después armá el fixture.</p>
      <button class="btn primario" data-vista="fixture">Ir a Fixture</button></div>`
      : `<div class="tarjeta pad"><p style="margin:0">Todavía no hay fixture armado.</p></div>${bloqueCuenta()}`;
  }
  const eqs = mapaEquipos(D());
  const ps = itemsDeFecha(D(), f).filter((x) => x.tipo === 'partido');
  const filas = ps.map((p) => `
    <button class="fila fila-btn" data-accion="abrir-partido" data-id="${p.id}">
      <span class="txt"><span style="font-weight:600">${esc(textoPartido(p, eqs))}</span>${p.ronda !== 'todos' ? `<span class="sub">${esc(nombreCruce(p.ronda, p.llave))}</span>` : ''}${p.estado === 'en_juego' && nombreDe(p.actualizado_por) ? `<span class="sub">Lo está cargando ${esc(nombreDe(p.actualizado_por))}</span>` : ''}</span>
      ${chipEstado(p, f)}
    </button>`).join('');
  return `
    ${chipsFechas(f, 'fecha-res')}
    <section class="tarjeta">
      <div class="tarjeta-cab" style="font-size:13px">${esc(tituloFecha(f))} · ${esc(fechaLarga(f.dia_previsto))}</div>
      ${filas || '<div class="vacio">Esta fecha no tiene partidos.</div>'}
    </section>
    <p class="ayuda" style="text-align:center">Tocá un partido para cargar el resultado.</p>
    <section class="tarjeta pad">
      <span style="font-weight:700">Placas para WhatsApp</span>
      <div class="placas">
        ${TIPOS_PLACA.map((t) => `<button class="btn" data-accion="placa" data-tipo="${t.id}">${ICONO.compartir}<span>${esc(t.texto)}</span></button>`).join('')}
      </div>
    </section>
    ${soyAdmin() ? '' : bloqueCuenta()}`;
}

/** Para el cargador (que no tiene menú): quién está conectado y cerrar sesión. */
function bloqueCuenta() {
  return `<section class="tarjeta pad">
      <span class="ayuda">Entraste como ${esc(estado.yo?.nombre || estado.yo?.email || '')} · cargás resultados</span>
      <button class="btn" data-accion="salir">${ICONO.salir}Cerrar sesión</button>
    </section>`;
}

function vistaCarga(p) {
  const eqs = mapaEquipos(D());
  const f = D().fechas.find((x) => x.id === p.fecha_id);
  const L = eqs.get(p.local_id);
  const V = eqs.get(p.visitante_id);
  const titulo = p.ronda === 'todos' ? `${tituloFecha(f)} · ${fechaLarga(p.dia)} · ${hora(p.hora)}` : `${nombreCruce(p.ronda, p.llave)} · ${fechaLarga(p.dia)} · ${hora(p.hora)}`;
  const volver = `<button class="volver" data-accion="cerrar-partido">‹ Partidos de la fecha</button>`;

  if (!L || !V) {
    return `${volver}<div class="tarjeta pad"><span style="font-weight:700">${esc(titulo)}</span>
      <p style="margin:0">Este cruce todavía no está definido: <b>${esc(nombreLado(p, 'local', eqs))}</b> contra <b>${esc(nombreLado(p, 'visitante', eqs))}</b>.</p>
      <p class="ayuda">Se completa solo cuando terminen los partidos anteriores.</p></div>`;
  }

  // Carga directa: el partido sigue "programado" (no se ve en la web) hasta que se guarda el resultado.
  const directo = soyAdmin() && p.estado === 'programado' && (estado.directo === p.id || tieneCargaDirecta(p));
  if (p.estado === 'suspendido' || (p.estado === 'programado' && !directo)) {
    return `${volver}
      <section class="tarjeta pad">
        <span class="ayuda">${esc(titulo)}</span>
        <div style="display:flex;align-items:center;justify-content:center;gap:14px;padding:8px 0">
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0">${escudo(L, 48)}<b style="text-align:center">${esc(L.nombre)}</b></div>
          <span style="font-family:var(--titulos);font-size:22px;color:var(--sec)">vs</span>
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0">${escudo(V, 48)}<b style="text-align:center">${esc(V.nombre)}</b></div>
        </div>
        ${p.estado === 'suspendido' ? '<div class="alerta">Este partido está suspendido.</div>' : ''}
        ${p.estado === 'suspendido'
          ? (soyAdmin() ? '<button class="btn grande primario" data-accion="reprogramar-partido">Volver a programarlo</button>' : '<p class="ayuda">Para volver a programarlo, avisale a un admin.</p>')
          : '<button class="btn grande primario" data-accion="empezar">Empezar partido</button>'}
        ${p.estado === 'programado' && soyAdmin() ? `<button class="btn grande secundario" data-accion="carga-directa">Cargar el resultado directo</button>
          <p class="ayuda">Para un partido ya jugado: ponés los goles, los autores y las tarjetas, y lo guardás de una. No hace falta empezarlo ni terminarlo.</p>` : ''}
        ${p.estado === 'programado' ? '<button class="btn peligro" data-accion="suspender">Suspender partido</button>' : ''}
        <p class="ayuda">Para cambiar el día o la hora, andá a Fixture.</p>
      </section>`;
  }

  const fin = p.estado === 'finalizado';
  const goles = D().goles.filter((g) => g.partido_id === p.id).sort((a, b) => (a.minuto ?? 999) - (b.minuto ?? 999) || String(a.created_at).localeCompare(String(b.created_at)));
  // El marcador sale de los goles: "+" agrega un gol de ese equipo y "−" quita el último.
  const golesDe = (eq) => goles.filter((x) => x.equipo_id === eq.id).length;
  const lado = (l, eq) => `
    <div class="lado">
      ${escudo(eq, 40)}
      <span class="n">${esc(eq.nombre)}</span>
      <div class="ctrl">
        <button class="btn-gol" data-accion="restar" data-lado="${l}" aria-label="Quitar el último gol de ${esc(eq.nombre)}" ${fin || !golesDe(eq) ? 'disabled' : ''}>${ICONO.menos}</button>
        <span class="goles" aria-live="polite">${golesDe(eq)}</span>
        <button class="btn-gol mas" data-accion="sumar" data-lado="${l}" aria-label="Agregar gol de ${esc(eq.nombre)}" ${fin ? 'disabled' : ''}>${ICONO.mas}</button>
      </div>
    </div>`;

  const g = estado.gol;
  if (!g.equipo || (g.equipo !== p.local_id && g.equipo !== p.visitante_id)) g.equipo = p.local_id;
  const rival = g.equipo === p.local_id ? p.visitante_id : p.local_id;
  const deQuien = g.enContra ? rival : g.equipo;
  const sugeridos = new Set(D().jugadores.filter((j) => j.equipo_id === deQuien && j.activo !== false).map((j) => j.nombre));
  if (!g.enContra) D().goles.filter((x) => x.equipo_id === deQuien && !x.en_contra).forEach((x) => sugeridos.add(x.jugador_nombre));
  const empatado = Number(p.goles_local ?? 0) === Number(p.goles_visitante ?? 0);
  const penales = p.ronda !== 'todos' && empatado;
  const sug = !fin && estado.sugerirPlantel && estado.sugerirPlantel.partido === p.id ? estado.sugerirPlantel : null;

  return `${volver}
    <section class="tarjeta pad" style="gap:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        ${fin ? '<span class="chip fin">Terminado</span>' : directo ? '<span class="chip">Carga del resultado</span>' : '<span class="estado-vivo">EN JUEGO</span>'}
        <span class="ayuda" style="text-align:right">${esc(titulo)}</span>
      </div>
      <div class="marcador-adm">${lado('local', L)}${lado('visitante', V)}</div>
      ${directo ? '<p class="ayuda">Todavía no se ve en la web: aparece cuando tocás "Guardar resultado".</p>' : ''}
      ${penales ? `
        <div style="border-top:1px solid var(--borde);padding-top:12px;display:flex;flex-direction:column;gap:8px">
          <span style="font-weight:700">Penales</span>
          <div class="dos">
            <label class="campo">${esc(L.nombre)}<input type="number" inputmode="numeric" min="0" max="99" data-campo="penales_local" value="${p.penales_local ?? ''}" ${fin ? 'disabled' : ''}></label>
            <label class="campo">${esc(V.nombre)}<input type="number" inputmode="numeric" min="0" max="99" data-campo="penales_visitante" value="${p.penales_visitante ?? ''}" ${fin ? 'disabled' : ''}></label>
          </div>
        </div>` : ''}
    </section>

    <section class="tarjeta pad" style="gap:10px">
      <span style="font-weight:700">Goles</span>
      ${goles.length ? goles.map((x) => {
        const eq = eqs.get(x.equipo_id);
        const quien = nombreDe(x.cargado_por);
        return `<div class="gol-item">${escudo(eq, 22)}<span class="n">${esc(x.jugador_nombre)}${x.en_contra ? ' <small>(en contra)</small>' : ''}${x.minuto !== null && x.minuto !== undefined ? ` <small>${x.minuto}'</small>` : ''}${quien ? `<small style="display:block">Cargó ${esc(quien)}</small>` : ''}</span>
          ${fin ? '' : `<button class="btn-icono" data-accion="quitar-gol" data-id="${x.id}" aria-label="Quitar gol de ${esc(x.jugador_nombre)}">${ICONO.cerrar}</button>`}</div>`;
      }).join('') : '<span class="ayuda">Todavía no hay goles cargados.</span>'}
      ${sug ? `<div class="alerta info" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="flex:1;min-width:180px">${esc(sug.nombre)} no está en el plantel de ${esc(eqs.get(sug.equipo_id)?.nombre || '')}.</span>
          <button class="btn secundario" data-accion="agregar-al-plantel">Agregar al plantel</button>
        </div>` : ''}
      ${fin ? '' : `
      <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--borde);padding-top:10px">
        <span class="ayuda">¿Para quién es el gol?</span>
        <div class="equipo-btns">
          ${[L, V].map((e) => `<button class="btn" data-accion="gol-equipo" data-id="${e.id}" aria-pressed="${g.equipo === e.id}">${escudo(e, 20)}<span>${esc(e.nombre)}</span></button>`).join('')}
        </div>
        <label class="campo">${g.enContra ? `Jugador de ${esc(eqs.get(rival)?.nombre || '')} que lo hizo en contra` : 'Jugador'}
          <input id="gol-nombre" list="sugeridos" autocomplete="off" value="${esc(g.nombre)}" data-gol="nombre" placeholder="Escribí el nombre">
        </label>
        <datalist id="sugeridos">${[...sugeridos].sort((a, b) => a.localeCompare(b, 'es')).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        <div class="dos" style="align-items:end">
          <label class="campo">Minuto (opcional)<input type="number" inputmode="numeric" min="0" max="200" data-gol="minuto" value="${esc(g.minuto)}"></label>
          <label class="check"><input type="checkbox" data-gol="enContra" ${g.enContra ? 'checked' : ''}> En contra</label>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn secundario" style="flex:1" data-accion="agregar-gol">Agregar gol</button>
          <button class="btn" data-accion="gol-sin-identificar" style="font-size:13px">Gol sin identificar</button>
        </div>
        <p class="ayuda">Si no sabés quién lo hizo, usá "Gol sin identificar": suma al marcador y después se puede corregir.</p>
      </div>`}
    </section>

    ${seccionTarjetas(p, L, V, fin)}

    <div style="display:flex;flex-direction:column;gap:8px">
      ${fin
        ? (soyAdmin() ? '<button class="btn grande" data-accion="corregir">Corregir resultado</button>' : '<p class="ayuda" style="text-align:center">Para corregir un partido terminado, avisale a un admin.</p>')
        : `<button class="btn grande primario" data-accion="terminar">${directo ? 'Guardar resultado' : 'Terminar partido'}</button>`}
      ${directo ? '' : `<button class="btn grande" data-accion="placa-partido">${ICONO.compartir}Compartir placa del resultado</button>`}
      ${fin || directo ? '' : '<button class="btn peligro" data-accion="suspender">Suspender partido</button>'}
    </div>`;
}

/** ¿El partido programado ya tiene algo cargado (marcador, goles o tarjetas)? Entonces se sigue en carga directa. */
function tieneCargaDirecta(p) {
  return (p.goles_local !== null && p.goles_local !== undefined) || (p.goles_visitante !== null && p.goles_visitante !== undefined)
    || D().goles.some((g) => g.partido_id === p.id) || (D().tarjetas || []).some((t) => t.partido_id === p.id);
}

function seccionTarjetas(p, L, V, fin) {
  const eqs = mapaEquipos(D());
  const lista = (D().tarjetas || []).filter((t) => t.partido_id === p.id)
    .sort((a, b) => (a.minuto ?? 999) - (b.minuto ?? 999) || String(a.created_at).localeCompare(String(b.created_at)));
  const t = estado.tarjeta;
  if (!t.equipo || (t.equipo !== p.local_id && t.equipo !== p.visitante_id)) t.equipo = p.local_id;
  const sugeridos = new Set(D().jugadores.filter((j) => j.equipo_id === t.equipo && j.activo !== false).map((j) => j.nombre));
  D().goles.filter((g) => g.equipo_id === t.equipo && !g.en_contra).forEach((g) => sugeridos.add(g.jugador_nombre));
  (D().tarjetas || []).filter((x) => x.equipo_id === t.equipo).forEach((x) => sugeridos.add(x.jugador_nombre));
  return `
    <section class="tarjeta pad" style="gap:10px">
      <span style="font-weight:700">Tarjetas</span>
      ${lista.length ? lista.map((x) => `<div class="gol-item">
          <span class="ico-tarjeta ${x.tipo}" role="img" aria-label="${x.tipo === 'roja' ? 'Roja' : 'Amarilla'}"></span>
          ${escudo(eqs.get(x.equipo_id), 22)}
          <span class="n">${esc(x.jugador_nombre)}${x.minuto !== null && x.minuto !== undefined ? ` <small>${x.minuto}'</small>` : ''}</span>
          ${fin ? '' : `<button class="btn-icono" data-accion="quitar-tarjeta" data-id="${x.id}" aria-label="Quitar tarjeta de ${esc(x.jugador_nombre)}">${ICONO.cerrar}</button>`}
        </div>`).join('') : '<span class="ayuda">Sin tarjetas.</span>'}
      ${fin ? '' : `
      <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--borde);padding-top:10px">
        <div class="segmento" role="group" aria-label="Tipo de tarjeta">
          <button class="btn" data-accion="tarjeta-tipo" data-valor="amarilla" aria-pressed="${t.tipo === 'amarilla'}"><span class="ico-tarjeta amarilla" aria-hidden="true"></span>Amarilla</button>
          <button class="btn" data-accion="tarjeta-tipo" data-valor="roja" aria-pressed="${t.tipo === 'roja'}"><span class="ico-tarjeta roja" aria-hidden="true"></span>Roja</button>
        </div>
        <div class="equipo-btns">
          ${[L, V].map((e) => `<button class="btn" data-accion="tarjeta-equipo" data-id="${e.id}" aria-pressed="${t.equipo === e.id}">${escudo(e, 20)}<span>${esc(e.nombre)}</span></button>`).join('')}
        </div>
        <label class="campo">Jugador amonestado o expulsado
          <input id="tarjeta-nombre" list="sugeridos-tarjeta" autocomplete="off" value="${esc(t.nombre)}" data-tarjeta="nombre" placeholder="Escribí el nombre">
        </label>
        <datalist id="sugeridos-tarjeta">${[...sugeridos].sort((a, b) => a.localeCompare(b, 'es')).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        <label class="campo">Minuto de la tarjeta (opcional)<input type="number" inputmode="numeric" min="0" max="200" data-tarjeta="minuto" value="${esc(t.minuto)}"></label>
        <button class="btn secundario" data-accion="agregar-tarjeta">Agregar tarjeta</button>
      </div>`}
    </section>`;
}

function guardarFormTarjeta() {
  const n = document.querySelector('[data-tarjeta="nombre"]');
  const m = document.querySelector('[data-tarjeta="minuto"]');
  if (n) estado.tarjeta.nombre = n.value;
  if (m) estado.tarjeta.minuto = m.value;
}

async function agregarTarjeta() {
  guardarFormTarjeta();
  const p = partidoActual();
  const t = estado.tarjeta;
  const nombre = normalizarNombre(t.nombre);
  if (!nombre) { aviso('Escribí el nombre del jugador.', 'error'); document.getElementById('tarjeta-nombre')?.focus(); return; }
  const jug = D().jugadores.find((j) => j.equipo_id === t.equipo && j.nombre.trim().toLowerCase() === nombre.toLowerCase());
  const minuto = t.minuto === '' || t.minuto === null ? null : Math.max(0, parseInt(t.minuto, 10) || 0);
  const fila = { partido_id: p.id, equipo_id: t.equipo, jugador_id: jug ? jug.id : null, jugador_nombre: jug ? jug.nombre : nombre, tipo: t.tipo, minuto };
  if (!D().tarjetas) almacen.D.tarjetas = [];
  D().tarjetas.push({ ...fila, id: `tmp-${Date.now()}`, created_at: new Date().toISOString() });
  estado.tarjeta = { ...t, nombre: '', minuto: '' };
  render();
  await guardar(() => db.insertar('tarjetas', [fila]), { ok: t.tipo === 'roja' ? 'Roja cargada' : 'Amarilla cargada' });
}

function partidoActual() {
  return D().partidos.find((x) => x.id === estado.partido);
}

async function agregarGol({ sinIdentificar = false } = {}) {
  const p = partidoActual();
  const g = estado.gol;
  const input = document.getElementById('gol-nombre');
  if (input) g.nombre = input.value;
  if (sinIdentificar) { g.nombre = SIN_IDENTIFICAR; g.enContra = false; }
  const nombre = normalizarNombre(g.nombre);
  if (!nombre) { aviso('Escribí el nombre del jugador.', 'error'); input && input.focus(); return; }
  const rival = g.equipo === p.local_id ? p.visitante_id : p.local_id;
  const deQuien = g.enContra ? rival : g.equipo;
  const jug = D().jugadores.find((j) => j.equipo_id === deQuien && j.nombre.trim().toLowerCase() === nombre.toLowerCase());
  const minuto = g.minuto === '' || g.minuto === null ? null : Math.max(0, parseInt(g.minuto, 10) || 0);
  const lado = g.equipo === p.local_id ? 'local' : 'visitante';
  const nuevo = (Number(p[`goles_${lado}`]) || 0) + 1;
  const fila = { partido_id: p.id, equipo_id: g.equipo, jugador_id: jug ? jug.id : null, jugador_nombre: jug ? jug.nombre : nombre, en_contra: !!g.enContra, minuto };
  // En pantalla al instante
  p[`goles_${lado}`] = nuevo;
  estado.gol = { equipo: g.equipo, nombre: '', minuto: '', enContra: false };
  estado.sugerirPlantel = !jug && !g.enContra && !sinIdentificar ? { partido: p.id, equipo_id: deQuien, nombre } : null;
  D().goles.push({ ...fila, id: `tmp-${Date.now()}`, created_at: new Date().toISOString(), cargado_por: estado.yo?.id });
  render();
  // El marcador del partido lo recalcula la base a partir de los goles.
  const r = await guardar(() => db.insertar('goles', [fila]), { ok: 'Gol cargado' });
  if (!r) { await almacen.recargar(); render(); }
}

async function quitarGol(id) {
  const p = partidoActual();
  let g = D().goles.find((x) => x.id === id);
  if (!g) return;
  if (String(g.id).startsWith('tmp-')) {
    // Recién cargado: todavía no tiene su id de la base. Se trae de nuevo y se busca el mismo gol.
    const { partido_id: pid, equipo_id: eq, jugador_nombre: n } = g;
    await almacen.recargar();
    g = D().goles.filter((x) => x.partido_id === pid && x.equipo_id === eq && x.jugador_nombre === n)
      .sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)))[0];
    if (!g) return;
    id = g.id;
  }
  const lado = g.equipo_id === p.local_id ? 'local' : 'visitante';
  const nuevo = Math.max(0, (Number(p[`goles_${lado}`]) || 0) - 1);
  p[`goles_${lado}`] = nuevo;
  almacen.D.goles = D().goles.filter((x) => x.id !== id);
  render();
  const r = await guardar(() => db.borrar('goles', [id]), { ok: 'Gol quitado' });
  if (!r) { await almacen.recargar(); render(); }
}

async function terminarPartido() {
  const p = partidoActual();
  const gl = D().goles.filter((x) => x.partido_id === p.id && x.equipo_id === p.local_id).length;
  const gv = D().goles.filter((x) => x.partido_id === p.id && x.equipo_id === p.visitante_id).length;
  const empate = gl === gv;
  if (p.ronda !== 'todos' && empate) {
    if (!hayPenales(p) || Number(p.penales_local) === Number(p.penales_visitante)) {
      aviso('Empataron: cargá los penales (con un ganador) antes de terminar.', 'error', 4500);
      return;
    }
  }
  const eqs = mapaEquipos(D());
  const directo = p.estado === 'programado';
  const marcador = `${nombreLado(p, 'local', eqs)} ${gl} – ${gv} ${nombreLado(p, 'visitante', eqs)}`;
  const ok = directo
    ? await confirmar(`¿Guardar el resultado ${marcador}? Va a aparecer en la web como terminado.`, { si: 'Guardar' })
    : await confirmar(`¿Terminar el partido ${marcador}?`, { si: 'Terminar' });
  if (!ok) return;
  estado.directo = null;
  const definidos = () => D().partidos.filter((x) => x.ronda !== 'todos').reduce((n, x) => n + (x.local_id ? 1 : 0) + (x.visitante_id ? 1 : 0), 0);
  const antes = definidos();
  const r = await guardar(() => db.cambiarEstado(p.id, 'finalizado'), { ok: directo ? 'Resultado guardado' : 'Partido terminado' });
  // Los ganadores pasan solos al cruce siguiente (lo hace la base al terminar)
  if (r && p.ronda !== 'todos' && definidos() > antes) aviso('Se actualizaron los cruces siguientes.', 'ok');
}

/** Cambia el estado del partido por la función de la base (respeta los permisos de cada rol). */
async function cambiarEstado(nuevo, opciones) {
  const p = partidoActual();
  p.estado = nuevo;
  render();
  const r = await guardar(() => db.cambiarEstado(p.id, nuevo), opciones);
  if (!r) { await almacen.recargar(); render(); }
  return r;
}


// ═════════════════════════════════════════════════════════════
// FIXTURE
// ═════════════════════════════════════════════════════════════

function fechaFixture() {
  const fechas = fechasOrdenadas(D());
  return fechas.find((f) => f.id === estado.fechaFix) || fechaEnCurso(D());
}

function vistaFixture() {
  const hayTodos = D().fechas.some((f) => f.fase === 'todos');
  const activos = D().equipos.filter((e) => e.activo !== false);
  const c = cfg(D());
  if (!hayTodos) return vistaSorteo(activos, c);
  const f = fechaFixture();
  const eqs = mapaEquipos(D());
  const items = itemsDeFecha(D(), f);
  const feriado = esFeriadoEspecial(f.dia_previsto);
  const filas = items.map((it) => {
    const key = it.id;
    const abierto = estado.abierto === key;
    const act = it.tipo === 'actividad';
    const reprog = !act && esReprogramado(it, f);
    const txt = act ? it.titulo : `${nombreLado(it, 'local', eqs)} vs ${nombreLado(it, 'visitante', eqs)}`;
    const sub = `${fechaLarga(it.dia)} · ${hora(it.hora)}${reprog ? ' · reprogramado' : ''}${!act && it.ronda !== 'todos' ? ` · ${nombreCruce(it.ronda, it.llave)}` : ''}${!act && it.estado === 'finalizado' ? ' · terminado' : ''}${!act && it.estado === 'suspendido' ? ' · suspendido' : ''}`;
    return `
      <div class="${act ? 'actividad-adm' : ''}" style="border-top:1px solid var(--borde)">
        <div class="fila" style="border-top:0">
          <span class="txt">${act ? '<span style="font-size:11px;font-weight:700;letter-spacing:.5px;color:#5b4a00;display:block">FUERA DEL TORNEO</span>' : ''}<span style="font-weight:600">${esc(txt)}</span><span class="sub ${reprog ? 'reprog' : ''}">${esc(sub)}</span></span>
          <button class="btn-icono borde" data-accion="abrir-item" data-id="${key}" aria-label="Cambiar día y hora de ${esc(txt)}" aria-expanded="${abierto}">${ICONO.calendario}</button>
        </div>
        ${abierto ? `
          <div class="editor">
            ${act ? `<label class="campo">Qué se juega<input data-item="${key}" data-tipo="${it.tipo}" data-campo="titulo" value="${esc(it.titulo)}"></label>` : ''}
            <div class="dos">
              <label class="campo">Día<input type="date" data-item="${key}" data-tipo="${it.tipo}" data-campo="dia" value="${esc(it.dia)}"></label>
              <label class="campo">Hora<input type="time" data-item="${key}" data-tipo="${it.tipo}" data-campo="hora" value="${esc(hora(it.hora))}"></label>
            </div>
            <p class="ayuda">${act ? 'No cuenta para la tabla ni para los goleadores.' : 'Si el día no es el de la fecha, en la web aparece como reprogramado.'}</p>
            <div style="display:flex;gap:8px">
              ${act ? `<button class="btn peligro" data-accion="quitar-actividad" data-id="${key}">Quitar</button>` : ''}
              <button class="btn primario" style="flex:1" data-accion="cerrar-item">Listo</button>
            </div>
          </div>` : ''}
      </div>`;
  }).join('');
  const libres = libresDeFecha(D(), f).map((e) => `<div class="libre">Libre: ${esc(e.nombre)}</div>`).join('');
  const puede = puedeRegenerarFixture(D()) && !hayPlayoff(D());
  return `
    ${chipsFechas(f, 'fecha-fix')}
    <section class="tarjeta pad" style="flex-direction:row;align-items:center;justify-content:space-between;gap:10px">
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <span class="ayuda">Día previsto de ${f.fase === 'playoff' ? esc(f.nombre || 'la fecha') : `la fecha ${f.numero}`}</span>
        <span style="font-weight:700;font-size:16px">${esc(fechaLarga(f.dia_previsto))}</span>
      </div>
      <button class="btn secundario" data-accion="mover-fecha" style="font-size:13px">Mover toda la fecha</button>
    </section>
    ${feriado ? `<div class="alerta">${esc(feriado)} Si hace falta, movela.</div>` : ''}
    <section class="tarjeta" style="overflow:visible">
      ${filas ? filas.replace('border-top:1px solid var(--borde)', 'border-top:0') : '<div class="vacio">Esta fecha no tiene partidos.</div>'}
      ${libres}
    </section>
    <button class="btn punteado" data-accion="agregar-actividad" style="min-height:48px">+ Agregar partido exhibición u otra actividad</button>
    <p class="ayuda" style="text-align:center">No suma puntos ni goles. Se muestra en la fecha, ordenado por hora.</p>
    ${puede ? `<button class="btn peligro" data-accion="borrar-fixture" style="margin-top:12px">Borrar el fixture y volver al sorteo</button>
      <p class="ayuda" style="text-align:center">Se puede mientras no haya ningún resultado cargado. Los números del sorteo quedan guardados.</p>` : ''}`;
}

/** Antes de armar el fixture: cada número del sorteo con su equipo, y cómo queda cada fecha. */
function vistaSorteo(activos, c) {
  const n = activos.length;
  if (n < 2) {
    return `<section class="tarjeta pad"><span style="font-weight:700">Sorteo y fixture</span>
      <div class="alerta">Primero cargá al menos 2 equipos.</div>
      <button class="btn primario" data-vista="equipos">Ir a Equipos</button></section>`;
  }
  const s = estadoSorteo(D());
  const plantilla = plantillaFixture(n);
  const dias = diasDeJuego(c.fecha_inicio, c.dias_juego, plantilla.length);
  const ordenados = activos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const etiqueta = (k) => {
    const e = s.porNumero.get(k);
    return e ? `<b>${k}</b> ${esc(e.nombre)}` : `<b>${k}</b>`;
  };
  const faltan = n - s.porNumero.size;

  const numeros = Array.from({ length: n }, (_, i) => i + 1).map((k) => {
    const actual = s.porNumero.get(k);
    return `<label class="fila" style="gap:10px">
      <span class="pos playoff" style="width:34px;height:34px;font-size:15px;flex:0 0 auto">${k}</span>
      <span class="sr">Equipo con el número ${k}</span>
      <select class="entrada" data-sorteo="${k}" style="flex:1;min-width:0">
        <option value="">Elegir equipo…</option>
        ${ordenados.map((e) => {
          const otro = s.porNumero.get(Number(e.numero_sorteo)) === e && Number(e.numero_sorteo) !== k ? ` (tiene el ${e.numero_sorteo})` : '';
          return `<option value="${e.id}" ${actual === e ? 'selected' : ''}>${esc(e.nombre)}${otro}</option>`;
        }).join('')}
      </select>
    </label>`;
  }).join('');

  const fechas = plantilla.map((r, i) => {
    const aviso = esFeriadoEspecial(dias[i]);
    return `<div style="border-top:1px solid var(--borde);padding:10px 12px;display:flex;flex-direction:column;gap:4px">
      <span style="font-weight:700">Fecha ${i + 1} · <span style="font-weight:500;color:var(--sec)">${esc(fechaLarga(dias[i]))}</span></span>
      ${r.partidos.map((p) => `<span style="font-size:13px">${etiqueta(p.local)} <span style="color:var(--sec)">vs</span> ${etiqueta(p.visitante)}</span>`).join('')}
      ${r.libre ? `<span class="ayuda">Libre: ${etiqueta(r.libre)}</span>` : ''}
      ${aviso ? `<span class="ayuda" style="color:var(--reprog)">${esc(aviso)}</span>` : ''}
    </div>`;
  }).join('');

  return `
    <section class="tarjeta pad" style="gap:8px">
      <span style="font-weight:700">Sorteo</span>
      <p class="ayuda" style="font-size:13px">Cada equipo saca un número. El día del sorteo, elegí qué equipo sacó cada número y el fixture se arma según el cuadro de abajo.</p>
    </section>
    <section class="tarjeta">${numeros}</section>
    ${s.porNumero.size ? '<button class="btn" data-accion="limpiar-sorteo">Borrar los números</button>' : ''}

    <section class="tarjeta">
      <div class="tarjeta-cab" style="font-size:13px">Así se arma el fixture</div>
      <p class="ayuda" style="padding:8px 12px 0">Todos contra todos una sola vez${n % 2 ? ', y cada uno queda libre una sola fecha' : ''}. ${plural(plantilla.length, 'fecha', 'fechas')} de ${plural(plantilla[0].partidos.length, 'partido', 'partidos')}.</p>
      ${fechas}
    </section>

    <section class="tarjeta pad">
      ${s.completo
        ? '<p class="ayuda">Están todos los números asignados.</p>'
        : `<div class="alerta">${faltan === 1 ? 'Falta asignar 1 número' : `Faltan asignar ${faltan} números`}.</div>`}
      <button class="btn grande primario" data-accion="armar-fixture" ${s.completo ? '' : 'disabled'}>Armar fixture</button>
      <p class="ayuda">Los partidos caen ${esc(textoDiasJuego(c))} desde el ${esc(fechaLarga(c.fecha_inicio).toLowerCase())}, el primero a las ${esc(hora(c.hora_primer_partido))} y uno cada ${c.minutos_entre_partidos} minutos. Se cambia en Formato.</p>
    </section>`;
}

function textoDiasJuego(c) {
  const nombres = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
  const d = (c.dias_juego || []).map((x) => nombres[x]);
  return d.length > 1 ? `${d.slice(0, -1).join(', ')} y ${d[d.length - 1]}` : d[0] || '';
}

/** Asigna el número k al equipo (o lo deja vacío). Libera el número primero porque no puede repetirse. */
async function asignarNumero(k, equipoId) {
  const s = estadoSorteo(D());
  const anterior = s.porNumero.get(k);
  if (anterior && anterior.id === equipoId) return;
  const cambios = [];
  if (anterior) cambios.push([anterior.id, null]);
  if (equipoId) cambios.push([equipoId, k]);
  for (const [id, num] of cambios) {
    const e = D().equipos.find((x) => x.id === id);
    if (e) e.numero_sorteo = num;
  }
  render();
  await guardar(async () => {
    for (const [id, num] of cambios) await db.actualizar('equipos', id, { numero_sorteo: num });
  });
}

async function crearFechas(fechas) {
  const filas = await db.insertar('fechas', fechas.map(({ numero, fase, nombre, dia_previsto }) => ({ numero, fase, nombre, dia_previsto })));
  const porNumero = new Map(filas.map((f) => [Number(f.numero), f.id]));
  const partidos = fechas.flatMap((f) => f.partidos.map((p) => ({ ...p, fecha_id: porNumero.get(Number(f.numero)) })));
  if (partidos.length) await db.insertar('partidos', partidos);
}

/** Borra el fixture de la 1ª fase (si no hay resultados) y vuelve a la pantalla del sorteo. */
async function borrarElFixture() {
  if (!puedeRegenerarFixture(D()) || hayPlayoff(D())) {
    aviso('Ya hay resultados cargados: el fixture no se puede borrar.', 'error', 4500);
    return;
  }
  const ok = await confirmar('Se borra el fixture actual (partidos, días y actividades) y volvés a la pantalla del sorteo para armarlo de nuevo. ¿Seguimos?', { si: 'Borrar', peligro: true });
  if (!ok) return;
  const r = await guardar(() => db.borrar('fechas', D().fechas.filter((f) => f.fase === 'todos').map((f) => f.id)), { ok: 'Fixture borrado' });
  if (r) {
    estado.fechaFix = null;
    estado.abierto = null;
    render();
    scrollTo(0, 0);
  }
}

async function armarElFixture() {
  if (D().fechas.some((f) => f.fase === 'todos')) {
    aviso('Ya hay un fixture armado. Para empezar de nuevo, borralo primero.', 'error', 4500);
    return;
  }
  const { fechas, avisos, faltan } = armarFixture(D());
  if (!fechas.length) {
    if (faltan) aviso(faltan === 1 ? 'Falta asignar 1 número del sorteo.' : `Faltan asignar ${faltan} números del sorteo.`, 'error');
    return;
  }
  const r = await guardar(() => crearFechas(fechas), { ok: `Fixture listo: ${plural(fechas.length, 'fecha', 'fechas')}` });
  if (r) {
    estado.fechaFix = null;
    if (avisos.length) await dialogo({ titulo: 'Ojo con estas fechas', contenido: `<p>${avisos.map(esc).join('<br>')}</p><p class="ayuda">No se movieron solas. Si hace falta, movelas con "Mover toda la fecha".</p>` });
    render();
  }
}

async function moverLaFecha() {
  const f = fechaFixture();
  const r = await dialogo({
    titulo: `Mover ${f.fase === 'playoff' ? f.nombre : `la fecha ${f.numero}`}`,
    contenido: `<label class="campo">Nuevo día<input type="date" name="dia" value="${esc(f.dia_previsto)}" required></label>
      <p class="ayuda">Se corren todos los partidos y actividades que estaban el ${esc(fechaLarga(f.dia_previsto).toLowerCase())}. Los que ya estaban en otro día quedan como están.</p>`,
    botones: [{ texto: 'Cancelar', valor: false, clase: 'secundario' }, { texto: 'Mover', valor: true, clase: 'primario' }],
  });
  if (!r.valor || !r.datos.dia || r.datos.dia === f.dia_previsto) return;
  const nuevo = r.datos.dia;
  const m = moverFecha(D(), f, nuevo);
  await guardar(async () => {
    await db.actualizar('fechas', f.id, { dia_previsto: nuevo });
    for (const p of m.partidos) await db.actualizar('partidos', p.id, { dia: p.dia });
    for (const a of m.actividades) await db.actualizar('actividades', a.id, { dia: a.dia });
  }, { ok: `Fecha movida al ${fechaLarga(nuevo).toLowerCase()}` });
  const aviso2 = esFeriadoEspecial(nuevo);
  if (aviso2) aviso(aviso2, 'info', 4000);
}

async function agregarActividad() {
  const f = fechaFixture();
  const c = cfg(D());
  const r = await guardar(() => db.insertar('actividades', [{ fecha_id: f.id, titulo: 'Partido exhibición', dia: f.dia_previsto, hora: hora(c.hora_primer_partido) }]));
  if (r && r[0]) { estado.abierto = r[0].id; render(); }
}

// ═════════════════════════════════════════════════════════════
// EQUIPOS
// ═════════════════════════════════════════════════════════════

function vistaEquipos() {
  const eqs = D().equipos.slice().sort((a, b) => (b.activo !== false) - (a.activo !== false) || a.nombre.localeCompare(b.nombre, 'es'));
  if (estado.equipo) {
    const e = D().equipos.find((x) => x.id === estado.equipo);
    if (e) return detalleEquipo(e);
    estado.equipo = null;
  }
  return `
    <button class="btn primario" data-accion="nuevo-equipo">${ICONO.mas}Nuevo equipo</button>
    <section class="tarjeta">
      ${eqs.length ? eqs.map((e) => {
        const n = D().jugadores.filter((j) => j.equipo_id === e.id).length;
        return `<button class="fila fila-btn" data-accion="abrir-equipo" data-id="${e.id}">
          ${escudo(e, 32)}
          <span class="txt" style="font-weight:600">${esc(e.nombre)}</span>
          ${e.numero_sorteo ? `<span class="chip">Nº ${e.numero_sorteo}</span>` : ''}
          ${e.activo === false ? '<span class="chip susp">Inactivo</span>' : ''}
          <span class="ayuda">${n ? plural(n, 'jugador', 'jugadores') : 'Sin plantel'}</span>
        </button>`;
      }).join('') : '<div class="vacio">Todavía no hay equipos. Tocá "Nuevo equipo" para empezar.</div>'}
    </section>`;
}

function detalleEquipo(e) {
  const goles = calcularGoleadores(D()).filter((g) => g.equipo_id === e.id);
  const jugadores = D().jugadores.filter((j) => j.equipo_id === e.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const golesDe = (j) => (goles.find((g) => g.jugador_id === j.id || (!g.jugador_id && g.nombre.toLowerCase() === j.nombre.toLowerCase())) || {}).goles || 0;
  const jugo = D().partidos.some((p) => p.local_id === e.id || p.visitante_id === e.id);
  return `
    <button class="volver" data-accion="cerrar-equipo">‹ Todos los equipos</button>
    <section class="tarjeta pad">
      <div style="display:flex;align-items:center;gap:14px">
        ${escudo(e, 64)}
        <div style="display:flex;flex-direction:column;gap:6px;flex:1">
          <label class="btn secundario" style="font-size:14px">${ICONO.subir}Subir escudo
            <input type="file" accept="image/*" data-accion-cambio="escudo" class="sr">
          </label>
          ${e.escudo_url ? '<button class="btn" style="font-size:13px;min-height:40px" data-accion="quitar-escudo">Quitar escudo</button>' : '<span class="ayuda">Foto o imagen del celular. Si no hay, se muestra la inicial.</span>'}
        </div>
      </div>
      <label class="campo">Nombre del equipo<input data-equipo-campo="nombre" value="${esc(e.nombre)}" maxlength="40"></label>
      <label class="campo">Color (se usa cuando no hay escudo)<input type="color" data-equipo-campo="color" value="${esc(e.color || '#0b2d5b')}"></label>

      <div style="display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--borde);padding-top:12px">
        <span style="font-weight:700">Plantel</span><span class="ayuda">Opcional</span>
      </div>
      ${jugadores.length ? jugadores.map((j) => {
        const g = golesDe(j);
        return `<div class="gol-item"><span class="n">${esc(j.nombre)}</span><small>${g ? plural(g, 'gol', 'goles') : ''}</small>
          <button class="btn-icono" data-accion="quitar-jugador" data-id="${j.id}" aria-label="Quitar a ${esc(j.nombre)}">${ICONO.cerrar}</button></div>`;
      }).join('') : '<span class="ayuda">Sin jugadores cargados. Los goles se pueden cargar igual escribiendo el nombre.</span>'}
      <div style="display:flex;gap:8px">
        <label for="nuevo-jugador" class="sr">Nuevo jugador</label>
        <input id="nuevo-jugador" class="entrada" style="flex:1;min-width:0" placeholder="Nombre y apellido" value="${esc(estado.nuevoJugador)}" data-nuevo-jugador>
        <button class="btn primario" data-accion="agregar-jugador">Agregar</button>
      </div>
      <button class="btn punteado" data-accion="pegar-lista" style="font-size:13px">Pegar lista de jugadores (uno por renglón)</button>
    </section>
    <section class="tarjeta pad">
      ${e.activo === false
        ? '<button class="btn" data-accion="activar-equipo">Volver a activar el equipo</button>'
        : '<button class="btn" data-accion="desactivar-equipo">Desactivar el equipo</button>'}
      ${jugo
        ? '<p class="ayuda">Este equipo ya está en el fixture: no se puede borrar, solo desactivar. Un equipo inactivo no entra en un fixture nuevo.</p>'
        : '<button class="btn peligro" data-accion="borrar-equipo">Borrar el equipo</button>'}
    </section>`;
}

async function nuevoEquipo() {
  const colores = ['#2e7d32', '#c62828', '#1565c0', '#6a1b9a', '#ef6c00', '#00838f', '#4e342e', '#37474f', '#ad1457', '#558b2f'];
  const color = colores[D().equipos.length % colores.length];
  const r = await dialogo({
    titulo: 'Nuevo equipo',
    contenido: `<label class="campo">Nombre del equipo<input name="nombre" required maxlength="40" autocomplete="off"></label>
      <label class="campo">Color<input type="color" name="color" value="${color}"></label>`,
    botones: [{ texto: 'Cancelar', valor: false, clase: 'secundario' }, { texto: 'Crear', valor: true, clase: 'primario' }],
  });
  const nombre = normalizarNombre(r.datos.nombre);
  if (!r.valor || !nombre) return;
  if (D().equipos.some((e) => e.nombre.toLowerCase() === nombre.toLowerCase())) { aviso('Ya hay un equipo con ese nombre.', 'error'); return; }
  const filas = await guardar(() => db.insertar('equipos', [{ nombre, color: r.datos.color || color }]), { ok: 'Equipo creado' });
  if (filas && filas[0]) { estado.equipo = filas[0].id; render(); }
}

async function agregarJugadores(equipoId, nombres) {
  const existentes = new Set(D().jugadores.filter((j) => j.equipo_id === equipoId).map((j) => j.nombre.toLowerCase()));
  const vistos = new Set();
  const nuevos = nombres.map(normalizarNombre).filter((n) => {
    const k = n.toLowerCase();
    if (!n || existentes.has(k) || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  if (!nuevos.length) { aviso('Esos jugadores ya están en el plantel.', 'info'); return false; }
  return guardar(() => db.insertar('jugadores', nuevos.map((nombre) => ({ equipo_id: equipoId, nombre }))), { ok: nuevos.length === 1 ? 'Jugador agregado' : `${nuevos.length} jugadores agregados` });
}

/** Recorta cuadrado al centro, reduce a 256×256 y devuelve WebP (o PNG si el navegador no puede). */
async function prepararEscudo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - lado) / 2;
    const sy = (img.naturalHeight - lado) / 2;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, lado, lado, 0, 0, 256, 256);
    let blob = await new Promise((ok) => cv.toBlob(ok, 'image/webp', 0.9));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function subirEscudo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const e = D().equipos.find((x) => x.id === estado.equipo);
  let blob;
  try { blob = await prepararEscudo(file); } catch { aviso('No se pudo leer esa imagen. Probá con otra.', 'error'); return; }
  const ext = blob.type === 'image/webp' ? 'webp' : 'png';
  aviso('Subiendo escudo…', 'info', 1500);
  await guardar(async () => {
    const url = await db.subirEscudo(blob, `${e.id}-${Date.now()}.${ext}`);
    await db.actualizar('equipos', e.id, { escudo_url: url });
  }, { ok: 'Escudo actualizado' });
}

// ═════════════════════════════════════════════════════════════
// FORMATO
// ═════════════════════════════════════════════════════════════

function vistaFormato() {
  const c = cfg(D());
  const bloqueado = hayPlayoff(D());
  const dis = bloqueado ? 'disabled' : '';
  const nTodos = D().fechas.filter((f) => f.fase === 'todos').length;
  const n = Number(c.playoff_cantidad);
  const desde = c.primero_modo === 'final' ? 2 : 1;
  const cruces = crucesTexto(c);
  const pendientes = D().partidos.filter((p) => p.ronda === 'todos' && p.estado !== 'finalizado').length;
  const puedeArmar = !bloqueado && c.primero_modo !== 'campeon' && primeraFaseTerminada(D());
  const playoffSinJugar = bloqueado && !D().partidos.some((p) => p.ronda !== 'todos' && p.estado !== 'programado');
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const hayFixture = nTodos > 0;

  return `
    ${bloqueado ? '<div class="alerta info">El playoff ya está armado, así que el formato quedó fijo.</div>' : ''}
    <section class="tarjeta pad" style="gap:10px">
      <span style="font-weight:700">1ª fase · Todos contra todos</span>
      <div style="display:flex;justify-content:space-between;font-size:13px"><span class="ayuda" style="font-size:13px">Partidos</span><span style="font-weight:600">Solo ida${nTodos ? ` · ${plural(nTodos, 'fecha', 'fechas')}` : ''}</span></div>
      <span class="ayuda" style="font-size:13px">Puntos</span>
      <div class="dos" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <label class="campo">Ganado<input type="number" inputmode="numeric" min="0" max="10" data-config="puntos_ganado" value="${c.puntos_ganado}" ${dis}></label>
        <label class="campo">Empate<input type="number" inputmode="numeric" min="0" max="10" data-config="puntos_empate" value="${c.puntos_empate}" ${dis}></label>
        <label class="campo">Perdido<input type="number" inputmode="numeric" min="0" max="10" data-config="puntos_perdido" value="${c.puntos_perdido}" ${dis}></label>
      </div>
      <span class="ayuda" style="font-size:13px">Orden de desempate</span>
      ${c.desempate.map((k, i) => `<div class="orden-item"><span>${i + 1}. ${esc(NOMBRE_DESEMPATE[k] || k)}</span>
        <button class="btn-icono" data-accion="desempate-subir" data-i="${i}" aria-label="Subir ${esc(NOMBRE_DESEMPATE[k])}" ${i === 0 || bloqueado ? 'disabled' : ''}>${ICONO.arriba}</button>
        <button class="btn-icono" data-accion="desempate-bajar" data-i="${i}" aria-label="Bajar ${esc(NOMBRE_DESEMPATE[k])}" ${i === c.desempate.length - 1 || bloqueado ? 'disabled' : ''}>${ICONO.abajo}</button></div>`).join('')}
      <p class="ayuda">Si sigue el empate, orden alfabético.</p>
    </section>

    <section class="tarjeta pad" style="gap:10px">
      <span style="font-weight:700">¿Qué pasa con el 1º?</span>
      ${[['final', 'Va directo a la final', 'Juega la final contra el ganador del playoff'], ['playoff', 'Juega el playoff', 'Entra al playoff como uno más'], ['campeon', 'Sale campeón', 'No hay playoff']]
        .map(([k, t, d]) => `<button class="opcion" data-accion="primero" data-valor="${k}" aria-pressed="${c.primero_modo === k}" ${dis}><span class="punto"></span><span><b style="font-weight:600">${t}</b><small>${d}</small></span></button>`).join('')}
    </section>

    ${c.primero_modo !== 'campeon' ? `
    <section class="tarjeta pad">
      <span style="font-weight:700">Playoff</span>
      <div style="display:flex;flex-direction:column;gap:6px">
        <span class="ayuda" style="font-size:13px">¿Cuántos equipos lo juegan?</span>
        <div class="segmento">${[2, 4, 8].map((x) => `<button class="btn" data-accion="cantidad" data-valor="${x}" aria-pressed="${n === x}" ${dis}>${x}</button>`).join('')}</div>
        <span class="ayuda">Clasifican del ${ordinal(desde)} al ${ordinal(desde + n - 1)} de la tabla.</span>
      </div>
      ${n >= 4 ? `<label class="check" style="justify-content:space-between"><span><b style="font-weight:600;font-size:13px">Partido por el 3er puesto</b><br><span class="ayuda">${c.tercer_puesto ? 'Lo juegan los perdedores de semis' : c.primero_modo === 'final' ? 'No se juega: queda 3º el que pierde la final del playoff' : 'No se juega'}</span></span>
        <input type="checkbox" data-config-check="tercer_puesto" ${c.tercer_puesto ? 'checked' : ''} ${dis}></label>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:13px"><span class="ayuda" style="font-size:13px">Si empatan</span><span style="font-weight:600">Penales</span></div>
    </section>` : ''}

    <section class="cruces-azul">
      <span class="titulo-seccion">Así quedan los cruces</span>
      ${cruces.map(([a, b]) => `<div class="fx"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('')}
    </section>

    ${c.primero_modo !== 'campeon' ? `
    <section class="tarjeta pad">
      <span style="font-weight:700">Armar el playoff</span>
      ${bloqueado
        ? `<p class="ayuda">Ya está armado. Los ganadores pasan solos al cruce siguiente cuando terminás cada partido.</p>
           ${playoffSinJugar ? '<button class="btn peligro" data-accion="deshacer-playoff">Deshacer el playoff</button><p class="ayuda">Se puede mientras no se haya jugado ningún partido del playoff.</p>' : ''}`
        : `<p class="ayuda">${!hayFixture ? 'Primero hay que armar el fixture.' : pendientes ? `Se habilita cuando terminen todos los partidos de la 1ª fase (${pendientes === 1 ? 'falta 1' : `faltan ${pendientes}`}).` : 'Ya terminó la 1ª fase: los cruces se arman con la tabla final.'}</p>
           <button class="btn grande primario" data-accion="armar-playoff" ${puedeArmar ? '' : 'disabled'}>Armar playoff</button>`}
    </section>` : ''}

    <section class="tarjeta pad">
      <span style="font-weight:700">Días y horarios del fixture</span>
      <div class="dos">
        <label class="campo">Primera fecha<input type="date" data-config="fecha_inicio" value="${esc(c.fecha_inicio)}" ${hayFixture ? 'disabled' : ''}></label>
        <label class="campo">Primer partido<input type="time" data-config="hora_primer_partido" value="${esc(hora(c.hora_primer_partido))}"></label>
      </div>
      <label class="campo">Minutos entre partidos<input type="number" inputmode="numeric" min="15" max="240" step="5" data-config="minutos_entre_partidos" value="${c.minutos_entre_partidos}"></label>
      <span class="ayuda" style="font-size:13px">Días de juego</span>
      <div class="segmento" style="flex-wrap:wrap">${dias.map((d, i) => `<button class="btn" style="min-width:44px;padding:0 6px" data-accion="dia-juego" data-valor="${i}" aria-pressed="${c.dias_juego.includes(i)}">${d}</button>`).join('')}</div>
      <p class="ayuda">${hayFixture ? 'El fixture ya está armado: estos cambios se usan para el playoff. Para mover partidos ya armados, usá Fixture.' : 'Se usan al armar el fixture.'}</p>
    </section>

    <section class="tarjeta pad">
      <span style="font-weight:700">Torneo</span>
      <label class="campo">Nombre<input data-config="nombre" value="${esc(c.nombre)}" maxlength="60"></label>
      <label class="campo">Subtítulo<input data-config="subtitulo" value="${esc(c.subtitulo || '')}" maxlength="80"></label>
    </section>

    <section class="tarjeta pad">
      <a class="btn" href="../" target="_blank" rel="noopener">${ICONO.enlace}Ver la web pública</a>
      <button class="btn" data-accion="salir">${ICONO.salir}Cerrar sesión</button>
    </section>

    <section class="tarjeta pad" style="border:1px solid #e0b4b4">
      <span style="font-weight:700;color:#b71c1c">Reiniciar el torneo</span>
      <p class="ayuda">Borra todos los resultados: goles, tarjetas, partidos jugados y el playoff. Los equipos, sus planteles, escudos y números de sorteo quedan como están.</p>
      <button class="btn peligro" data-accion="reiniciar-torneo">${ICONO.borrar}Reiniciar el torneo</button>
    </section>`;
}

/** Reiniciar con confirmación y cuenta regresiva de 5 segundos. */
async function reiniciarTorneo() {
  const d = document.createElement('dialog');
  d.className = 'dialogo';
  d.innerHTML = `<form method="dialog">
      <h2>¿Seguro que querés borrar todos los resultados?</h2>
      <div class="dialogo-cuerpo">
        <p>Se borran <b>todos los goles, tarjetas y resultados</b>, y el playoff. Todos los partidos vuelven a "sin jugar". No se puede deshacer.</p>
        <p class="ayuda">Los equipos, planteles, escudos y números de sorteo no se tocan.</p>
        <label class="check"><input type="checkbox" name="fixture"> Borrar también el fixture (fechas, partidos y actividades) y volver al sorteo</label>
      </div>
      <div class="dialogo-botones">
        <button class="btn secundario" value="no">Cancelar</button>
        <button class="btn peligro lleno" value="si" data-borrar disabled>Esperá 5</button>
      </div>
    </form>`;
  document.body.appendChild(d);
  const btn = d.querySelector('[data-borrar]');
  let falta = 5;
  const timer = setInterval(() => {
    falta -= 1;
    if (falta > 0) { btn.textContent = `Esperá ${falta}`; return; }
    clearInterval(timer);
    btn.disabled = false;
    btn.textContent = 'Sí, borrar todo';
  }, 1000);
  const elegido = await new Promise((ok) => {
    let valor = 'no';
    d.querySelector('form').addEventListener('submit', (e) => { valor = e.submitter ? e.submitter.value : 'no'; });
    d.addEventListener('close', () => ok({ valor, fixture: d.querySelector('[name=fixture]').checked }));
    d.showModal();
  });
  clearInterval(timer);
  d.remove();
  if (elegido.valor !== 'si') return;
  const r = await guardar(() => db.reiniciar(elegido.fixture), { ok: elegido.fixture ? 'Torneo reiniciado: volvés al sorteo' : 'Torneo reiniciado: todos los partidos sin jugar' });
  if (r) {
    estado.fechaRes = null;
    estado.fechaFix = null;
    estado.partido = null;
    estado.directo = null;
    render();
  }
}

function crucesTexto(c) {
  if (c.primero_modo === 'campeon') return [['Campeón', '1º de todos contra todos']];
  const rondas = armarCruces(c, []);
  const filas = [];
  for (const r of rondas) {
    for (const p of r.partidos) {
      const nombre = r.ronda === 'semi' || r.ronda === 'cuartos' ? nombreCruce(p.ronda, p.llave) : NOMBRE_RONDA[p.ronda];
      filas.push([nombre, `${p.local.origen} vs ${p.visitante.origen}`.replace('Ganador semi 1 vs Ganador semi 2', 'Ganadores de semis')]);
    }
  }
  if (c.primero_modo === 'final' && !c.tercer_puesto) filas.push(['3er puesto', 'El que pierde la final del playoff']);
  return filas;
}

async function guardarConfig(cambios) {
  Object.assign(almacen.D.config, cambios);
  render();
  await guardar(() => db.guardarConfig(cambios));
}

async function armarElPlayoff() {
  if (!primeraFaseTerminada(D())) return;
  const t = calcularTabla(D());
  const c = cfg(D());
  const rondas = armarCruces(c, t);
  const eqs = mapaEquipos(D());
  const lineas = rondas.flatMap((r) => r.partidos.map((p) => {
    const n = (l) => (l.equipo_id ? `${eqs.get(l.equipo_id)?.nombre} (${l.origen})` : l.origen);
    return `<b>${esc(nombreCruce(p.ronda, p.llave))}:</b> ${esc(n(p.local))} vs ${esc(n(p.visitante))}`;
  }));
  const r = await dialogo({
    titulo: 'Armar playoff',
    contenido: `<p class="ayuda">Con la tabla final quedan así:</p><p style="font-size:14px">${lineas.join('<br>')}</p><p class="ayuda">Después ya no se puede cambiar el formato.</p>`,
    botones: [{ texto: 'Cancelar', valor: false, clase: 'secundario' }, { texto: 'Armar', valor: true, clase: 'primario' }],
  });
  if (!r.valor) return;
  const { fechas, avisos } = armarPlayoff(D());
  const ok = await guardar(() => crearFechas(fechas), { ok: 'Playoff armado' });
  if (ok && avisos.length) await dialogo({ titulo: 'Ojo con estas fechas', contenido: `<p>${avisos.map(esc).join('<br>')}</p><p class="ayuda">No se movieron solas. Si hace falta, movelas en Fixture.</p>` });
}

// ═════════════════════════════════════════════════════════════
// PLACAS
// ═════════════════════════════════════════════════════════════

async function mostrarPlaca(generar, nombre) {
  aviso('Armando la placa…', 'info', 1200);
  let cv;
  try {
    cv = await generar();
  } catch (err) {
    console.warn('[torneo]', err);
    aviso('No se pudo armar la placa. Probá de nuevo.', 'error');
    return;
  }
  const file = await archivoDePlaca(cv, nombre);
  const url = URL.createObjectURL(file);
  const d = document.createElement('dialog');
  d.className = 'dialogo';
  d.innerHTML = `<form method="dialog">
      <img src="${url}" alt="Vista previa de la placa" style="width:100%;border-radius:8px;display:block">
      <div class="dialogo-botones">
        <button class="btn secundario" value="cerrar">Cerrar</button>
        <button class="btn primario" type="button" data-compartir>${ICONO.compartir}Compartir</button>
      </div></form>`;
  document.body.appendChild(d);
  d.querySelector('[data-compartir]').addEventListener('click', async () => {
    const r = await compartirArchivo(file);
    if (r === 'descargada') aviso('La placa se descargó. Ya la podés mandar por WhatsApp.', 'ok', 4000);
    if (r === 'compartida') d.close();
  });
  d.addEventListener('close', () => { d.remove(); URL.revokeObjectURL(url); });
  d.showModal();
}

function placaPorTipo(tipo) {
  const f = fechaResultados();
  const gen = {
    fecha: () => placaFecha(D(), f.id),
    tabla: () => placaTabla(D()),
    goleadores: () => placaGoleadores(D()),
    proxima: () => placaProxima(D()),
    playoff: () => placaPlayoff(D()),
  }[tipo];
  const nombres = { fecha: `resultados-${f ? tituloFecha(f) : ''}`, tabla: 'tabla', goleadores: 'goleadores', proxima: 'proxima-fecha', playoff: 'playoff' };
  if (tipo === 'fecha' && !f) { aviso('Todavía no hay fechas.', 'error'); return; }
  mostrarPlaca(gen, nombres[tipo]);
}

// ═════════════════════════════════════════════════════════════
// EVENTOS
// ═════════════════════════════════════════════════════════════

const acciones = {
  // Resultados
  'fecha-res': (b) => { estado.fechaRes = b.dataset.id; estado.partido = null; render(); },
  'abrir-partido': (b) => {
    estado.partido = b.dataset.id;
    estado.sugerirPlantel = null;
    estado.directo = null;
    estado.gol = { equipo: null, nombre: '', minuto: '', enContra: false };
    estado.tarjeta = { equipo: null, nombre: '', minuto: '', tipo: 'amarilla' };
    render();
    scrollTo(0, 0);
  },
  'cerrar-partido': () => { estado.partido = null; estado.directo = null; render(); },
  'carga-directa': () => { estado.directo = estado.partido; render(); },
  'tarjeta-tipo': (b) => { guardarFormTarjeta(); estado.tarjeta.tipo = b.dataset.valor; render(); },
  'tarjeta-equipo': (b) => { guardarFormTarjeta(); estado.tarjeta.equipo = b.dataset.id; render(); document.getElementById('tarjeta-nombre')?.focus(); },
  'agregar-tarjeta': () => agregarTarjeta(),
  'quitar-tarjeta': async (b) => {
    almacen.D.tarjetas = (D().tarjetas || []).filter((x) => x.id !== b.dataset.id);
    render();
    await guardar(() => db.borrar('tarjetas', [b.dataset.id]));
  },
  empezar: () => {
    const p = partidoActual();
    cambiarEstado('en_juego');
  },
  // "+": abre la carga del gol con ese equipo ya elegido
  sumar: (b) => {
    const p = partidoActual();
    guardarFormGol();
    estado.gol.equipo = p[`${b.dataset.lado}_id`];
    estado.gol.enContra = false;
    render();
    const input = document.getElementById('gol-nombre');
    if (input) { input.scrollIntoView({ block: 'center' }); input.focus(); }
  },
  // "−": quita el último gol de ese equipo, pidiendo confirmación
  restar: async (b) => {
    const p = partidoActual();
    const eqId = p[`${b.dataset.lado}_id`];
    const ultimoGol = () => D().goles.filter((g) => g.partido_id === p.id && g.equipo_id === eqId)
      .sort((a, c) => String(c.created_at).localeCompare(String(a.created_at)))[0];
    const ultimo = ultimoGol();
    if (!ultimo) return;
    const eq = mapaEquipos(D()).get(eqId);
    const ok = await confirmar(`¿Quitar el último gol de ${eq ? eq.nombre : ''} (${ultimo.jugador_nombre}${ultimo.minuto != null ? `, ${ultimo.minuto}'` : ''})?`, { si: 'Quitar', peligro: true });
    if (!ok) return;
    // Mientras estaba abierta la confirmación pudieron llegar los datos de la base (el gol recién
    // cargado pasa de su id provisorio al definitivo): se busca de nuevo el último gol.
    const actual = ultimoGol();
    if (actual) await quitarGol(actual.id);
  },
  'gol-sin-identificar': () => { guardarFormGol(); agregarGol({ sinIdentificar: true }); },
  'gol-equipo': (b) => { guardarFormGol(); estado.gol.equipo = b.dataset.id; render(); document.getElementById('gol-nombre')?.focus(); },
  'agregar-gol': () => { guardarFormGol(); agregarGol(); },
  'quitar-gol': (b) => quitarGol(b.dataset.id),
  'agregar-al-plantel': async () => {
    const s = estado.sugerirPlantel;
    estado.sugerirPlantel = null;
    const r = await agregarJugadores(s.equipo_id, [s.nombre]);
    if (r) {
      // Vincular los goles que ya tenía cargados con ese nombre
      const j = D().jugadores.find((x) => x.equipo_id === s.equipo_id && x.nombre.toLowerCase() === s.nombre.toLowerCase());
      const sueltos = D().goles.filter((g) => !g.jugador_id && !g.en_contra && g.equipo_id === s.equipo_id && g.jugador_nombre.trim().toLowerCase() === s.nombre.toLowerCase());
      // El cargador solo puede tocar goles con el partido en juego
      const p = partidoActual();
      const puede = soyAdmin() || (p && p.estado === 'en_juego');
      if (j && sueltos.length && puede) await guardar(async () => { for (const g of sueltos) await db.actualizar('goles', g.id, { jugador_id: j.id }); });
    }
    render();
  },
  terminar: () => terminarPartido(),
  corregir: async () => {
    const ok = await confirmar('El partido vuelve a "en juego" para corregir el marcador o los goles. ¿Seguimos?', { si: 'Corregir' });
    if (ok) await cambiarEstado('en_juego');
  },
  suspender: async () => {
    const ok = await confirmar('¿Suspender este partido? En la web va a aparecer como suspendido.', { si: 'Suspender', peligro: true });
    if (ok) await cambiarEstado('suspendido');
  },
  'reprogramar-partido': () => cambiarEstado('programado'),
  'placa-partido': () => {
    const p = partidoActual();
    const eqs = mapaEquipos(D());
    mostrarPlaca(() => placaPartido(D(), p.id), `${nombreLado(p, 'local', eqs)}-${nombreLado(p, 'visitante', eqs)}`);
  },
  placa: (b) => placaPorTipo(b.dataset.tipo),

  // Fixture
  'fecha-fix': (b) => { estado.fechaFix = b.dataset.id; estado.abierto = null; render(); },
  'armar-fixture': () => armarElFixture(),
  'borrar-fixture': () => borrarElFixture(),
  'mover-fecha': () => moverLaFecha(),
  'abrir-item': (b) => { estado.abierto = estado.abierto === b.dataset.id ? null : b.dataset.id; render(); },
  'cerrar-item': () => { estado.abierto = null; render(); },
  'agregar-actividad': () => agregarActividad(),
  'limpiar-sorteo': async () => {
    const ok = await confirmar('¿Borrar los números del sorteo de todos los equipos?', { si: 'Borrar', peligro: true });
    if (!ok) return;
    const con = D().equipos.filter((e) => e.numero_sorteo !== null && e.numero_sorteo !== undefined);
    con.forEach((e) => { e.numero_sorteo = null; });
    render();
    await guardar(async () => { for (const e of con) await db.actualizar('equipos', e.id, { numero_sorteo: null }); });
  },
  'quitar-actividad': async (b) => {
    const ok = await confirmar('¿Quitar esta actividad de la fecha?', { si: 'Quitar', peligro: true });
    if (ok) { estado.abierto = null; await guardar(() => db.borrar('actividades', [b.dataset.id])); }
  },

  // Equipos
  'nuevo-equipo': () => nuevoEquipo(),
  'abrir-equipo': (b) => { estado.equipo = b.dataset.id; estado.nuevoJugador = ''; render(); scrollTo(0, 0); },
  'cerrar-equipo': () => { estado.equipo = null; render(); },
  'agregar-jugador': async () => {
    const input = document.querySelector('[data-nuevo-jugador]');
    const n = normalizarNombre(input ? input.value : estado.nuevoJugador);
    if (!n) { input && input.focus(); return; }
    estado.nuevoJugador = '';
    const r = await agregarJugadores(estado.equipo, [n]);
    if (!r) estado.nuevoJugador = n;
    render();
    document.querySelector('[data-nuevo-jugador]')?.focus();
  },
  'pegar-lista': async () => {
    const r = await dialogo({
      titulo: 'Pegar lista de jugadores',
      contenido: '<label class="campo">Un jugador por renglón<textarea name="lista" placeholder="Juan Pérez&#10;Martín Gómez&#10;…"></textarea></label>',
      botones: [{ texto: 'Cancelar', valor: false, clase: 'secundario' }, { texto: 'Agregar', valor: true, clase: 'primario' }],
    });
    if (!r.valor) return;
    const nombres = String(r.datos.lista || '').split(/\r?\n/).map((s) => s.replace(/^\s*\d+[.)-]?\s*/, ''));
    await agregarJugadores(estado.equipo, nombres);
  },
  'quitar-jugador': async (b) => {
    const j = D().jugadores.find((x) => x.id === b.dataset.id);
    const ok = await confirmar(`¿Quitar a ${j.nombre} del plantel? Sus goles quedan cargados igual.`, { si: 'Quitar', peligro: true });
    if (ok) await guardar(() => db.borrar('jugadores', [j.id]));
  },
  'quitar-escudo': () => guardar(() => db.actualizar('equipos', estado.equipo, { escudo_url: null })),
  'desactivar-equipo': async () => {
    const ok = await confirmar('Un equipo inactivo no entra en un fixture nuevo. Si ya jugó, sigue en la tabla. ¿Desactivarlo?', { si: 'Desactivar' });
    if (ok) await guardar(() => db.actualizar('equipos', estado.equipo, { activo: false }));
  },
  'activar-equipo': () => guardar(() => db.actualizar('equipos', estado.equipo, { activo: true })),
  'borrar-equipo': async () => {
    const e = D().equipos.find((x) => x.id === estado.equipo);
    if (D().partidos.some((p) => p.local_id === e.id || p.visitante_id === e.id)) { aviso('Este equipo ya está en el fixture: solo se puede desactivar.', 'error'); return; }
    const ok = await confirmar(`¿Borrar ${e.nombre} y su plantel? No se puede deshacer.`, { si: 'Borrar', peligro: true });
    if (ok && await guardar(() => db.borrar('equipos', [e.id]), { ok: 'Equipo borrado' })) { estado.equipo = null; render(); }
  },

  // Formato
  primero: (b) => guardarConfig({ primero_modo: b.dataset.valor }),
  cantidad: (b) => guardarConfig({ playoff_cantidad: Number(b.dataset.valor) }),
  'desempate-subir': (b) => moverDesempate(Number(b.dataset.i), -1),
  'desempate-bajar': (b) => moverDesempate(Number(b.dataset.i), 1),
  'dia-juego': (b) => {
    const v = Number(b.dataset.valor);
    const dias = new Set(cfg(D()).dias_juego);
    if (dias.has(v)) { if (dias.size === 1) { aviso('Tiene que quedar al menos un día de juego.', 'error'); return; } dias.delete(v); } else dias.add(v);
    guardarConfig({ dias_juego: [...dias].sort((a, b2) => a - b2) });
  },
  'armar-playoff': () => armarElPlayoff(),
  'reiniciar-torneo': () => reiniciarTorneo(),
  'deshacer-playoff': async () => {
    const ok = await confirmar('Se borran las fechas y los partidos del playoff. El formato se puede volver a cambiar. ¿Seguimos?', { si: 'Deshacer', peligro: true });
    if (ok) await guardar(() => db.borrar('fechas', D().fechas.filter((f) => f.fase === 'playoff').map((f) => f.id)), { ok: 'Playoff deshecho' });
  },
  salir: async () => {
    await db.salir();
    location.replace(location.pathname);
  },

  // Usuarios
  invitar: () => invitarUsuario(),
  'reenviar-invitacion': async (b) => {
    const u = (estado.usuarios || []).find((x) => x.user_id === b.dataset.id);
    if (!u) return;
    const r = await guardar(() => db.invitar({ email: u.email, nombre: u.nombre, rol: u.rol, redirectTo: urlCrearClave() }), { recargar: false });
    if (r) aviso(`Le volvimos a mandar la invitación a ${u.email}.`, 'ok', 4000);
    await cargarUsuarios();
  },
  'desactivar-usuario': async (b) => {
    const u = (estado.usuarios || []).find((x) => x.user_id === b.dataset.id);
    const ok = await confirmar(`¿Desactivar a ${u.nombre || u.email}? No va a poder cargar nada hasta que lo reactives.`, { si: 'Desactivar', peligro: true });
    if (!ok) return;
    if (await guardar(() => db.actualizarUsuario(u.user_id, { activo: false }), { recargar: false, ok: 'Usuario desactivado' })) await cargarUsuarios();
  },
  'reactivar-usuario': async (b) => {
    if (await guardar(() => db.actualizarUsuario(b.dataset.id, { activo: true }), { recargar: false, ok: 'Usuario reactivado' })) await cargarUsuarios();
  },
  'cambiar-rol': async (b) => {
    const u = (estado.usuarios || []).find((x) => x.user_id === b.dataset.id);
    const nuevo = u.rol === 'admin' ? 'cargador' : 'admin';
    const ok = await confirmar(nuevo === 'admin'
      ? `¿Hacer admin a ${u.nombre || u.email}? Va a poder cambiar todo: fixture, equipos, formato y usuarios.`
      : `¿Pasar a ${u.nombre || u.email} a cargador? Solo va a poder cargar resultados.`, { si: 'Cambiar' });
    if (!ok) return;
    if (await guardar(() => db.actualizarUsuario(u.user_id, { rol: nuevo }), { recargar: false, ok: 'Rol cambiado' })) await cargarUsuarios();
  },
};

function moverDesempate(i, d) {
  const lista = cfg(D()).desempate.slice();
  const j = i + d;
  if (j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  guardarConfig({ desempate: lista });
}

function guardarFormGol() {
  const n = document.querySelector('[data-gol="nombre"]');
  const m = document.querySelector('[data-gol="minuto"]');
  const c = document.querySelector('[data-gol="enContra"]');
  if (n) estado.gol.nombre = n.value;
  if (m) estado.gol.minuto = m.value;
  if (c) estado.gol.enContra = c.checked;
}

document.addEventListener('click', (e) => {
  const v = e.target.closest('[data-vista]');
  if (v) {
    estado.vista = v.dataset.vista;
    estado.partido = null;
    estado.equipo = null;
    estado.abierto = null;
    render();
    scrollTo(0, 0);
    if (estado.vista === 'usuarios') cargarUsuarios();
    return;
  }
  const b = e.target.closest('[data-accion]');
  if (b && !b.disabled && acciones[b.dataset.accion]) {
    e.preventDefault();
    acciones[b.dataset.accion](b);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.matches('[data-gol="nombre"], [data-gol="minuto"]')) { e.preventDefault(); guardarFormGol(); agregarGol(); }
  if (e.target.matches('[data-nuevo-jugador]')) { e.preventDefault(); acciones['agregar-jugador'](); }
  if (e.target.matches('[data-tarjeta]')) { e.preventDefault(); agregarTarjeta(); }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-gol]')) guardarFormGol();
  if (t.matches('[data-tarjeta]')) guardarFormTarjeta();
  if (t.matches('[data-nuevo-jugador]')) estado.nuevoJugador = t.value;
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-gol="enContra"]')) { guardarFormGol(); render(); return; }
  if (t.matches('[data-sorteo]')) {
    await asignarNumero(Number(t.dataset.sorteo), t.value || null);
    return;
  }
  if (t.matches('[data-campo^="penales_"]')) {
    const p = partidoActual();
    const v = t.value === '' ? null : Math.max(0, parseInt(t.value, 10) || 0);
    p[t.dataset.campo] = v;
    if (p.penales_local == null || p.penales_visitante == null) return; // se guarda cuando están los dos
    await guardar(() => db.penales(p.id, p.penales_local, p.penales_visitante));
    return;
  }
  if (t.matches('[data-item]')) {
    const tabla = t.dataset.tipo === 'actividad' ? 'actividades' : 'partidos';
    const campo = t.dataset.campo;
    let v = t.value;
    if (campo === 'titulo') { v = normalizarNombre(v); if (!v) return; }
    if (!v) return;
    await optimista(tabla, t.dataset.item, { [campo]: v });
    if (campo === 'dia') { const a = esFeriadoEspecial(v); if (a) aviso(a, 'info', 4000); }
    return;
  }
  if (t.matches('[data-equipo-campo]')) {
    const campo = t.dataset.equipoCampo;
    let v = campo === 'nombre' ? normalizarNombre(t.value) : t.value;
    if (!v) { render(); return; }
    if (campo === 'nombre' && D().equipos.some((x) => x.id !== estado.equipo && x.nombre.toLowerCase() === v.toLowerCase())) { aviso('Ya hay un equipo con ese nombre.', 'error'); render(); return; }
    await optimista('equipos', estado.equipo, { [campo]: v });
    return;
  }
  if (t.matches('[data-accion-cambio="escudo"]')) { await subirEscudo(t); return; }
  if (t.matches('[data-config]')) {
    const k = t.dataset.config;
    let v = t.value;
    if (t.type === 'number') {
      v = parseInt(v, 10);
      if (Number.isNaN(v)) { render(); return; }
    }
    if ((k === 'nombre') && !normalizarNombre(v)) { render(); return; }
    if (!v && v !== 0 && k !== 'subtitulo') { render(); return; }
    await guardarConfig({ [k]: typeof v === 'string' ? v.trim() : v });
    return;
  }
  if (t.matches('[data-config-check]')) await guardarConfig({ [t.dataset.configCheck]: t.checked });
});

// ═════════════════════════════════════════════════════════════
// USUARIOS (solo admin)
// ═════════════════════════════════════════════════════════════

async function cargarUsuarios() {
  try {
    estado.usuarios = await db.usuarios();
    estado.nombres = Object.fromEntries(estado.usuarios.map((u) => [u.user_id, u.nombre]));
  } catch (err) {
    console.warn('[torneo]', err);
    if (!estado.usuarios) estado.usuarios = [];
    aviso(esErrorDeRed(err) ? 'Sin conexión. No se pudo traer la lista de usuarios.' : 'No se pudo traer la lista de usuarios.', 'error');
  }
  if (estado.vista === 'usuarios') render();
}

function vistaUsuarios() {
  const lista = estado.usuarios;
  const estadoDe = (u) => (!u.activo ? ['Desactivado', 'susp'] : u.invitado ? ['Invitado', 'reprog'] : ['Activo', 'fin']);
  const filas = (lista || []).map((u) => {
    const [txt, clase] = estadoDe(u);
    const soyYo = estado.yo && u.user_id === estado.yo.id;
    return `<div style="border-top:1px solid var(--borde);padding:12px;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="txt" style="flex:1;min-width:0"><span style="font-weight:600">${esc(u.nombre || u.email)}${soyYo ? ' (vos)' : ''}</span>
          <span class="sub" style="display:block;font-size:12px;color:var(--sec);overflow:hidden;text-overflow:ellipsis">${esc(u.email)}</span></span>
        <span class="chip">${u.rol === 'admin' ? 'Admin' : 'Cargador'}</span>
        <span class="chip ${clase}">${txt}</span>
      </div>
      ${soyYo ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap">
        ${u.invitado && u.activo ? `<button class="btn" style="font-size:13px;min-height:40px" data-accion="reenviar-invitacion" data-id="${u.user_id}">Reenviar invitación</button>` : ''}
        ${u.activo ? `<button class="btn" style="font-size:13px;min-height:40px" data-accion="cambiar-rol" data-id="${u.user_id}">${u.rol === 'admin' ? 'Pasar a cargador' : 'Hacer admin'}</button>` : ''}
        ${u.activo
          ? `<button class="btn peligro" style="font-size:13px;min-height:40px" data-accion="desactivar-usuario" data-id="${u.user_id}">Desactivar</button>`
          : `<button class="btn" style="font-size:13px;min-height:40px" data-accion="reactivar-usuario" data-id="${u.user_id}">Reactivar</button>`}
      </div>`}
    </div>`;
  }).join('');
  return `
    <button class="btn primario" data-accion="invitar">${ICONO.mas}Invitar</button>
    <section class="tarjeta">
      ${lista === null ? '<div class="cargando">Cargando…</div>' : (filas.replace('border-top:1px solid var(--borde);', '') || '<div class="vacio">Todavía no hay usuarios.</div>')}
    </section>
    <section class="tarjeta pad" style="gap:6px">
      <span style="font-weight:700">Roles</span>
      <p class="ayuda"><b>Admin</b>: todo (resultados, fixture, equipos, formato, usuarios y corregir partidos terminados).</p>
      <p class="ayuda"><b>Cargador</b>: solo resultados: empezar, goles, tarjetas, penales y terminar. Puede agregar jugadores al plantel cuando carga un gol.</p>
      <p class="ayuda">Cada persona entra con su propio mail y contraseña. Al invitar, le llega un mail con un link para elegir su contraseña.</p>
    </section>`;
}

async function invitarUsuario() {
  const r = await dialogo({
    titulo: 'Invitar',
    contenido: `<label class="campo">Mail<input type="email" name="email" required autocomplete="off" inputmode="email"></label>
      <label class="campo">Nombre (se muestra en el panel)<input name="nombre" maxlength="60" autocomplete="off" placeholder="Juan"></label>
      <label class="campo">Rol<select name="rol" class="entrada">
        <option value="cargador">Cargador: solo resultados</option>
        <option value="admin">Admin: todo</option>
      </select></label>
      <p class="ayuda">Le llega un mail con un link para elegir su contraseña.</p>`,
    botones: [{ texto: 'Cancelar', valor: false, clase: 'secundario' }, { texto: 'Mandar invitación', valor: true, clase: 'primario' }],
  });
  if (!r.valor) return;
  const email = String(r.datos.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { aviso('Ese mail no parece válido.', 'error'); return; }
  aviso('Mandando la invitación…', 'info', 1500);
  const res = await guardar(() => db.invitar({ email, nombre: normalizarNombre(r.datos.nombre), rol: r.datos.rol, redirectTo: urlCrearClave() }), { recargar: false });
  if (res) {
    aviso(res === 'actualizado' ? `${email} ya tenía usuario: quedó activo con el rol elegido.`
      : res === 'reenviado' ? `Le volvimos a mandar la invitación a ${email}.`
        : `Listo: le mandamos la invitación a ${email}.`, 'ok', 4500);
  }
  await cargarUsuarios();
}

// ═════════════════════════════════════════════════════════════
// CONTRASEÑA: crear (al llegar desde el mail) y olvidé
// ═════════════════════════════════════════════════════════════

function pantallaCrearClave(error = '') {
  app.innerHTML = `
    <form class="login" id="crear-clave">
      <img class="logo" src="../assets/logo-mitre-75.jpg" alt="Escudo C.D. Mitre 75 aniversario">
      <h1>Elegí tu contraseña</h1>
      <p class="ayuda" style="text-align:center">Con esta contraseña y tu mail vas a entrar al panel del torneo.</p>
      <label class="campo">Contraseña nueva (mínimo 8 caracteres)<input type="password" name="clave" autocomplete="new-password" minlength="8" required></label>
      <label class="campo">Repetila<input type="password" name="repetida" autocomplete="new-password" minlength="8" required></label>
      ${error ? `<p class="error-txt" role="alert">${esc(error)}</p>` : ''}
      <button class="btn grande primario" type="submit">Guardar y entrar</button>
    </form>`;
  document.getElementById('crear-clave').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const clave = String(fd.get('clave'));
    if (clave.length < 8) { pantallaCrearClave('Tiene que tener al menos 8 caracteres.'); return; }
    if (clave !== String(fd.get('repetida'))) { pantallaCrearClave('Las dos contraseñas no coinciden.'); return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await db.actualizarClave(clave);
    } catch (err) {
      pantallaCrearClave(err.sinConexion ? 'Sin conexión. Probá de nuevo cuando tengas señal.' : (err.message || 'No se pudo guardar la contraseña.'));
      return;
    }
    history.replaceState(null, '', location.pathname);
    aviso('Listo: ya tenés tu contraseña.', 'ok');
    await entrar();
  });
}

async function olvideClave() {
  const r = await dialogo({
    titulo: 'Olvidé mi contraseña',
    contenido: '<label class="campo">Tu mail<input type="email" name="email" required autocomplete="username" inputmode="email"></label><p class="ayuda">Te mandamos un link para elegir una contraseña nueva.</p>',
    botones: [{ texto: 'Cancelar', valor: false, clase: 'secundario' }, { texto: 'Mandar link', valor: true, clase: 'primario' }],
  });
  const email = String(r.datos.email || '').trim();
  if (!r.valor || !email) return;
  try {
    await db.recuperarClave(email, urlCrearClave());
    aviso('Si ese mail tiene usuario, te llega un link para elegir una contraseña nueva. Revisá también la carpeta de spam.', 'ok', 6000);
  } catch (err) {
    aviso(err.sinConexion ? 'Sin conexión. Probá de nuevo cuando tengas señal.' : 'No se pudo mandar el link. Probá de nuevo.', 'error');
  }
}

// ═════════════════════════════════════════════════════════════
// INGRESO Y ARRANQUE
// ═════════════════════════════════════════════════════════════

function pantallaIngreso(error = '') {
  app.innerHTML = `
    <form class="login" id="login">
      <img class="logo" src="../assets/logo-mitre-75.jpg" alt="Escudo C.D. Mitre 75 aniversario">
      <h1>Panel del torneo</h1>
      ${MODO === 'demo' ? '<div class="banda prueba" style="border-radius:8px">Modo de prueba: entrá con cualquier email y contraseña.</div>' : ''}
      <label class="campo">Email<input type="email" name="email" autocomplete="username" required></label>
      <label class="campo">Contraseña<input type="password" name="clave" autocomplete="current-password" required></label>
      ${error ? `<p class="error-txt" role="alert">${esc(error)}</p>` : ''}
      <button class="btn grande primario" type="submit">Entrar</button>
      <button class="btn" type="button" id="olvide" style="border:0;background:transparent;color:var(--azul)">Olvidé mi contraseña</button>
      <a href="../" class="ayuda" style="text-align:center">Ir a la web del torneo</a>
    </form>`;
  document.getElementById('olvide').addEventListener('click', olvideClave);
  document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      await db.ingresar(String(fd.get('email')).trim(), String(fd.get('clave')));
    } catch (err) {
      pantallaIngreso(err.sinConexion ? 'Sin conexión. Probá de nuevo cuando tengas señal.' : 'El email o la contraseña no son correctos.');
      return;
    }
    try {
      await entrar();
    } catch (err) {
      console.warn('[torneo]', err);
      pantallaIngreso('No se pudo abrir el panel. Probá de nuevo.');
    }
  });
}

async function entrar() {
  try {
    estado.yo = await db.miUsuario();
  } catch (err) {
    if (esErrorDeRed(err)) {
      app.innerHTML = '<div class="login"><p>Sin conexión. Probá de nuevo cuando tengas señal.</p><button class="btn primario" onclick="location.reload()">Reintentar</button></div>';
      return;
    }
  }
  if (!estado.yo) {
    app.innerHTML = `<div class="login"><h1>Panel del torneo</h1><p>Tu usuario no tiene permiso para cargar datos del torneo, o fue desactivado. Si creés que es un error, hablá con un admin.</p><button class="btn" id="salir">Cerrar sesión</button></div>`;
    document.getElementById('salir').onclick = async () => { await db.salir(); location.replace(location.pathname); };
    return;
  }
  // Entró por el link de la invitación y todavía no eligió contraseña: primero eso.
  if (estado.yo.sinClave) { pantallaCrearClave(); return; }
  try { estado.nombres = await db.nombresUsuarios(); } catch { estado.nombres = {}; }
  esqueleto();
  document.getElementById('contenido').innerHTML = '<div class="cargando">Cargando…</div>';
  protegerSalida(() => {
    if (estado.partido) { estado.partido = null; estado.directo = null; render(); return true; }
    if (estado.equipo) { estado.equipo = null; render(); return true; }
    if (estado.abierto) { estado.abierto = null; render(); return true; }
    if (estado.vista !== 'resultados') { estado.vista = 'resultados'; render(); scrollTo(0, 0); return true; }
    return false;
  });
  almacen = await iniciarDatos({
    alCambiar() { if (almacen) renderSiSePuede(); },
    alEstado(e) {
      estado.conectado = e === 'conectado';
      pintarCabecera();
      if (estado.conectado) reintentar();
    },
  });
  render();
}

(async () => {
  db = await getDb();
  const u = await db.sesion();
  if (LLEGO_PARA_CREAR_CLAVE && u) pantallaCrearClave();
  else if (LLEGO_PARA_CREAR_CLAVE || LINK_VENCIDO) {
    history.replaceState(null, '', location.pathname);
    pantallaIngreso('El link del mail venció o ya se usó. Pedí que te reenvíen la invitación, o tocá "Olvidé mi contraseña".');
  } else if (u) await entrar();
  else pantallaIngreso();
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('../sw.js').catch(() => {});
}
