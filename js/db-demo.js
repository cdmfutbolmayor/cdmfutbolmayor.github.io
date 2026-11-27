// Backend de prueba: guarda todo en este navegador (localStorage) y avisa a las otras pestañas.
// Se usa cuando js/config.js no tiene los datos de Supabase. Sirve para probar sin tocar la base real.
// Imita lo importante de la base real: roles (admin / cargador), el marcador que sale de los goles,
// los cambios de estado con sus permisos y el avance de cruces del playoff.
import { CONFIG_DEFECTO, resolverCruces } from './calculos.js';
import { SinConexion } from './db.js';

const CLAVE = 'nocturno-demo-v1';
const CLAVE_SESION = 'nocturno-demo-sesion';
const TABLAS = ['equipos', 'jugadores', 'fechas', 'partidos', 'goles', 'actividades', 'tarjetas'];

const DEFECTOS = {
  equipos: { color: '#0b2d5b', escudo_url: null, activo: true, numero_sorteo: null },
  jugadores: { activo: true },
  fechas: { nombre: null },
  partidos: {
    ronda: 'todos', llave: null, local_id: null, visitante_id: null, local_origen: null, visitante_origen: null,
    estado: 'programado', goles_local: null, goles_visitante: null, penales_local: null, penales_visitante: null,
    actualizado_por: null,
  },
  goles: { jugador_id: null, en_contra: false, minuto: null },
  tarjetas: { jugador_id: null, minuto: null },
  actividades: {},
};

const SIN_PERMISO = 'No tenés permiso para hacer eso.';

function semilla() {
  const colores = ['#2e7d32', '#c62828', '#1565c0', '#6a1b9a', '#ef6c00', '#00838f', '#4e342e', '#37474f'];
  const ahora = new Date().toISOString();
  return {
    config: { id: 1, ...CONFIG_DEFECTO },
    equipos: 'ABCDEFGH'.split('').map((l, i) => ({
      id: crypto.randomUUID(), nombre: `Equipo ${l}`, color: colores[i], escudo_url: null, activo: true, numero_sorteo: null, created_at: ahora,
    })),
    jugadores: [], fechas: [], partidos: [], goles: [], actividades: [], tarjetas: [],
    usuarios: [],
  };
}

function leer() {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (raw) {
      const s = JSON.parse(raw);
      for (const t of TABLAS) s[t] = s[t] || []; // datos guardados antes de agregar una tabla
      s.usuarios = s.usuarios || [];
      return s;
    }
  } catch { /* sin storage */ }
  const s = semilla();
  guardar(s);
  return s;
}

function guardar(s) {
  try { localStorage.setItem(CLAVE, JSON.stringify(s)); } catch { /* sin storage */ }
}

