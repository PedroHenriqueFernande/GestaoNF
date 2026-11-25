import { useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_TOPICS, allSelected, cascadeMessage, toggleAll, toggleKey, toggleTopic, topicState,
  type PermissionKey, type PermissionTopic, type Selection, type SelectionChange, type TopicState } from '@gestaonf/permissions';
import './permissions-dialog.css';

/** Diálogo empilhado (D12): trabalha numa cópia; Aplicar devolve, Cancelar/Esc descartam. Não grava nada. */
export function PermissionsDialog({ subject, initial, onApply, onCancel }: {
  subject: string; initial: Selection; onApply: (next: Selection) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Selection>(() => new Set(initial));
  const [announcement, setAnnouncement] = useState('');
  const allCheckbox = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    allCheckbox.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  const apply = (change: SelectionChange) => { setSelected(change.next); setAnnouncement(cascadeMessage(change)); };
  /** Fecha antes de avisar o pai: com o diálogo aberto, o resto da página é inerte e não recebe foco. */
  const finish = (next?: Selection) => { ref.current?.close(); if (next) onApply(next); else onCancel(); };
  const onNativeCancel = (event: SyntheticEvent) => { event.preventDefault(); finish(); };

  return <dialog ref={ref} className="permissions-dialog" aria-labelledby="permissions-title" onCancel={onNativeCancel}>
    <header className="permissions-dialog__header">
      <div><h2 id="permissions-title">Permissões de usuário</h2>{subject && <p>{subject}</p>}</div>
    </header>
    <div className="permissions-dialog__body">
      <div className={`permissions-all${selected.size ? ' has-selection' : ''}`}>
        <label className="permissions-check permissions-all__toggle">
          <input type="checkbox" ref={allCheckbox} checked={allSelected(selected)} aria-describedby="permissions-count" onChange={() => apply(toggleAll(selected))} />
          <span><strong>Todas as permissões</strong><small>{selected.size === 0 ? 'Este usuário verá apenas Meu perfil.' : 'Marque ou desmarque tudo de uma vez.'}</small></span>
        </label>
        <p id="permissions-count" className="permissions-count"><b>{selected.size}</b> de {ALL_PERMISSIONS.length} marcadas</p>
      </div>
      <div className="permissions-dialog__topics">
        {PERMISSION_TOPICS.map((topic) => <TopicFieldset key={topic.id} topic={topic} selected={selected} onTopic={() => apply(toggleTopic(selected, topic.id))} onKey={(key) => apply(toggleKey(selected, key))} />)}
      </div>
      <p className="permissions-dialog__announcement" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
    <footer className="permissions-dialog__footer">
      <button type="button" className="button button--secondary" onClick={() => finish()}>Cancelar</button>
      <button type="button" className="button button--primary" onClick={() => finish(selected)}>Aplicar</button>
    </footer>
  </dialog>;
}

function TopicCheckbox({ state, label, onToggle }: { state: TopicState; label: string; onToggle: () => void }) {
  // `indeterminate` só existe no DOM; a API de acessibilidade o expõe como "mixed" (Spec 8.5).
  return <label className="permissions-check permissions-topic__toggle">
    <input type="checkbox" checked={state === 'all'} ref={(input) => { if (input) input.indeterminate = state === 'mixed'; }} onChange={onToggle} />
    <span>{label}</span>
  </label>;
}

/** Acima disso o rótulo quebra em duas linhas na coluna de ~210px da grade. */
const SINGLE_LINE_LABEL_MAX = 30;
const isTall = (key: PermissionKey) => !!PERMISSIONS[key].description || PERMISSIONS[key].label.length > SINGLE_LINE_LABEL_MAX;
/**
 * Só a exibição muda: itens de duas linhas vão para o fim da área, para que apenas a última
 * linha da grade fique mais alta e as demais continuem alinhadas. A ordem do catálogo é mantida no resto.
 */
const displayOrder = (keys: readonly PermissionKey[]) => [...keys.filter((key) => !isTall(key)), ...keys.filter(isTall)];

function TopicFieldset({ topic, selected, onTopic, onKey }: { topic: PermissionTopic; selected: Selection; onTopic: () => void; onKey: (key: PermissionKey) => void }) {
  const state = topicState(selected, topic.id);
  const keys = topic.areas.flatMap((area) => area.keys);
  const marked = keys.filter((key) => selected.has(key)).length;
  return <fieldset className={`permissions-topic is-${state}`}>
    <legend className="permissions-topic__header">
      <TopicCheckbox state={state} label={topic.label} onToggle={onTopic} />
      <span className="permissions-topic__count" aria-hidden="true">{marked} de {keys.length}</span>
    </legend>
    {topic.areas.map((area) => <div key={area.id} className="permissions-area">
      {topic.areas.length > 1 && <h3>{area.label}</h3>}
      <div className="permissions-area__keys">
      {displayOrder(area.keys).map((key) => {
        const description = PERMISSIONS[key].description;
        const keyId = `permission-${key.replace('.', '-')}`;
        return <label key={key} className="permissions-check permissions-key">
          <input type="checkbox" checked={selected.has(key)} aria-labelledby={`${keyId}-label`} aria-describedby={description ? `${keyId}-desc` : undefined} onChange={() => onKey(key)} />
          <span><span id={`${keyId}-label`}>{PERMISSIONS[key].label}</span>{description && <small id={`${keyId}-desc`}>{description}</small>}</span>
        </label>;
      })}
      </div>
    </div>)}
  </fieldset>;
}
