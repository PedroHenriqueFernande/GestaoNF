import type { CSSProperties } from 'react';
import { BookOpen, ChevronRight, FileDown, UserPlus } from 'lucide-react';

type Props = { aiEnabled: boolean; layout: 'list' | 'chips'; onReport: () => void; onTopics: () => void; onPrompt: (text: string) => void };

export function QuickActions({ aiEnabled, layout, onReport, onTopics, onPrompt }: Props) {
  const items = [
    { label: 'Gerar relatório em PDF', hint: 'Escolha o tipo e o período', icon: FileDown, run: onReport },
    { label: 'Como fazer...', hint: 'Guias passo a passo do sistema', icon: BookOpen, run: onTopics },
    ...(aiEnabled ? [{ label: 'Cadastrar cliente', hint: 'O assistente prepara, você confirma', icon: UserPlus, run: () => onPrompt('Quero cadastrar um cliente') }] : []),
  ];
  return <div className={`support-quick support-quick--${layout}`} role="group" aria-label="Atalhos">
    {items.map(({ label, hint, icon: Icon, run }, index) =>
      <button key={label} type="button" className={layout === 'list' ? 'support-shortcut' : 'support-chip'} aria-label={label} style={{ '--i': index } as CSSProperties} onClick={run}>
        <span className="support-shortcut__icon" aria-hidden="true"><Icon size={layout === 'list' ? 18 : 14} /></span>
        {layout === 'list'
          ? <><span className="support-shortcut__text"><strong>{label}</strong><small>{hint}</small></span><ChevronRight className="support-shortcut__go" size={16} aria-hidden="true" /></>
          : <span>{label}</span>}
      </button>)}
  </div>;
}
