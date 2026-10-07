import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const base = process.env.API_ORIGIN ?? 'http://localhost:3000';
const sql = postgres(process.env.DATABASE_URL ?? '');
const userIds: string[] = [];
const companyIds: string[] = [];

beforeAll(async () => {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/docs-json`)).ok) return; } catch { /* API still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API não respondeu em ${base}`);
});

async function request(path: string, method = 'GET', body?: object, token?: string, companyId?: string, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(companyId ? { 'x-company-id': companyId } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
}

afterAll(async () => {
  for (const companyId of companyIds) {
    await sql`delete from customers where company_id = ${companyId}`;
    await sql`delete from company_users where company_id = ${companyId}`;
    await sql`delete from companies where id = ${companyId}`;
  }
  for (const userId of userIds) {
    await sql`delete from auth_sessions where user_id = ${userId}`;
    await sql`delete from user_credentials where user_id = ${userId}`;
    await sql`delete from users where id = ${userId}`;
  }
  await sql.end();
});

describe('API de clientes com autenticação e isolamento por empresa', () => {
  it('permite os métodos do CRUD no preflight do frontend', async () => {
    for (const origin of [process.env.WEB_ORIGIN ?? 'http://localhost:5173', 'http://127.0.0.1:5173']) {
      for (const method of ['PATCH', 'DELETE']) {
        const response = await fetch(`${base}/customers/11111111-1111-4111-8111-111111111111`, {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type,x-company-id' },
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe(origin);
        expect(response.headers.get('access-control-allow-methods')).toContain(method);
      }
    }
  });
  it('executa cadastro, login, CRUD, validações e isolamento entre empresas', async () => {
    const suffix = crypto.randomUUID();
    const password = 'senha-segura-para-teste-123';
    const first = await request('/auth/register', 'POST', { name: 'Pessoa Um', email: `um-${suffix}@example.com`, password, companyName: 'Empresa Um', client: 'mobile' });
    expect(first.status).toBe(201);
    userIds.push(first.body.user.id);
    companyIds.push(first.body.company.id);
    const second = await request('/auth/register', 'POST', { name: 'Pessoa Dois', email: `dois-${suffix}@example.com`, password, companyName: 'Empresa Dois', client: 'mobile' });
    expect(second.status).toBe(201);
    userIds.push(second.body.user.id);
    companyIds.push(second.body.company.id);
    const companyA = first.body.company.id;
    const companyB = second.body.company.id;
    const tokenA = first.body.accessToken;
    const tokenB = second.body.accessToken;

    expect((await request('/auth/register', 'POST', { name: 'Repetido', email: `um-${suffix}@example.com`, password, companyName: 'Outra empresa', client: 'mobile' })).status).toBe(409);
    const specification = await request('/docs-json');
    expect(specification.body.openapi).toBe('3.1.0');

    expect((await request('/companies', 'GET', undefined, tokenA)).body).toEqual([{ id: companyA, name: 'Empresa Um', role: 'OWNER' }]);
    expect((await request('/customers', 'GET', undefined, tokenB, companyA)).status).toBe(403);
    expect((await request('/customers', 'GET', undefined, undefined, companyA)).status).toBe(401);

    const created = await request('/customers', 'POST', { kind: 'PF', name: 'Cliente sem documento' }, tokenA, companyA);
    expect(created.status).toBe(201);
    expect(created.body.taxId).toBeNull();
    const id = created.body.id;
    expect((await request(`/customers/${id}`, 'GET', undefined, tokenB, companyB)).status).toBe(404);
    expect((await request('/customers', 'POST', { kind: 'PF', name: 'Inválido', taxId: '11111111111' }, tokenA, companyA)).status).toBe(400);
    expect((await request('/customers', 'POST', { kind: 'PF', name: 'Errado', taxId: '00000000E08G12' }, tokenA, companyA)).status).toBe(400);
    expect((await request('/customers', 'POST', { kind: 'PF', name: 'Extra', unexpected: true }, tokenA, companyA)).status).toBe(400);

    const updated = await request(`/customers/${id}`, 'PATCH', { taxId: '529.982.247-25', email: 'cliente@example.com', phone: '11987654321' }, tokenA, companyA);
    expect(updated.status).toBe(200);
    expect(updated.body.taxId).toBe('52998224725');
    expect((await request('/customers', 'POST', { kind: 'PF', name: 'Duplicado', taxId: '52998224725' }, tokenA, companyA)).status).toBe(409);
    expect((await request('/customers', 'POST', { kind: 'PF', name: 'Outro tenant', taxId: '52998224725' }, tokenB, companyB)).status).toBe(201);
    expect((await request('/customers?search=Cliente&limit=10', 'GET', undefined, tokenA, companyA)).body.total).toBe(1);
    expect((await request('/customers?search=529.982.247-25', 'GET', undefined, tokenA, companyA)).body.total).toBe(1);
    expect((await request('/customers?search=%2811%29%2098765-4321', 'GET', undefined, tokenA, companyA)).body.total).toBe(1);
    expect((await request(`/customers/${id}`, 'PATCH', { kind: 'PJ' }, tokenA, companyA)).status).toBe(400);
    expect((await request(`/customers/${id}`, 'DELETE', undefined, tokenB, companyB)).status).toBe(404);
    expect((await request(`/customers/${id}`, 'DELETE', undefined, tokenA, companyA)).status).toBe(204);
    expect((await request('/customers', 'GET', undefined, tokenA, companyA)).body.total).toBe(0);
    expect((await request('/customers?status=INACTIVE', 'GET', undefined, tokenA, companyA)).body.total).toBe(1);

    const refreshed = await request('/auth/refresh', 'POST', { refreshToken: first.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect((await request('/auth/refresh', 'POST', { refreshToken: first.body.refreshToken })).status).toBe(401);
    expect((await request('/auth/logout', 'POST', { refreshToken: refreshed.body.refreshToken })).status).toBe(204);
    expect((await request('/auth/refresh', 'POST', { refreshToken: refreshed.body.refreshToken })).status).toBe(401);

    const web = await request('/auth/login', 'POST', { email: `um-${suffix}@example.com`, password, client: 'web' });
    expect(web.status).toBe(200);
    expect(web.body.accessToken).toBeUndefined();
    const cookies = web.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
    expect((await request('/auth/me', 'GET', undefined, undefined, undefined, { cookie: cookies })).status).toBe(200);
    expect((await request('/customers', 'POST', { kind: 'PF', name: 'CSRF' }, undefined, companyA, { cookie: cookies })).status).toBe(403);
    const webRefresh = await request('/auth/refresh', 'POST', {}, undefined, undefined, { cookie: cookies, origin: base });
    expect(webRefresh.status).toBe(200);
    expect(webRefresh.body.accessToken).toBeUndefined();
  });
});
