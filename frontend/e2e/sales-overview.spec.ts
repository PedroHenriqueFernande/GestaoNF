import { expect, test, type Page } from '@playwright/test';
import { localWebOrigin } from './origin';
import { memberCompany, ownerCompany } from './companies';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const companies = [
  ownerCompany(A, 'Alfa Serviços', 'acc1'),
  ownerCompany(B, 'Beta Consultoria', 'acc2'),
  memberCompany(C, 'Cinza Obras', 'acc1', ['sales.access', 'finance.access'], 'MANAGER'),
];
const saleId = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const sale = (n: number, companyId: string, status = 'CONFIRMED') => ({ id: saleId(n), companyId, orderCode: '14872', workOrderNumber: null, customerId: 'cust', customerNameSnapshot: `Cliente ${n}`,
  customerKindSnapshot: 'PF', customerTaxIdSnapshot: null, status, soldOn: '2026-11-10', subtotalAmount: '100.00', discountAmount: '0.00', totalAmount: '100.00', notes: null, version: 1,
  createdAt: '2026-11-10T12:00:00Z', confirmedAt: status === 'CONFIRMED' ? '2026-11-10T12:00:00Z' : null, canceledAt: status === 'CANCELED' ? '2026-11-10T13:00:00Z' : null, createdByUserName: 'Pedro' });
type Calls = { overview: URLSearchParams[]; single: (string | undefined)[]; details: { path: string; companyId: string | undefined }[]; finance: (string | undefined)[]; posts: number; customers: (string | undefined)[]; overviewStatus: number };
const newCalls = (): Calls => ({ overview: [], single: [], details: [], finance: [], posts: 0, customers: [], overviewStatus: 200 });
const view = (page: Page) => page.evaluate(() => ({ view: sessionStorage.getItem('gestaonf.companyView'), active: sessionStorage.getItem('gestaonf.companyId') }));

async function mockApi(page: Page, calls: Calls, companyList = companies) {
  await page.addInitScript(id => { if (!sessionStorage.getItem('gestaonf.companyId')) sessionStorage.setItem('gestaonf.companyId', id); }, A);
  const cors = { 'access-control-allow-origin': localWebOrigin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS' };
  await page.route('**:4030/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), companyId = request.headers()['x-company-id'];
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json, headers: cors });
    if (method === 'OPTIONS') return reply({});
    if (url.pathname === '/auth/me') return reply({ id: 'user', name: 'Pedro', email: 'pedro@example.test', avatarId: null, profileVersion: 1 });
    if (url.pathname === '/companies') return reply(companyList);
    if (url.pathname === '/companies/logos/access') return reply({ items: [] });
    if (url.pathname === '/sales/overview') {
      calls.overview.push(url.searchParams);
      if (calls.overviewStatus !== 200) return reply({ message: 'Sem acesso a uma ou mais empresas selecionadas' }, calls.overviewStatus);
      const status = url.searchParams.get('status') ?? 'ALL';
      return reply({ items: [sale(1, A, 'CANCELED'), sale(2, B, 'CANCELED'), sale(3, B, 'DRAFT')], total: 3, limit: 20, offset: 0, summary: { amount: '1284.86', excludesCanceled: status === 'ALL' }, companyIds: [A, B] });
    }
    if (url.pathname === '/sales' && method === 'GET') { calls.single.push(companyId); return reply({ items: [sale(9, companyId ?? A)], total: 1, limit: 20, offset: 0 }); }
    if (url.pathname === '/sales' && method === 'POST') { calls.posts++; return reply({ message: 'não esperado' }, 500); }
    if (url.pathname.startsWith('/sales/')) {
      calls.details.push({ path: url.pathname, companyId });
      const n = Number(url.pathname.slice(-1));
      return reply({ ...sale(n, companyId!, n === 3 ? 'DRAFT' : 'CANCELED'), items: [], installments: [], attachments: [], receivables: [] });
    }
    if (url.pathname === '/customers') calls.customers.push(companyId);
    if (url.pathname === '/fiscal/tax-profiles') return reply([]);
    if (url.pathname.startsWith('/finance')) { calls.finance.push(companyId); return reply({ items: [], total: 0 }); }
    return reply({ items: [], total: 0 });
  });
}

