import { FileText } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? ' brand--compact' : ''}`} aria-label="GestãoNF">
      <span className="brand__mark"><FileText size={21} strokeWidth={2.2} aria-hidden="true" /></span>
      <span className="brand__name">Gestão<span>NF</span></span>
    </div>
  );
}
