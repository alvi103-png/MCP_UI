// Las demos en directo llaman a las APIs del taller con el mismo token que los retos.
// El layout Directo.astro lo deja en <meta name="token-taller">.
export function conToken(headers: Record<string, string> = {}): Record<string, string> {
  const token = document.querySelector<HTMLMetaElement>('meta[name="token-taller"]')?.content ?? '';
  return { ...headers, Authorization: `Bearer ${token}` };
}