test('seletor: Ver todas, rascunho descartado com Esc, selecionadas e volta para uma empresa', async ({ page }) => {
  await mockApi(page, newCalls());
  await page.goto('/portal-de-servicos');
  const menu = page.locator('#workspace-company-menu');
  await page.getByRole('button', { name: /Empresa ativa: Alfa Serviços/ }).click();
  await menu.getByRole('button', { name: 'Ver todas as empresas' }).click();
  const allTrigger = page.getByRole('button', { name: 'Visão: todas as empresas (3). Trocar empresas' });
  await expect(allTrigger).toBeVisible();
  await expect(allTrigger).toContainText('Todas as empresas');
  await expect(page.locator('.header-company__stack .header-company__badge')).toHaveCount(3);
  expect(await view(page)).toEqual({ view: expect.stringContaining('"mode":"all"'), active: A });
  await allTrigger.click();
  const cinza = menu.getByRole('checkbox', { name: 'Incluir Cinza Obras na visão' });
  await expect(cinza).toBeChecked();
  await cinza.uncheck();
  await page.keyboard.press('Escape');
  await expect(allTrigger).toBeFocused();
  await allTrigger.click();
  await expect(cinza).toBeChecked(); // rascunho descartado
  await cinza.uncheck();
  await menu.getByRole('button', { name: 'Ver selecionadas (2)' }).click();
  const twoTrigger = page.getByRole('button', { name: 'Visão: 2 empresas selecionadas. Trocar empresas' });
  await expect(twoTrigger).toContainText('2 empresas');
  await twoTrigger.click();
  await menu.getByRole('button', { name: /Beta Consultoria/ }).click();
  await expect(page.getByRole('button', { name: /Empresa ativa: Beta Consultoria/ })).toBeVisible();
  expect(await view(page)).toEqual({ view: null, active: B });
});

