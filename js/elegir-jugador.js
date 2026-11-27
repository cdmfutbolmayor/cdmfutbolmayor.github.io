// Ventana para elegir jugador (goles, amarillas y rojas), y para editar uno ya cargado.
// Hoja que sube desde abajo. Se cierra con "Cancelar", tocando afuera, deslizando hacia abajo o con Esc.
import { esc } from './util.js';
import { escudo, confirmar } from './ui.js';

const TITULOS = {
  gol: '¿Quién hizo el gol?',
  amarilla: '¿A quién le sacaron la amarilla?',
  roja: '¿A quién le sacaron la roja?',
};
const QUE = { gol: 'gol', amarilla: 'amarilla', roja: 'roja' };

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * @param {object} o
 * @param {'gol'|'amarilla'|'roja'} o.tipo
 * @param {Array<object>} o.equipos  [local, visitante]
 * @param {string} o.equipoId  gol: el equipo al que suma · tarjeta: el equipo del jugador
 * @param {boolean} [o.enContra]
 * @param {string|number|null} [o.minuto]
 * @param {(equipoId: string) => Array<{id, nombre, dato}>} o.jugadores  plantel (ya ordenado) con lo que tiene en el torneo
 * @param {{jugadorId, nombre, sinIdentificar}} [o.actual]  al editar: el jugador cargado
 * @param {boolean} [o.editar]
 * @returns {Promise<null | {eliminar: true} | {equipoId, enContra, minuto, jugadorId, nombre, sinIdentificar, agregarAlPlantel}>}
 */
