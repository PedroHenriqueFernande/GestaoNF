import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { AlertCircle, ArrowLeft, ArrowRight, BarChart3, ChevronLeft, ChevronRight, Download, Filter, RefreshCw } from 'lucide-react';
import { api, type ReportFilters, type ReportResult, type User } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { money, monthPeriod, reportDate, reports, statusLabels, type ReportDefinition } from './report-definitions';
import './reports.css';

export function ReportsPage({ user }: { user: User }) {
  const client=useQueryClient(), {type:slug}=useParams();
  const [companyId,setCompanyId]=useState(()=>sessionStorage.getItem('gestaonf.companyId')??'');
  const companies=useQuery({queryKey:['companies'],queryFn:api.companies});
  const profile=useQuery({queryKey:['company',companyId],queryFn:()=>api.company(companyId),enabled:!!companyId});
  useEffect(()=>{if(companies.data && !companies.data.some(c=>c.id===companyId)) setCompanyId(companies.data[0]?.id??'');},[companies.data,companyId]);
  useEffect(()=>{if(companyId) sessionStorage.setItem('gestaonf.companyId',companyId);},[companyId]);
  const logout=useMutation({mutationFn:api.logout,onSuccess:()=>{sessionStorage.removeItem('gestaonf.companyId');client.clear();window.location.assign('/relatorios');}});
  const definition=reports.find(r=>r.slug===slug);
  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={setCompanyId} onLogout={()=>logout.mutate()} loggingOut={logout.isPending}>
    <main id="workspace-main" className="reports-main" tabIndex={-1}>
      {!slug ? <>
        <header className="reports-header"><div><span className="eyebrow">GESTÃO / RELATÓRIOS</span><h1>Relatórios</h1><p>Consulte os resultados da sua empresa e exporte seus cadastros.</p></div><span className="reports-header__icon"><BarChart3 size={28}/></span></header>
        <section className="reports-grid" aria-label="Relatórios disponíveis">{reports.map(({slug,title,description,icon:Icon,catalog})=><Link className="report-card" key={slug} to={`/relatorios/${slug}`}><span className="report-card__icon"><Icon size={23}/></span><div><h2>{title}</h2><p>{description}</p></div><span className="report-card__footer">{catalog ? 'Consultar e exportar CSV' : 'Ver relatório'}<ArrowRight size={16}/></span></Link>)}</section>
      </> : !definition ? <div className="reports-state"><AlertCircle size={25}/><h1>Relatório não encontrado</h1><Link to="/relatorios">Voltar aos relatórios</Link></div>
        : profile.isError ? <div className="reports-state" role="alert"><p>Não foi possível carregar a empresa.</p><button className="button button--secondary" onClick={()=>profile.refetch()}>Tentar novamente</button></div>
        : profile.data ? <ReportDetail key={`${companyId}-${definition.type}`} definition={definition} companyId={companyId} timezone={profile.data.timezone}/>
        : <div className="reports-state" role="status"><RefreshCw className="is-spinning" size={22}/>Carregando relatório...</div>}
    </main>
  </WorkspaceLayout>;
}

