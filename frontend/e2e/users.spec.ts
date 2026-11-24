import { expect, test } from '@playwright/test';
import { ALL_PERMISSIONS } from '@gestaonf/permissions';
import type { AccessInput, ManagedMember } from '../src/api/client';
import { localWebOrigin } from './origin';
import { ownerCompany } from './companies';

const companyId = '11111111-1111-4111-8111-111111111111';
const secondCompanyId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const inviteId = '44444444-4444-4444-8444-444444444444';
const cors = { 'access-control-allow-origin': localWebOrigin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS' };

test('titular convida usuário para duas empresas e vê reservas por empresa', async ({ page }) => {
  const errors: string[] = [];
  let body: (AccessInput & { name: string; email: string }) | null = null;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:4030/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const reply = (json: unknown) => route.fulfill({ json, headers: cors });
    if (request.method() === 'OPTIONS') return reply({});
    if (path === '/auth/me') return reply({ id: 'owner', name: 'Titular', email: 'titular@example.test' });
    if (path === '/companies') return reply([ownerCompany(companyId, 'GestãoNF', accountId), ownerCompany(secondCompanyId, 'Filial', accountId)]);
    if (path === '/accounts') return reply([{ id: accountId, name: 'GestãoNF', status: 'ACTIVE', planCode: 'BASE', additionalUsersPerCompany: 5 }]);
    if (path === `/accounts/${accountId}/users/capacity`) return reply([{ companyId, name: 'GestãoNF', status: 'ACTIVE', limit: 5, occupied: 0, reserved: body ? 1 : 0, available: body ? 4 : 5, overLimit: 0 }, { companyId: secondCompanyId, name: 'Filial', status: 'ACTIVE', limit: 5, occupied: 0, reserved: body ? 1 : 0, available: body ? 4 : 5, overLimit: 0 }]);
    if (path === `/accounts/${accountId}/users` && request.method() === 'GET') return reply({ items: body ? [{ id: inviteId, type: 'INVITATION', name: body.name, email: body.email, roleLabel: body.roleLabel, permissions: body.permissions, status: 'PENDING', expiresAt: '2026-10-14T18:00:00Z', version: 1, createdAt: '2026-10-13T18:00:00Z', companies: [{ id: companyId, name: 'GestãoNF' }, { id: secondCompanyId, name: 'Filial' }], delivery: { id: 'mail', sendStatus: 'QUEUED' } }] : [{ id: 'owner', type: 'MEMBER', name: 'Titular', email: 'titular@example.test', status: 'OWNER', accountOwner: true, roleLabel: 'OWNER', permissions: [...ALL_PERMISSIONS], companies: [{ companyId, companyName: 'GestãoNF', status: 'ACTIVE', version: 1 }], version: 'a'.repeat(64) }], total: 1 });
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
  expect(body).toEqual({ name: 'Maria Silva', email: 'maria@example.test', companyIds: [companyId, secondCompanyId], roleLabel: 'COLLABORATOR', permissions: [] });
  await expect(page.getByText('4 de 5 vagas livres')).toHaveCount(2);
  expect(errors).toEqual([]);
});

const longEmail = `ana@${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(55)}.br`;
for (const [caseName, email] of [['curto', 'ana@example.test'], ['com 254 caracteres', longEmail]]) test(`convite para membro ativo preserva o rascunho e localiza o acesso existente (e-mail ${caseName})`, async ({ page }) => {
  const errors: string[] = [];
  const member: ManagedMember = {
    id: '55555555-5555-4555-8555-555555555555', type: 'MEMBER', name: 'Ana Silva', email, status: 'ACTIVE',
    accountOwner: false, roleLabel: 'MANAGER', permissions: ['customers.access'], version: 'b'.repeat(64),
    companies: [{ companyId, companyName: 'GestãoNF', status: 'ACTIVE', version: 1 }],
  };
  const blockedMessage = 'Este usuário já tem acesso nesta contratação. Abra o usuário na lista, marque a nova empresa e ajuste as permissões lá.';
  const searches: string[] = [], invitations: unknown[] = [], edits: unknown[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:4030/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status, headers: cors });
    if (request.method() === 'OPTIONS') return reply({});
    if (url.pathname === '/auth/me') return reply({ id: 'owner', name: 'Titular', email: 'titular@example.test' });
    if (url.pathname === '/companies') return reply([ownerCompany(companyId, 'GestãoNF', accountId), ownerCompany(secondCompanyId, 'Filial', accountId)]);
    if (url.pathname === '/accounts') return reply([{ id: accountId, name: 'GestãoNF', status: 'ACTIVE', planCode: 'BASE', additionalUsersPerCompany: 5 }]);
    if (url.pathname === `/accounts/${accountId}/users/capacity`) return reply([
      { companyId, name: 'GestãoNF', status: 'ACTIVE', limit: 5, occupied: 1, reserved: 0, available: 4, overLimit: 0 },
      { companyId: secondCompanyId, name: 'Filial', status: 'ACTIVE', limit: 5, occupied: 0, reserved: 0, available: 5, overLimit: 0 },
    ]);
    if (url.pathname === `/accounts/${accountId}/users`) {
      const search = url.searchParams.get('search') ?? '';
      searches.push(search);
      return reply(search === member.email ? { items: [member], total: 1 } : { items: [], total: 26 });
    }
    if (url.pathname === `/accounts/${accountId}/user-invitations` && request.method() === 'POST') {
      invitations.push(request.postDataJSON());
      return reply({ statusCode: 409, code: 'USER_ALREADY_LINKED', message: blockedMessage, userId: member.id }, 409);
    }
    if (url.pathname === `/accounts/${accountId}/users/${member.id}/access` && request.method() === 'PUT') {
      edits.push(request.postDataJSON());
      return reply({ userId: member.id, version: 'c'.repeat(64) });
    }
    return reply({ items: [] });
  });

  await page.goto('/usuarios');
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  const invite = page.getByRole('dialog', { name: 'Convidar usuário' });
  await invite.getByLabel('Nome').fill('Outra grafia');
  await invite.getByLabel('E-mail').fill(member.email.toUpperCase());
  await invite.getByLabel('Classificação').selectOption('OWNER');
  await invite.getByLabel(/Filial/).check();
  await invite.getByRole('button', { name: 'Permissões de usuário' }).click();
  const editor = page.getByRole('dialog', { name: 'Permissões de usuário' });
  await editor.getByRole('checkbox', { name: 'Acessar Serviços', exact: true }).check();
  await editor.getByRole('button', { name: 'Aplicar' }).click();
  await invite.getByRole('button', { name: 'Enviar convite' }).click();

  await expect(invite.getByRole('alert')).toContainText(blockedMessage);
  await expect(invite.getByRole('alert')).toBeFocused();
  await expect(invite.getByLabel('Nome')).toHaveValue('Outra grafia');
  await expect(invite.getByLabel('E-mail')).toHaveValue(member.email.toUpperCase());
  await expect(invite.getByLabel('Classificação')).toHaveValue('OWNER');
  await expect(invite.getByLabel(/Filial/)).toBeChecked();
  await expect(invite.getByText('1 permissão em 1 tópico')).toBeVisible();
  await expect(page.getByText('Convite criado. O e-mail está na fila de envio.')).toHaveCount(0);

  await invite.getByRole('button', { name: 'Localizar na lista' }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Buscar usuários' })).toHaveValue(member.email);
  await expect(page.getByRole('textbox', { name: 'Buscar usuários' })).toBeFocused();
  await page.locator('.users-row').filter({ hasText: member.email }).getByRole('button', { name: 'Editar acesso' }).click();
  const edit = page.getByRole('dialog', { name: 'Acesso de Ana Silva' });
  await expect(edit.getByLabel('Classificação')).toHaveValue('MANAGER');
  await expect(edit.getByLabel(/Filial/)).not.toBeChecked();
  await edit.getByLabel(/Filial/).check();
  await edit.getByRole('button', { name: 'Salvar acesso' }).click();
  await expect(page.getByText('Acesso atualizado.')).toBeVisible();
  expect(searches).toContain(member.email);
  expect(invitations).toEqual([{ name: 'Outra grafia', email: member.email, companyIds: [companyId, secondCompanyId], roleLabel: 'OWNER', permissions: ['services.access'] }]);
  expect(edits).toEqual([{ version: member.version, companyIds: [companyId, secondCompanyId], roleLabel: 'MANAGER', permissions: member.permissions }]);
  expect(errors).toEqual([]);
});

test('link de convite cria senha e abre a sessão', async ({ page }) => {
  const errors: string[] = [], token = 'A'.repeat(43);
  let accepted = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**:4030/**', async route => {
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
  await page.route('**:4030/**', async route => {
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
