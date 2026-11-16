import { expect, test, type Page } from '@playwright/test';
import { localWebOrigin } from './origin';

const companyA = '11111111-1111-4111-8111-111111111111', companyB = '22222222-2222-4222-8222-222222222222';
const logoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fileNew = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
type Role = 'OWNER' | 'COLLABORATOR';
type MockCompany = { id: string; name: string; role: Role; accountId: string; logoId: string | null };
type State = { companies: MockCompany[]; logoStatus: number; begins: number; puts: { logoId: string | null }[]; uploads: number; failApply: boolean; accessCalls: number; keys: string[]; failBegin: number; expireBegin: number; accessStatus: number };

const initialState = (logoId: string | null = logoA, role: Role = 'OWNER'): State => ({
  companies: [{ id: companyA, name: 'Alfa Serviços', role, accountId: 'acc', logoId }], logoStatus: 200, begins: 0, puts: [], uploads: 0, failApply: false, accessCalls: 0, keys: [], failBegin: 0, expireBegin: 0, accessStatus: 200,
});
const profile = (company: MockCompany) => ({ ...company, kind: 'PJ', legalName: null, tradeName: null, taxId: null, email: null, phone: null, street: null, number: null,
  complement: null, district: null, postalCode: null, cityName: null, cityIbgeCode: null, stateCode: null, countryCode: 'BR', municipalRegistration: null,
  stateRegistration: null, cnaeCode: null, simplesNationalOption: null, simplesTaxationRegime: null, simplesIbsCbsRegime: null, caepfCode: null,
  specialTaxRegime: null, timezone: 'America/Sao_Paulo', locale: 'pt-BR', status: 'ACTIVE', createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z' });

async function mockApi(page: Page, state: State) {
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyA);
  const cors = { 'access-control-allow-origin': localWebOrigin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS' };
  await page.route('https://uploads.example.test/**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': localWebOrigin, 'access-control-allow-methods': 'PUT, OPTIONS', 'access-control-allow-headers': 'content-type, cache-control' } });
    expect(route.request().headers()).not.toHaveProperty('cookie');
    state.uploads++;
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': localWebOrigin } });
  });
  await page.route('https://downloads.example.test/**', route => state.logoStatus === 200 ? route.fulfill({ body: pngBytes, headers: { 'content-type': 'image/png' } }) : route.fulfill({ status: state.logoStatus }));
  await page.route('**:4030/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json, headers: cors });
    if (method === 'OPTIONS') return reply({});
    const current = state.companies.find(c => c.id === request.headers()['x-company-id']);
    if (url.pathname === '/auth/me') return reply({ id: 'user', name: 'Pedro', email: 'pedro@example.test', avatarId: null, profileVersion: 1 });
    if (url.pathname === '/companies' && method === 'GET') return reply(state.companies);
    if (url.pathname === '/companies' && method === 'POST') {
      const created: MockCompany = { id: companyB, name: (request.postDataJSON() as { name: string }).name, role: 'OWNER', accountId: 'acc', logoId: null };
      state.companies.push(created); return reply(profile(created), 201);
    }
    if (url.pathname === '/companies/logos/access') {
      state.accessCalls++;
      // expiresAt usa o relógio real do Node de propósito, para divergir do page.clock.
      if (state.accessStatus !== 200) return reply({ message: 'Armazenamento temporariamente indisponível.' }, state.accessStatus);
      return reply({ items: state.companies.filter(c => c.logoId).map(c => ({ companyId: c.id, logoId: c.logoId, url: `https://downloads.example.test/${c.logoId}?v=${state.accessCalls}`, expiresAt: new Date(Date.now() + 120_000).toISOString(), expiresInSeconds: 120 })) });
    }
    if (url.pathname === '/companies/current' && method === 'GET' && current) return reply(profile(current));
    if (url.pathname === '/companies/current' && method === 'PATCH' && current) { current.name = (request.postDataJSON() as { name: string }).name; return reply(profile(current)); }
    if (url.pathname === '/companies/current/logo/uploads') {
      state.keys.push(request.headers()['idempotency-key']);
      if (state.failBegin > 0) { state.failBegin--; return reply({ message: 'Armazenamento temporariamente indisponível.' }, 503); }
      if (state.expireBegin > 0) { state.expireBegin--; return reply({ message: 'Reserva expirada. Selecione a imagem novamente.' }, 410); }
      state.begins++; expect(request.headers()['idempotency-key']).toBeTruthy(); expect(request.headers()['x-company-id']).toBe(current?.id);
      return reply({ file: { id: fileNew, status: 'PENDING' }, upload: { url: 'https://uploads.example.test/staging', method: 'PUT', headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }, expiresAt: new Date(Date.now() + 600_000).toISOString() } }, 201);
    }
    if (url.pathname === `/companies/current/logo/uploads/${fileNew}/complete`) return reply({ file: { id: fileNew, status: 'READY', mimeType: 'image/webp', width: 1080, height: 1080, sizeBytes: 1000, thumbnail: { width: 128, height: 128, sizeBytes: 100 } }, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    if (url.pathname === '/companies/current/logo' && method === 'PUT' && current) {
      const body = request.postDataJSON() as { logoId: string | null }; state.puts.push(body);
      if (state.failApply) { state.failApply = false; return reply({ message: 'Armazenamento temporariamente indisponível.' }, 503); }
      current.logoId = body.logoId; return reply(profile(current));
    }
    if (url.pathname === '/fiscal/certificate') return reply(null);
    return reply({ items: [], total: 0 });
  });
}

