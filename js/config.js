// Configuración del sitio.
// La anon key es pública por diseño (la seguridad la da RLS). NUNCA poner acá la service_role key.
// Si SUPABASE_URL queda vacío, la app arranca en "modo de prueba" (datos solo en este navegador).

export const SUPABASE_URL = 'https://mncemnlhtgvtubtkvivd.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uY2VtbmxodGd2dHVidGt2aXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEwNTk5NzIsImV4cCI6MjA3NjYzNTk3Mn0.CSwnyynuvRGdAusGLYCA0f_ws8LRoYiG9pe4e5n6dpA';

// Subir junto con CACHE_VERSION de /sw.js, siempre en el mismo cambio.
export const VERSION = '1.1.3';

// Dirección pública que aparece en las placas.
export const SITIO = 'cdmfutbolmayor.github.io';