function sesionGuardada() {
  try { return JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null'); } catch { return null; }
}

/** Rol del usuario con sesión (o null). */
function rolDe(s) {
  const ses = sesionGuardada();
  if (!ses) return null;
  const u = s.usuarios.find((x) => x.user_id === ses.id);
  return u && u.activo ? u.rol : null;
}

// Sin jugar o en juego: el cargador puede cargar goles y tarjetas (también en la carga directa)
const abierto = (s, partidoId) => s.partidos.some((p) => p.id === partidoId && (p.estado === 'en_juego' || p.estado === 'programado'));

/** Mismas reglas que las políticas de sql/004, 006 y 007 */
function permitir(s, tabla, filas) {
  const rol = rolDe(s);
  if (rol === 'admin') return;
  if (rol === 'cargador') {
    if (['jugadores-insert', 'equipos', 'jugadores', 'fechas', 'partidos', 'actividades', 'storage'].includes(tabla)) return;
    if ((tabla === 'goles' || tabla === 'tarjetas') && filas.every((f) => abierto(s, f.partido_id))) return;
  }
  throw new Error(SIN_PERMISO);
}

/** El marcador sale de los goles (como el trigger de la base). */
function recalcular(s, partidoIds) {
  const ses = sesionGuardada();
  for (const id of new Set(partidoIds)) {
    const p = s.partidos.find((x) => x.id === id);
    if (!p) continue;
    p.goles_local = s.goles.filter((g) => g.partido_id === id && g.equipo_id === p.local_id).length;
    p.goles_visitante = s.goles.filter((g) => g.partido_id === id && g.equipo_id === p.visitante_id).length;
    if (ses) p.actualizado_por = ses.id;
  }
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

function nombreDesdeEmail(email) {
  const base = String(email).split('@')[0].replace(/[._-]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Usuario';
}

export function crear() {
  return {
    modo: 'demo',

    async listarTodo() {
      red();
      await espera();
      const s = leer();
      const copia = JSON.parse(JSON.stringify(s));
      delete copia.usuarios; // los mails de los usuarios no van a la vista pública
      return copia;
    },

    async insertar(tabla, filas) {
      red();
      await espera();
      const s = leer();
      permitir(s, tabla === 'jugadores' ? 'jugadores-insert' : tabla, filas);
      const ahora = new Date().toISOString();
      const ses = sesionGuardada();
      const extra = (tabla === 'goles' || tabla === 'tarjetas') && ses ? { cargado_por: ses.id } : {};
      const nuevas = filas.map((f) => ({ id: crypto.randomUUID(), ...DEFECTOS[tabla], created_at: ahora, ...extra, ...f }));
      if (tabla === 'jugadores') {
        for (const n of nuevas) {
          if (s.jugadores.some((j) => j.equipo_id === n.equipo_id && j.nombre.toLowerCase() === n.nombre.toLowerCase())) {
            throw new Error('Ese jugador ya está en el plantel.');
          }
        }
      }
      s[tabla].push(...nuevas);
      if (tabla === 'goles') recalcular(s, nuevas.map((g) => g.partido_id));
      guardar(s);
      avisar(tabla);
      return nuevas;
    },

    async actualizar(tabla, id, cambios) {
      red();
      await espera();
      const s = leer();
      const f = s[tabla].find((x) => x.id === id);
      permitir(s, tabla, f ? [f] : []);
      // Guardia (sql/007): el cargador no cambia estado, marcador ni penales con un update directo
      if (tabla === 'partidos' && f && rolDe(s) === 'cargador') {
        const tocaResultado = ['estado', 'goles_local', 'goles_visitante', 'penales_local', 'penales_visitante']
          .some((k) => k in cambios && cambios[k] !== f[k]);
        const tocaEquipos = f.estado === 'finalizado' && ['local_id', 'visitante_id'].some((k) => k in cambios && cambios[k] !== f[k]);
        if (tocaResultado || tocaEquipos) throw new Error(SIN_PERMISO);
      }
      if (f) Object.assign(f, cambios, tabla === 'partidos' ? { updated_at: new Date().toISOString() } : {});
      if (tabla === 'goles' && f) recalcular(s, [f.partido_id]);
      guardar(s);
      avisar(tabla);
      return f ? [f] : [];
    },

    async borrar(tabla, ids) {
      red();
      await espera();
      const s = leer();
      const set = new Set(ids);
      permitir(s, tabla, s[tabla].filter((x) => set.has(x.id)));
      const partidosTocados = tabla === 'goles' ? s.goles.filter((g) => set.has(g.id)).map((g) => g.partido_id) : [];
      s[tabla] = s[tabla].filter((x) => !set.has(x.id));
      // Cascadas como en la base real
      if (tabla === 'fechas') {
        const ps = new Set(s.partidos.filter((p) => set.has(p.fecha_id)).map((p) => p.id));
        s.partidos = s.partidos.filter((p) => !ps.has(p.id));
        s.goles = s.goles.filter((g) => !ps.has(g.partido_id));
        s.tarjetas = s.tarjetas.filter((t) => !ps.has(t.partido_id));
        s.actividades = s.actividades.filter((a) => !set.has(a.fecha_id));
      }
      if (tabla === 'partidos') {
        s.goles = s.goles.filter((g) => !set.has(g.partido_id));
        s.tarjetas = s.tarjetas.filter((t) => !set.has(t.partido_id));
      }
      if (tabla === 'equipos') s.jugadores = s.jugadores.filter((j) => !set.has(j.equipo_id));
      if (tabla === 'jugadores') {
        s.goles.forEach((g) => { if (set.has(g.jugador_id)) g.jugador_id = null; });
        s.tarjetas.forEach((t) => { if (set.has(t.jugador_id)) t.jugador_id = null; });
      }
      if (partidosTocados.length) recalcular(s, partidosTocados);
      guardar(s);
      avisar(tabla);
      return [];
    },

    async guardarConfig(cambios) {
      red();
      await espera();
      const s = leer();
      permitir(s, 'config', []);
      s.config = { ...s.config, ...cambios, id: 1 };
      guardar(s);
      avisar('config');
      return [s.config];
    },

    async subirEscudo(blob) {
      red();
      permitir(leer(), 'storage', []);
      return new Promise((ok, mal) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.onerror = mal;
        r.readAsDataURL(blob);
      });
    },

    // ── Estados y penales (como las funciones torneo_cambiar_estado y torneo_penales) ──

    async cambiarEstado(partidoId, nuevo) {
      red();
      await espera();
      const s = leer();
      const rol = rolDe(s);
      if (!rol) throw new Error(SIN_PERMISO);
      const p = s.partidos.find((x) => x.id === partidoId);
      if (!p || !p.local_id || !p.visitante_id) throw new Error('Este cruce todavía no está definido.');
      const ok = rol === 'admin'
        || (p.estado === 'programado' && ['en_juego', 'finalizado', 'suspendido'].includes(nuevo))
        || (p.estado === 'en_juego' && ['finalizado', 'suspendido'].includes(nuevo));
      if (!ok) throw new Error(SIN_PERMISO);
      const gl = s.goles.filter((g) => g.partido_id === p.id && g.equipo_id === p.local_id).length;
      const gv = s.goles.filter((g) => g.partido_id === p.id && g.equipo_id === p.visitante_id).length;
      if (nuevo === 'finalizado' && p.ronda !== 'todos' && gl === gv
        && (p.penales_local == null || p.penales_visitante == null || p.penales_local === p.penales_visitante)) {
        throw new Error('Empataron: cargá los penales (con un ganador) antes de terminar.');
      }
      p.estado = nuevo;
      if (nuevo === 'en_juego' || nuevo === 'finalizado') { p.goles_local = gl; p.goles_visitante = gv; }
      if (nuevo === 'finalizado' && (p.ronda === 'todos' || gl !== gv)) { p.penales_local = null; p.penales_visitante = null; }
      p.actualizado_por = sesionGuardada().id;
      p.updated_at = new Date().toISOString();
      if (nuevo === 'finalizado' && p.ronda !== 'todos') {
        for (const { id, ...c } of resolverCruces(s.partidos)) Object.assign(s.partidos.find((x) => x.id === id), c);
      }
      guardar(s);
      avisar('partidos');
    },

    async penales(partidoId, local, visitante) {
      red();
      await espera();
      const s = leer();
      const rol = rolDe(s);
      const p = s.partidos.find((x) => x.id === partidoId);
      if (!rol || !p || p.ronda === 'todos' || (rol === 'cargador' && !['en_juego', 'programado'].includes(p.estado))) throw new Error(SIN_PERMISO);
      p.penales_local = local;
      p.penales_visitante = visitante;
      p.actualizado_por = sesionGuardada().id;
      guardar(s);
      avisar('partidos');
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

    // ── Sesión y usuarios ──
    // En modo de prueba se entra con cualquier contraseña. Un mail que empieza con "cargador"
    // entra como cargador; cualquier otro, como admin.

    async sesion() {
      return sesionGuardada();
    },

    async ingresar(email, clave) {
      red();
      if (!email || !clave) throw new Error('El email o la contraseña no son correctos.');
      const s = leer();
      const mail = String(email).trim().toLowerCase();
      let u = s.usuarios.find((x) => x.email === mail);
      if (!u) {
        u = {
          user_id: `demo-${crypto.randomUUID()}`, email: mail, nombre: nombreDesdeEmail(mail),
          rol: mail.startsWith('cargador') ? 'cargador' : 'admin', activo: true, invitado: false,
        };
        s.usuarios.push(u);
        guardar(s);
      }
      const ses = { id: u.user_id, email: u.email };
      try { localStorage.setItem(CLAVE_SESION, JSON.stringify(ses)); } catch { /* */ }
      return ses;
    },

    async salir() {
      try { localStorage.removeItem(CLAVE_SESION); } catch { /* */ }
    },

    async miUsuario() {
      const ses = sesionGuardada();
      if (!ses) return null;
      const u = leer().usuarios.find((x) => x.user_id === ses.id);
      if (!u || !u.activo) return null;
      return { id: u.user_id, email: u.email, nombre: u.nombre, rol: u.rol, sinClave: !!u.invitado };
    },

    async reiniciar(borrarFixture) {
      red();
      await espera();
      const s = leer();
      if (rolDe(s) !== 'admin') throw new Error(SIN_PERMISO);
      s.goles = [];
      s.tarjetas = [];
      if (borrarFixture) {
        s.fechas = [];
        s.partidos = [];
        s.actividades = [];
      } else {
        const playoff = new Set(s.fechas.filter((f) => f.fase === 'playoff').map((f) => f.id));
        s.fechas = s.fechas.filter((f) => !playoff.has(f.id));
        s.partidos = s.partidos.filter((p) => !playoff.has(p.fecha_id));
        s.actividades = s.actividades.filter((a) => !playoff.has(a.fecha_id));
        for (const p of s.partidos) {
          Object.assign(p, { estado: 'programado', goles_local: null, goles_visitante: null, penales_local: null, penales_visitante: null });
        }
      }
      guardar(s);
      avisar('partidos');
    },

    async esAdmin() {
      const u = await this.miUsuario();
      return !!u && u.rol === 'admin';
    },

    async nombresUsuarios() {
      return Object.fromEntries(leer().usuarios.map((u) => [u.user_id, u.nombre]));
    },

    async usuarios() {
      red();
      await espera();
      const s = leer();
      if (rolDe(s) !== 'admin') throw new Error(SIN_PERMISO);
      return s.usuarios.map((u) => ({ ...u }));
    },

    async actualizarUsuario(userId, cambios) {
      red();
      await espera();
      const s = leer();
      if (rolDe(s) !== 'admin') throw new Error(SIN_PERMISO);
      const u = s.usuarios.find((x) => x.user_id === userId);
      if (u) Object.assign(u, cambios);
      guardar(s);
      return u ? [u] : [];
    },

    async invitar({ email, nombre, rol }) {
      red();
      await espera();
      const s = leer();
      if (rolDe(s) !== 'admin') throw new Error('Solo un admin puede invitar usuarios.');
      const mail = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new Error('Ese mail no parece válido.');
      let u = s.usuarios.find((x) => x.email === mail);
      let estado;
      if (u) {
        estado = u.invitado ? 'reenviado' : 'actualizado';
        Object.assign(u, { rol: rol === 'admin' ? 'admin' : 'cargador', activo: true }, nombre ? { nombre } : {});
      } else {
        u = { user_id: `demo-${crypto.randomUUID()}`, email: mail, nombre: nombre || null, rol: rol === 'admin' ? 'admin' : 'cargador', activo: true, invitado: true };
        s.usuarios.push(u);
        estado = 'invitado';
      }
      guardar(s);
      return estado;
    },

    async actualizarClave(clave) {
      red();
      if (!clave || clave.length < 8) throw new Error('No se pudo guardar la contraseña. Probá con otra.');
      const s = leer();
      const ses = sesionGuardada();
      const u = ses && s.usuarios.find((x) => x.user_id === ses.id);
      if (u) u.invitado = false;
      guardar(s);
    },

    async recuperarClave() {
      red();
      await espera();
    },
  };
}

export { TABLAS };