test('header: miniatura no gatilho e no dropdown, iniciais sem foto, uma única consulta em lote', async ({ page }) => {
  const state = initialState();
  state.companies.push({ id: companyB, name: 'Beta Consultoria', role: 'OWNER', accountId: 'acc', logoId: null });
  await mockApi(page, state);
  await page.goto('/empresa');
  const trigger = page.getByRole('button', { name: /Empresa ativa: Alfa Serviços/ });
  await expect(trigger.locator('.header-company__badge')).toHaveClass(/is-image/);
  await expect(trigger.locator('.header-company__badge img')).toHaveAttribute('src', /downloads\.example\.test\/aaaaaaaa/);
  await trigger.click();
  const menu = page.locator('#workspace-company-menu');
  await expect(menu.getByRole('button', { name: /Alfa Serviços/ }).locator('img')).toBeVisible();
  const beta = menu.getByRole('button', { name: /Beta Consultoria/ }).locator('.header-company__initials');
  await expect(beta).not.toHaveClass(/is-image/);
  await expect(beta.locator('img')).toHaveCount(0);
  expect(state.accessCalls).toBe(1);
});

test('header: imagem com erro renova uma vez e depois mostra iniciais, sem repetição', async ({ page }) => {
  const state = initialState(); state.logoStatus = 404;
  await mockApi(page, state);
  await page.goto('/empresa');
  const badge = page.getByRole('button', { name: /Empresa ativa/ }).locator('.header-company__badge');
  await expect.poll(() => state.accessCalls).toBeGreaterThanOrEqual(2);
  await expect(badge.locator('img')).toHaveCount(0);
  await expect(badge).not.toHaveClass(/is-image/);
  const calls = state.accessCalls;
  await page.waitForTimeout(1500); // asserção negativa: nenhuma nova renovação
  expect(state.accessCalls).toBe(calls);
  expect(calls).toBeLessThanOrEqual(2);
});

const choosePng = async (page: Page, trigger: () => Promise<void>) => {
  const chooser = page.waitForEvent('filechooser');
  await trigger();
  await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: pngBytes });
};
const headerBadge = (page: Page) => page.getByRole('button', { name: /Empresa ativa/ }).locator('.header-company__badge');

