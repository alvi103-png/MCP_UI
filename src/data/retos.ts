import type { MarkdownInstance } from 'astro';

export interface RetoFrontmatter {
  title: string;
  bloque: number;
  minutos: number;
  resumen: string;
}

// Los enunciados viven junto al código de cada reto: retos/<slug>/README.md
const files = import.meta.glob<MarkdownInstance<RetoFrontmatter>>('/retos/*/README.md', { eager: true });

export const retos = Object.entries(files)
  .map(([path, file]) => ({
    slug: path.split('/').at(-2)!,
    ...file.frontmatter,
    Content: file.Content,
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug));
