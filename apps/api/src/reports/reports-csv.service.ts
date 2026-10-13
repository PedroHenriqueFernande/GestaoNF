import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import type { CrmContext } from '../crm/crm.schemas.js';
import { ReportsReadService } from './reports-read.service.js';
import type { CatalogReport, ReportInput } from './reports.schemas.js';

// Quoting alone does not stop spreadsheet formula evaluation.
export function csvCell(value: unknown, textIdentifier=false): string {
  let text=value==null ? '' : String(value);
  if(text && (textIdentifier || /^[\s\uFEFF]*[=+\-@]/u.test(text))) text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
const columns:Record<CatalogReport,Array<[string,string,boolean?]>>={
  customers:[['name','Nome'],['kind','Tipo'],['tradeName','Nome fantasia'],['taxId','CPF/CNPJ',true],['email','E-mail'],['phone','Telefone',true],['status','Situação'],['street','Rua'],['number','Número',true],['complement','Complemento'],['district','Bairro'],['postalCode','CEP',true],['cityName','Cidade'],['stateCode','UF'],['countryCode','País'],['createdAt','Cadastrado em']],
  'service-catalog':[['internalCode','Código',true],['name','Serviço'],['description','Descrição'],['unitLabel','Unidade'],['suggestedUnitPrice','Preço sugerido'],['status','Situação'],['nationalTaxCode','Código tributário nacional',true],['nbsCode','NBS',true],['municipalTaxCodes','Códigos municipais (IBGE:código)'],['createdAt','Cadastrado em']],
};
@Injectable()
export class ReportsCsvService {
  constructor(@Inject(ReportsReadService) private readonly reader:ReportsReadService) {}
  async create(ctx:CrmContext,type:CatalogReport,input:ReportInput) {
    const maxRows=50_000;
    const preflight=await this.reader.read(ctx,type,{...input,limit:1,cursor:undefined});
    if(Number(preflight.summary.total)>maxRows) throw new BadRequestException(`A exportação aceita até ${maxRows} registros. Refine os filtros.`);
    const stream=new PassThrough();
    const write=async(text:string)=>{
      if(stream.destroyed) throw new Error('Exportação interrompida');
      if(!stream.write(text)) await new Promise<void>((resolve,reject)=>{
        const cleanup=()=>{stream.off('drain',drained);stream.off('close',closed);stream.off('error',failed);};
        const drained=()=>{cleanup();resolve();};
        const failed=(error:Error)=>{cleanup();reject(error);};
        const closed=()=>failed(new Error('Exportação interrompida'));
        stream.once('drain',drained);stream.once('close',closed);stream.once('error',failed);
      });
    };
    queueMicrotask(()=>{
      void this.reader.exportRows(ctx,type,input,maxRows,async(rows)=>{
        for(const row of rows) await write(columns[type].map(([field,,identifier])=>{
          const value=field==='status' ? row[field]==='ACTIVE' ? 'Ativo' : 'Inativo' : field==='suggestedUnitPrice' && row[field] ? String(row[field]).replace('.',',') : row[field];
          return csvCell(value,identifier);
        }).join(';')+'\r\n');
      }).then(()=>stream.end()).catch((error:unknown)=>stream.destroy(error instanceof Error ? error : new Error('Falha na exportação')));
      stream.write('\uFEFF'+columns[type].map(([,label])=>csvCell(label)).join(';')+'\r\n');
    });
    return stream;
  }
}
