const API_URL = (import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:3000`).replace(/\/$/, '');

export type User = { id: string; name: string; email: string };
export type Company = { id: string; name: string; role: string; accountId: string };
export type FiscalCertificate = { id: string; status: 'ACTIVE' | 'EXPIRED'; subjectTaxId: string; fingerprintSha256: string;
  serialNumber: string; subjectSummary: string; issuerSummary: string; notBefore: string; notAfter: string; createdAt: string };
export type Account = { id: string; name: string; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED'; planCode: string; additionalUsersPerCompany: number };
export type UserCapacity = { companyId: string; name: string; status: string; limit: number; occupied: number; reserved: number; available: number; overLimit: number; ownerIncludedSeparately: boolean };
export type ManagedMember = { id: string; type: 'MEMBER'; name: string; email: string; status: 'OWNER' | 'ACTIVE' | 'INACTIVE'; companies: { companyId: string; companyName: string; status: 'ACTIVE' | 'INACTIVE'; role: string; version: number }[]; version: string };
export type ManagedInvitation = { id: string; type: 'INVITATION'; name: string; email: string; status: 'PENDING' | 'REVOKED' | 'EXPIRED'; expiresAt: string; version: number; createdAt: string; companies: { id: string; name: string }[]; delivery: { id: string; sendStatus: string } | null };
export type ManagedUser = ManagedMember | ManagedInvitation;
export type ManagedUsersList = { items: ManagedUser[]; total: number };
export type InvitationPreview = { invitationId: string; name: string; accountName: string; email: string; companies: { id: string; name: string }[]; expiresAt: string; nextStep: 'LOGIN' | 'DEFINE_PASSWORD' };
export type CompanyProfile = Company & {
  kind: 'PF' | 'PJ'; legalName: string | null; tradeName: string | null; taxId: string | null; email: string | null; phone: string | null;
  street: string | null; number: string | null; complement: string | null; district: string | null;
  postalCode: string | null; cityName: string | null; cityIbgeCode: string | null; stateCode: string | null;
  countryCode: string; municipalRegistration: string | null; stateRegistration: string | null; cnaeCode: string | null;
  simplesNationalOption: '1' | '2' | '3' | '4' | null;
  simplesTaxationRegime: '1' | '2' | '3' | null; simplesIbsCbsRegime: '1' | '2' | '3' | null; caepfCode: string | null;
  specialTaxRegime: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '9' | null;
  timezone: string; locale: string; status: 'ACTIVE' | 'INACTIVE'; createdAt: string; updatedAt: string;
};
export type CompanyInput = Pick<CompanyProfile, 'name' | 'kind' | 'legalName' | 'tradeName' | 'taxId' | 'email' | 'phone' | 'street' | 'number' | 'complement' | 'district' | 'postalCode' | 'cityName' | 'cityIbgeCode' | 'stateCode' | 'countryCode' | 'municipalRegistration' | 'stateRegistration' | 'cnaeCode' | 'simplesNationalOption' | 'simplesTaxationRegime' | 'specialTaxRegime'> & Partial<Pick<CompanyProfile, 'simplesIbsCbsRegime' | 'caepfCode'>>;
export type Customer = {
  id: string;
  companyId: string;
  kind: 'PF' | 'PJ';
  name: string;
  tradeName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  postalCode: string | null;
  cityName: string | null;
  cityIbgeCode: string | null;
  stateCode: string | null;
  countryCode: string;
  municipalRegistration: string | null;
  caepfCode: string | null;
  foreignTaxId: string | null;
  noForeignTaxIdReason: '1' | '2' | null;
  foreignPostalCode: string | null;
  foreignStateProvince: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CustomerInput = Pick<Customer, 'kind' | 'name' | 'tradeName' | 'taxId' | 'email' | 'phone' | 'notes' | 'street' | 'number' | 'complement' | 'district' | 'postalCode' | 'cityName' | 'cityIbgeCode' | 'stateCode' | 'countryCode'> & Partial<Pick<Customer, 'municipalRegistration' | 'caepfCode' | 'foreignTaxId' | 'noForeignTaxIdReason' | 'foreignPostalCode' | 'foreignStateProvince'>>;
export type CustomerList = { items: Customer[]; total: number; limit: number; offset: number };
export type Service = {
  id: string;
  companyId: string;
  internalCode: string | null;
  name: string;
  description: string | null;
  unitLabel: string;
  suggestedUnitPrice: string | null;
  nationalTaxCode: string | null;
  nbsCode: string | null;
  simplesActivityCode: '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '90' | null;
  status: 'ACTIVE' | 'INACTIVE';
  fiscalClassificationStatus: 'PENDING_NATIONAL_CODE' | 'NATIONAL_CODE_PROVIDED';
  createdAt: string;
  updatedAt: string;
};
export type ServiceInput = Pick<Service, 'name' | 'internalCode' | 'description' | 'unitLabel' | 'suggestedUnitPrice' | 'nationalTaxCode' | 'nbsCode'> & Partial<Pick<Service, 'simplesActivityCode'>>;
export type ServiceList = { items: Service[]; total: number; limit: number; offset: number };
export type MunicipalTaxCode = {
  companyId: string;
  serviceId: string;
  municipalityIbgeCode: string;
  municipalTaxCode: string;
  createdAt: string;
  updatedAt: string;
};
export type PaymentMethod = 'PIX' | 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO' | 'TRANSFER' | 'OTHER';
export type StoredFile = {
  id: string; companyId: string; saleId: string | null; fileName: string; mimeType: 'image/jpeg' | 'image/png' | 'application/pdf'; sizeBytes: number;
  status: 'PENDING' | 'READY' | 'REJECTED' | 'EXPIRED' | 'DELETING' | 'DELETED'; width: number | null; height: number | null; pageCount: number | null; createdAt: string; readyAt: string | null;
};
export type UploadCapabilities = { enabled: boolean; mimeTypes: StoredFile['mimeType'][]; imageMaxBytes: number; pdfMaxBytes: number; maxAttachments: number; uploadTtlSeconds: number };
export type UploadSession = { file: StoredFile; upload: { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string } | null };
export type SaleStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELED';
export type FiscalSeries = { id: string; companyId: string; environment: 'HOMOLOGATION' | 'PRODUCTION'; issuerTaxIdSnapshot: string;
  municipalityIbgeCode: string; seriesNumber: number; initialNumber: string; nextNumber: string;
  status: 'ACTIVE' | 'INACTIVE'; isDefault: boolean; version: number; createdAt: string };
export type FiscalSeriesAdjustment = { id: string; oldNextNumber: string; newNextNumber: string;
  reason: string; actorName: string; createdAt: string };
export type TaxRates = { issRatePercent: string | null; pisRatePercent: string | null; cofinsRatePercent: string | null;
  csllRatePercent: string | null; irRatePercent: string | null; inssRatePercent: string | null;
  issWithholdingSuggestion: boolean | null };
export type TaxRevisionInput = TaxRates & { effectiveFrom: string; notes: string | null };
export type TaxProfile = { id: string; companyId: string; name: string; scope: 'COMPANY' | 'SERVICE' | 'SERVICE_MUNICIPALITY';
  serviceId: string | null; municipalityIbgeCode: string | null; status: 'ACTIVE' | 'INACTIVE'; isDefault: boolean;
  version: number; revisions: Array<TaxRevisionInput & { id: string; revision: number; createdAt: string }> };
export type TaxSnapshot = TaxRates & { profileId?: string; profileName: string; effectiveFrom: string };
export type TaxPreview = { items: Array<{ serviceId: string; taxProfileId?: string | null; revisionId?: string; snapshot?: TaxSnapshot }>;
  municipalityIbgeCode: string | null; notice: string };
export type SaleItemInput = { serviceId: string; taxProfileId?: string | null; quantity: string; unitPrice: string; discountAmount: string; description?: string | null; performedOn?: string | null };
export type SaleInstallmentInput = { paymentMethod: PaymentMethod; amount: string } & ({ dueOn: string; receivedOn?: never } | { receivedOn: string; dueOn?: never });
export type SaleInput = { customerId: string; soldOn: string; fiscalSeriesId?: string | null; workOrderNumber?: string | null; notes?: string | null; attachmentIds?: string[]; items: SaleItemInput[]; installments: SaleInstallmentInput[] };
export type ConfirmedSaleInput = Omit<SaleInput, 'items' | 'installments'> & { items: (SaleItemInput & { id?: string })[]; installments: (SaleInstallmentInput & { id?: string })[] };
export type Sale = {
  id: string; companyId: string; orderCode: string; workOrderNumber: string | null; customerId: string;
  customerNameSnapshot: string; customerKindSnapshot: 'PF' | 'PJ'; customerTaxIdSnapshot: string | null;
  status: SaleStatus; soldOn: string | null; subtotalAmount: string; discountAmount: string; totalAmount: string;
  notes: string | null; fiscalSeriesId: string | null; version: number; createdAt: string; confirmedAt: string | null;
};
export type SaleListItem = Sale & { createdByUserName: string };
export type SaleMovement = { id: string; kind: 'RECEIPT' | 'REVERSAL'; amount: string; effectiveOn: string; paymentMethod: PaymentMethod | null; reference: string | null; reversesMovementId: string | null; recordedAt: string };
export type SaleInstallment = { id: string; number: number; paycode: string | null; paymentMethod: PaymentMethod;
  amount: string; dueOn: string | null; initialReceivedOn: string | null; receivableId: string | null; paidAmount: string; remainingAmount: string;
  paymentStatus: 'DRAFT' | 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE'; movements: SaleMovement[] };
export type SaleItem = { id: string; serviceId: string; position: number; serviceNameSnapshot: string; descriptionSnapshot: string | null;
  quantity: string; unitPrice: string; grossAmount: string; discountAmount: string; totalAmount: string; performedOn: string | null;
  taxProfileRevisionId: string | null; taxSnapshot: TaxSnapshot | null };
export type SaleDetail = Sale & { items: SaleItem[]; installments: SaleInstallment[]; attachments: StoredFile[] };
export type SaleList = { items: SaleListItem[]; total: number; limit: number; offset: number };
export type FinanceSettlement = 'ALL' | 'PENDING' | 'PARTIAL' | 'PAID';
export type FinanceDateBasis = 'SALE' | 'DUE' | 'RECEIPT';
export type FinanceOverdue = 'ALL' | 'ONLY' | 'EXCLUDE';
export type FinanceFilters = {
  customerId?: string; search?: string; orderCode?: string; paycode?: string; workOrderNumber?: string;
  dateFrom?: string; dateTo?: string; dateBasis: FinanceDateBasis; settlement: FinanceSettlement;
  overdue: FinanceOverdue; paymentMethod?: PaymentMethod;
};
export type FinancePayment = {
  receivableId: string; installmentId: string; number: number; paycode: string; paymentMethod: PaymentMethod;
  originalAmount: string; paidAmount: string; remainingAmount: string; dueOn: string | null;
  initialReceivedOn: string | null; settlement: Exclude<FinanceSettlement, 'ALL'>;
  isOverdue: boolean; matchesFilter: boolean;
};
export type FinanceSale = {
  saleId: string; version: number; orderCode: string; workOrderNumber: string | null; customerId: string;
  customerName: string; soldOn: string; confirmedAt: string; totalAmount: string;
  paidAmount: string; remainingAmount: string; payments: FinancePayment[];
};
export type FinanceMovement = SaleMovement;
export type FinanceDetail = Omit<FinanceSale, 'payments'> & { payments: (FinancePayment & { movements: FinanceMovement[] })[] };
export type FinanceList = { items: FinanceSale[]; nextCursor: string | null; limit: number };
export type FinanceSummary = {
  paymentCount: number; saleCount: number; originalAmount: string; paidAmount: string;
  remainingAmount: string; overdueAmount: string;
};
export type WhatsAppLinkStatus = {
  configured: boolean;
  linked: boolean;
  connection: { displayPhoneNumber: string; environment: string } | null;
  link: { id: string; linkId: string; companyId: string; phoneE164: string | null; verifiedAt: string } | null;
  verifiedNumbers: { id: string; phoneE164: string | null; verifiedAt: string }[];
};
export type WhatsAppLinkChallenge = {
  challengeId: string; expiresAt: string; waLink: string; displayPhoneNumber: string; instruction: string;
};
export type WhatsAppChallengeStatus = {
  id: string; status: 'PENDING' | 'CANDIDATE' | 'CONFIRMED' | 'EXPIRED' | 'CANCELED'; expiresAt: string; candidatePhoneE164: string | null;
};
export type CrmStatus = 'NEW' | 'CONTACTING' | 'QUALIFIED' | 'DISQUALIFIED' | 'LOST' | 'WON';
export type CrmCapture = {
  sourceLabel: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null;
  utmContent: string | null; utmTerm: string | null;
};
export type CrmLead = {
  id: string; companyId: string; name: string; organizationName: string | null; email: string | null; phone: string | null;
  taxId: string | null; taxIdKind: 'PF' | 'PJ' | null; notes: string | null; assignedUserId: string | null;
  customerId: string | null; version: number; archivedAt: string | null; createdAt: string; updatedAt: string;
};
export type CrmEntry = CrmCapture & {
  id: string; contactId: string; captureKind: 'MANUAL' | 'FORM' | 'META_ADS' | 'GOOGLE_ADS' | 'IMPORT' | 'NERO' | 'API';
  sourceFormReference: string | null; primaryServiceId: string | null; interestDescription: string | null;
  occurredAt: string; receivedAt: string;
};
export type CrmOpportunity = {
  id: string; companyId: string; contactId: string; pipelineId: string; stageId: string; title: string;
  primaryServiceId: string | null; estimatedAmount: string | null; expectedCloseOn: string | null;
  commercialStatus: CrmStatus; assignedUserId: string | null; reasonCode: string | null; reasonText: string | null;
  closedAt: string | null; lastActivityAt: string; createdAt: string; updatedAt: string; archivedAt: string | null; version: number;
  lead: Pick<CrmLead, 'id' | 'name' | 'organizationName'>; origin: CrmEntry;
};
export type CrmOpportunityRecord = Omit<CrmOpportunity, 'lead' | 'origin'>;
export type CrmOpportunityDetail = CrmOpportunityRecord & { lead: CrmLead; origin: CrmEntry };
export type CrmOpportunityList = {
  items: CrmOpportunity[]; total: number; limit: number; offset: number;
  summary: { total: number; knownAmounts: number; estimatedAmount: string };
};
export type CrmLeadDetail = CrmLead & {
  summary: { opportunities: number; knownAmounts: number; estimatedAmount: string };
  firstVisibleEntry: CrmEntry | null; visibility: 'COMPANY' | 'ASSIGNED';
};
export type CrmActivity = {
  id: string; contactId: string; opportunityId: string | null; entryId: string | null; kind: string; actorType: string;
  note: string | null; changes: Record<string, unknown>; occurredAt: string; recordedAt: string;
};
export type CrmPipeline = {
  id: string; name: string; isDefault: boolean; version: number;
  stages: { id: string; pipelineId: string; name: string; position: number; isEntry: boolean; version: number }[];
};
export type CrmFilters = {
  search?: string; status?: CrmStatus; contactId?: string; pipelineId?: string; stageId?: string; primaryServiceId?: string;
  sourceLabel?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string;
  from?: string; to?: string; periodBy?: 'ENTRY_RECEIVED' | 'CONTACT_CREATED'; includeArchived?: boolean;
};
export type CrmLeadInput = {
  lead: { name: string; organizationName?: string | null; email?: string | null; phone?: string | null; notes?: string | null };
  interest?: { description?: string | null; primaryServiceId?: string | null; estimatedAmount?: string | null; expectedCloseOn?: string | null };
  capture?: { sourceLabel?: string | null; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; utmContent?: string | null; utmTerm?: string | null };
  pipelineId?: string; title?: string;
};
export type CrmCreateResult = { leadId: string; entryId: string; opportunityId: string };
export type MeetingStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW';
export type MeetingParticipant = { kind: 'CONTACT'; contactId: string } | { kind: 'USER'; userId: string } | { kind: 'EXTERNAL'; name: string | null; email: string | null; phone: string | null };
export type Meeting = {
  id: string; companyId: string; contactId: string; opportunityId: string | null; title: string; assignedUserId: string;
  startsAt: string; endsAt: string; timezone: string; modality: 'IN_PERSON' | 'ONLINE'; location: string | null;
  meetingUrl: string | null; description: string | null; notes: string | null; status: MeetingStatus;
  outcomeNotes: string | null; nextSteps: string | null; cancellationReason: string | null;
  version: number; createdAt: string; updatedAt: string;
  lead: { id: string; name: string; organizationName: string | null; email?: string | null; phone?: string | null };
  responsible: { id: string; name: string };
};
export type MeetingDetail = Meeting & { opportunity: { id: string; title: string; commercialStatus: CrmStatus } | null; participants: MeetingParticipant[]; reminderMinutes: number[] };
export type MeetingList = { items: Meeting[]; total: number; limit: number; offset: number; summary: { total: number; scheduled: number; completed: number; canceled: number; noShow: number } };
export type MeetingFilters = { from: string; to: string; assignedUserId?: string; contactId?: string; opportunityId?: string; status?: MeetingStatus; modality?: Meeting['modality']; search?: string };
export type MeetingCreateInput = { contactId: string; opportunityId?: string | null; title: string; assignedUserId?: string; startsAt: string; endsAt: string; timezone: string; modality: Meeting['modality']; location?: string | null; meetingUrl?: string | null; description?: string | null; notes?: string | null; participants: MeetingParticipant[]; reminderMinutes?: number[]; allowConflict: boolean };
export type MeetingSettings = { companyId: string; qualifyOpportunityOnMeeting: boolean; defaultReminderMinutes: number | null; conflictPolicy: 'WARN' | 'ALLOW'; version: number };
export type MeetingNotification = { id: string; meetingId: string; title: string; body: string; createdAt: string; readAt: string | null };
export type ProposalStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CONVERTED';
export type ProposalItemInput = { serviceId: string; quantity: string; unitPrice: string; description?: string | null; discountType: 'AMOUNT' | 'PERCENT'; discountInput: string };
export type ProposalInput = { opportunityId?: string; customerId?: string; contactId?: string; createOpportunity?: boolean; newCustomer?: Partial<CustomerInput>; title: string; commercialDescription?: string | null; paymentTerms?: string | null; notes?: string | null; terms?: string | null; validUntil?: string | null; items: ProposalItemInput[] };
export type Proposal = { id: string; companyId: string; proposalNumber: number; proposalCode: string; contactId: string; opportunityId: string; customerId: string; title: string; recipientName: string; recipientOrganization: string | null; recipientEmail: string | null; recipientTaxId: string | null; commercialDescription: string | null; paymentTerms: string | null; notes: string | null; terms: string | null; validUntil: string | null; subtotalAmount: string; discountAmount: string; totalAmount: string; status: Exclude<ProposalStatus, 'EXPIRED'>; effectiveStatus: ProposalStatus; version: number; createdAt: string; updatedAt: string; sentAt: string | null; acceptedAt: string | null; declinedAt: string | null; convertedAt: string | null; declineReason: string | null; contactName?: string; assignedUserId?: string | null };
export type ProposalItem = ProposalItemInput & { id: string; proposalId: string; serviceNameSnapshot: string; descriptionSnapshot: string | null; unitLabelSnapshot: string; grossAmount: string; discountAmount: string; totalAmount: string; position: number };
export type ProposalDetail = Proposal & { items: ProposalItem[]; sale: { id: string; orderCode: string; status: SaleStatus } | null };
export type ProposalResult = { proposalId: string; proposalCode: string; customerId: string; status: Proposal['status']; version: number; totalAmount: string; saleId?: string; orderCode?: string; reviewUrl?: string };
export type ProposalFilters = { search?: string; status?: ProposalStatus | 'ALL'; contactId?: string; customerId?: string; opportunityId?: string; serviceId?: string; from?: string; to?: string; validFrom?: string; validTo?: string };
export type ProposalList = { items: Proposal[]; total: number; limit: number; offset: number; summary: { total: number; totalAmount: string; sent: number; expired: number; accepted: number; converted: number } };
export type ProposalPrefill = { contact?: CrmLead; opportunity?: CrmOpportunityRecord; customer?: Customer | null; customerCandidates?: Pick<Customer, 'id' | 'name' | 'kind' | 'taxId' | 'status'>[]; customerDraft?: { kind: 'PF' | 'PJ' | null; name: string; taxId: string | null; email: string | null; phone: string | null }; service?: Service | null; interestDescription?: string | null; suggestedItems?: ProposalItemInput[]; requiresCustomerDetails?: boolean; requiresServiceSelection?: boolean; opportunities?: CrmOpportunityRecord[]; contacts?: { id: string; name: string }[]; requiresOpportunitySelection?: boolean; requiresOpportunityCreation?: boolean };
export type ProposalEvent = { id: string; eventType: string; actorType: string; reason: string | null; recordedAt: string };
export type ProposalSettings = { companyId: string; winOpportunityOnProposalConversion: boolean; proposalSentStageId: string | null; version: number };
export type ApiIssue = { path: string; message: string };

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues: ApiIssue[] = []) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshPromise: Promise<void> | null = null;

async function readError(response: Response): Promise<ApiError> {
  const data = await response.json().catch(() => null) as { message?: string | { message?: string; errors?: ApiIssue[] }; errors?: ApiIssue[] } | null;
  const nested = typeof data?.message === 'object' ? data.message : null;
  const message = typeof data?.message === 'string' ? data.message : nested?.message ?? 'Não foi possível concluir a operação.';
  return new ApiError(response.status, message, data?.errors ?? nested?.errors ?? []);
}

async function refreshSession(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(async (response) => {
      if (!response.ok) throw await readError(response);
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}, options: { retryAuth?: boolean; companyId?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.companyId) headers.set('X-Company-Id', options.companyId);
  const execute = () => fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  let response: Response;
  try {
    response = await execute();
    if (response.status === 401 && options.retryAuth !== false) {
      try {
        await refreshSession();
        response = await execute();
      } catch { throw await readError(response); }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'Não foi possível conectar ao sistema. Tente novamente em instantes.');
  }
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestBlob(path: string, companyId: string): Promise<Blob> {
  const execute = () => fetch(`${API_URL}${path}`, { credentials: 'include', headers: { 'X-Company-Id': companyId } });
  let response = await execute();
  if (response.status === 401) { await refreshSession(); response = await execute(); }
  if (!response.ok) throw await readError(response);
  return response.blob();
}

const json = (value: unknown) => JSON.stringify(value);

export type ReportType = 'closed-services' | 'service-receipts' | 'lead-entries' | 'customers' | 'service-catalog' | 'meetings' | 'disqualification-rate' | 'loss-rate';
export type ReportFilters = { from?: string; to?: string; search?: string; customerId?: string; serviceId?: string; assignedUserId?: string; status?: string; captureKind?: string; utmSource?: string; utmCampaign?: string; sourceFormReference?: string; paymentMethod?: string; limit?: number; cursor?: string };
export type ReportResult = { summary: Record<string, number | string | null>; items: Array<Record<string, unknown> & { id: string }>; nextCursor: string | null; generatedAt: string; timezone: string; visibility: 'COMPANY' | 'ASSIGNED' };
function reportQuery(filters: ReportFilters) {
  return new URLSearchParams(Object.entries(filters).filter(([,value]) => value !== undefined && value !== '').map(([key,value]) => [key,String(value)]));
}

export const api = {
  fiscalSeries: (companyId: string, environment?: FiscalSeries['environment']) => request<FiscalSeries[]>(`/fiscal/series${environment ? `?environment=${environment}` : ''}`, {}, { companyId }),
  fiscalSeriesAdjustments: (companyId: string, id: string) => request<FiscalSeriesAdjustment[]>(`/fiscal/series/${id}/adjustments`, {}, { companyId }),
  createFiscalSeries: (companyId: string, input: { environment: FiscalSeries['environment']; seriesNumber: number; nextNumber: string; isDefault: boolean }) =>
    request<FiscalSeries>('/fiscal/series', { method: 'POST', body: json(input) }, { companyId }),
  updateFiscalSeries: (companyId: string, id: string, input: { expectedVersion: number; status?: FiscalSeries['status']; isDefault?: boolean }) =>
    request<FiscalSeries>(`/fiscal/series/${id}`, { method: 'PATCH', body: json(input) }, { companyId }),
  advanceFiscalSeries: (companyId: string, id: string, input: { expectedVersion: number; nextNumber: string; reason: string }) =>
    request<FiscalSeries>(`/fiscal/series/${id}/advance`, { method: 'POST', body: json(input) }, { companyId }),
  taxProfiles: (companyId: string) => request<TaxProfile[]>('/fiscal/tax-profiles', {}, { companyId }),
  createTaxProfile: (companyId: string, input: { name: string; scope: TaxProfile['scope']; serviceId: string | null; municipalityIbgeCode: string | null; isDefault: boolean; revision: TaxRevisionInput }) =>
    request<TaxProfile>('/fiscal/tax-profiles', { method: 'POST', body: json(input) }, { companyId }),
  updateTaxProfile: (companyId: string, id: string, input: { expectedVersion: number; name?: string; status?: TaxProfile['status']; isDefault?: boolean }) =>
    request<TaxProfile>(`/fiscal/tax-profiles/${id}`, { method: 'PATCH', body: json(input) }, { companyId }),
  addTaxRevision: (companyId: string, id: string, input: TaxRevisionInput & { expectedVersion: number }) =>
    request<TaxProfile>(`/fiscal/tax-profiles/${id}/revisions`, { method: 'POST', body: json(input) }, { companyId }),
  previewTax: (companyId: string, input: { items: Array<{ serviceId: string; taxProfileId?: string | null }>; competence: string; municipalityIbgeCode?: string | null }) =>
    request<TaxPreview>('/fiscal/tax-profiles/preview', { method: 'POST', body: json(input) }, { companyId }),
  report: (companyId: string, type: ReportType, filters: ReportFilters) => request<ReportResult>(`/reports/${type}?${reportQuery(filters)}`, {}, { companyId }),
  reportOptions: (companyId: string, field: 'customerId' | 'serviceId' | 'assignedUserId', search = '') => request<{ items: Array<{ id: string; name: string }> }>(`/reports/options?${new URLSearchParams({ field, search, limit: '100' })}`, {}, { companyId }),
  reportCsv: (companyId: string, type: 'customers' | 'service-catalog', filters: ReportFilters) => requestBlob(`/reports/${type}.csv?${reportQuery(filters)}`, companyId),
  fileCapabilities: (companyId: string) => request<UploadCapabilities>('/files/capabilities', {}, { companyId }),
  beginFileUpload: (companyId: string, input: { fileName: string; mimeType: StoredFile['mimeType']; sizeBytes: number }, key: string) => request<UploadSession>('/files/uploads', { method: 'POST', headers: { 'Idempotency-Key': key }, body: json(input) }, { companyId }),
  completeFileUpload: (companyId: string, id: string) => request<StoredFile>(`/files/${id}/complete`, { method: 'POST', body: '{}' }, { companyId }),
  fileAccess: (companyId: string, id: string) => request<{ url: string; expiresAt: string; fileName: string }>(`/files/${id}/access?disposition=attachment`, {}, { companyId }),
  removeFile: (companyId: string, id: string) => request<void>(`/files/${id}`, { method: 'DELETE' }, { companyId }),
  me: () => request<User>('/auth/me'),
  login: (email: string, password: string) => request('/auth/login', { method: 'POST', body: json({ email, password, client: 'web' }) }, { retryAuth: false }),
  register: (name: string, email: string, password: string) => request('/auth/register', { method: 'POST', body: json({ name, email, password, client: 'web' }) }, { retryAuth: false }),
  logout: () => request<void>('/auth/logout', { method: 'POST', body: '{}' }, { retryAuth: false }),
  accounts: () => request<Account[]>('/accounts'),
  managedUsers: (accountId: string, search: string, offset = 0, limit = 25) => request<ManagedUsersList>(`/accounts/${accountId}/users?${new URLSearchParams({ search, offset: String(offset), limit: String(limit) })}`),
  userCapacity: (accountId: string) => request<UserCapacity[]>(`/accounts/${accountId}/users/capacity`),
  inviteUser: (accountId: string, input: { name: string; email: string; companyIds: string[] }, key: string) => request<ManagedInvitation>(`/accounts/${accountId}/user-invitations`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: json(input) }),
  resendInvitation: (accountId: string, invitationId: string, version: number, key: string) => request<ManagedInvitation>(`/accounts/${accountId}/user-invitations/${invitationId}/resend`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: json({ version }) }),
  changeInvitationCompanies: (accountId: string, invitationId: string, version: number, companyIds: string[], key: string) => request<ManagedInvitation>(`/accounts/${accountId}/user-invitations/${invitationId}/companies`, { method: 'PATCH', headers: { 'Idempotency-Key': key }, body: json({ version, companyIds }) }),
  revokeInvitation: (accountId: string, invitationId: string, version: number, key: string) => request<ManagedInvitation>(`/accounts/${accountId}/user-invitations/${invitationId}/revoke`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: json({ version }) }),
  changeMemberCompanies: (accountId: string, userId: string, version: string, companyIds: string[], key: string) => request<{ userId: string; version: string }>(`/accounts/${accountId}/users/${userId}/companies`, { method: 'PATCH', headers: { 'Idempotency-Key': key }, body: json({ version, companyIds }) }),
  previewInvitation: (token: string) => request<InvitationPreview>('/user-invitations/preview', { method: 'POST', body: json({ token }) }, { retryAuth: false }),
  acceptNewInvitation: (token: string, password: string, passwordConfirmation: string) => request<{ user: User }>('/user-invitations/accept-new', { method: 'POST', body: json({ token, password, passwordConfirmation, client: 'web' }) }, { retryAuth: false }),
  acceptExistingInvitation: (token: string) => request<{ accepted: boolean }>('/user-invitations/accept-existing', { method: 'POST', body: json({ token }) }),
  companies: () => request<Company[]>('/companies'),
  company: (companyId: string) => request<CompanyProfile>('/companies/current', {}, { companyId }),
  createCompany: (input: CompanyInput) => request<CompanyProfile>('/companies', { method: 'POST', body: json(input) }),
  updateCompany: (companyId: string, input: CompanyInput) => request<CompanyProfile>('/companies/current', { method: 'PATCH', body: json(input) }, { companyId }),
  fiscalCertificate: (companyId: string) => request<FiscalCertificate | null>('/fiscal/certificate', {}, { companyId }),
  uploadFiscalCertificate: (companyId: string, file: File, passphrase: string) => {
    const body = new FormData(); body.append('file', file); body.append('passphrase', passphrase);
    return request<FiscalCertificate>('/fiscal/certificate', { method: 'POST', body }, { companyId });
  },
  disableFiscalCertificate: (companyId: string) => request<{ disabled: true }>('/fiscal/certificate', { method: 'DELETE' }, { companyId }),
  customers: (companyId: string, params: { search: string; status: 'ACTIVE' | 'INACTIVE' | 'ALL'; page: number; limit: number }) => {
    const query = new URLSearchParams({ status: params.status, offset: String(params.page * params.limit), limit: String(params.limit) });
    if (params.search) query.set('search', params.search);
    return request<CustomerList>(`/customers?${query}`, {}, { companyId });
  },
  customer: (companyId: string, id: string) => request<Customer>(`/customers/${id}`, {}, { companyId }),
  createCustomer: (companyId: string, input: CustomerInput) => request<Customer>('/customers', { method: 'POST', body: json(input) }, { companyId }),
  updateCustomer: (companyId: string, id: string, input: Partial<CustomerInput> | { status: 'ACTIVE' }) => request<Customer>(`/customers/${id}`, { method: 'PATCH', body: json(input) }, { companyId }),
  inactivateCustomer: (companyId: string, id: string) => request<void>(`/customers/${id}`, { method: 'DELETE' }, { companyId }),
  services: (companyId: string, params: { search: string; status: 'ACTIVE' | 'INACTIVE'; page: number; limit: number }) => {
    const query = new URLSearchParams({ status: params.status, offset: String(params.page * params.limit), limit: String(params.limit) });
    if (params.search) query.set('search', params.search);
    return request<ServiceList>(`/services?${query}`, {}, { companyId });
  },
  createService: (companyId: string, input: ServiceInput) => request<Service>('/services', { method: 'POST', body: json(input) }, { companyId }),
  updateService: (companyId: string, id: string, input: Partial<ServiceInput> | { status: 'ACTIVE' }) => request<Service>(`/services/${id}`, { method: 'PATCH', body: json(input) }, { companyId }),
  inactivateService: (companyId: string, id: string) => request<void>(`/services/${id}`, { method: 'DELETE' }, { companyId }),
  municipalTaxCodes: (companyId: string, serviceId: string) => request<MunicipalTaxCode[]>(`/services/${serviceId}/municipal-tax-codes`, {}, { companyId }),
  upsertMunicipalTaxCode: (companyId: string, serviceId: string, municipalityIbgeCode: string, municipalTaxCode: string) =>
    request<MunicipalTaxCode>(`/services/${serviceId}/municipal-tax-codes/${municipalityIbgeCode}`, { method: 'PUT', body: json({ municipalTaxCode }) }, { companyId }),
  removeMunicipalTaxCode: (companyId: string, serviceId: string, municipalityIbgeCode: string) =>
    request<void>(`/services/${serviceId}/municipal-tax-codes/${municipalityIbgeCode}`, { method: 'DELETE' }, { companyId }),
  sales: (companyId: string, params: { search: string; status: SaleStatus | 'ALL'; page: number; limit: number }) => {
    const query = new URLSearchParams({ status: params.status, offset: String(params.page * params.limit), limit: String(params.limit) });
    if (params.search) query.set('search', params.search);
    return request<SaleList>(`/sales?${query}`, {}, { companyId });
  },
  sale: (companyId: string, id: string) => request<SaleDetail>(`/sales/${id}`, {}, { companyId }),
  createSale: (companyId: string, input: SaleInput, key: string) => request<SaleDetail>('/sales', { method: 'POST', headers: { 'Idempotency-Key': key }, body: json(input) }, { companyId }),
  updateSale: (companyId: string, id: string, expectedVersion: number, input: SaleInput) =>
    request<SaleDetail>(`/sales/${id}`, { method: 'PATCH', body: json({ ...input, expectedVersion }) }, { companyId }),
  updateConfirmedSale: (companyId: string, id: string, expectedVersion: number, input: ConfirmedSaleInput) =>
    request<SaleDetail>(`/sales/${id}/confirmed`, { method: 'PATCH', body: json({ ...input, expectedVersion }) }, { companyId }),
  confirmSale: (companyId: string, id: string, expectedVersion: number, initialReceipts: { installmentId: string; amount: string; paymentMethod: PaymentMethod; receivedOn: string }[]) =>
    request<SaleDetail>(`/sales/${id}/confirm`, { method: 'POST', body: json({ expectedVersion, initialReceipts }) }, { companyId }),
  updateSaleWorkOrder: (companyId: string, id: string, expectedVersion: number, workOrderNumber: string | null) =>
    request<SaleDetail>(`/sales/${id}/work-order-number`, { method: 'PATCH', body: json({ expectedVersion, workOrderNumber }) }, { companyId }),
  cancelSale: (companyId: string, id: string, expectedVersion: number, reason: string) =>
    request<SaleDetail>(`/sales/${id}/cancel`, { method: 'POST', body: json({ expectedVersion, reason }) }, { companyId }),
  receiveSaleInstallment: (companyId: string, saleId: string, installmentId: string, input: { amount: string; paymentMethod: PaymentMethod; receivedOn: string; reference?: string | null }, key: string) =>
    request<SaleDetail>(`/sales/${saleId}/installments/${installmentId}/receipts`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: json(input) }, { companyId }),
  reverseSaleReceipt: (companyId: string, saleId: string, movementId: string, reason: string, key: string) =>
    request<SaleDetail>(`/sales/${saleId}/receipts/${movementId}/reverse`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: json({ reason }) }, { companyId }),
  financeReceivables: (companyId: string, filters: FinanceFilters, cursor: string | null, limit = 20) => {
    const query = new URLSearchParams({ limit: String(limit) });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    if (cursor) query.set('cursor', cursor);
    return request<FinanceList>(`/finance/receivables?${query}`, {}, { companyId });
  },
  financeSummary: (companyId: string, filters: FinanceFilters) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    return request<FinanceSummary>(`/finance/receivables/summary?${query}`, {}, { companyId });
  },
  financeDetail: (companyId: string, saleId: string) => request<FinanceDetail>(`/finance/receivables/${saleId}`, {}, { companyId }),
  updateFinanceDates: (companyId: string, saleId: string, installmentId: string, input: { expectedVersion: number; soldOn: string; dueOn: string | null }) =>
    request<FinanceDetail>(`/finance/receivables/${saleId}/payments/${installmentId}/dates`, { method: 'PATCH', body: json(input) }, { companyId }),
  crmOpportunities: (companyId: string, filters: CrmFilters = {}, page = 0, limit = 20) => {
    const query = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '' && value !== false) query.set(key, String(value));
    return request<CrmOpportunityList>(`/crm/opportunities?${query}`, {}, { companyId });
  },
  crmLead: (companyId: string, id: string) => request<CrmLeadDetail>(`/crm/leads/${id}`, {}, { companyId }),
  crmLeads: (companyId: string, search = '') => request<{ items: CrmLead[]; total: number }>(`/crm/leads?limit=30&offset=0${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`, {}, { companyId }),
  crmOpportunity: (companyId: string, id: string) => request<CrmOpportunityDetail>(`/crm/opportunities/${id}`, {}, { companyId }),
  createCrmLead: (companyId: string, input: CrmLeadInput, key: string) =>
    request<CrmCreateResult>('/crm/leads', { method: 'POST', headers: { 'Idempotency-Key': key }, body: json(input) }, { companyId }),
  updateCrmLead: (companyId: string, id: string, input: Partial<Omit<CrmLeadInput['lead'], 'taxId' | 'taxIdKind'>> & { expectedVersion: number }) =>
    request<CrmLead>(`/crm/leads/${id}`, { method: 'PATCH', body: json(input) }, { companyId }),
  updateCrmOpportunity: (companyId: string, id: string, input: { expectedVersion: number; title?: string; primaryServiceId?: string | null; estimatedAmount?: string | null; expectedCloseOn?: string | null }) =>
    request<CrmOpportunityRecord>(`/crm/opportunities/${id}`, { method: 'PATCH', body: json(input) }, { companyId }),
  updateCrmStatus: (companyId: string, id: string, input: { expectedVersion: number; status: CrmStatus; reasonText?: string | null }) =>
    request<CrmOpportunityRecord>(`/crm/opportunities/${id}/status`, { method: 'PATCH', body: json(input) }, { companyId }),
  crmHistory: (companyId: string, leadId: string, page = 0, limit = 50) =>
    request<{ items: CrmActivity[]; total: number; limit: number; offset: number }>(`/crm/leads/${leadId}/history?offset=${page * limit}&limit=${limit}`, {}, { companyId }),
  addCrmNote: (companyId: string, leadId: string, opportunityId: string, note: string, key: string) =>
    request<{ id: string }>(`/crm/leads/${leadId}/notes`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: json({ opportunityId, note }) }, { companyId }),
  crmPipelines: (companyId: string) => request<{ items: CrmPipeline[] }>('/crm/pipelines', {}, { companyId }),
  proposals: (companyId: string, filters: ProposalFilters = {}, page = 0, limit = 20) => {
    const query = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    return request<ProposalList>(`/crm/proposals?${query}`, {}, { companyId });
  },
  proposal: (companyId: string, id: string) => request<ProposalDetail>(`/crm/proposals/${id}`, {}, { companyId }),
  proposalPrefill: (companyId: string, input: { opportunityId?: string; customerId?: string; contactId?: string }) => request<ProposalPrefill>(`/crm/proposals/prefill?${new URLSearchParams(input as Record<string, string>)}`, {}, { companyId }),
  createProposal: (companyId: string, input: ProposalInput, key: string) => request<ProposalResult>('/crm/proposals', { method: 'POST', headers: { 'Idempotency-Key': key }, body: json(input) }, { companyId }),
  updateProposal: (companyId: string, id: string, input: Partial<Omit<ProposalInput, 'opportunityId' | 'customerId' | 'contactId' | 'createOpportunity' | 'newCustomer'>> & { expectedVersion: number }) => request<ProposalResult>(`/crm/proposals/${id}`, { method: 'PATCH', body: json(input) }, { companyId }),
  proposalAction: (companyId: string, id: string, action: 'send' | 'accept' | 'decline' | 'duplicate' | 'convert', input: { expectedVersion: number; reason?: string | null; validUntil?: string | null }, key: string) => request<ProposalResult>(`/crm/proposals/${id}/${action}`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: json(input) }, { companyId }),
  proposalHistory: (companyId: string, id: string) => request<{ items: ProposalEvent[]; total: number }>(`/crm/proposals/${id}/history?limit=50&offset=0`, {}, { companyId }),
  proposalPdf: (companyId: string, id: string) => requestBlob(`/crm/proposals/${id}/pdf`, companyId),
  proposalSettings: (companyId: string) => request<ProposalSettings>('/crm/proposal-settings', {}, { companyId }),
  updateProposalSettings: (companyId: string, input: { expectedVersion: number; winOpportunityOnProposalConversion?: boolean; proposalSentStageId?: string | null }) => request<ProposalSettings>('/crm/proposal-settings', { method: 'PATCH', body: json(input) }, { companyId }),
  meetings: (companyId: string, filters: MeetingFilters, offset = 0, limit = 100) => {
    const query = new URLSearchParams({ from: filters.from, to: filters.to, offset: String(offset), limit: String(limit) });
    for (const [key, value] of Object.entries(filters)) if (key !== 'from' && key !== 'to' && value) query.set(key, value);
    return request<MeetingList>(`/crm/meetings?${query}`, {}, { companyId });
  },
  meeting: (companyId: string, id: string) => request<MeetingDetail>(`/crm/meetings/${id}`, {}, { companyId }),
  meetingResponsibles: (companyId: string) => request<{ items: { id: string; name: string }[] }>('/crm/meetings/responsibles', {}, { companyId }),
  meetingConflicts: (companyId: string, input: { assignedUserId: string; startsAt: string; endsAt: string; excludeMeetingId?: string }) => request<{ hasConflict: boolean; items: { id: string; title: string; startsAt: string; endsAt: string }[] }>('/crm/meetings/conflicts', { method: 'POST', body: json(input) }, { companyId }),
  createMeeting: (companyId: string, input: MeetingCreateInput, key: string) => request<{ meetingId: string; opportunityQualified: boolean }>('/crm/meetings', { method: 'POST', headers: { 'Idempotency-Key': key }, body: json(input) }, { companyId }),
  updateMeeting: (companyId: string, id: string, input: { expectedVersion: number; allowConflict?: boolean; title?: string; assignedUserId?: string; timezone?: string; modality?: Meeting['modality']; location?: string | null; meetingUrl?: string | null; description?: string | null; notes?: string | null; participants?: MeetingParticipant[]; reminderMinutes?: number[] }) => request<Meeting>(`/crm/meetings/${id}`, { method: 'PATCH', body: json(input) }, { companyId }),
  rescheduleMeeting: (companyId: string, id: string, input: { expectedVersion: number; startsAt: string; endsAt: string; timezone: string; allowConflict: boolean }) => request<Meeting>(`/crm/meetings/${id}/reschedule`, { method: 'POST', body: json(input) }, { companyId }),
  changeMeetingStatus: (companyId: string, id: string, input: { expectedVersion: number; status: MeetingStatus; outcomeNotes?: string | null; nextSteps?: string | null; cancellationReason?: string | null }) => request<Meeting>(`/crm/meetings/${id}/status`, { method: 'PATCH', body: json(input) }, { companyId }),
  reopenMeeting: (companyId: string, id: string, expectedVersion: number, allowConflict: boolean) => request<Meeting>(`/crm/meetings/${id}/reopen`, { method: 'POST', body: json({ expectedVersion, allowConflict }) }, { companyId }),
  meetingHistory: (companyId: string, id: string, offset = 0) => request<{ items: { id: string; kind: string; actorType: string; occurredAt: string }[]; total: number }>(`/crm/meetings/${id}/history?limit=50&offset=${offset}`, {}, { companyId }),
  meetingSettings: (companyId: string) => request<MeetingSettings>('/crm/meeting-settings', {}, { companyId }),
  updateMeetingSettings: (companyId: string, input: { expectedVersion: number; qualifyOpportunityOnMeeting?: boolean; defaultReminderMinutes?: number | null; conflictPolicy?: 'WARN' | 'ALLOW' }) => request<MeetingSettings>('/crm/meeting-settings', { method: 'PATCH', body: json(input) }, { companyId }),
  meetingNotifications: (companyId: string) => request<{ items: MeetingNotification[]; total: number }>('/crm/notifications?limit=100&offset=0', {}, { companyId }),
  readMeetingNotification: (companyId: string, id: string) => request<MeetingNotification>(`/crm/notifications/${id}/read`, { method: 'PATCH', body: '{}' }, { companyId }),
  whatsappLinkStatus: (companyId: string) => request<WhatsAppLinkStatus>('/integrations/whatsapp/link/status', {}, { companyId }),
  createWhatsAppChallenge: (companyId: string, input: { mode?: 'NEW_NUMBER' | 'EXISTING_NUMBER'; linkId?: string } = {}) => request<WhatsAppLinkChallenge>('/integrations/whatsapp/link/challenges', { method: 'POST', body: json(input) }, { companyId }),
  whatsappChallengeStatus: (companyId: string, challengeId: string) => request<WhatsAppChallengeStatus>(`/integrations/whatsapp/link/challenges/${challengeId}`, {}, { companyId }),
  confirmWhatsAppLink: (companyId: string, challengeId: string) => request<{ linked: true; phoneE164: string | null; verifiedAt: string }>(`/integrations/whatsapp/link/challenges/${challengeId}/confirm`, { method: 'POST', body: '{}' }, { companyId }),
  disconnectWhatsApp: (companyId: string) => request<void>('/integrations/whatsapp/link', { method: 'DELETE' }, { companyId }),
};
