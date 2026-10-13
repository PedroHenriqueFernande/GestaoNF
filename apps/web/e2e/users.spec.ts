import { expect, test } from '@playwright/test';

const companyId = '11111111-1111-4111-8111-111111111111';
const secondCompanyId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const inviteId = '44444444-4444-4444-8444-444444444444';
const cors = { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };

test('titular convida usuário para duas empresas e vê reservas por empresa', async ({ page }) => {
  const errors: string[] = [];
  let body: { name: string; email: string; companyIds: string[] } | null = null;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:3000/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const reply = (json: unknown) => route.fulfill({ json, headers: cors });
    if (request.method() === 'OPTIONS') return reply({});
    if (path === '/auth/me') return reply({ id: 'owner', name: 'Titular', email: 'titular@example.test' });
    if (path === '/companies') return reply([{ id: companyId, name: 'GestãoNF', role: 'OWNER', accountId }, { id: secondCompanyId, name: 'Filial', role: 'OWNER', accountId }]);
    if (path === '/accounts') return reply([{ id: accountId, name: 'GestãoNF', status: 'ACTIVE', planCode: 'BASE', additionalUsersPerCompany: 5 }]);
    if (path === `/accounts/${accountId}/users/capacity`) return reply([{ companyId, name: 'GestãoNF', status: 'ACTIVE', limit: 5, occupied: 0, reserved: body ? 1 : 0, available: body ? 4 : 5, overLimit: 0 }, { companyId: secondCompanyId, name: 'Filial', status: 'ACTIVE', limit: 5, occupied: 0, reserved: body ? 1 : 0, available: body ? 4 : 5, overLimit: 0 }]);
    if (path === `/accounts/${accountId}/users` && request.method() === 'GET') return reply({ items: body ? [{ id: inviteId, type: 'INVITATION', name: body.name, email: body.email, status: 'PENDING', expiresAt: '2026-10-14T18:00:00Z', version: 1, createdAt: '2026-10-13T18:00:00Z', companies: [{ id: companyId, name: 'GestãoNF' }, { id: secondCompanyId, name: 'Filial' }], delivery: { id: 'mail', sendStatus: 'QUEUED' } }] : [{ id: 'owner', type: 'MEMBER', name: 'Titular', email: 'titular@example.test', status: 'OWNER', companies: [{ companyId, companyName: 'GestãoNF', status: 'ACTIVE', role: 'OWNER', version: 1 }], version: 'a'.repeat(64) }], total: 1 });
    if (path === `/accounts/${accountId}/user-invitations` && request.method() === 'POST') { body = request.postDataJSON(); return reply({ id: inviteId, ...body, status: 'PENDING' }); }
    return reply({});
  });
  await page.goto('/usuarios');
  await expect(page.getByRole('heading', { name: 'Usuários e convites' })).toBeVisible();
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convidar usuário' });
  await dialog.getByLabel('Nome').fill('Maria Silva');
  await dialog.getByLabel('E-mail').fill('maria@example.test');
  await dialog.getByLabel(/Filial/).check();
  await dialog.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Convite criado. O e-mail está na fila de envio.')).toBeVisible();
  expect(body).toEqual({ name: 'Maria Silva', email: 'maria@example.test', companyIds: [companyId, secondCompanyId] });
  await expect(page.getByText('4 de 5 vagas livres')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('link de convite cria senha e abre a sessão', async ({ page }) => {
  const errors: string[] = [], token = 'A'.repeat(43);
  let accepted = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**:3000/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const reply = (json: unknown) => route.fulfill({ json, headers: cors });
    if (request.method() === 'OPTIONS') return reply({});
    if (path === '/user-invitations/preview') { expect(request.postDataJSON()).toEqual({ token }); return reply({ invitationId: inviteId, name: 'Maria', accountName: 'GestãoNF', email: 'm***@example.test', companies: [{ id: companyId, name: 'GestãoNF' }], expiresAt: '2026-10-14T18:00:00Z', nextStep: 'DEFINE_PASSWORD' }); }
    if (path === '/user-invitations/accept-new') { expect(request.postDataJSON()).toEqual({ token, password: 'senha-bem-longa-123', passwordConfirmation: 'senha-bem-longa-123', client: 'web' }); accepted = true; return reply({ user: { id: 'member', name: 'Maria', email: 'maria@example.test' } }); }
    return reply({});
  });
  await page.goto(`/aceitar-convite#token=${token}`);
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible();
  await page.getByLabel('Nova senha').fill('senha-bem-longa-123');
  await page.getByLabel('Confirmar senha').fill('senha-bem-longa-123');
  await page.getByRole('button', { name: 'Criar conta e aceitar convite' }).click();
  await expect(page.getByRole('heading', { name: 'Você já faz parte da equipe' })).toBeVisible();
  expect(accepted).toBe(true);
  expect(new URL(page.url()).hash).toBe('');
  expect(errors).toEqual([]);
});

test('conta existente entra com o e-mail convidado antes de aceitar', async ({ page }) => {
  const token = 'B'.repeat(43);
  const calls: string[] = [];
  await page.route('**:3000/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const reply = (json: unknown) => route.fulfill({ json, headers: cors });
    if (request.method() === 'OPTIONS') return reply({});
    if (path === '/user-invitations/preview') return reply({ invitationId: inviteId, name: 'Pedro', accountName: 'GestãoNF', email: 'p***@example.test', companies: [{ id: companyId, name: 'GestãoNF' }], expiresAt: '2026-10-14T18:00:00Z', nextStep: 'LOGIN' });
    if (path === '/auth/login') { calls.push('login'); expect(request.postDataJSON()).toMatchObject({ email: 'pedro@example.test', password: 'senha-existente-123' }); return reply({ user: { id: 'member', name: 'Pedro', email: 'pedro@example.test' } }); }
    if (path === '/user-invitations/accept-existing') { calls.push('accept'); expect(request.postDataJSON()).toEqual({ token }); return reply({ accepted: true, invitationId: inviteId }); }
    return reply({});
  });
  await page.goto(`/aceitar-convite#token=${token}`);
  await expect(page.getByRole('heading', { name: 'Entre com sua conta' })).toBeVisible();
  await page.getByLabel('E-mail').fill('pedro@example.test');
  await page.getByLabel('Senha').fill('senha-existente-123');
  await page.getByRole('button', { name: 'Entrar e aceitar convite' }).click();
  await expect(page.getByRole('heading', { name: 'Você já faz parte da equipe' })).toBeVisible();
  expect(calls).toEqual(['login', 'accept']);
});
