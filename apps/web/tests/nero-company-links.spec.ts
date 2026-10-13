import { test, expect, type Page } from '@playwright/test';

const companyA = '11111111-1111-4111-8111-111111111111', companyB = '22222222-2222-4222-8222-222222222222';
const linkId = '33333333-3333-4333-8333-333333333333', challengeId = '44444444-4444-4444-8444-444444444444';

async function setup(page: Page) {
  const state = { linkedB: false, candidate: false, created: [] as { companyId: string; mode: string; linkId?: string }[], delay: null as Promise<void> | null };
  await page.addInitScript((id) => sessionStorage.setItem('gestaonf.companyId', id), companyA);
  await page.route('**:3000/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, target = request.headers()['x-company-id'];
    const fulfill = (data: unknown) => route.fulfill({ json: data, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5174', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' } });
    if (request.method() === 'OPTIONS') { await fulfill({}); return; }
    if (path === '/auth/me') { await fulfill({ id: 'operator', name: 'Operador', email: 'operator@example.test' }); return; }
    if (path === '/companies') { await fulfill([{ id: companyA, name: 'Empresa A', role: 'OWNER' }, { id: companyB, name: 'Empresa B', role: 'OWNER' }]); return; }
    if (path.endsWith('/link/status')) {
      const linked = target === companyA || state.linkedB;
      await fulfill({ configured: true, linked, connection: { displayPhoneNumber: '15550000000', environment: 'DEVELOPMENT' },
        link: linked ? { id: 'association', linkId, companyId: target, phoneE164: '5561990000001', verifiedAt: '2026-10-12T15:00:00Z' } : null,
        verifiedNumbers: [{ id: linkId, phoneE164: '5561990000001', verifiedAt: '2026-10-12T15:00:00Z' }] }); return;
    }
    if (path.endsWith('/link/challenges') && request.method() === 'POST') {
      state.created.push({ companyId: target, ...request.postDataJSON() });
      if (state.delay) await state.delay;
      const text = 'Quero vincular minha empresa Empresa B ao meu secretário virtual, meu código é temporary_test_token_1234.';
      await fulfill({ challengeId, expiresAt: '2099-01-01T00:00:00Z', waLink: `https://wa.me/15550000000?text=${encodeURIComponent(text)}`, displayPhoneNumber: '15550000000' }); return;
    }
    if (path.endsWith(`/challenges/${challengeId}`)) { await fulfill({ id: challengeId, status: state.candidate ? 'CANDIDATE' : 'PENDING', expiresAt: '2099-01-01T00:00:00Z', candidatePhoneE164: state.candidate ? '5561990000001' : null }); return; }
    if (path.endsWith('/confirm')) { state.linkedB = true; await fulfill({ linked: true, phoneE164: '5561990000001', verifiedAt: '2026-10-12T15:00:00Z' }); return; }
    if (path.endsWith('/whatsapp/link') && request.method() === 'DELETE') { expect(target).toBe(companyB); state.linkedB = false; await fulfill({}); return; }
    await fulfill({});
  });
  await page.goto('/nero');
  await expect(page.getByRole('heading', { name: 'WhatsApp vinculado a Empresa A' })).toBeVisible();
  return state;
}

async function switchCompany(page: Page, name: string) {
  await page.getByRole('button', { name: /^Empresa ativa:/ }).click();
  await page.locator('.company-picker__option').filter({ hasText: name }).click();
}

test('mesmo número pode ser vinculado a B sem mover A; desconexão é por empresa', async ({ page }) => {
  const state = await setup(page);
  await switchCompany(page, 'Empresa B');
  await expect(page.getByRole('button', { name: 'Vincular este número também' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vincular outro número' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar esta empresa' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/nero-company-links.png', fullPage: true });
  await page.getByRole('button', { name: 'Vincular este número também' }).click();
  await expect(page.getByRole('link', { name: 'Abrir no WhatsApp' })).toBeVisible();
  expect(state.created[0]).toEqual({ companyId: companyB, mode: 'EXISTING_NUMBER', linkId });
  await expect(page.getByRole('button', { name: 'Confirmar este número' })).toBeDisabled();
  state.candidate = true;
  await expect(page.getByRole('button', { name: 'Confirmar este número' })).toBeEnabled({ timeout: 6000 });
  await page.getByRole('button', { name: 'Confirmar este número' }).click();
  await expect(page.getByRole('heading', { name: 'WhatsApp vinculado a Empresa B' })).toBeVisible();
  await page.getByRole('button', { name: 'Desconectar nesta empresa' }).click();
  await expect(page.getByRole('button', { name: 'Vincular este número também' })).toBeVisible();
  await switchCompany(page, 'Empresa A');
  await expect(page.getByRole('heading', { name: 'WhatsApp vinculado a Empresa A' })).toBeVisible();
});

test('outro número usa challenge independente e os controles cabem no celular', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await switchCompany(page, 'Empresa B');
  await expect(page.getByRole('button', { name: 'Vincular outro número' })).toBeVisible();
  await page.getByRole('button', { name: 'Vincular outro número' }).click();
  await expect(page.getByRole('img', { name: /QR Code para vincular/ })).toBeVisible();
  expect(state.created[0]).toEqual({ companyId: companyB, mode: 'NEW_NUMBER' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'test-results/nero-company-links-mobile.png', fullPage: true });
});

test('resposta atrasada de um QR não aparece na empresa escolhida depois', async ({ page }) => {
  const state = await setup(page);
  await switchCompany(page, 'Empresa B');
  let release!: () => void;
  state.delay = new Promise<void>((resolve) => { release = resolve; });
  await page.getByRole('button', { name: 'Vincular este número também' }).click();
  await expect.poll(() => state.created.length).toBe(1);
  await switchCompany(page, 'Empresa A');
  release();
  await expect(page.getByRole('heading', { name: 'WhatsApp vinculado a Empresa A' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir no WhatsApp' })).toHaveCount(0);
});
