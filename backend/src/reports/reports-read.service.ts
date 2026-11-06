import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { CrmPolicyService, type CrmAccess } from '../crm/crm-policy.service.js';
import type { CrmContext } from '../crm/crm.schemas.js';
import { reportCursorSchema, type CatalogReport, type ReportInput, type ReportType } from './reports.schemas.js';

export type ReportRow = Record<string, unknown> & { id: string; _sort: string };
type Definition = { rows: SQL; summary: SQL; target?: string; calendarSort?: boolean };
const all = (terms: SQL[]) => sql.join(terms.map((term) => sql`(${term})`), sql` AND `);
const iso = (column: SQL) => sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const textMatch = (input: ReportInput, columns: SQL[]) => input.search
  ? sql`(${sql.join(columns.map((column) => sql`position(lower(${input.search}) in lower(coalesce(${column}::text,''))) > 0`), sql` OR `)})`
  : sql`TRUE`;

@Injectable()
export class ReportsReadService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(CrmPolicyService) private readonly policy: CrmPolicyService) {}

  private period(column: SQL, input: ReportInput, a: CrmAccess, calendarDate = false) {
    if (!input.from || !input.to) return sql`TRUE`;
    return calendarDate ? sql`${column} >= ${input.from}::date AND ${column} <= ${input.to}::date`
      : sql`${column} >= (${input.from}::date::timestamp AT TIME ZONE ${a.timezone})
          AND ${column} < ((${input.to}::date + 1)::timestamp AT TIME ZONE ${a.timezone})`;
  }

  private validate(type: ReportType, input: ReportInput) {
    const catalog = type === 'customers' || type === 'service-catalog';
    if (!catalog && (!input.from || !input.to)) throw new BadRequestException('Informe o período do relatório');
    const statuses = catalog ? ['ALL', 'ACTIVE', 'INACTIVE'] : type === 'meetings' ? ['ALL', 'SCHEDULED', 'COMPLETED', 'CANCELED', 'NO_SHOW'] : ['ALL'];
    if (!statuses.includes(input.status)) throw new BadRequestException('Situação inválida para este relatório');
    const supported: Record<ReportType, string[]> = {
      'closed-services': ['customerId', 'serviceId', 'assignedUserId'],
      'service-receipts': ['customerId', 'assignedUserId', 'paymentMethod'],
      'lead-entries': ['serviceId', 'assignedUserId', 'captureKind', 'utmSource', 'utmCampaign', 'sourceFormReference'],
      customers: [], 'service-catalog': [], meetings: ['assignedUserId'],
      'disqualification-rate': ['serviceId', 'assignedUserId', 'captureKind', 'utmSource', 'utmCampaign', 'sourceFormReference'],
      'loss-rate': ['serviceId', 'assignedUserId', 'captureKind', 'utmSource', 'utmCampaign', 'sourceFormReference'],
    };
    for (const field of ['customerId', 'serviceId', 'assignedUserId', 'captureKind', 'utmSource', 'utmCampaign', 'sourceFormReference', 'paymentMethod'] as const) {
      if (input[field] && !supported[type].includes(field)) throw new BadRequestException(`Filtro ${field} indisponível neste relatório`);
    }
  }

  private crmTerms(input: ReportInput, a: CrmAccess, entryService = false) {
    const terms: SQL[] = [sql`o.company_id = ${a.companyId}::uuid`, a.manager ? sql`TRUE` : sql`o.assigned_user_id = ${a.userId}::uuid`];
    if (input.assignedUserId) terms.push(sql`o.assigned_user_id = ${input.assignedUserId}::uuid`);
    if (input.serviceId) terms.push(sql`${entryService ? sql`e.primary_service_id` : sql`o.primary_service_id`} = ${input.serviceId}::uuid`);
    if (input.captureKind) terms.push(sql`e.capture_kind = ${input.captureKind}`);
    if (input.sourceFormReference) terms.push(sql`e.source_form_reference = ${input.sourceFormReference}`);
    if (input.utmSource) terms.push(sql`lower(btrim(e.utm_source)) = lower(${input.utmSource})`);
    if (input.utmCampaign) terms.push(sql`lower(btrim(e.utm_campaign)) = lower(${input.utmCampaign})`);
    terms.push(textMatch(input, [sql`c.name`, sql`o.title`, sql`c.email`]));
    return terms;
  }

  private definition(type: ReportType, input: ReportInput, a: CrmAccess): Definition {
    if (type === 'closed-services') {
      const terms = [sql`s.company_id = ${a.companyId}::uuid`, sql`s.status = 'CONFIRMED'`, this.period(sql`s.sold_on`, input, a, true), textMatch(input, [sql`s.customer_name_snapshot`, sql`s.order_code`, sql`s.work_order_number`])];
      if (input.customerId) terms.push(sql`s.customer_id = ${input.customerId}::uuid`);
      if (input.assignedUserId) terms.push(sql`s.created_by_user_id = ${input.assignedUserId}::uuid`);
      const itemFilter = input.serviceId ? sql`AND i.service_id = ${input.serviceId}::uuid` : sql``;
      if (input.serviceId) terms.push(sql`EXISTS (SELECT 1 FROM sale_items i WHERE i.company_id=s.company_id AND i.sale_id=s.id ${itemFilter})`);
      const value = input.serviceId ? sql`(SELECT sum(i.total_amount) FROM sale_items i WHERE i.company_id=s.company_id AND i.sale_id=s.id ${itemFilter})` : sql`s.total_amount`;
      const paid = sql`(SELECT coalesce(sum(CASE WHEN m.kind='RECEIPT' THEN m.amount ELSE -m.amount END),0)
        FROM receivables r JOIN receivable_movements m ON m.company_id=r.company_id AND m.receivable_id=r.id
        WHERE r.company_id=s.company_id AND r.sale_id=s.id)`;
      return {
        calendarSort: true,
        rows: sql`SELECT s.id, s.sold_on AS "_order", s.sold_on::text AS "_sort", s.sold_on::text AS "soldOn", s.order_code AS "orderCode",
          s.work_order_number AS "workOrderNumber", s.customer_id AS "customerId", s.customer_name_snapshot AS "customerName", u.name AS "userName",
          (${value})::text AS "contractedAmount", s.total_amount::text AS "saleTotalAmount",
          ${input.serviceId ? sql`NULL::text` : sql`(${paid})::text`} AS "receivedAmount",
          ${input.serviceId ? sql`NULL::text` : sql`(s.total_amount - ${paid})::text`} AS "pendingAmount",
          (SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.service_name_snapshot,'quantity',i.quantity::text,'unitPrice',i.unit_price::text,'totalAmount',i.total_amount::text) ORDER BY i.position),'[]'::jsonb)
            FROM sale_items i WHERE i.company_id=s.company_id AND i.sale_id=s.id ${itemFilter}) AS items
          FROM sales s LEFT JOIN users u ON u.id=s.created_by_user_id WHERE ${all(terms)}`,
        summary: sql`SELECT count(*)::int AS "saleCount", coalesce(sum("contractedAmount"::numeric),0)::text AS "contractedAmount",
          ${input.serviceId ? sql`NULL::text` : sql`coalesce(sum("receivedAmount"::numeric),0)::text`} AS "receivedAmount",
          ${input.serviceId ? sql`NULL::text` : sql`coalesce(sum("pendingAmount"::numeric),0)::text`} AS "pendingAmount" FROM report_rows`,
      };
    }
    if (type === 'service-receipts') {
      const terms = [sql`m.company_id=${a.companyId}::uuid`, this.period(sql`m.effective_on`, input, a, true), textMatch(input, [sql`s.customer_name_snapshot`, sql`s.order_code`, sql`s.work_order_number`])];
      if (input.customerId) terms.push(sql`s.customer_id=${input.customerId}::uuid`);
      if (input.assignedUserId) terms.push(sql`m.created_by_user_id=${input.assignedUserId}::uuid`);
      if (input.paymentMethod) terms.push(sql`coalesce(m.payment_method, original.payment_method)=${input.paymentMethod}`);
      return {
        calendarSort: true,
        rows: sql`SELECT m.id, m.effective_on AS "_order", m.effective_on::text AS "_sort", m.effective_on::text AS "effectiveOn", m.kind,
          m.amount::text AS amount, (CASE WHEN m.kind='RECEIPT' THEN m.amount ELSE -m.amount END)::text AS "signedAmount",
          coalesce(m.payment_method,original.payment_method) AS "paymentMethod", s.id AS "saleId", s.status AS "saleStatus",
          s.order_code AS "orderCode", s.customer_name_snapshot AS "customerName", p.paycode, u.name AS "userName", m.reference
          FROM receivable_movements m JOIN receivables r ON r.company_id=m.company_id AND r.id=m.receivable_id
          JOIN sales s ON s.company_id=r.company_id AND s.id=r.sale_id
          JOIN sale_installments p ON p.company_id=r.company_id AND p.sale_id=r.sale_id AND p.id=r.sale_installment_id
          LEFT JOIN receivable_movements original ON original.company_id=m.company_id AND original.receivable_id=m.receivable_id AND original.id=m.reverses_movement_id
          LEFT JOIN users u ON u.id=m.created_by_user_id WHERE ${all(terms)}`,
        summary: sql`SELECT count(*)::int AS "movementCount", coalesce(sum(amount::numeric) FILTER(WHERE kind='RECEIPT'),0)::text AS "grossAmount",
          coalesce(sum(amount::numeric) FILTER(WHERE kind='REVERSAL'),0)::text AS "reversedAmount", coalesce(sum("signedAmount"::numeric),0)::text AS "netAmount" FROM report_rows`,
      };
    }
    if (type === 'customers') {
      const terms = [sql`c.company_id=${a.companyId}::uuid`, this.period(sql`c.created_at`, input, a), textMatch(input, [sql`c.name`, sql`c.email`, sql`c.tax_id`, sql`c.trade_name`])];
      if (input.status !== 'ALL') terms.push(sql`c.status=${input.status}`);
      return { rows: sql`SELECT c.id, c.created_at AS "_order", ${iso(sql`c.created_at`)} AS "_sort", ${iso(sql`c.created_at`)} AS "createdAt", c.name, c.kind, c.status,
        c.trade_name AS "tradeName", c.tax_id AS "taxId", c.email, c.phone, c.street, c.number, c.complement, c.district,
        c.postal_code AS "postalCode", c.city_name AS "cityName", c.state_code AS "stateCode", c.country_code AS "countryCode"
        FROM customers c WHERE ${all(terms)}`,
        summary: sql`SELECT count(*)::int AS total, count(*) FILTER(WHERE status='ACTIVE')::int AS active, count(*) FILTER(WHERE status='INACTIVE')::int AS inactive FROM report_rows` };
    }
    if (type === 'service-catalog') {
      const terms = [sql`v.company_id=${a.companyId}::uuid`, this.period(sql`v.created_at`, input, a), textMatch(input, [sql`v.name`, sql`v.internal_code`, sql`v.description`])];
      if (input.status !== 'ALL') terms.push(sql`v.status=${input.status}`);
      return { rows: sql`SELECT v.id, v.created_at AS "_order", ${iso(sql`v.created_at`)} AS "_sort", ${iso(sql`v.created_at`)} AS "createdAt", v.name, v.status,
        v.internal_code AS "internalCode", v.description, v.unit_label AS "unitLabel", v.suggested_unit_price::text AS "suggestedUnitPrice",
        v.national_tax_code AS "nationalTaxCode", v.nbs_code AS "nbsCode",
        (SELECT string_agg(t.municipality_ibge_code || ':' || t.municipal_tax_code,' | ' ORDER BY t.municipality_ibge_code)
          FROM service_municipal_tax_codes t WHERE t.company_id=v.company_id AND t.service_id=v.id) AS "municipalTaxCodes"
        FROM services v WHERE ${all(terms)}`,
        summary: sql`SELECT count(*)::int AS total, count(*) FILTER(WHERE status='ACTIVE')::int AS active, count(*) FILTER(WHERE status='INACTIVE')::int AS inactive FROM report_rows` };
    }
    if (type === 'lead-entries') {
      return { rows: sql`SELECT e.id, e.received_at AS "_order", ${iso(sql`e.received_at`)} AS "_sort", ${iso(sql`e.received_at`)} AS "receivedAt", c.id AS "contactId", c.name AS "contactName", c.email,
        o.id AS "opportunityId", o.title, o.commercial_status AS "commercialStatus", u.name AS "userName", e.capture_kind AS "captureKind",
        e.source_label AS "sourceLabel", e.source_form_reference AS "sourceFormReference", e.utm_source AS "utmSource", e.utm_medium AS "utmMedium",
        e.utm_campaign AS "utmCampaign", e.utm_content AS "utmContent", e.utm_term AS "utmTerm", v.name AS "serviceName", e.interest_description AS "interestDescription"
        FROM crm_lead_entries e JOIN crm_opportunities o ON o.company_id=e.company_id AND o.contact_id=e.contact_id AND o.origin_entry_id=e.id
        JOIN crm_contacts c ON c.company_id=e.company_id AND c.id=e.contact_id
        LEFT JOIN users u ON u.id=o.assigned_user_id LEFT JOIN services v ON v.company_id=e.company_id AND v.id=e.primary_service_id
        WHERE ${all([...this.crmTerms(input,a,true), this.period(sql`e.received_at`,input,a)])}`,
        summary: sql`SELECT count(*)::int AS entries, count(DISTINCT "contactId")::int AS "uniqueLeads" FROM report_rows` };
    }
    if (type === 'meetings') {
      const terms = [sql`m.company_id=${a.companyId}::uuid`, a.manager ? sql`TRUE` : sql`m.assigned_user_id=${a.userId}::uuid`, this.period(sql`m.starts_at`,input,a), textMatch(input,[sql`m.title`,sql`c.name`])];
      if (input.assignedUserId) terms.push(sql`m.assigned_user_id=${input.assignedUserId}::uuid`);
      if (input.status !== 'ALL') terms.push(sql`m.status=${input.status}`);
      return { rows: sql`SELECT m.id, m.starts_at AS "_order", ${iso(sql`m.starts_at`)} AS "_sort", ${iso(sql`m.starts_at`)} AS "startsAt", ${iso(sql`m.ends_at`)} AS "endsAt",
        m.title, m.status, m.modality, c.name AS "contactName", c.id AS "contactId", u.name AS "userName"
        FROM crm_meetings m JOIN crm_contacts c ON c.company_id=m.company_id AND c.id=m.contact_id
        JOIN users u ON u.id=m.assigned_user_id WHERE ${all(terms)}`,
        summary: sql`SELECT count(*)::int AS total, count(*) FILTER(WHERE status='COMPLETED')::int AS completed, count(*) FILTER(WHERE status='CANCELED')::int AS canceled,
          count(*) FILTER(WHERE status='NO_SHOW')::int AS "noShow", count(*) FILTER(WHERE status='SCHEDULED')::int AS scheduled FROM report_rows` };
    }
    // Use every actual status change until the period end, including reopenings.
    // Notes/reason edits with kind STATUS_CHANGED but no status transition do not replace a decision.
    const after = sql`coalesce(h.changes->'commercialStatus'->>'after',h.changes->>'after')`;
    const before = sql`coalesce(h.changes->'commercialStatus'->>'before',h.changes->>'before')`;
    return {
      rows: sql`SELECT o.id, last_status.occurred_at AS "_order", ${iso(sql`last_status.occurred_at`)} AS "_sort", ${iso(sql`last_status.occurred_at`)} AS "decidedAt",
        c.id AS "contactId", c.name AS "contactName", o.title, last_status.final_status AS "decisionStatus", o.commercial_status AS "currentStatus",
        u.name AS "userName", e.utm_source AS "utmSource", e.utm_campaign AS "utmCampaign", e.capture_kind AS "captureKind", v.name AS "serviceName",
        coalesce(last_status.changes->'reasonText'->>'after', last_status.changes->'reasonCode'->>'after') AS reason
        FROM crm_opportunities o JOIN crm_contacts c ON c.company_id=o.company_id AND c.id=o.contact_id
        JOIN crm_lead_entries e ON e.company_id=o.company_id AND e.contact_id=o.contact_id AND e.id=o.origin_entry_id
        LEFT JOIN users u ON u.id=o.assigned_user_id LEFT JOIN services v ON v.company_id=o.company_id AND v.id=o.primary_service_id
        JOIN LATERAL (SELECT h.occurred_at,h.changes,${after} AS final_status FROM crm_activities h
          WHERE h.company_id=o.company_id AND h.opportunity_id=o.id AND h.kind='STATUS_CHANGED'
            AND ${after} IN ('NEW','CONTACTING','QUALIFIED','DISQUALIFIED','LOST','WON') AND ${after} IS DISTINCT FROM ${before}
            AND h.occurred_at < ((${input.to}::date + 1)::timestamp AT TIME ZONE ${a.timezone})
          ORDER BY h.occurred_at DESC,h.recorded_at DESC,h.id DESC LIMIT 1) last_status ON TRUE
        WHERE ${all([...this.crmTerms(input,a),this.period(sql`last_status.occurred_at`,input,a),sql`last_status.final_status IN ('WON','LOST','DISQUALIFIED')`])}`,
      summary: sql`SELECT count(*)::int AS decisions, count(*) FILTER(WHERE "decisionStatus"='WON')::int AS won,
        count(*) FILTER(WHERE "decisionStatus"='LOST')::int AS lost, count(*) FILTER(WHERE "decisionStatus"='DISQUALIFIED')::int AS disqualified,
        round(100.0 * count(*) FILTER(WHERE "decisionStatus"=${type === 'loss-rate' ? 'LOST' : 'DISQUALIFIED'}) / nullif(count(*),0),2)::text AS rate FROM report_rows`,
      target: type === 'loss-rate' ? 'LOST' : 'DISQUALIFIED',
    };
  }

  async read(ctx: CrmContext, type: ReportType, input: ReportInput) {
    this.validate(type,input);
    return this.database.db.transaction(async (tx) => {
      const a = await this.policy.access(ctx,tx), d = this.definition(type,input,a);
      const { cursor, limit, ...filters } = input;
      const hash = createHash('sha256').update(JSON.stringify({ ...ctx, type, filters })).digest('hex');
      let position: { sort: string; id: string } | null = null;
      if (cursor) {
        try { const decoded=reportCursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))); if(decoded.hash!==hash) throw new Error(); position=decoded; }
        catch { throw new BadRequestException('Cursor inválido para este relatório e filtros'); }
      }
      const [summary] = await tx.execute(sql`WITH report_rows AS (${d.rows}) ${d.summary}`);
      const rows = await tx.execute(sql`WITH report_rows AS (${d.rows}) SELECT * FROM report_rows
        WHERE ${d.target ? sql`"decisionStatus"=${d.target}` : sql`TRUE`}
          ${position ? sql`AND ("_order",id)<(${d.calendarSort ? sql`${position.sort}::date` : sql`${position.sort}::timestamptz`},${position.id}::uuid)` : sql``}
        ORDER BY "_order" DESC,id DESC LIMIT ${limit+1}`) as unknown as ReportRow[];
      const page=rows.slice(0,limit), last=page.at(-1);
      return { summary, items:page.map(({ _sort: _internal, _order: _date, ...row })=>row),
        nextCursor: rows.length>limit && last ? Buffer.from(JSON.stringify({ sort:last._sort,id:last.id,hash })).toString('base64url') : null,
        filters, generatedAt:new Date().toISOString(), timezone:a.timezone, visibility:a.manager ? 'COMPANY' : ['lead-entries','meetings','loss-rate','disqualification-rate'].includes(type) ? 'ASSIGNED' : 'COMPANY' };
    },{ isolationLevel:'repeatable read' });
  }

  async exportRows(ctx: CrmContext, type: CatalogReport, input: ReportInput, maxRows: number, onRows: (rows: ReportRow[])=>Promise<void>) {
    this.validate(type,input);
    await this.database.db.transaction(async(tx)=>{
      const a=await this.policy.access(ctx,tx), d=this.definition(type,input,a);
      const [count]=await tx.execute(sql`WITH report_rows AS (${d.rows}) SELECT count(*)::int AS total FROM report_rows`);
      if(Number(count.total)>maxRows) throw new BadRequestException(`A exportação aceita até ${maxRows} registros. Refine os filtros.`);
      let last:ReportRow|undefined;
      do {
        const rows=await tx.execute(sql`WITH report_rows AS (${d.rows}) SELECT * FROM report_rows
          ${last ? sql`WHERE ("_order",id)<(${last._sort}::timestamptz,${last.id}::uuid)` : sql``}
          ORDER BY "_order" DESC,id DESC LIMIT 500`) as unknown as ReportRow[];
        if(!rows.length) break;
        await onRows(rows); last=rows.at(-1);
        if(rows.length<500) break;
      } while(last);
    },{ isolationLevel:'repeatable read' });
  }

  async options(ctx: CrmContext, input: { field:'customerId'|'serviceId'|'assignedUserId'; search:string; limit:number }) {
    const a=await this.policy.access(ctx);
    const query=input.field==='customerId' ? sql`SELECT id,name FROM customers WHERE company_id=${a.companyId}::uuid AND position(lower(${input.search}) in lower(name))>0 ORDER BY name,id LIMIT ${input.limit}`
      : input.field==='serviceId' ? sql`SELECT id,name FROM services WHERE company_id=${a.companyId}::uuid AND position(lower(${input.search}) in lower(name))>0 ORDER BY name,id LIMIT ${input.limit}`
      : sql`SELECT u.id,u.name FROM company_users cu JOIN users u ON u.id=cu.user_id WHERE cu.company_id=${a.companyId}::uuid
          AND ${a.manager ? sql`TRUE` : sql`u.id=${a.userId}::uuid`} AND position(lower(${input.search}) in lower(u.name))>0 ORDER BY u.name,u.id LIMIT ${input.limit}`;
    return {items:await this.database.db.execute(query)};
  }
}