export function elegirJugador(o) {
  const esGol = o.tipo === 'gol';
  const [A, B] = o.equipos;
  const st = {
    equipoId: o.equipoId,
    enContra: esGol && !!o.enContra,
    minuto: o.minuto ?? '',
    busca: '',
    // Selección: { jugadorId } | { otro: true } | { sin: true } | null
    sel: null,
    otroNombre: '',
    agregar: true,
  };
  const rival = (id) => (id === A.id ? B.id : A.id);
  const equipo = (id) => (id === A.id ? A : B);
  const deQuien = () => (st.enContra ? rival(st.equipoId) : st.equipoId);

  // Al editar, queda marcado el jugador actual
  if (o.actual) {
    if (o.actual.sinIdentificar) st.sel = { sin: true };
    else {
      const j = o.jugadores(deQuien()).find((x) => (o.actual.jugadorId && x.id === o.actual.jugadorId)
        || sinAcentos(x.nombre) === sinAcentos(o.actual.nombre));
      if (j) st.sel = { jugadorId: j.id };
      else { st.sel = { otro: true }; st.otroNombre = o.actual.nombre || ''; st.agregar = false; }
    }
  }

  return new Promise((listo) => {
    const d = document.createElement('dialog');
    d.className = 'hoja';
    d.setAttribute('aria-labelledby', 'hoja-titulo');
    d.setAttribute('aria-describedby', 'hoja-sub');
    let resultado = null;
    let cerrando = false;

    const cerrar = (r) => {
      if (cerrando) return;
      cerrando = true;
      resultado = r;
      d.classList.add('saliendo');
      setTimeout(() => d.close(), 160);
    };

    function subtitulo() {
      if (!esGol) return `Jugador de ${equipo(st.equipoId).nombre}`;
      return st.enContra
        ? `Gol en contra para ${equipo(st.equipoId).nombre}: elegí al jugador de ${equipo(rival(st.equipoId)).nombre} que lo hizo`
        : `Gol de ${equipo(st.equipoId).nombre}`;
    }

    function filasHTML() {
      const todos = o.jugadores(deQuien());
      const q = sinAcentos(st.busca);
      const lista = q ? todos.filter((j) => sinAcentos(j.nombre).includes(q)) : todos;
      const fila = (j) => `<button type="button" class="hoja-fila" data-j="${esc(j.id)}" aria-pressed="${st.sel?.jugadorId === j.id}">
          <span class="n">${esc(j.nombre)}</span>${j.dato ? `<small>${esc(j.dato)}</small>` : ''}</button>`;
      const vacio = !todos.length
        ? '<p class="hoja-vacio">Este equipo no tiene jugadores cargados.</p>'
        : (!lista.length ? `<p class="hoja-vacio">Nadie se llama "${esc(st.busca)}" en el plantel.</p>` : '');
      const otroAbierto = st.sel?.otro || !todos.length;
      return `${vacio}${lista.map(fila).join('')}
        ${todos.length ? `<button type="button" class="hoja-fila otro" data-otro aria-pressed="${!!st.sel?.otro}" aria-expanded="${!!otroAbierto}"><span class="n">Otro jugador</span><small>escribir el nombre</small></button>` : ''}
        ${otroAbierto ? `<div class="hoja-otro">
            <label class="campo">Nombre del jugador
              <input id="hoja-otro-nombre" autocomplete="off" value="${esc(st.otroNombre)}" placeholder="Nombre y apellido">
            </label>
            <label class="check"><input type="checkbox" id="hoja-agregar" ${st.agregar ? 'checked' : ''}> Agregar al plantel de ${esc(equipo(deQuien()).nombre)}</label>
            ${o.editar ? '' : `<button type="button" class="btn primario" data-confirmar-otro>Agregar ${QUE[o.tipo]}</button>`}
          </div>` : ''}
        ${esGol && !st.enContra ? `<button type="button" class="hoja-fila sin" data-sin aria-pressed="${!!st.sel?.sin}"><span class="n">Sin identificar</span><small>suma al marcador igual</small></button>` : ''}`;
    }

    d.innerHTML = `
      <div class="hoja-caja">
        <div class="hoja-cab" data-arrastre>
          <span class="hoja-asa" aria-hidden="true"></span>
          <h2 id="hoja-titulo" tabindex="-1">${esc(TITULOS[o.tipo])}</h2>
          <p id="hoja-sub" class="hoja-sub"></p>
        </div>
        <div class="hoja-opciones">
          ${esGol ? `<div class="equipo-btns" role="group" aria-label="El gol suma a">
            ${[A, B].map((e) => `<button type="button" class="btn" data-equipo="${esc(e.id)}" aria-pressed="${st.equipoId === e.id}">${escudo(e, 20)}<span>${esc(e.nombre)}</span></button>`).join('')}
          </div>` : ''}
          <div class="dos" style="align-items:end">
            <label class="campo">Minuto (opcional)<input type="number" inputmode="numeric" min="0" max="200" id="hoja-minuto" value="${esc(st.minuto)}"></label>
            ${esGol ? `<label class="check"><input type="checkbox" id="hoja-encontra" ${st.enContra ? 'checked' : ''}> En contra</label>` : '<span></span>'}
          </div>
          <input type="search" id="hoja-buscar" class="hoja-buscar" placeholder="Buscar jugador" aria-label="Buscar jugador" autocomplete="off">
        </div>
        <div class="hoja-lista" id="hoja-lista"></div>
        <div class="hoja-pie">
          ${o.editar ? '<button type="button" class="btn peligro" data-eliminar>Eliminar</button>' : ''}
          <button type="button" class="btn" data-cancelar>Cancelar</button>
          ${o.editar ? '<button type="button" class="btn primario" data-guardar>Guardar</button>' : ''}
        </div>
      </div>`;

    const $ = (s) => d.querySelector(s);
    function pintar() {
      $('#hoja-sub').textContent = subtitulo();
      d.querySelectorAll('[data-equipo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.equipo === st.equipoId)));
      $('#hoja-lista').innerHTML = filasHTML();
    }
    const leerOtro = () => {
      const n = $('#hoja-otro-nombre');
      const c = $('#hoja-agregar');
      if (n) st.otroNombre = n.value;
      if (c) st.agregar = c.checked;
    };
    const minuto = () => {
      const v = $('#hoja-minuto').value;
      return v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
    };
    function confirmarSeleccion() {
      leerOtro();
      const base = { equipoId: st.equipoId, enContra: st.enContra, minuto: minuto(), agregarAlPlantel: false, sinIdentificar: false, jugadorId: null, nombre: '' };
      const sinPlantel = !o.jugadores(deQuien()).length;
      if (st.sel?.sin) return cerrar({ ...base, sinIdentificar: true });
      if (st.sel?.jugadorId) {
        const j = o.jugadores(deQuien()).find((x) => x.id === st.sel.jugadorId);
        if (j) return cerrar({ ...base, jugadorId: j.id, nombre: j.nombre });
      }
      if (st.sel?.otro || sinPlantel) {
        const nombre = st.otroNombre.trim();
        if (!nombre) { const n = $('#hoja-otro-nombre'); n?.focus(); n?.classList.add('error'); return null; }
        return cerrar({ ...base, nombre, agregarAlPlantel: st.agregar });
      }
      $('#hoja-buscar').focus();
      return null;
    }

    d.addEventListener('click', async (e) => {
      if (e.target === d) { cerrar(null); return; } // tocar afuera (el fondo)
      const t = e.target.closest('button');
      if (!t) return;
      if (t.matches('[data-cancelar]')) { cerrar(null); return; }
      if (t.matches('[data-equipo]')) {
        leerOtro();
        if (st.equipoId !== t.dataset.equipo) {
          st.equipoId = t.dataset.equipo;
          if (st.sel?.jugadorId) st.sel = null; // el jugador era del otro plantel
        }
        pintar();
        return;
      }
      if (t.matches('[data-j]')) {
        st.sel = { jugadorId: t.dataset.j };
        if (o.editar) pintar(); else confirmarSeleccion();
        return;
      }
      if (t.matches('[data-sin]')) {
        st.sel = { sin: true };
        if (o.editar) pintar(); else confirmarSeleccion();
        return;
      }
      if (t.matches('[data-otro]')) {
        leerOtro();
        st.sel = { otro: true };
        if (!st.otroNombre && st.busca) st.otroNombre = st.busca;
        pintar();
        const n = $('#hoja-otro-nombre');
        if (n) { n.focus(); n.scrollIntoView({ block: 'nearest' }); }
        return;
      }
      if (t.matches('[data-confirmar-otro], [data-guardar]')) { confirmarSeleccion(); return; }
      if (t.matches('[data-eliminar]')) {
        const ok = await confirmar(`¿Eliminar ${o.tipo === 'gol' ? 'este gol' : 'esta tarjeta'}? ${o.tipo === 'gol' ? 'El marcador se recalcula solo.' : ''}`.trim(), { si: 'Eliminar', peligro: true });
        if (ok) cerrar({ eliminar: true });
      }
    });
    d.addEventListener('input', (e) => {
      if (e.target.id === 'hoja-buscar') { leerOtro(); st.busca = e.target.value; pintar(); }
      if (e.target.id === 'hoja-otro-nombre') e.target.classList.remove('error');
    });
    d.addEventListener('change', (e) => {
      if (e.target.id === 'hoja-encontra') {
        leerOtro();
        st.enContra = e.target.checked;
        if (st.sel?.jugadorId || st.sel?.sin) st.sel = null; // cambia el plantel que se muestra
        pintar();
      }
    });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'hoja-otro-nombre') { e.preventDefault(); confirmarSeleccion(); }
      // Foco atrapado: Tab da la vuelta dentro de la ventana
      if (e.key === 'Tab') {
        const f = [...d.querySelectorAll('button, input, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(null); }); // Esc
    d.addEventListener('close', () => { d.remove(); listo(resultado); });

    // Deslizar hacia abajo desde el encabezado para cerrar
    const caja = d.querySelector('.hoja-caja');
    let y0 = null;
    const zona = d.querySelector('[data-arrastre]');
    zona.addEventListener('pointerdown', (e) => { y0 = e.clientY; zona.setPointerCapture(e.pointerId); caja.style.transition = 'none'; });
    zona.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      const dy = Math.max(0, e.clientY - y0);
      caja.style.transform = `translateY(${dy}px)`;
    });
    const soltar = (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      y0 = null;
      caja.style.transition = '';
      if (dy > 80) cerrar(null);
      else caja.style.transform = '';
    };
    zona.addEventListener('pointerup', soltar);
    zona.addEventListener('pointercancel', soltar);

    document.body.appendChild(d);
    pintar();
    d.showModal();
    // En el celular no se abre el teclado de entrada (tapa la lista); en la compu, al buscador.
    if (matchMedia('(pointer: coarse)').matches) $('#hoja-titulo').focus();
    else $('#hoja-buscar').focus();
    const marcado = d.querySelector('.hoja-fila[aria-pressed="true"]');
    if (marcado) marcado.scrollIntoView({ block: 'center' });
  });
}
