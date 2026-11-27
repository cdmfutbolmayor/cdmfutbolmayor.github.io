// Backend Supabase.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SinConexion, esErrorDeRed } from './db.js';

const TABLAS = ['equipos', 'jugadores', 'fechas', 'partidos', 'goles', 'actividades', 'tarjetas'];
// Tablas agregadas después: si todavía no se corrió su SQL, la app sigue andando sin ellas.
const OPCIONALES = new Set(['tarjetas']);
const T = (t) => `torneo_${t}`;
const BUCKET = 'torneo-escudos';

function chequear({ data, error }) {
  if (error) {
    if (esErrorDeRed(error)) throw new SinConexion();
    console.warn('[torneo]', error);
    // Mensajes que la persona entiende; el detalle técnico queda solo en la consola.
    if (error.code === '42501' || /row-level security|permission denied|sin permiso/i.test(error.message || '')) {
      throw new Error('No tenés permiso para hacer eso.');
    }
    if (/faltan penales/i.test(error.message || '')) throw new Error('Empataron: cargá los penales (con un ganador) antes de terminar.');
    if (/cruce siguiente jugado/i.test(error.message || '')) throw new Error('El cruce siguiente ya se empezó a jugar: primero borrá ese resultado.');
    const e = new Error('No se pudo guardar.');
    e.detalle = error;
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
        ...TABLAS.map((t) => (OPCIONALES.has(t)
          ? seguro(sb.from(T(t)).select('*')).catch((err) => { if (esErrorDeRed(err)) throw err; return []; })
          : seguro(sb.from(T(t)).select('*')))),
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
      for (const t of [...TABLAS.filter((x) => !OPCIONALES.has(x)), 'config']) {
        canal.on('postgres_changes', { event: '*', schema: 'public', table: T(t) }, () => onCambio(t));
      }
      canal.subscribe((estado) => {
        if (estado === 'SUBSCRIBED') onEstado('conectado');
        else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') onEstado('desconectado');
      });
      // Las tablas opcionales van en otro canal: si su tabla todavía no existe, no corta el principal.
      const extra = sb.channel('torneo-cambios-extra');
      for (const t of OPCIONALES) {
        extra.on('postgres_changes', { event: '*', schema: 'public', table: T(t) }, () => onCambio(t));
      }
      extra.subscribe();
      return () => { sb.removeChannel(canal); sb.removeChannel(extra); };
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
      const yo = await this.miUsuario();
      return !!yo && yo.rol === 'admin';
    },

    /** { id, email, nombre, rol } del usuario con sesión, o null si no es parte del torneo o está desactivado. */
    async miUsuario() {
      const u = await this.sesion();
      if (!u) return null;
      const { data, error } = await sb.from('torneo_admins').select('*').eq('user_id', u.id).maybeSingle();
      if (error) {
        if (esErrorDeRed(error)) throw new SinConexion();
        return null;
      }
      if (!data || data.activo === false) return null;
      // ¿Todavía no eligió contraseña? (si el SQL 005 no está aplicado, se asume que sí tiene)
      const { data: sinClave } = await sb.rpc('torneo_necesito_clave');
      return { id: u.id, email: u.email, nombre: data.nombre || null, rol: data.rol || 'admin', sinClave: sinClave === true };
    },

    /** Borra goles, tarjetas y marcador: el partido queda sin jugar (solo admin). */
    async borrarResultado(partidoId) {
      return seguro(sb.rpc('torneo_borrar_resultado', { p_partido: partidoId }));
    },

    async reiniciar(borrarFixture) {
      return seguro(sb.rpc('torneo_reiniciar', { p_borrar_fixture: !!borrarFixture }));
    },

    /** Nombres de los usuarios del torneo, para "Cargó Juan". { user_id: nombre } */
    async nombresUsuarios() {
      const { data, error } = await sb.from('torneo_admins').select('user_id, nombre');
      if (error) return {};
      return Object.fromEntries((data || []).map((x) => [x.user_id, x.nombre]));
    },

    async cambiarEstado(partidoId, estado) {
      return seguro(sb.rpc('torneo_cambiar_estado', { p_partido: partidoId, p_estado: estado }));
    },

    async penales(partidoId, local, visitante) {
      return seguro(sb.rpc('torneo_penales', { p_partido: partidoId, p_local: local, p_visitante: visitante }));
    },

    async usuarios() {
      return seguro(sb.rpc('torneo_usuarios'));
    },

    async actualizarUsuario(userId, cambios) {
      return seguro(sb.from('torneo_admins').update(cambios).eq('user_id', userId).select());
    },

    /** Manda la invitación por mail (Edge Function torneo-invitar). Devuelve 'invitado' | 'reenviado' | 'actualizado'. */
    async invitar({ email, nombre, rol, redirectTo }) {
      try {
        const { data, error } = await sb.functions.invoke('torneo-invitar', { body: { email, nombre, rol, redirectTo } });
        if (error) {
          let codigo = '';
          try { codigo = (await error.context.json()).error; } catch { /* sin cuerpo */ }
          console.warn('[torneo] invitar', error, codigo);
          const e = new Error(
            codigo === 'mail' ? 'No se pudo mandar el mail. Revisá la configuración de correo del proyecto.'
              : codigo === 'email' ? 'Ese mail no parece válido.'
                : codigo === 'sin_permiso' ? 'Solo un admin puede invitar usuarios.'
                  : 'No se pudo mandar la invitación. Probá de nuevo.');
          throw e;
        }
        return data && data.estado;
      } catch (err) {
        if (esErrorDeRed(err)) throw new SinConexion();
        throw err;
      }
    },

    async actualizarClave(clave) {
      const { error } = await sb.auth.updateUser({ password: clave });
      if (error) {
        if (esErrorDeRed(error)) throw new SinConexion();
        console.warn('[torneo]', error);
        throw new Error(/should be different/i.test(error.message)
          ? 'La contraseña nueva tiene que ser distinta de la anterior.'
          : 'No se pudo guardar la contraseña. Probá con otra.');
      }
    },

    async recuperarClave(email, redirectTo) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        if (esErrorDeRed(error)) throw new SinConexion();
        console.warn('[torneo]', error);
        // No contamos si el mail existe o no.
      }
    },
  };
}