test('seletor: setas nos itens, Tab e Space nos checkboxes, Enter aplica', async ({ page }) => {
  await mockApi(page, newCalls());
  await page.goto('/portal-de-servicos');
  const menu = page.locator('#workspace-company-menu');
  await page.getByRole('button', { name: /Empresa ativa: Alfa Serviços/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('button', { name: 'Ver todas as empresas' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('button', { name: /^Alfa Serviços/ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  const alfaCheck = menu.getByRole('checkbox', { name: 'Incluir Alfa Serviços na visão' });
  await expect(alfaCheck).toBeFocused();
  // Seta a partir do checkbox segue a ordem do painel.
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('button', { name: /^Alfa Serviços/ })).toBeFocused();
  await alfaCheck.focus();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('button', { name: 'Ver todas as empresas' })).toBeFocused();
  await alfaCheck.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const beta = menu.getByRole('checkbox', { name: 'Incluir Beta Consultoria na visão' });
  await expect(beta).toBeFocused();
  await page.keyboard.press('Space');
  await expect(beta).toBeChecked();
  await menu.getByRole('button', { name: 'Ver selecionadas (2)' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Visão: 2 empresas selecionadas. Trocar empresas' })).toBeFocused();
});

test('seletor fora do Portal: seleção única, empresa ativa e visão preservada', async ({ page }) => {
  const calls = newCalls();
  await mockApi(page, calls);
  await page.goto('/portal-de-servicos');
  await page.getByRole('button', { name: /Empresa ativa/ }).click();
  await page.locator('#workspace-company-menu').getByRole('button', { name: 'Ver todas as empresas' }).click();
  await page.goto('/financeiro');
  const trigger = page.getByRole('button', { name: /Empresa ativa: Alfa Serviços/ });
  await expect(trigger).toBeVisible();
  await expect.poll(() => calls.finance.length).toBeGreaterThan(0);
  expect(new Set(calls.finance)).toEqual(new Set([A]));
  await trigger.click();
  const menu = page.locator('#workspace-company-menu');
  await expect(menu.getByRole('checkbox')).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Ver todas as empresas' })).toHaveCount(0);
  await menu.getByRole('button', { name: /Beta Consultoria/ }).click();
  await expect(page.getByRole('button', { name: /Empresa ativa: Beta Consultoria/ })).toBeVisible();
  expect(await view(page)).toEqual({ view: expect.stringContaining('"mode":"all"'), active: B });
  await page.goto('/portal-de-servicos');
  await expect(page.getByRole('button', { name: 'Visão: todas as empresas (3). Trocar empresas' })).toBeVisible();
});

const openPicker = (page: Page) => page.getByRole('button', { name: /^(Empresa ativa|Visão):/ }).click();
const menuOf = (page: Page) => page.locator('#workspace-company-menu');

test('Ver todas oferece só empresas com sales.access (critério 11)', async ({ page }) => {
  const calls = newCalls();
  await mockApi(page, calls, [
    memberCompany(A, 'Alfa Serviços', 'acc1', ['sales.access']),
    memberCompany(B, 'Beta Consultoria', 'acc2', ['sales.access']),
    memberCompany(C, 'Cinza Obras', 'acc3', ['customers.access']),
  ]);
  await page.goto('/portal-de-servicos');
  await openPicker(page);
  await expect(menuOf(page).getByRole('checkbox', { name: 'Incluir Alfa Serviços na visão' })).toBeVisible();
  await expect(menuOf(page).getByRole('checkbox', { name: 'Incluir Beta Consultoria na visão' })).toBeVisible();
  await expect(menuOf(page).getByRole('checkbox', { name: 'Incluir Cinza Obras na visão' })).toHaveCount(0);
  await expect(menuOf(page).getByRole('button', { name: /^Cinza Obras/ })).toBeVisible();
  await menuOf(page).getByRole('button', { name: 'Ver todas as empresas' }).click();
  await expect(page.getByRole('button', { name: 'Visão: todas as empresas (2). Trocar empresas' })).toBeVisible();
  await expect.poll(() => calls.overview.at(-1)?.get('companies')).toBe('all');
});

test('lista consolidada: empresa por linha, total por aba e volta à lista por empresa', async ({ page }) => {
  const calls = newCalls();
  await mockApi(page, calls);
  await page.goto('/portal-de-servicos');
  await expect(page.locator('.sales-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.sales-company')).toHaveCount(0);
  await expect(page.locator('.sales-ledger__sum')).toHaveCount(0);
  await openPicker(page);
  await menuOf(page).getByRole('button', { name: 'Ver todas as empresas' }).click();
  await expect.poll(() => calls.overview.length).toBeGreaterThan(0);
  expect(calls.overview.at(-1)!.get('companies')).toBe('all');
  expect(calls.overview.at(-1)!.get('companyIds')).toBeNull();
  const rows = page.locator('.sales-table tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('.sales-company')).toHaveAttribute('title', 'Alfa Serviços');
  await expect(rows.nth(1).locator('.sales-company__name')).toHaveText('Beta Consultoria');
  await expect(rows.nth(0).getByRole('button', { name: 'Abrir pedido 14872 de Alfa Serviços' })).toBeVisible();
  await expect(page.locator('.sales-ledger__sum')).toHaveText(/Total sem excluídas: R\$\s1\.284,86/);
  await page.getByRole('button', { name: 'Excluídas', exact: true }).click();
  await expect(page.locator('.sales-ledger__sum')).toHaveText(/Total excluído: R\$\s1\.284,86/);
  expect(calls.overview.at(-1)!.get('status')).toBe('CANCELED');
  await openPicker(page);
  await menuOf(page).getByRole('checkbox', { name: 'Incluir Cinza Obras na visão' }).uncheck();
  await menuOf(page).getByRole('button', { name: 'Ver selecionadas (2)' }).click();
  await expect.poll(() => calls.overview.at(-1)!.get('companyIds')).toBe([A, B].sort().join(','));
  await openPicker(page);
  await menuOf(page).getByRole('button', { name: /^Alfa Serviços/ }).click();
  await expect(page.locator('.sales-company')).toHaveCount(0);
  await expect(page.locator('.sales-ledger__sum')).toHaveCount(0);
  expect(calls.single.at(-1)).toBe(A);
});

test('lista consolidada no celular: foto e nome no card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, newCalls());
  await page.goto('/portal-de-servicos');
  await openPicker(page);
  await menuOf(page).getByRole('button', { name: 'Ver todas as empresas' }).click();
  const cards = page.locator('.sales-mobile-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(1).locator('.sales-company__logo')).toBeVisible();
  await expect(cards.nth(1).locator('.sales-mobile-card__company')).toHaveText('Beta Consultoria');
});

const applyAll = async (page: Page) => { await openPicker(page); await menuOf(page).getByRole('button', { name: 'Ver todas as empresas' }).click(); };

test('abrir pedido usa a empresa da linha e não troca a visão', async ({ page }) => {
  const calls = newCalls();
  await mockApi(page, calls);
  await page.goto('/portal-de-servicos');
  await applyAll(page);
  await page.getByRole('button', { name: 'Abrir pedido 14872 de Beta Consultoria' }).first().click();
  await expect.poll(() => calls.details.find(d => d.path === `/sales/${saleId(2)}`)?.companyId).toBe(B);
  expect(await view(page)).toEqual({ view: expect.stringContaining('"mode":"all"'), active: A });
  await expect(page.getByRole('button', { name: /^Visão: todas as empresas/ })).toBeVisible();
});

test('link direto para pedido de empresa da visão abre sem trocar a visão', async ({ page }) => {
  const calls = newCalls();
  await mockApi(page, calls);
  await page.goto('/portal-de-servicos');
  await applyAll(page);
  await page.goto(`/portal-de-servicos?editar=${saleId(2)}&empresa=${B}`);
  await expect.poll(() => calls.details.find(d => d.path === `/sales/${saleId(2)}`)?.companyId).toBe(B);
  expect(await view(page)).toEqual({ view: expect.stringContaining('"mode":"all"'), active: A });
});

test('link direto para empresa fora da visão aplica seleção única, mesmo que ela já seja a ativa', async ({ page }) => {
  const calls = newCalls();
  await mockApi(page, calls);
  await page.addInitScript(ids => sessionStorage.setItem('gestaonf.companyView', JSON.stringify({ userId: 'user', mode: 'selected', ids })), [B, C]);
  await page.goto(`/portal-de-servicos?editar=${saleId(1)}&empresa=${A}`);
  await expect(page.getByRole('button', { name: /^Empresa ativa: Alfa Serviços/ })).toBeVisible();
  expect(await view(page)).toEqual({ view: null, active: A });
  await expect.poll(() => calls.details.find(d => d.path === `/sales/${saleId(1)}`)?.companyId).toBe(A);
});

test('rascunho de outra empresa na visão consolidada abre o editor com a empresa da linha', async ({ page }) => {
  const calls = newCalls();
  await mockApi(page, calls);
  await page.goto('/portal-de-servicos');
  await applyAll(page);
  await page.getByRole('button', { name: 'Abrir pedido 14872 de Beta Consultoria' }).nth(1).click();
  await expect(page.getByRole('heading', { name: /Continuar pedido #14872/ })).toBeVisible();
  expect(calls.details.find(d => d.path === `/sales/${saleId(3)}`)?.companyId).toBe(B);
  await expect.poll(() => calls.customers.length).toBeGreaterThan(0);
  expect(new Set(calls.customers)).toEqual(new Set([B]));
  expect(await view(page)).toEqual({ view: expect.stringContaining('"mode":"all"'), active: A });
});

test('Nova venda: empresa vazia e obrigatória com várias; preenchida com uma', async ({ page }) => {
  const calls = newCalls();
  await mockApi(page, calls);
  await page.goto('/portal-de-servicos');
  await applyAll(page);
  await page.getByRole('button', { name: 'Nova venda de serviço' }).first().click();
  const companyField = page.locator('.sale-field', { hasText: 'Empresa' });
  await expect(companyField).not.toContainText('Alfa Serviços');
  await page.getByRole('button', { name: 'Registrar venda de serviço' }).click();
  await expect(page.getByText('Selecione a empresa e o cliente e adicione ao menos um serviço.')).toBeVisible();
  expect(calls.posts).toBe(0);
  await expect(page.getByRole('button', { name: /^Visão: todas as empresas/ })).toBeVisible();
  await page.getByRole('button', { name: 'Portal de Serviços' }).first().click();
  await openPicker(page);
  await menuOf(page).getByRole('button', { name: /^Alfa Serviços/ }).click();
  await page.getByRole('button', { name: 'Nova venda de serviço' }).first().click();
  await expect(companyField).toContainText('Alfa Serviços');
});

test('403 do overview volta para uma empresa com aviso', async ({ page }) => {
  const calls = newCalls(); calls.overviewStatus = 403;
  await mockApi(page, calls);
  await page.goto('/portal-de-servicos');
  await applyAll(page);
  await expect(page.getByRole('status')).toContainText('Algumas empresas não estão mais disponíveis');
  await expect(page.getByRole('button', { name: /^Empresa ativa: Alfa Serviços/ })).toBeVisible();
  expect((await view(page)).view).toBeNull();
});
