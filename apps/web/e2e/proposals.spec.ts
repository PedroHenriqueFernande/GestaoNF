import { expect, test } from '@playwright/test';

test('lead cria serviço, cliente e proposta; registra envio sem criar pedido', async ({ page }) => {
  const companyId = '11111111-1111-4111-8111-111111111111';
  const opportunityId = '22222222-2222-4222-8222-222222222222';
  const contactId = '33333333-3333-4333-8333-333333333333';
  const serviceId = '44444444-4444-4444-8444-444444444444';
  const proposalId = '55555555-5555-4555-8555-555555555555';
  const customerId = '66666666-6666-4666-8666-666666666666';
  const errors: string[] = [];
  let serviceCreated = false, proposalCreated = false, status = 'DRAFT', version = 1;
  let createBody: Record<string, unknown> | null = null;
  let sendBody: Record<string, unknown> | null = null;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:3000/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (json: unknown) => route.fulfill({ json, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' } });
    if (request.method() === 'OPTIONS') return reply({});
    if (url.pathname === '/auth/me') return reply({ id: 'user', name: 'Pedro', email: 'pedro@example.test' });
    if (url.pathname === '/companies') return reply([{ id: companyId, name: 'GestãoNF', role: 'OWNER' }]);
    if (url.pathname === '/crm/proposals/prefill') return reply({ contact: { id: contactId, name: 'Maria Silva', taxIdKind: null, taxId: null, email: 'maria@example.test', phone: null }, opportunity: { id: opportunityId, title: 'Implantação de CRM' }, customer: null, customerCandidates: [], customerDraft: { kind: null, name: 'Maria Silva', taxId: null, email: 'maria@example.test', phone: null }, service: null, suggestedItems: [], requiresCustomerDetails: true, requiresServiceSelection: true });
    if (url.pathname === '/services' && request.method() === 'POST') { serviceCreated = true; return reply({ id: serviceId, name: 'Consultoria CRM', description: null, unitLabel: 'UN', suggestedUnitPrice: '5000.00', status: 'ACTIVE' }); }
    if (url.pathname === '/services') return reply({ items: [], total: serviceCreated ? 101 : 100 });
    if (url.pathname === '/crm/proposals' && request.method() === 'POST') { createBody = request.postDataJSON(); proposalCreated = true; return reply({ proposalId, proposalCode: 'P-000001', customerId, status, version, totalAmount: '5000.00' }); }
    if (url.pathname === '/crm/proposals') return reply({ items: proposalCreated ? [{ id: proposalId, proposalCode: 'P-000001', title: 'Implantação de CRM', recipientName: 'Maria Silva', recipientOrganization: null, contactName: 'Maria Silva', totalAmount: '5000.00', effectiveStatus: status, validUntil: null, createdAt: '2026-10-13T10:00:00Z' }] : [], total: proposalCreated ? 1 : 0, limit: 20, offset: 0, summary: { total: proposalCreated ? 1 : 0, totalAmount: proposalCreated ? '5000.00' : '0.00', sent: status === 'SENT' ? 1 : 0, expired: 0, accepted: 0, converted: 0 } });
    if (url.pathname === `/crm/proposals/${proposalId}`) return reply({ id: proposalId, companyId, proposalNumber: 1, proposalCode: 'P-000001', contactId, opportunityId, customerId, title: 'Implantação de CRM', recipientName: 'Maria Silva', recipientOrganization: null, recipientEmail: 'maria@example.test', recipientTaxId: null, commercialDescription: null, paymentTerms: null, notes: null, terms: null, validUntil: null, subtotalAmount: '5000.00', discountAmount: '0.00', totalAmount: '5000.00', status, effectiveStatus: status, version, createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:00Z', sentAt: null, acceptedAt: null, declinedAt: null, convertedAt: null, declineReason: null, items: [{ id: 'item1', proposalId, serviceId, position: 1, serviceNameSnapshot: 'Consultoria CRM', descriptionSnapshot: null, unitLabelSnapshot: 'UN', quantity: '1.0000', unitPrice: '5000.00', discountType: 'AMOUNT', discountInput: '0.00', grossAmount: '5000.00', discountAmount: '0.00', totalAmount: '5000.00' }], sale: null });
    if (url.pathname === `/crm/proposals/${proposalId}/send`) { sendBody = request.postDataJSON(); status = 'SENT'; version += 1; return reply({ proposalId, proposalCode: 'P-000001', customerId, status, version, totalAmount: '5000.00' }); }
    return reply({ items: [], total: 0 });
  });
  await page.goto(`/propostas?negociacao=${opportunityId}`);
  await expect(page.getByRole('heading', { name: 'Construir proposta' })).toBeVisible();
  await expect(page.getByText('Este lead será cadastrado como cliente ao salvar a proposta.')).toBeVisible();
  await page.getByRole('button', { name: 'Novo serviço' }).click();
  await expect(page.getByRole('heading', { name: 'Novo serviço' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Novo serviço' }).getByLabel('Nome do serviço').fill('Consultoria CRM');
  await page.getByRole('dialog', { name: 'Novo serviço' }).getByLabel('Preço sugerido (R$)').fill('5000,00');
  await page.getByRole('button', { name: 'Cadastrar serviço' }).click();
  await expect(page.getByRole('dialog', { name: 'Novo serviço' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Construir proposta' }).getByRole('combobox', { name: 'Serviço', exact: true })).toHaveValue(serviceId);
  await page.getByRole('combobox', { name: 'Tipo de pessoa' }).selectOption('PF');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('dialog', { name: 'Construir proposta' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir P-000001' })).toBeVisible();
  expect(createBody).toMatchObject({ opportunityId, newCustomer: { kind: 'PF', name: 'Maria Silva' }, items: [{ serviceId, quantity: '1.0000', unitPrice: '5000.00' }] });
  await page.getByRole('button', { name: 'Abrir P-000001' }).click();
  await expect(page.getByRole('heading', { name: 'Implantação de CRM' })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar envio' }).click();
  await expect(page.getByText('Envio registrado. Compartilhe o PDF com o cliente.')).toBeVisible();
  expect(sendBody).toEqual({ expectedVersion: 1 });
  expect(errors).toEqual([]);
});

test('cliente existente cria nova proposta com contato escolhido', async ({ page }) => {
  const companyId = '11111111-1111-4111-8111-111111111111', customerId = '22222222-2222-4222-8222-222222222222';
  const contactId = '33333333-3333-4333-8333-333333333333', serviceId = '44444444-4444-4444-8444-444444444444';
  const proposalId = '55555555-5555-4555-8555-555555555555';
  let createBody: Record<string, unknown> | null = null;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:3000/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (json: unknown) => route.fulfill({ json, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' } });
    if (request.method() === 'OPTIONS') return reply({});
    if (url.pathname === '/auth/me') return reply({ id: 'user', name: 'Pedro', email: 'pedro@example.test' });
    if (url.pathname === '/companies') return reply([{ id: companyId, name: 'GestãoNF', role: 'OWNER' }]);
    if (url.pathname === '/crm/proposals/prefill') return reply({ customer: { id: customerId, name: 'Empresa Cliente', kind: 'PJ' }, contacts: [{ id: contactId, name: 'Ana' }, { id: '66666666-6666-4666-8666-666666666666', name: 'Bruno' }], opportunities: [], requiresOpportunityCreation: true });
    if (url.pathname === '/services') return reply({ items: [{ id: serviceId, name: 'Consultoria', description: null, unitLabel: 'UN', suggestedUnitPrice: '1500.00', status: 'ACTIVE' }], total: 1 });
    if (url.pathname === '/crm/proposals' && request.method() === 'POST') { createBody = request.postDataJSON(); return reply({ proposalId, proposalCode: 'P-000002', customerId, status: 'DRAFT', version: 1, totalAmount: '1500.00' }); }
    if (url.pathname === '/crm/proposals') return reply({ items: [], total: 0, summary: { total: 0, totalAmount: '0.00', sent: 0, expired: 0, accepted: 0, converted: 0 } });
    if (url.pathname === `/crm/proposals/${proposalId}`) return reply({ id: proposalId, companyId, proposalNumber: 2, proposalCode: 'P-000002', contactId, opportunityId: '77777777-7777-4777-8777-777777777777', customerId, title: 'Nova consultoria', recipientName: 'Empresa Cliente', recipientOrganization: null, recipientEmail: null, recipientTaxId: null, commercialDescription: null, paymentTerms: null, notes: null, terms: null, validUntil: null, subtotalAmount: '1500.00', discountAmount: '0.00', totalAmount: '1500.00', status: 'DRAFT', effectiveStatus: 'DRAFT', version: 1, createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:00Z', sentAt: null, acceptedAt: null, declinedAt: null, convertedAt: null, declineReason: null, items: [{ id: 'item1', proposalId, serviceId, position: 1, serviceNameSnapshot: 'Consultoria', descriptionSnapshot: null, unitLabelSnapshot: 'UN', quantity: '1.0000', unitPrice: '1500.00', discountType: 'AMOUNT', discountInput: '0.00', grossAmount: '1500.00', discountAmount: '0.00', totalAmount: '1500.00' }], sale: null });
    return reply({ items: [], total: 0 });
  });
  await page.goto(`/propostas?cliente=${customerId}`);
  await expect(page.getByRole('heading', { name: 'Construir proposta' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Título da proposta' }).fill('Nova consultoria');
  await page.getByRole('combobox', { name: 'Contato desta proposta' }).selectOption(contactId);
  await page.getByRole('combobox', { name: 'Serviço', exact: true }).selectOption(serviceId);
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('dialog', { name: 'Construir proposta' })).toHaveCount(0);
  await expect(page.getByText('Proposta criada e cliente vinculado.')).toBeVisible();
  expect(createBody).toMatchObject({ customerId, createOpportunity: true, contactId, items: [{ serviceId, unitPrice: '1500.00' }] });
  expect(createBody).not.toHaveProperty('newCustomer');
  expect(errors).toEqual([]);
});

test('novo lead pode cadastrar e selecionar serviço de interesse', async ({ page }) => {
  const companyId = '11111111-1111-4111-8111-111111111111', serviceId = '44444444-4444-4444-8444-444444444444';
  let serviceCreated = false;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:3000/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (json: unknown) => route.fulfill({ json, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' } });
    if (request.method() === 'OPTIONS') return reply({});
    if (url.pathname === '/auth/me') return reply({ id: 'user', name: 'Pedro', email: 'pedro@example.test' });
    if (url.pathname === '/companies') return reply([{ id: companyId, name: 'GestãoNF', role: 'OWNER' }]);
    if (url.pathname === '/services' && request.method() === 'POST') { serviceCreated = true; return reply({ id: serviceId, name: 'CRM novo', description: null, unitLabel: 'UN', suggestedUnitPrice: null, status: 'ACTIVE' }); }
    if (url.pathname === '/services') return reply({ items: [], total: serviceCreated ? 101 : 100 });
    return reply({ items: [], total: 0, summary: { total: 0, estimatedAmount: '0.00' } });
  });
  await page.goto('/crm');
  await page.getByRole('button', { name: 'Novo lead' }).click();
  await page.getByRole('button', { name: '+ Novo' }).click();
  await page.getByRole('dialog', { name: 'Novo serviço' }).getByLabel('Nome do serviço').fill('CRM novo');
  await page.getByRole('button', { name: 'Cadastrar serviço' }).click();
  await expect(page.getByRole('combobox', { name: 'Serviço de interesse' })).toHaveValue(serviceId);
  expect(errors).toEqual([]);
});
