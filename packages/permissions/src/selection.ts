import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_TOPICS, topicKeys, type PermissionKey, type PermissionTopicId } from './catalog.js';
import { closure, dependents, sortByCatalog } from './graph.js';

export type Selection = ReadonlySet<PermissionKey>;
export type TopicState = 'all' | 'none' | 'mixed';
/** Resultado de um clique: o novo conjunto e o que mudou além do item clicado (para anunciar). */
export type SelectionChange = Readonly<{ next: Selection; alsoAdded: PermissionKey[]; alsoRemoved: PermissionKey[] }>;

function changeOf(before: Selection, next: Set<PermissionKey>, clicked: readonly PermissionKey[]): SelectionChange {
  const own = new Set(clicked);
  return { next, alsoAdded: sortByCatalog([...next].filter(key => !before.has(key) && !own.has(key))),
    alsoRemoved: sortByCatalog([...before].filter(key => !next.has(key) && !own.has(key))) };
}

/** Ação: marcar soma o fechamento das dependências; desmarcar tira os dependentes, inclusive de outros tópicos. */
export function toggleKey(selected: Selection, key: PermissionKey): SelectionChange {
  const next = new Set(selected);
  if (selected.has(key)) for (const k of [key, ...dependents([key])]) next.delete(k);
  else for (const k of closure([key])) next.add(k);
  return changeOf(selected, next, [key]);
}

export function topicState(selected: Selection, topic: PermissionTopicId): TopicState {
  const keys = topicKeys(topic), marked = keys.filter(key => selected.has(key)).length;
  return marked === 0 ? 'none' : marked === keys.length ? 'all' : 'mixed';
}

/** Tópico: marcado → desmarca o tópico e os dependentes; desmarcado ou misto → marca o tópico e as dependências. */
export function toggleTopic(selected: Selection, topic: PermissionTopicId): SelectionChange {
  const keys = topicKeys(topic), next = new Set(selected);
  if (topicState(selected, topic) === 'all') for (const k of [...keys, ...dependents(keys)]) next.delete(k);
  else for (const k of closure(keys)) next.add(k);
  return changeOf(selected, next, keys);
}

/** "Todos" tem dois estados: marcado só com o catálogo inteiro. */
export const allSelected = (selected: Selection) => ALL_PERMISSIONS.every(key => selected.has(key));

export function toggleAll(selected: Selection): SelectionChange {
  return changeOf(selected, new Set(allSelected(selected) ? [] : ALL_PERMISSIONS), ALL_PERMISSIONS);
}

const labels = (keys: readonly PermissionKey[]) => keys.map(key => PERMISSIONS[key].label).join(', ');
export function cascadeMessage(change: SelectionChange): string {
  return [change.alsoAdded.length ? `Também ativado: ${labels(change.alsoAdded)}.` : '', change.alsoRemoved.length ? `Também desativado: ${labels(change.alsoRemoved)}.` : '']
    .filter(Boolean).join(' ');
}

export function selectionSummary(selected: Selection): string {
  if (selected.size === 0) return 'Nenhuma permissão';
  if (allSelected(selected)) return 'Todas as permissões';
  const topics = PERMISSION_TOPICS.filter(topic => topicState(selected, topic.id) !== 'none').length;
  return `${selected.size} ${selected.size === 1 ? 'permissão' : 'permissões'} em ${topics} ${topics === 1 ? 'tópico' : 'tópicos'}`;
}
