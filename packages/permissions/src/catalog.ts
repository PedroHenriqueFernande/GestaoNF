/** Texto único de toda ação negada por permissão, na API e na interface. */
export const PERMISSION_DENIED_MESSAGE = 'Você não tem permissão para realizar essa ação.';

export const PERMISSION_KEYS = [
  'sales.access', 'sales.create', 'sales.edit', 'sales.delete', 'sales.change_price', 'sales.nfse_issue', 'sales.nfse_cancel', 'sales.nfse_edit', 'sales.attachments_view',
  'finance.access', 'finance.receive', 'finance.reverse', 'finance.edit_dates',
  'crm.access', 'crm.create', 'crm.edit', 'crm.archive', 'crm.assign',
  'agenda.access', 'agenda.manage', 'agenda.settings',
  'proposals.access', 'proposals.manage', 'proposals.change_price', 'proposals.convert', 'proposals.settings',
  'reports.access', 'reports.export',
  'customers.access', 'customers.create', 'customers.edit', 'customers.deactivate', 'customers.export',
  'services.access', 'services.create', 'services.edit', 'services.edit_price', 'services.deactivate',
  'company.access', 'company.edit', 'company.certificate',
  'fiscal.series', 'fiscal.tax',
  'nero.use',
  'support.assistant',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSION_KEYS;

export const ROLE_LABELS = ['OWNER', 'MANAGER', 'COLLABORATOR'] as const;
export type RoleLabel = (typeof ROLE_LABELS)[number];

export type PermissionDefinition = Readonly<{ label: string; requires: readonly PermissionKey[]; description?: string }>;

export const PERMISSIONS: Readonly<Record<PermissionKey, PermissionDefinition>> = {
  'sales.access': { label: 'Acessar Vendas', requires: [] },
  'sales.create': { label: 'Criar vendas', requires: ['sales.access', 'customers.access', 'services.access'] },
  'sales.edit': { label: 'Editar venda', requires: ['sales.create'] },
  'sales.delete': { label: 'Excluir venda', requires: ['sales.access'] },
  'sales.change_price': { label: 'Alterar preço e desconto na venda', requires: ['sales.create'] },
  'sales.nfse_issue': { label: 'Emitir NFS-e', requires: ['sales.access'] },
  'sales.nfse_cancel': { label: 'Cancelar NFS-e', requires: ['sales.access'] },
  'sales.nfse_edit': { label: 'Corrigir NFS-e (substituição)', requires: ['sales.edit'] },
  'sales.attachments_view': { label: 'Ver anexos das vendas', requires: ['sales.access'] },
  'finance.access': { label: 'Acessar Financeiro', requires: [] },
  'finance.receive': { label: 'Dar baixa', requires: ['finance.access'] },
  'finance.reverse': { label: 'Cancelar baixa', requires: ['finance.access'] },
  'finance.edit_dates': { label: 'Alterar data e vencimento', requires: ['finance.access'], description: "Vale só na tela do Financeiro. No Portal, alterar a venda exige 'Editar venda'." },
  'crm.access': { label: 'Acessar Leads e oportunidades', requires: [] },
  'crm.create': { label: 'Cadastrar leads', requires: ['crm.access'] },
  'crm.edit': { label: 'Alterar leads e negociações', requires: ['crm.access'] },
  'crm.archive': { label: 'Arquivar e restaurar', requires: ['crm.access'] },
  'crm.assign': { label: 'Alterar responsável', requires: ['crm.access'] },
  'agenda.access': { label: 'Acessar Agenda', requires: ['crm.access'] },
  'agenda.manage': { label: 'Gerenciar reuniões', requires: ['agenda.access'] },
  'agenda.settings': { label: 'Configurar Agenda', requires: ['agenda.access'] },
  'proposals.access': { label: 'Acessar Propostas', requires: ['crm.access', 'customers.access', 'services.access'] },
  'proposals.manage': { label: 'Gerenciar propostas', requires: ['proposals.access'] },
  'proposals.change_price': { label: 'Alterar preço e desconto em propostas', requires: ['proposals.manage'] },
  'proposals.convert': { label: 'Converter proposta em venda', requires: ['proposals.access', 'sales.create'] },
  'proposals.settings': { label: 'Configurar Propostas', requires: ['proposals.access'] },
  'reports.access': { label: 'Acessar Relatórios', requires: [] },
  'reports.export': { label: 'Exportar relatórios', requires: ['reports.access'] },
  'customers.access': { label: 'Acessar Clientes', requires: [] },
  'customers.create': { label: 'Cadastrar clientes', requires: ['customers.access'] },
  'customers.edit': { label: 'Alterar clientes', requires: ['customers.access'] },
  'customers.deactivate': { label: 'Desativar clientes', requires: ['customers.access'] },
  'customers.export': { label: 'Exportar clientes', requires: ['customers.access', 'reports.access'] },
  'services.access': { label: 'Acessar Serviços', requires: [] },
  'services.create': { label: 'Cadastrar serviços', requires: ['services.access'] },
  'services.edit': { label: 'Alterar serviços', requires: ['services.access'] },
  'services.edit_price': { label: 'Alterar preço do catálogo', requires: ['services.edit'] },
  'services.deactivate': { label: 'Desativar serviços', requires: ['services.access'] },
  'company.access': { label: 'Acessar cadastro da empresa', requires: [] },
  'company.edit': { label: 'Alterar dados da empresa', requires: ['company.access'] },
  'company.certificate': { label: 'Certificado digital A1', requires: ['company.access'] },
  'fiscal.series': { label: 'Séries e numeração', requires: [] },
  'fiscal.tax': { label: 'Controle de tributação', requires: [] },
  'nero.use': { label: 'Usar o Nero (WhatsApp)', requires: [] },
  'support.assistant': { label: 'Usar o assistente com IA', requires: [] },
};

export type PermissionTopicId = 'sales' | 'finance' | 'crm' | 'reports' | 'customers' | 'services' | 'company' | 'fiscal' | 'nero' | 'support';
export type PermissionAreaId = PermissionTopicId | 'agenda' | 'proposals';
export type PermissionArea = Readonly<{ id: PermissionAreaId; label: string; keys: readonly PermissionKey[] }>;
export type PermissionTopic = Readonly<{ id: PermissionTopicId; label: string; areas: readonly PermissionArea[] }>;

const byPrefix = (prefix: string) => PERMISSION_KEYS.filter(key => key.startsWith(`${prefix}.`));
const single = (id: PermissionTopicId, label: string): PermissionTopic => ({ id, label, areas: [{ id, label, keys: byPrefix(id) }] });

/** Ordem do editor (Spec 4). Só o CRM tem várias áreas. */
export const PERMISSION_TOPICS: readonly PermissionTopic[] = [
  single('sales', 'Vendas'),
  single('finance', 'Financeiro'),
  { id: 'crm', label: 'CRM', areas: [
    { id: 'crm', label: 'Leads e oportunidades', keys: byPrefix('crm') },
    { id: 'agenda', label: 'Agenda', keys: byPrefix('agenda') },
    { id: 'proposals', label: 'Propostas', keys: byPrefix('proposals') },
  ] },
  single('reports', 'Relatórios'),
  single('customers', 'Clientes'),
  single('services', 'Serviços'),
  single('company', 'Empresa'),
  single('fiscal', 'Fiscal'),
  single('nero', 'Nero'),
  single('support', 'Assistente de suporte'),
];

const KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);
export const isPermissionKey = (value: unknown): value is PermissionKey => typeof value === 'string' && KEY_SET.has(value);
export const topicKeys = (id: PermissionTopicId): readonly PermissionKey[] =>
  PERMISSION_TOPICS.find(topic => topic.id === id)!.areas.flatMap(area => area.keys);
