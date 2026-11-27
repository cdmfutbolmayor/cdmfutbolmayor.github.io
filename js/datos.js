// Carga de datos con actualización en vivo y respaldo sin conexión.
//
// const almacen = await iniciarDatos({ alCambiar(D, info), alEstado(estado) })
//   estado: 'conectado' | 'sin_conexion'
//   info: { desdeCache: bool, guardadoEn: iso }
// almacen.recargar() · almacen.D

import { getDb, esErrorDeRed } from './db.js';
import { CONFIG_DEFECTO } from './calculos.js';
import { debounce } from './util.js';

const CLAVE_CACHE = 'nocturno-datos-v1';
const POLLING_MS = 60_000;

function vacio() {
  return { config: { ...CONFIG_DEFECTO }, equipos: [], jugadores: [], fechas: [], partidos: [], goles: [], actividades: [], tarjetas: [] };
}

function normalizar(D) {
  const base = vacio();
  const out = { ...base, ...D, config: { ...CONFIG_DEFECTO, ...(D.config || {}) } };
  // Las horas vienen como 'HH:MM:SS' desde Postgres; la app usa 'HH:MM'.
  out.partidos = (out.partidos || []).map((p) => ({ ...p, hora: String(p.hora || '').slice(0, 5), dia: String(p.dia || '').slice(0, 10) }));
  out.actividades = (out.actividades || []).map((a) => ({ ...a, hora: String(a.hora || '').slice(0, 5), dia: String(a.dia || '').slice(0, 10) }));
  out.fechas = (out.fechas || []).map((f) => ({ ...f, dia_previsto: String(f.dia_previsto || '').slice(0, 10) }));
  out.config.hora_primer_partido = String(out.config.hora_primer_partido || '20:30').slice(0, 5);
  return out;
}

function leerCache() {
  try {
    const raw = localStorage.getItem(CLAVE_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function escribirCache(D) {
  try { localStorage.setItem(CLAVE_CACHE, JSON.stringify({ guardadoEn: new Date().toISOString(), D })); } catch { /* lleno o bloqueado */ }
}

export async function iniciarDatos({ alCambiar, alEstado } = {}) {
  const db = await getDb();
  let estado = null;
  let realtimeOk = false;
  let timerPolling = null;

  const almacen = { D: vacio(), db, recargar: null };

  const ponerEstado = (e) => {
    if (e !== estado) {
      estado = e;
      alEstado && alEstado(e);
    }
  };

  const recargar = async () => {
    try {
      const D = normalizar(await db.listarTodo());
      almacen.D = D;
      escribirCache(D);
      ponerEstado('conectado');
      alCambiar && alCambiar(D, { desdeCache: false });
      return D;
    } catch (err) {
      if (!esErrorDeRed(err)) console.warn('[torneo]', err);
      const c = leerCache();
      if (c && c.D) {
        almacen.D = normalizar(c.D);
        alCambiar && alCambiar(almacen.D, { desdeCache: true, guardadoEn: c.guardadoEn });
      }
      ponerEstado('sin_conexion');
      return almacen.D;
    }
  };
  almacen.recargar = recargar;

  const recargarPronto = debounce(recargar, 1000);

  const arrancarPolling = () => {
    if (timerPolling) return;
    timerPolling = setInterval(() => { if (!realtimeOk) recargar(); }, POLLING_MS);
  };
  const pararPolling = () => {
    clearInterval(timerPolling);
    timerPolling = null;
  };

  // Mostrar lo guardado al instante, mientras llega lo nuevo.
  const c = leerCache();
  if (c && c.D) {
    almacen.D = normalizar(c.D);
    alCambiar && alCambiar(almacen.D, { desdeCache: true, guardadoEn: c.guardadoEn, inicial: true });
  }

  await recargar();

  db.suscribir(
    () => recargarPronto(),
    (e) => {
      const antes = realtimeOk;
      realtimeOk = e === 'conectado';
      if (realtimeOk) {
        pararPolling();
        if (!antes) recargarPronto(); // al volver, traer lo que cambió
      } else {
        arrancarPolling();
      }
    }
  );
  arrancarPolling();

  addEventListener('online', () => recargarPronto());
  addEventListener('offline', () => ponerEstado('sin_conexion'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recargarPronto();
  });

  return almacen;
}
