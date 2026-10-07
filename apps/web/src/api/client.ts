const API_URL = (import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:3000`).replace(/\/$/, '');

export type User = { id: string; name: string; email: string };
export type Company = { id: string; name: string; role: string };
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
  register: (name: string, email: string, password: string, companyName: string) => request('/auth/register', { method: 'POST', body: json({ name, email, password, companyName, client: 'web' }) }, { retryAuth: false }),
  logout: () => request<void>('/auth/logout', { method: 'POST', body: '{}' }, { retryAuth: false }),
  companies: () => request<Company[]>('/companies'),
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
};
