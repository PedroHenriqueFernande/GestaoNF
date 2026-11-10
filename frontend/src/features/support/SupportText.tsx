import { Fragment, type ReactNode } from 'react';

// Negrito só quando os ** abrem e fecham colados ao texto; qualquer ** solto continua como texto literal.
const boldSplit = /(\*\*(?!\s)[^*]+?(?<!\s)\*\*)/g;
const boldOnly = /^\*\*(?!\s)[^*]+?(?<!\s)\*\*$/;

function inline(text: string): ReactNode[] {
  return text.split(boldSplit).filter(Boolean).map((part, index) =>
    boldOnly.test(part) ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>);
}

const bullet = /^\s*[-•*]\s+/;
const numbered = /^\s*\d+[.)]\s+/;
const heading = /^#{1,6}\s+/;

export function SupportText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    list = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const ordered = numbered.test(line);
    if (ordered || bullet.test(line)) {
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(line.replace(ordered ? numbered : bullet, ''));
      continue;
    }
    flush();
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(heading.test(trimmed) ? <h4 key={out.length}>{inline(trimmed.replace(heading, ''))}</h4> : <p key={out.length}>{inline(trimmed)}</p>);
  }
  flush();
  return <div className="support-text">{out}</div>;
}
