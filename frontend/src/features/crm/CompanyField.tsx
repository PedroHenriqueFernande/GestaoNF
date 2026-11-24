import type { Company } from '../../api/client';
import './crm.css';

export type CompanyChoice = Readonly<{ options: Company[]; onChange: (companyId: string) => void }>;

export function CompanyField({ choice, value, disabled }: { choice: CompanyChoice; value: string; disabled?: boolean }) {
  return <label className="field crm-company-field"><span>Cadastrar na empresa</span>
    <select autoFocus required value={value} disabled={disabled} onChange={event => choice.onChange(event.target.value)}>
      <option value="" disabled>Selecione a empresa</option>
      {choice.options.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
    </select>
  </label>;
}

export const creationOptions = (companies: Company[] | undefined, ids: readonly string[], can: (companyId: string) => boolean) =>
  (companies ?? []).filter(company => ids.includes(company.id) && can(company.id));
