import { expect, test, type Page } from '@playwright/test';

const companyId = '11111111-1111-4111-8111-111111111111';
const leadId = '22222222-2222-4222-8222-222222222222';
const opportunityId = '33333333-3333-4333-8333-333333333333';
const baseOpportunity = {
  id: opportunityId, companyId, contactId: leadId, pipelineId: 'pipeline', stageId: 'stage', title: 'Implantação do GestãoNF',
  primaryServiceId: null, estimatedAmount: '8500.00', expectedCloseOn: '2026-10-30', commercialStatus: 'NEW', assignedUserId: null,
  reasonCode: null, reasonText: null, closedAt: null, lastActivityAt: '2026-10-13T12:00:00.000Z', createdAt: '2026-10-13T12:00:00.000Z',
  updatedAt: '2026-10-13T12:00:00.000Z', archivedAt: null, version: 1,
  lead: { id: leadId, name: 'Mariana Andrade', organizationName: 'Andrade Consultoria' },
  origin: { id: 'entry', contactId: leadId, captureKind: 'FORM', sourceFormReference: null, primaryServiceId: null, interestDescription: 'Gestão comercial', sourceLabel: 'Landing page', utmSource: 'instagram', utmMedium: 'paid_social', utmCampaign: 'crm_outubro', utmContent: null, utmTerm: null, occurredAt: '2026-10-13T12:00:00.000Z', receivedAt: '2026-10-13T12:00:00.000Z' },
};

async function setup(page: Page) {
  await page.addInitScript((id) => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:3000/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const fulfill = (json: unknown) => route.fulfill({ json, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' } });
    if (request.method() === 'OPTIONS') { await fulfill({}); return; }
    if (url.pathname === '/auth/me') { await fulfill({ id: 'user', name: 'Pedro Henrique', email: 'pedro@example.test' }); return; }
    if (url.pathname === '/companies') { await fulfill([{ id: companyId, name: 'GestãoNF', role: 'OWNER' }]); return; }
    if (url.pathname === '/services') { await fulfill({ items: [], total: 0, limit: 100, offset: 0 }); return; }
    if (url.pathname === `/crm/opportunities/${opportunityId}`) {
      await fulfill({ ...baseOpportunity, lead: { ...baseOpportunity.lead, companyId, email: 'mariana@example.com', phone: '5561999999999', taxId: null, taxIdKind: null, notes: 'Retornar na sexta-feira.', assignedUserId: null, customerId: null, version: 1, archivedAt: null, createdAt: '2026-10-13T12:00:00.000Z', updatedAt: '2026-10-13T12:00:00.000Z' } }); return;
    }
    if (url.pathname === '/crm/opportunities') {
      const status = url.searchParams.get('status');
      if (status) { await fulfill({ items: status === 'NEW' ? [baseOpportunity] : [], total: status === 'NEW' ? 1 : 0, limit: 1, offset: 0, summary: { total: status === 'NEW' ? 1 : 0, knownAmounts: status === 'NEW' ? 1 : 0, estimatedAmount: status === 'NEW' ? '8500.00' : '0.00' } }); return; }
      await fulfill({ items: [baseOpportunity], total: 1, limit: 20, offset: 0, summary: { total: 1, knownAmounts: 1, estimatedAmount: '8500.00' } }); return;
    }
    await fulfill({});
  });
  await page.goto('/crm');
}

test('exibe o banco de leads e abre criação e detalhe em modais centrais', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible();
  await expect(page.getByText('Mariana Andrade').first()).toBeVisible();
  await expect(page.getByText('R$ 8.500,00').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/crm-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Novo lead' }).click();
  await expect(page.getByRole('heading', { name: 'Adicionar lead' })).toBeVisible();
  const createBox = await page.getByRole('dialog').boundingBox();
  expect(createBox).not.toBeNull();
  expect(Math.abs((createBox!.x + createBox!.width / 2) - 720)).toBeLessThan(5);
  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.getByRole('button', { name: 'Mariana Andrade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mariana Andrade' })).toBeVisible();
  await expect(page.getByText('Retornar na sexta-feira.')).toBeVisible();
});

test('mantém a listagem utilizável no celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator('.crm-mobile-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/crm-mobile.png', fullPage: true });
});
