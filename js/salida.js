// Botón "atrás" del celular: primero vuelve dentro de la app (cierra diálogos, sale del detalle)
// y, ya en la pantalla principal, hay que tocarlo dos veces seguidas para salir.
import { aviso } from './ui.js';

const VENTANA_MS = 2500;

/**
 * volverDentro(): si hay algo para "volver" dentro de la app lo hace y devuelve true.
 * Si devuelve false, se está en la pantalla principal y empieza el doble toque para salir.
 */
export function protegerSalida(volverDentro = () => false) {
  if (!window.history || !history.pushState) return;
  // Dos entradas en el historial: la base y una "guardia" encima. El atrás saca la guardia y lo atajamos.
  history.replaceState({ nocturno: 'base' }, '');
  history.pushState({ nocturno: 'guardia' }, '');
  let esperando = null;

  addEventListener('popstate', (e) => {
    if (!e.state || e.state.nocturno !== 'base') return;

    // 1) Cerrar lo que esté abierto (diálogos, detalle de equipo, partido…)
    const dlg = document.querySelector('dialog[open]');
    let manejado = false;
    if (dlg) { dlg.close(); manejado = true; } else { manejado = !!volverDentro(); }
    if (manejado) {
      clearTimeout(esperando);
      esperando = null;
      history.pushState({ nocturno: 'guardia' }, '');
      return;
    }

    // 2) Pantalla principal: el primer atrás avisa. Durante unos segundos nos quedamos
    //    en la base sin guardia, así el segundo atrás sale de verdad.
    if (esperando) return;
    aviso('Tocá atrás otra vez para salir.', 'info', VENTANA_MS);
    esperando = setTimeout(() => {
      esperando = null;
      history.pushState({ nocturno: 'guardia' }, '');
    }, VENTANA_MS);
  });
}
