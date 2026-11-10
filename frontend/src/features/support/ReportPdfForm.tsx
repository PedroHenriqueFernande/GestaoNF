import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, FileDown } from 'lucide-react';
import { api, type ReportType } from '../../api/client';
import { monthPeriod, reports } from '../reports/report-definitions';
import { reportPdfFilename, saveBlob } from './download';

export function ReportPdfForm({ companyId, onBack }: { companyId: string; onBack: () => void }) {
  const initial = monthPeriod(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [type, setType] = useState<ReportType>('closed-services');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [validation, setValidation] = useState('');
  const catalog = reports.find((report) => report.type === type)?.catalog ?? false;
  const download = useMutation({
    mutationFn: () => api.reportPdf(companyId, type, from && to ? { from, to } : {}),
    onSuccess: (blob) => saveBlob(blob, reportPdfFilename(type, from || undefined, to || undefined)),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!!from !== !!to || (!catalog && (!from || !to))) { setValidation('Informe a data inicial e a data final.'); return; }
    if (from && to) {
      const span = (Date.parse(to) - Date.parse(from)) / 86400000;
      if (span < 0 || span >= 366) { setValidation('Escolha um período de até 366 dias, com início anterior ao fim.'); return; }
    }
    setValidation('');
    download.mutate();
  }
  return <form className="support-form" onSubmit={submit}>
    <button type="button" className="support-back" onClick={onBack}><ArrowLeft size={14} />Voltar</button>
    <div className="support-form__head"><h3>Relatório em PDF</h3><p className="support-muted">Gere o arquivo na hora, com os dados da empresa selecionada.</p></div>
    <label>Tipo de relatório
      <select value={type} onChange={(event) => setType(event.target.value as ReportType)}>
        {reports.map((report) => <option key={report.type} value={report.type}>{report.title}</option>)}
      </select>
    </label>
    <div className="support-form__dates">
      <label>Data inicial<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Data final<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    {catalog && <p className="support-muted">Deixe as datas em branco para listar todos os registros.</p>}
    {(validation || download.isError) && <p className="support-notice support-notice--error" role="alert">{validation || download.error?.message}</p>}
    <button className="button button--primary support-form__submit" disabled={download.isPending}><FileDown size={16} />{download.isPending ? 'Gerando PDF...' : 'Baixar PDF'}</button>
  </form>;
}
