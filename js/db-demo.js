// Backend de prueba: guarda todo en este navegador (localStorage) y avisa a las otras pestañas.
// Se usa cuando js/config.js no tiene los datos de Supabase. Sirve para probar sin tocar la base real.
import { CONFIG_DEFECTO } from './calculos.js';
import { SinConexion } from './db.js';

const CLAVE = 'nocturno-demo-v1';
const TABLAS = ['equipos', 'jugadores', 'fechas', 'partidos', 'goles', 'actividades'];

const DEFECTOS = {
  equipos: { color: '#0b2d5b', escudo_url: null, activo: true, numero_sorteo: null },
  jugadores: { activo: true },
  fechas: { nombre: null },
  partidos: {
    ronda: 'todos', llave: null, local_id: null, visitante_id: null, local_origen: null, visitante_origen: null,
    estado: 'programado', goles_local: null, goles_visitante: null, penales_local: null, penales_visitante: null,
  },
  goles: { jugador_id: null, en_contra: false, minuto: null },
  actividades: {},
};

function semilla() {
  const colores = ['#2e7d32', '#c62828', '#1565c0', '#6a1b9a', '#ef6c00', '#00838f', '#4e342e', '#37474f'];
  const ahora = new Date().toISOString();
  return {
    config: { id: 1, ...CONFIG_DEFECTO },
    equipos: 'ABCDEFGH'.split('').map((l, i) => ({
      id: crypto.randomUUID(), nombre: `Equipo ${l}`, color: colores[i], escudo_url: null, activo: true, numero_sorteo: null, created_at: ahora,
    })),
    jugadores: [], fechas: [], partidos: [], goles: [], actividades: [],
  };
}

function leer() {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (raw) return JSON.parse(raw);
  } catch { /* sin storage */ }
  const s = semilla();
  guardar(s);
  return s;
}

function guardar(s) {
  try { localStorage.setItem(CLAVE, JSON.stringify(s)); } catch { /* sin storage */ }
}

const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nocturno-demo') : null;
const oyentes = new Set();
function avisar(tabla) {
  canal && canal.postMessage(tabla);
  // También en la misma pestaña (el admin y la vista pública pueden estar abiertos a la vez)
  setTimeout(() => oyentes.forEach((fn) => fn(tabla)), 0);
}
canal && (canal.onmessage = (e) => oyentes.forEach((fn) => fn(e.data)));

function red() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SinConexion();
}

const espera = () => new Promise((r) => setTimeout(r, 30));

export function crear() {
  return {
    modo: 'demo',

    async listarTodo() {
      red();
      await espera();
      const s = leer();
      return JSON.parse(JSON.stringify(s));
    },

    async insertar(tabla, filas) {
      red();
      await espera();
      const s = leer();
      const ahora = new Date().toISOString();
      const nuevas = filas.map((f) => ({ id: crypto.randomUUID(), ...DEFECTOS[tabla], created_at: ahora, ...f }));
      if (tabla === 'jugadores') {
        for (const n of nuevas) {
          if (s.jugadores.some((j) => j.equipo_id === n.equipo_id && j.nombre.toLowerCase() === n.nombre.toLowerCase())) {
            throw new Error('Ese jugador ya está en el plantel.');
          }
        }
      }
      s[tabla].push(...nuevas);
      guardar(s);
      avisar(tabla);
      return nuevas;
    },

    async actualizar(tabla, id, cambios) {
      red();
      await espera();
      const s = leer();
      const f = s[tabla].find((x) => x.id === id);
      if (f) Object.assign(f, cambios, tabla === 'partidos' ? { updated_at: new Date().toISOString() } : {});
      guardar(s);
      avisar(tabla);
      return f ? [f] : [];
    },

    async borrar(tabla, ids) {
      red();
      await espera();
      const s = leer();
      const set = new Set(ids);
      s[tabla] = s[tabla].filter((x) => !set.has(x.id));
      // Cascadas como en la base real
      if (tabla === 'fechas') {
        const ps = new Set(s.partidos.filter((p) => set.has(p.fecha_id)).map((p) => p.id));
        s.partidos = s.partidos.filter((p) => !ps.has(p.id));
        s.goles = s.goles.filter((g) => !ps.has(g.partido_id));
        s.actividades = s.actividades.filter((a) => !set.has(a.fecha_id));
      }
      if (tabla === 'partidos') s.goles = s.goles.filter((g) => !set.has(g.partido_id));
      if (tabla === 'equipos') s.jugadores = s.jugadores.filter((j) => !set.has(j.equipo_id));
      if (tabla === 'jugadores') s.goles.forEach((g) => { if (set.has(g.jugador_id)) g.jugador_id = null; });
      guardar(s);
      avisar(tabla);
      return [];
    },

    async guardarConfig(cambios) {
      red();
      await espera();
      const s = leer();
      s.config = { ...s.config, ...cambios, id: 1 };
      guardar(s);
      avisar('config');
      return [s.config];
    },

    async subirEscudo(blob) {
      red();
      return new Promise((ok, mal) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.onerror = mal;
        r.readAsDataURL(blob);
      });
    },

    suscribir(onCambio, onEstado) {
      oyentes.add(onCambio);
      const estado = () => onEstado(navigator.onLine === false ? 'desconectado' : 'conectado');
      setTimeout(estado, 0);
      addEventListener('online', estado);
      addEventListener('offline', estado);
      return () => {
        oyentes.delete(onCambio);
        removeEventListener('online', estado);
        removeEventListener('offline', estado);
      };
    },

    async sesion() {
      try { return JSON.parse(localStorage.getItem('nocturno-demo-sesion') || 'null'); } catch { return null; }
    },

    async ingresar(email, clave) {
      red();
      if (!email || !clave) throw new Error('El email o la contraseña no son correctos.');
      const u = { id: 'demo', email };
      try { localStorage.setItem('nocturno-demo-sesion', JSON.stringify(u)); } catch { /* */ }
      return u;
    },

    async salir() {
      try { localStorage.removeItem('nocturno-demo-sesion'); } catch { /* */ }
    },

    async esAdmin() {
      return !!(await this.sesion());
    },
  };
}

export { TABLAS };
