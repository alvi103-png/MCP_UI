// Token compartido del taller. No está en git: se lee de WORKSHOP_TOKEN en .dev.vars (el .env de
// Wrangler, que el adaptador de Cloudflare carga también al compilar) y se muestra en /apis y en las
// slides. Es el mismo valor que valida el Worker; en producción:
//   pnpm wrangler secret put WORKSHOP_TOKEN
// Al terminar el taller, cambia el secreto para que deje de funcionar.
export const TOKEN_DEL_TALLER: string = import.meta.env.WORKSHOP_TOKEN ?? '';

if (!TOKEN_DEL_TALLER) {
  console.warn('[taller] Falta WORKSHOP_TOKEN en .dev.vars: el token no se mostrará en /apis ni en las slides.');
}
