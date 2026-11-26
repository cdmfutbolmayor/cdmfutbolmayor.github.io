// Piezas de interfaz compartidas por la vista pública y el admin.
import { esc, inicial, textoSobre, fechaCorta, fechaLargaMin, hora } from './util.js';
import { esReprogramado, nombreCruce } from './calculos.js';

const svg = (d, extra = '') =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICONO = {
  compartir: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
  calendario: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  subir: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  cerrar: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  izq: svg('<path d="M15 18l-6-6 6-6"/>'),
  der: svg('<path d="M9 18l6-6-6-6"/>'),
  mas: svg('<path d="M12 5v14M5 12h14"/>'),
  menos: svg('<path d="M5 12h14"/>'),
  borrar: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  arriba: svg('<path d="M18 15l-6-6-6 6"/>'),
  abajo: svg('<path d="M6 9l6 6 6-6"/>'),
  salir: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  pelota: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/>'),
  resultados: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M3 12h4M17 12h4"/>'),
  equipos: svg('<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/>'),
  formato: svg('<path d="M4 6h6v4H4zM14 14h6v4h-6zM10 8h4v8"/>'),
  enlace: svg('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'),
};

export function mapaEquipos(D) {
  return new Map((D.equipos || []).map((e) => [e.id, e]));
}

/** Escudo del equipo o círculo de color con la inicial. */
export function escudo(eq, tam = 20, clase = '') {
  const s = `width:${tam}px;height:${tam}px`;
  if (eq && eq.escudo_url) {
    return `<img class="escudo ${clase}" src="${esc(eq.escudo_url)}" alt="" width="${tam}" height="${tam}" style="${s}" loading="lazy" decoding="async">`;
  }
  const color = (eq && eq.color) || '#98a2b0';
  const letra = eq ? inicial(eq.nombre) : '?';
  return `<span class="escudo inicial ${clase}" aria-hidden="true" style="${s};background:${esc(color)};color:${textoSobre(color)};font-size:${Math.round(tam * 0.5)}px">${esc(letra)}</span>`;
}

/** Nombre a mostrar de un lado del partido: el equipo, o el origen ("2º", "Ganador semi 1"), o "A definir". */
export function nombreLado(p, lado, equipos) {
  const eq = equipos.get(p[`${lado}_id`]);
  if (eq) return eq.nombre;
  return p[`${lado}_origen`] || 'A definir';
}

/** Estado corto para la columna izquierda de la fila del partido. */
export function estadoPartido(p, fecha) {
  if (p.estado === 'finalizado') return { texto: 'Final', clase: 'fin' };
  if (p.estado === 'en_juego') return { texto: 'En juego', clase: 'vivo' };
  if (p.estado === 'suspendido') return { texto: 'Susp.', clase: 'susp' };
  if (esReprogramado(p, fecha)) return { texto: fechaCorta(p.dia).split(' ')[0], clase: 'reprog' };
  return { texto: hora(p.hora), clase: 'hora' };
}

export function textoReprogramado(p) {
  return `Reprogramado · se juega el ${fechaLargaMin(p.dia)} a las ${hora(p.hora)}`;
}

/** "M. García (2), L. Sosa" por lado. Los en contra llevan "(e/c)". */
export function golesPorLado(D, p) {
  const res = { local: '', visitante: '' };
  const goles = (D.goles || []).filter((g) => g.partido_id === p.id);
  for (const lado of ['local', 'visitante']) {
    const eqId = p[`${lado}_id`];
    const cuenta = new Map();
    for (const g of goles.filter((x) => x.equipo_id === eqId)) {
      const nombre = String(g.jugador_nombre || '').trim() || 'Sin nombre';
      const k = `${nombre.toLowerCase()}|${g.en_contra ? 1 : 0}`;
      const x = cuenta.get(k) || { nombre, ec: !!g.en_contra, n: 0 };
      x.n++;
      cuenta.set(k, x);
    }
    res[lado] = [...cuenta.values()]
      .map((x) => `${x.nombre}${x.ec ? ' (e/c)' : ''}${x.n > 1 ? ` (${x.n})` : ''}`)
      .join(', ');
  }
  return res;
}

export function etiquetaCruce(p) {
  return p.ronda && p.ronda !== 'todos' ? nombreCruce(p.ronda, p.llave) : '';
}

export function hayPenales(p) {
  return p.penales_local !== null && p.penales_local !== undefined && p.penales_visitante !== null && p.penales_visitante !== undefined;
}

// ── Avisos y diálogos ──────────────────────────────────────

let zonaToast;
export function aviso(texto, tipo = 'info', ms = 3200) {
  if (!zonaToast) {
    zonaToast = document.createElement('div');
    zonaToast.className = 'toasts';
    zonaToast.setAttribute('role', 'status');
    zonaToast.setAttribute('aria-live', 'polite');
    document.body.appendChild(zonaToast);
  }
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = texto;
  zonaToast.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/**
 * Abre un diálogo. contenido: HTML. botones: [{ texto, valor, clase }]
 * Devuelve una promesa con { valor, form } al cerrar.
 */
export function dialogo({ titulo, contenido = '', botones = [{ texto: 'Listo', valor: true, clase: 'primario' }] }) {
  return new Promise((ok) => {
    const d = document.createElement('dialog');
    d.className = 'dialogo';
    d.innerHTML = `
      <form method="dialog">
        ${titulo ? `<h2>${esc(titulo)}</h2>` : ''}
        <div class="dialogo-cuerpo">${contenido}</div>
        <div class="dialogo-botones">
          ${botones.map((b, i) => `<button class="btn ${b.clase || ''}" value="${i}" type="submit">${esc(b.texto)}</button>`).join('')}
        </div>
      </form>`;
    document.body.appendChild(d);
    const form = d.querySelector('form');
    let elegido = null;
    form.addEventListener('submit', (e) => {
      elegido = e.submitter ? Number(e.submitter.value) : null;
    });
    d.addEventListener('close', () => {
      const b = elegido !== null ? botones[elegido] : null;
      const datos = Object.fromEntries(new FormData(form).entries());
      d.remove();
      ok({ valor: b ? b.valor : null, datos });
    });
    d.showModal();
    const foco = d.querySelector('input, textarea, select');
    if (foco) foco.focus();
  });
}

export async function confirmar(texto, { si = 'Sí', no = 'Cancelar', peligro = false } = {}) {
  const r = await dialogo({
    contenido: `<p>${esc(texto)}</p>`,
    botones: [
      { texto: no, valor: false, clase: 'secundario' },
      { texto: si, valor: true, clase: peligro ? 'peligro' : 'primario' },
    ],
  });
  return r.valor === true;
}
