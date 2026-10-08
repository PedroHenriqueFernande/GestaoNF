const API_URL = (import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:3000`).replace(/\/$/, '');

export type User = { id: string; name: string; email: string };
export type Company = { id: string; name: string; role: string };
export type CompanyProfile = Company & {
  kind: 'PF' | 'PJ'; legalName: string | null; tradeName: string | null; taxId: string | null; email: string | null; phone: string | null;
  street: string | null; number: string | null; complement: string | null; district: string | null;
  postalCode: string | null; cityName: string | null; cityIbgeCode: string | null; stateCode: string | null;
  countryCode: string; municipalRegistration: string | null; stateRegistration: string | null; cnaeCode: string | null;
  simplesNationalOption: '1' | '2' | '3' | '4' | null;
  simplesTaxationRegime: '1' | '2' | '3' | null; specialTaxRegime: '0' | '1' | '2' | '3' | '4' | '5' | '6' | null;
  timezone: string; locale: string; status: 'ACTIVE' | 'INACTIVE'; createdAt: string; updatedAt: string;
};
export type CompanyInput = Pick<CompanyProfile, 'name' | 'kind' | 'legalName' | 'tradeName' | 'taxId' | 'email' | 'phone' | 'street' | 'number' | 'complement' | 'district' | 'postalCode' | 'cityName' | 'cityIbgeCode' | 'stateCode' | 'countryCode' | 'municipalRegistration' | 'stateRegistration' | 'cnaeCode' | 'simplesNationalOption' | 'simplesTaxationRegime' | 'specialTaxRegime'>;
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
  createdAt: string;
  updatedAt: string;
};
export type CustomerInput = Pick<Customer, 'kind' | 'name' | 'tradeName' | 'taxId' | 'email' | 'phone' | 'notes' | 'street' | 'number' | 'complement' | 'district' | 'postalCode' | 'cityName' | 'cityIbgeCode' | 'stateCode' | 'countryCode'>;
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
  status: 'ACTIVE' | 'INACTIVE';
  fiscalClassificationStatus: 'PENDING_NATIONAL_CODE' | 'NATIONAL_CODE_PROVIDED';
  createdAt: string;
  updatedAt: string;
};
export type ServiceInput = Pick<Service, 'name' | 'internalCode' | 'description' | 'unitLabel' | 'suggestedUnitPrice' | 'nationalTaxCode' | 'nbsCode'>;
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
export type SaleStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELED';
export type SaleItemInput = { serviceId: string; quantity: string; unitPrice: string; discountAmount: string; description?: string | null; performedOn?: string | null };
export type SaleInstallmentInput = { paymentMethod: PaymentMethod; amount: string } & ({ dueOn: string; receivedOn?: never } | { receivedOn: string; dueOn?: never });
export type SaleInput = { customerId: string; soldOn: string; workOrderNumber?: string | null; notes?: string | null; items: SaleItemInput[]; installments: SaleInstallmentInput[] };
export type ConfirmedSaleInput = Omit<SaleInput, 'items' | 'installments'> & { items: (SaleItemInput & { id?: string })[]; installments: (SaleInstallmentInput & { id?: string })[] };
export type Sale = {
  id: string; companyId: string; orderCode: string; workOrderNumber: string | null; customerId: string;
  customerNameSnapshot: string; customerKindSnapshot: 'PF' | 'PJ'; customerTaxIdSnapshot: string | null;
  status: SaleStatus; soldOn: string | null; subtotalAmount: string; discountAmount: string; totalAmount: string;
  notes: string | null; version: number; createdAt: string; confirmedAt: string | null;
};
export type SaleMovement = { id: string; kind: 'RECEIPT' | 'REVERSAL'; amount: string; effectiveOn: string; paymentMethod: PaymentMethod | null; reference: string | null; reversesMovementId: string | null; recordedAt: string };
export type SaleInstallment = { id: string; number: number; paycode: string | null; paymentMethod: PaymentMethod;
  amount: string; dueOn: string | null; initialReceivedOn: string | null; receivableId: string | null; paidAmount: string; remainingAmount: string;
  paymentStatus: 'DRAFT' | 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE'; movements: SaleMovement[] };
export type SaleItem = { id: string; serviceId: string; position: number; serviceNameSnapshot: string; descriptionSnapshot: string | null;
  quantity: string; unitPrice: string; grossAmount: string; discountAmount: string; totalAmount: string; performedOn: string | null };
export type SaleDetail = Sale & { items: SaleItem[]; installments: SaleInstallment[] };
export type SaleList = { items: Sale[]; total: number; limit: number; offset: number };
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
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
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

const json = (value: unknown) => JSON.stringify(value);

export const api = {
  me: () => request<User>('/auth/me'),
  login: (email: string, password: string) => request('/auth/login', { method: 'POST', body: json({ email, password, client: 'web' }) }, { retryAuth: false }),
  register: (name: string, email: string, password: string) => request('/auth/register', { method: 'POST', body: json({ name, email, password, client: 'web' }) }, { retryAuth: false }),
  logout: () => request<void>('/auth/logout', { method: 'POST', body: '{}' }, { retryAuth: false }),
  companies: () => request<Company[]>('/companies'),
  company: (companyId: string) => request<CompanyProfile>('/companies/current', {}, { companyId }),
  createCompany: (input: CompanyInput) => request<CompanyProfile>('/companies', { method: 'POST', body: json(input) }),
  updateCompany: (companyId: string, input: CompanyInput) => request<CompanyProfile>('/companies/current', { method: 'PATCH', body: json(input) }, { companyId }),
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
};