function ReportDetail({definition:d,companyId,timezone}:{definition:ReportDefinition;companyId:string;timezone:string}) {
  const initial:ReportFilters={status:'ALL',...(d.catalog ? {} : monthPeriod(timezone))};
  const [draft,setDraft]=useState<ReportFilters>(initial),[applied,setApplied]=useState<ReportFilters>(initial);
  const [cursors,setCursors]=useState<Array<string|undefined>>([undefined]);
  const cursor=cursors.at(-1);
  const result=useQuery({queryKey:['report',companyId,d.type,applied,cursor],queryFn:()=>api.report(companyId,d.type,{...applied,limit:25,cursor})});
  const csv=useMutation({mutationFn:()=>api.reportCsv(companyId,d.type as 'customers'|'service-catalog',applied),onSuccess:(blob)=>{
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${d.slug}-${companyId.slice(0,8)}.csv`;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }});
  const [validation,setValidation]=useState('');
  function apply(event:FormEvent) {
    event.preventDefault();
    if((!!draft.from!==!!draft.to)||(!d.catalog && (!draft.from||!draft.to))) {setValidation('Informe a data inicial e a data final.');return;}
    if(draft.from && draft.to) {
      const span=(Date.parse(draft.to)-Date.parse(draft.from))/86400000;
      if(span<0 || span>=366) {setValidation('Escolha um período de até 366 dias, com início anterior ao fim.');return;}
    }
    setValidation('');csv.reset();setApplied(Object.fromEntries(Object.entries(draft).filter(([,v])=>v!=='')));setCursors([undefined]);
  }
  const update=(key:keyof ReportFilters,value:string)=>setDraft(old=>({...old,[key]:value}));
  const summary=result.data?.summary;
  const total=Number(summary?.[d.rate ? d.type==='loss-rate' ? 'lost' : 'disqualified' : d.type==='lead-entries' ? 'entries' : d.type==='closed-services' ? 'saleCount' : d.type==='service-receipts' ? 'movementCount' : 'total']??0);
  return <>
    <Link className="reports-back" to="/relatorios"><ArrowLeft size={15}/>Todos os relatórios</Link>
    <header className="reports-header"><div><span className="eyebrow">{d.catalog ? 'CADASTROS' : d.crm || d.type==='meetings' ? 'RELACIONAMENTO' : 'VENDAS E RECEBIMENTOS'}</span><h1>{d.title}</h1><p>{d.description}</p></div><div className="reports-actions"><button className="button button--secondary" aria-label="Atualizar relatório" disabled={result.isFetching} onClick={()=>result.refetch()}><RefreshCw size={16} className={result.isFetching ? 'is-spinning' : ''}/></button>{d.catalog && <button className="button button--primary" disabled={csv.isPending || result.isPending || result.isError} onClick={()=>csv.mutate()}><Download size={16}/>{csv.isPending ? 'Exportando...' : 'Exportar CSV'}</button>}</div></header>
    <section className="reports-filters" aria-label="Filtros do relatório"><div className="reports-filters__title"><Filter size={16}/><h2>Filtrar relatório</h2>{d.catalog && <span>Período de cadastro opcional</span>}</div><form onSubmit={apply}>
      <label>De<input type="date" value={draft.from??''} onChange={e=>update('from',e.target.value)} required={!d.catalog}/></label><label>Até<input type="date" value={draft.to??''} onChange={e=>update('to',e.target.value)} required={!d.catalog}/></label>
      <label className="reports-search">Buscar<input type="search" maxLength={200} placeholder={d.catalog ? 'Nome, código ou contato' : 'Cliente, lead, pedido ou negociação'} value={draft.search??''} onChange={e=>update('search',e.target.value)}/></label>
      {(d.type==='closed-services' || d.type==='service-receipts') && <OptionFilter companyId={companyId} field="customerId" label="Cliente" value={draft.customerId} onChange={v=>update('customerId',v)}/>}
      {(d.type==='closed-services' || d.crm) && <OptionFilter companyId={companyId} field="serviceId" label="Serviço" value={draft.serviceId} onChange={v=>update('serviceId',v)}/>}
      {!d.catalog && <OptionFilter companyId={companyId} field="assignedUserId" label={d.type==='closed-services'||d.type==='service-receipts' ? 'Lançado por' : 'Responsável'} value={draft.assignedUserId} onChange={v=>update('assignedUserId',v)}/>}
      {(d.catalog || d.type==='meetings') && <label>Situação<select value={draft.status??'ALL'} onChange={e=>update('status',e.target.value)}><option value="ALL">Todas</option>{(d.catalog ? ['ACTIVE','INACTIVE'] : ['SCHEDULED','COMPLETED','CANCELED','NO_SHOW']).map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}</select></label>}
      {d.type==='service-receipts' && <label>Forma de recebimento<select value={draft.paymentMethod??''} onChange={e=>update('paymentMethod',e.target.value)}><option value="">Todas</option>{['PIX','CASH','CREDIT_CARD','DEBIT_CARD','BOLETO','TRANSFER','OTHER'].map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}</select></label>}
      {d.crm && <><label>Canal<select value={draft.captureKind??''} onChange={e=>update('captureKind',e.target.value)}><option value="">Todos</option>{['MANUAL','FORM','META_ADS','GOOGLE_ADS','IMPORT','NERO','API'].map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}</select></label><label>Origem (UTM)<input value={draft.utmSource??''} onChange={e=>update('utmSource',e.target.value)} maxLength={200} placeholder="Ex.: instagram"/></label><label>Campanha (UTM)<input value={draft.utmCampaign??''} onChange={e=>update('utmCampaign',e.target.value)} maxLength={200}/></label><label>Referência do formulário<input value={draft.sourceFormReference??''} onChange={e=>update('sourceFormReference',e.target.value)} maxLength={200}/></label></>}
      <div className="reports-filter-actions"><button className="button button--secondary" type="button" onClick={()=>{setDraft(initial);setApplied(initial);setCursors([undefined]);setValidation('');csv.reset();}}>Limpar</button><button className="button button--primary" type="submit">Aplicar filtros</button></div>
    </form>{validation && <p className="reports-error" role="alert">{validation}</p>}</section>
    {csv.isError && <p className="reports-error" role="alert">{csv.error.message}</p>}
    {result.isPending ? <div className="reports-state" role="status"><RefreshCw className="is-spinning" size={22}/>Consultando dados...</div>
      : result.isError ? <div className="reports-state" role="alert"><AlertCircle size={24}/><p>{result.error.message}</p><button className="button button--secondary" onClick={()=>result.refetch()}>Tentar novamente</button></div>
      : <>
        <ReportMetrics definition={d} result={result.data}/>
        <div className="reports-context"><span>{applied.from && applied.to ? `${reportDate(applied.from,timezone)} a ${reportDate(applied.to,timezone)}` : 'Todos os cadastros'} · {result.data.visibility==='ASSIGNED' ? 'Seus registros atribuídos' : 'Empresa selecionada'}</span><span>Atualizado em {reportDate(result.data.generatedAt,timezone,true)}</span></div>
        {d.rate && <p className="reports-note">Percentual sobre negociações ganhas, perdidas ou desqualificadas no período. Cada negociação entra uma vez, pela última decisão até o fim do período.</p>}
        {d.type==='closed-services' && applied.serviceId && <p className="reports-note">O total considera os itens do serviço selecionado. Recebimentos e pendências são registrados por venda.</p>}
        <section className="reports-ledger" aria-label="Detalhes do relatório"><div className="reports-ledger__title"><h2>{d.rate ? d.type==='loss-rate' ? 'Negociações perdidas' : 'Negociações desqualificadas' : 'Detalhes'}</h2><span>{total.toLocaleString('pt-BR')} registros</span></div>
          {!result.data.items.length ? <div className="reports-state"><BarChart3 size={29}/><h3>Nenhum registro neste filtro</h3><p>Ajuste o período ou os filtros para consultar outros resultados.</p></div> : <div className="reports-table-scroll"><table><thead><tr>{d.columns.map(c=><th key={c.key} className={c.format==='money'?'reports-money':''}>{c.label}</th>)}</tr></thead><tbody>{result.data.items.map(row=><tr key={row.id}>{d.columns.map(c=><td key={c.key} className={c.format==='money'?'reports-money':''}>{cell(row[c.key],c.format,timezone)}</td>)}</tr>)}</tbody></table></div>}
          <footer className="reports-pagination"><span>{result.data.items.length ? `${(cursors.length-1)*25+1}–${(cursors.length-1)*25+result.data.items.length} de ${total}` : '0 registros'}</span><div><button aria-label="Página anterior" disabled={cursors.length===1 || result.isFetching} onClick={()=>setCursors(old=>old.slice(0,-1))}><ChevronLeft size={17}/></button><span>Página {cursors.length}</span><button aria-label="Próxima página" disabled={!result.data.nextCursor || result.isFetching} onClick={()=>setCursors(old=>[...old,result.data.nextCursor!])}><ChevronRight size={17}/></button></div></footer>
        </section>
      </>}
  </>;
}

function OptionFilter({companyId,field,label,value,onChange}:{companyId:string;field:'customerId'|'serviceId'|'assignedUserId';label:string;value?:string;onChange:(v:string)=>void}) {
  const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[selectedName,setSelectedName]=useState('Selecionado');
  useEffect(()=>{const timer=window.setTimeout(()=>setTerm(search),250);return ()=>window.clearTimeout(timer);},[search]);
  const options=useQuery({queryKey:['report-options',companyId,field,term],queryFn:()=>api.reportOptions(companyId,field,term)});
  return <div className="reports-option"><label htmlFor={`report-${field}`}>{label}</label><input aria-label={`Buscar ${label.toLowerCase()} para filtro`} placeholder={`Buscar ${label.toLowerCase()}`} value={search} onChange={e=>setSearch(e.target.value)} maxLength={100}/><select id={`report-${field}`} value={value??''} onChange={e=>{setSelectedName(e.target.selectedOptions[0].text);onChange(e.target.value);}}><option value="">Todos</option>{value && !options.data?.items.some(o=>o.id===value) && <option value={value}>{selectedName}</option>}{options.data?.items.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>{options.isError && <small role="alert">Não foi possível carregar as opções.</small>}</div>;
}

function ReportMetrics({definition:d,result}:{definition:ReportDefinition;result:ReportResult}) {
  const s=result.summary;
  const metrics:Array<[string,ReactNode]>=d.type==='closed-services' ? [['Total contratado',money(s.contractedAmount)],['Pedidos confirmados',s.saleCount],...(s.receivedAmount!==null ? [['Recebido dessas vendas',money(s.receivedAmount)],['Pendente dessas vendas',money(s.pendingAmount)]] as Array<[string,ReactNode]> : [])]
    : d.type==='service-receipts' ? [['Recebido líquido',money(s.netAmount)],['Recebimentos',money(s.grossAmount)],['Estornos',money(s.reversedAmount)],['Movimentos',s.movementCount]]
    : d.type==='lead-entries' ? [['Entradas no CRM',s.entries],['Leads únicos',s.uniqueLeads]]
    : d.catalog ? [['Total de cadastros',s.total],['Ativos',s.active],['Inativos',s.inactive]]
    : d.type==='meetings' ? [['Reuniões realizadas',s.completed],['Total agendado',s.total],['A realizar',s.scheduled],['Canceladas',s.canceled],['Não compareceu',s.noShow]]
    : [['Taxa no período',s.rate==null ? 'Sem base para cálculo' : `${Number(s.rate).toLocaleString('pt-BR',{maximumFractionDigits:2})}%`],[d.type==='loss-rate'?'Perdidas':'Desqualificadas',d.type==='loss-rate'?s.lost:s.disqualified],['Negociações encerradas',s.decisions],['Ganhas',s.won]];
  return <section className="reports-metrics" aria-label="Resumo do relatório">{metrics.map(([label,value],i)=><div key={label} className={i===0?'is-primary':''}><span>{label}</span><strong>{value??0}</strong></div>)}</section>;
}

function cell(value:unknown,format:ReportDefinition['columns'][number]['format'],timezone:string):ReactNode {
  if(value==null || value==='') return <span className="reports-muted">—</span>;
  if(format==='money') return money(value);
  if(format==='date' || format==='instant') return reportDate(value,timezone,format==='instant');
  if(format==='status') return <span className={`reports-badge ${['REVERSAL','LOST','DISQUALIFIED','CANCELED','NO_SHOW'].includes(String(value))?'is-negative':''}`}>{statusLabels[String(value)]??String(value)}</span>;
  if(format==='items' && Array.isArray(value)) return <details className="reports-items"><summary>{value.length===1?String(value[0].name):`${value.length} serviços`}</summary>{value.map(item=><div key={item.id}><strong>{String(item.name)}</strong><span>{Number(item.quantity).toLocaleString('pt-BR')} × {money(item.unitPrice)} · {money(item.totalAmount)}</span></div>)}</details>;
  return String(value);
}
