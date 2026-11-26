// Acceso a datos. Elige Supabase si está configurado; si no, el modo de prueba (solo en este navegador).
//
// Interfaz común de los dos backends:
//   listarTodo() → { config, equipos, jugadores, fechas, partidos, goles, actividades }
//   insertar(tabla, filas) → filas con id
//   actualizar(tabla, id, cambios)
//   borrar(tabla, ids)
//   guardarConfig(cambios)
//   subirEscudo(blob, nombre) → url pública
//   suscribir(onCambio, onEstado) → función para cortar
//   sesion() → usuario | null · ingresar(email, clave) · salir() · esAdmin()
//
// Tablas (nombre corto → tabla real con prefijo torneo_): equipos, jugadores, fechas, partidos, goles, actividades.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const MODO = SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : 'demo';

let backend;
export async function getDb() {
  if (!backend) {
    backend = MODO === 'supabase'
      ? (await import('./db-supabase.js')).crear(SUPABASE_URL, SUPABASE_ANON_KEY)
      : (await import('./db-demo.js')).crear();
  }
  return backend;
}

/** Error de red: la app muestra "Sin conexión" en vez del error técnico. */
export class SinConexion extends Error {
  constructor() {
    super('Sin conexión');
    this.sinConexion = true;
  }
}

export function esErrorDeRed(err) {
  if (!err) return false;
  if (err.sinConexion) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = String(err.message || err).toLowerCase();
  return m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed') || m.includes('load failed');
}
