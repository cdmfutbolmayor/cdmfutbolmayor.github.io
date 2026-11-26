// Backend Supabase.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SinConexion, esErrorDeRed } from './db.js';

const TABLAS = ['equipos', 'jugadores', 'fechas', 'partidos', 'goles', 'actividades'];
const T = (t) => `torneo_${t}`;
const BUCKET = 'torneo-escudos';

function chequear({ data, error }) {
  if (error) {
    if (esErrorDeRed(error)) throw new SinConexion();
    const e = new Error('No se pudo guardar.');
    e.detalle = error; // queda para la consola, nunca en pantalla
    console.warn('[torneo]', error);
    throw e;
  }
  return data;
}

async function seguro(promesa) {
  try {
    return chequear(await promesa);
  } catch (err) {
    if (esErrorDeRed(err)) throw new SinConexion();
    throw err;
  }
}

export function crear(url, anonKey) {
  const sb = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'nocturno-sesion' },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  return {
    modo: 'supabase',

    async listarTodo() {
      const [config, ...resto] = await Promise.all([
        seguro(sb.from('torneo_config').select('*').eq('id', 1).maybeSingle()),
        ...TABLAS.map((t) => seguro(sb.from(T(t)).select('*'))),
      ]);
      const D = { config: config || {} };
      TABLAS.forEach((t, i) => { D[t] = resto[i] || []; });
      return D;
    },

    async insertar(tabla, filas) {
      return seguro(sb.from(T(tabla)).insert(filas).select());
    },

    async actualizar(tabla, id, cambios) {
      return seguro(sb.from(T(tabla)).update(cambios).eq('id', id).select());
    },

    async borrar(tabla, ids) {
      if (!ids.length) return [];
      return seguro(sb.from(T(tabla)).delete().in('id', ids));
    },

    async guardarConfig(cambios) {
      return seguro(sb.from('torneo_config').upsert({ id: 1, ...cambios }).select());
    },

    async subirEscudo(blob, nombre) {
      await seguro(sb.storage.from(BUCKET).upload(nombre, blob, { upsert: true, contentType: blob.type, cacheControl: '31536000' }));
      return sb.storage.from(BUCKET).getPublicUrl(nombre).data.publicUrl;
    },

    suscribir(onCambio, onEstado) {
      const canal = sb.channel('torneo-cambios');
      for (const t of [...TABLAS, 'config']) {
        canal.on('postgres_changes', { event: '*', schema: 'public', table: T(t) }, () => onCambio(t));
      }
      canal.subscribe((estado) => {
        if (estado === 'SUBSCRIBED') onEstado('conectado');
        else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') onEstado('desconectado');
      });
      return () => sb.removeChannel(canal);
    },

    async sesion() {
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.user : null;
    },

    async ingresar(email, clave) {
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: clave });
        if (error) {
          if (esErrorDeRed(error)) throw new SinConexion();
          const e = new Error('El email o la contraseña no son correctos.');
          throw e;
        }
        return data.user;
      } catch (err) {
        if (esErrorDeRed(err)) throw new SinConexion();
        throw err;
      }
    },

    async salir() {
      await sb.auth.signOut();
    },

    async esAdmin() {
      const u = await this.sesion();
      if (!u) return false;
      const { data, error } = await sb.from('torneo_admins').select('user_id').eq('user_id', u.id).maybeSingle();
      if (error) {
        if (esErrorDeRed(error)) throw new SinConexion();
        return false;
      }
      return !!data;
    },
  };
}
