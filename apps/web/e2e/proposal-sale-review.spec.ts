import { expect, test } from '@playwright/test';

test('link da proposta abre revisão do pedido na empresa indicada', async ({ page }) => {
  const companyA = '11111111-1111-4111-8111-111111111111', companyB = '22222222-2222-4222-8222-222222222222';
  const saleId = '33333333-3333-4333-8333-333333333333', customerId = '44444444-4444-4444-8444-444444444444';
  const serviceId = '55555555-5555-4555-8555-555555555555';
  const requests: string[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyA);
  await page.route('**:3000/**', async route => {
    const req = route.request(), url = new URL(req.url());
    const send = (json: unknown) => route.fulfill({ json, headers: {
      'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    } });
    if (req.method() === 'OPTIONS') return send({});
    if (url.pathname === '/auth/me') return send({ id: 'user', name: 'Pedro', email: 'pedro@example.test' });
    if (url.pathname === '/companies') return send([{ id: companyA, name: 'Empresa A', role: 'OWNER' }, { id: companyB, name: 'Empresa B', role: 'OWNER' }]);
    if (url.pathname === `/sales/${saleId}`) {
      requests.push(req.headers()['x-company-id']);
      return send({ id: saleId, companyId: companyB, orderCode: '52663', workOrderNumber: null, customerId,
        customerNameSnapshot: 'Cliente da proposta', customerKindSnapshot: 'PF', customerTaxIdSnapshot: null,
        status: 'DRAFT', soldOn: null, subtotalAmount: '5000.00', discountAmount: '500.00', totalAmount: '4500.00',
        notes: 'Proposta P-000001', version: 1, createdAt: '2026-10-13T12:00:00Z', confirmedAt: null, installments: [],
        items: [{ id: 'item', serviceId, position: 1, serviceNameSnapshot: 'Implantação CRM', descriptionSnapshot: null,
          quantity: '1.0000', unitPrice: '5000.00', grossAmount: '5000.00', discountAmount: '500.00', totalAmount: '4500.00', performedOn: null }] });
    }
    if (url.pathname === '/companies/current') return send({ id: companyB, name: 'Empresa B', role: 'OWNER', timezone: 'America/Sao_Paulo' });
    if (url.pathname === '/customers') return send({ items: [{ id: customerId, name: 'Cliente da proposta', kind: 'PF', status: 'ACTIVE' }], total: 1 });
    if (url.pathname === '/services') return send({ items: [{ id: serviceId, name: 'Implantação CRM', status: 'ACTIVE', suggestedUnitPrice: '5000.00' }], total: 1 });
    return send({ items: [], total: 0 });
  });
  await page.goto(`/portal-de-servicos?editar=${saleId}&empresa=${companyB}`);
  await expect(page.getByRole('heading', { name: 'Continuar pedido #52663' })).toBeVisible();
  await expect(page.getByText('Implantação CRM', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Formas de pagamento' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('');
  expect(requests.length).toBeGreaterThan(0); expect(requests.every(c => c === companyB)).toBe(true); expect(errors).toEqual([]);
});
