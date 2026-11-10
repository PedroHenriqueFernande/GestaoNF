import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destinations, type Destination } from './support-blocks.js';

export type HelpArticle = { id: string; titulo: string; rota: Destination | null; palavrasChave: string[]; conteudo: string };

export function parseHelpArticle(source: string, file: string): HelpArticle {
  const match = source.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`Artigo de ajuda sem frontmatter: ${file}`);
  const meta = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index > 0) meta.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  const id = meta.get('id') ?? '';
  const titulo = meta.get('titulo') ?? '';
  const rota = meta.get('rota') || null;
  const conteudo = match[2].trim();
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Artigo de ajuda com id inválido: ${file}`);
  if (!titulo) throw new Error(`Artigo de ajuda sem título: ${file}`);
  if (!conteudo) throw new Error(`Artigo de ajuda sem conteúdo: ${file}`);
  if (rota && !(rota in destinations)) throw new Error(`Rota desconhecida em ${file}: ${rota}`);
  const palavrasChave = (meta.get('palavras-chave') ?? '').replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean);
  return { id, titulo, rota: rota as Destination | null, palavrasChave, conteudo };
}

const defaultDir = fileURLToPath(new URL('./help/', import.meta.url));

export class SupportHelpCatalog {
  private readonly byId = new Map<string, HelpArticle>();

  constructor(articles: HelpArticle[]) {
    for (const article of articles) {
      if (this.byId.has(article.id)) throw new Error(`Artigo de ajuda duplicado: ${article.id}`);
      this.byId.set(article.id, article);
    }
  }

  static load(dir = defaultDir) {
    const files = readdirSync(dir).filter((file) => file.endsWith('.md')).sort();
    return new SupportHelpCatalog(files.map((file) => parseHelpArticle(readFileSync(join(dir, file), 'utf8'), file)));
  }

  list() { return [...this.byId.values()].map(({ id, titulo }) => ({ id, titulo })); }
  get(id: string) { return this.byId.get(id) ?? null; }
  ids(): [string, ...string[]] {
    const ids = [...this.byId.keys()];
    if (!ids.length) throw new Error('Base de ajuda vazia');
    return ids as [string, ...string[]];
  }
}