test('modal: envia por teclado, troca e remove; reflete no header e na lista', async ({ page }) => {
  const state = initialState(null);
  await mockApi(page, state);
  await page.goto('/empresa');
  await page.getByRole('button', { name: 'Abrir cadastro de Alfa Serviços' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Enviar foto' }).focus();
  await choosePng(page, () => page.keyboard.press('Enter'));
  await expect(dialog.getByText('Foto atualizada.')).toBeVisible();
  expect([state.begins, state.uploads]).toEqual([1, 1]);
  expect(state.puts).toEqual([{ logoId: fileNew }]);
  await expect(headerBadge(page).locator('img')).toHaveAttribute('src', /bbbbbbbb/);
  await expect(page.locator('.company-list__logo img')).toHaveAttribute('src', /bbbbbbbb/);
  await expect(dialog.getByRole('button', { name: 'Trocar foto' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remover foto' }).click();
  await expect(dialog.getByText('Foto removida.')).toBeVisible();
  expect(state.puts.at(-1)).toEqual({ logoId: null });
  await expect(headerBadge(page).locator('img')).toHaveCount(0);
});

test('modal: falha ao aplicar permite tentar de novo sem reenviar; clique duplo não duplica', async ({ page }) => {
  const state = initialState(null); state.failApply = true;
  await mockApi(page, state);
  await page.goto('/empresa');
  await page.getByRole('button', { name: 'Abrir cadastro de Alfa Serviços' }).click();
  const dialog = page.getByRole('dialog');
  await choosePng(page, () => dialog.getByRole('button', { name: 'Enviar foto' }).click());
  await expect(dialog.getByRole('alert')).toContainText('Armazenamento temporariamente indisponível');
  await dialog.getByRole('button', { name: 'Tentar novamente' }).dblclick();
  await expect(dialog.getByText('Foto atualizada.')).toBeVisible();
  expect([state.begins, state.uploads]).toEqual([1, 1]);
  expect(state.puts).toHaveLength(2);
});

test('modal: colaborador vê a foto e não tem ações', async ({ page }) => {
  await mockApi(page, initialState(logoA, 'COLLABORATOR'));
  await page.goto('/empresa');
  await page.getByRole('button', { name: 'Abrir cadastro de Alfa Serviços' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.company-logo-field img')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Enviar foto|Trocar foto|Remover foto/ })).toHaveCount(0);
});

test('cadastro: foto escolhida sobe logo após criar; falha mantém a empresa e permite tentar de novo', async ({ page }) => {
  const state = initialState(null); state.failApply = true;
  await mockApi(page, state);
  await page.goto('/empresa');
  await page.getByRole('button', { name: 'Novo' }).click();
  const dialog = page.getByRole('dialog');
  await choosePng(page, () => dialog.getByRole('button', { name: 'Escolher foto' }).click());
  await expect(dialog.getByRole('img', { name: 'Prévia da foto selecionada' })).toBeVisible();
  expect(state.begins).toBe(0);
  await dialog.getByLabel(/Nome de exibição/).fill('Beta Consultoria');
  await dialog.getByRole('button', { name: 'Cadastrar empresa' }).click();
  await expect(dialog.getByRole('alert')).toContainText('A empresa foi cadastrada, mas a foto não foi enviada');
  expect(state.companies.map(c => c.name)).toContain('Beta Consultoria');
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(dialog.getByText('Foto atualizada.')).toBeVisible();
  // Em dev o StrictMode repete o efeito: pode haver 2 reservas, sempre com a MESMA chave, e um único envio ao R2.
  expect(new Set(state.keys).size).toBe(1);
  expect(state.uploads).toBe(1);
  expect(state.puts.at(-1)).toEqual({ logoId: fileNew });
});

test('modal: falha na reserva (503) oferece "Tentar novamente" com a mesma chave', async ({ page }) => {
  const state = initialState(null); state.failBegin = 1;
  await mockApi(page, state);
  await page.goto('/empresa');
  await page.getByRole('button', { name: 'Abrir cadastro de Alfa Serviços' }).click();
  const dialog = page.getByRole('dialog');
  await choosePng(page, () => dialog.getByRole('button', { name: 'Enviar foto' }).click());
  await expect(dialog.getByRole('alert')).toContainText('Armazenamento temporariamente indisponível');
  // Troca de foto na edição: a mensagem de "empresa cadastrada" não se aplica.
  await expect(dialog.getByRole('alert')).not.toContainText('A empresa foi cadastrada');
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(dialog.getByText('Foto atualizada.')).toBeVisible();
  expect(state.keys).toHaveLength(2);
  expect(new Set(state.keys).size).toBe(1);
  expect(state.uploads).toBe(1);
});

test('modal: reserva expirada (410) gera uma chave nova na nova tentativa', async ({ page }) => {
  const state = initialState(null); state.expireBegin = 1;
  await mockApi(page, state);
  await page.goto('/empresa');
  await page.getByRole('button', { name: 'Abrir cadastro de Alfa Serviços' }).click();
  const dialog = page.getByRole('dialog');
  await choosePng(page, () => dialog.getByRole('button', { name: 'Enviar foto' }).click());
  await expect(dialog.getByRole('alert')).toContainText('Reserva expirada');
  await dialog.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(dialog.getByText('Foto atualizada.')).toBeVisible();
  expect(state.keys).toHaveLength(2);
  expect(new Set(state.keys).size).toBe(2);
  expect(state.uploads).toBe(1);
});

test('header: link de outra foto (logoId divergente) nunca é exibido e há no máximo uma renovação', async ({ page }) => {
  const state = initialState(logoA);
  await mockApi(page, state);
  // Registrada depois do mockApi, esta rota tem precedência: a lista devolve o logoId antigo da empresa.
  await page.route('**:4030/companies/logos/access', route => {
    state.accessCalls++;
    return route.fulfill({ json: { items: [{ companyId: companyA, logoId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', url: 'https://downloads.example.test/stale', expiresAt: new Date(Date.now() + 120_000).toISOString(), expiresInSeconds: 120 }] },
      headers: { 'access-control-allow-origin': localWebOrigin, 'access-control-allow-credentials': 'true' } });
  });
  await page.goto('/empresa');
  await expect.poll(() => state.accessCalls).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500); // asserção negativa: nenhuma renovação além da única permitida
  await expect(page.locator('img[src*="stale"]')).toHaveCount(0);
  await expect(headerBadge(page).locator('img')).toHaveCount(0);
  expect(state.accessCalls).toBe(2);
});

test('empresa com foto: salvar o formulário mantém a imagem no header, sem passar pelas iniciais', async ({ page }) => {
  const state = initialState(logoA);
  await mockApi(page, state);
  await page.goto('/empresa');
  await expect(headerBadge(page).locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir cadastro de Alfa Serviços' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.company-logo-field img')).toBeVisible();
  // Observa o badge do header durante o salvamento: a imagem não pode sumir nem por um instante.
  await page.evaluate(() => {
    const badge = document.querySelector('.header-company__badge')!;
    const w = window as unknown as { __logoLost: boolean };
    w.__logoLost = false;
    new MutationObserver(() => { if (!badge.querySelector('img')) w.__logoLost = true; }).observe(badge, { childList: true, subtree: true, attributes: true });
  });
  await dialog.getByLabel(/Nome de exibição/).fill('Alfa Serviços Renomeada');
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Dados da empresa atualizados com sucesso.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Empresa ativa: Alfa Serviços Renomeada/ }).locator('.header-company__badge img')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __logoLost: boolean }).__logoLost)).toBe(false);
});

test('header: relógio do navegador adiantado não renova os links em laço', async ({ page }) => {
  const state = initialState();
  await page.clock.install({ time: new Date(Date.now() + 10 * 60_000) });
  await mockApi(page, state);
  await page.goto('/empresa');
  const badge = page.getByRole('button', { name: /Empresa ativa/ }).locator('.header-company__badge');
  await expect(badge.locator('img')).toBeVisible();
  // Passos de 1 s dão tempo às respostas da rota (assíncronas em tempo real) entre um timer e outro.
  for (let second = 0; second < 240; second++) await page.clock.runFor(1_000);
  expect(state.accessCalls).toBeGreaterThanOrEqual(2);
  expect(state.accessCalls).toBeLessThanOrEqual(3);
});

test('header: renovação que falha espera 60 s entre tentativas e mantém a miniatura', async ({ page }) => {
  const state = initialState();
  await page.clock.install();
  await mockApi(page, state);
  await page.goto('/empresa');
  const badge = page.getByRole('button', { name: /Empresa ativa/ }).locator('.header-company__badge');
  await expect(badge.locator('img')).toBeVisible();
  state.accessStatus = 503;
  for (let second = 0; second < 240; second++) await page.clock.runFor(1_000);
  expect(state.accessCalls).toBeGreaterThanOrEqual(2);
  expect(state.accessCalls).toBeLessThanOrEqual(4);
  await expect(badge.locator('img')).toBeVisible();
});
