import { expect, test } from '@playwright/test';

test('upload sem modal ao lado do total, download e anexos preservados ao salvar/reabrir', async ({ page }) => {
  const companyId = '11111111-1111-4111-8111-111111111111', saleId = '22222222-2222-4222-8222-222222222222';
  const customerId = '33333333-3333-4333-8333-333333333333', serviceId = '44444444-4444-4444-8444-444444444444';
  const oldFileId = '55555555-5555-4555-8555-555555555555', newFileId = '66666666-6666-4666-8666-666666666666';
  const oldFile = { id: oldFileId, companyId, saleId, fileName: 'Contrato.pdf', mimeType: 'application/pdf', sizeBytes: 400, status: 'READY', width: null, height: null, pageCount: 1, createdAt: '2026-10-13T12:00:00Z', readyAt: '2026-10-13T12:00:00Z' };
  const newFile = { ...oldFile, id: newFileId, saleId: null, fileName: 'foto.png', mimeType: 'image/png', sizeBytes: 68, width: 1, height: 1, pageCount: null };
  let attachments = [oldFile], version = 2;
  let beginBody: Record<string, unknown> | null = null, savedBody: Record<string, unknown> | null = null;
  let uploadHeaderCheck = false, completionStarted = false;
  let releaseComplete!: () => void;
  const completeGate = new Promise<void>(resolve => { releaseComplete = resolve; });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  const sale = () => ({ id: saleId, companyId, orderCode: '14872', workOrderNumber: null, customerId, customerNameSnapshot: 'Cliente do contrato', customerKindSnapshot: 'PF', customerTaxIdSnapshot: null,
    status: 'CONFIRMED', soldOn: '2026-10-13', subtotalAmount: '5000.00', discountAmount: '0.00', totalAmount: '5000.00', notes: null, version,
    createdAt: '2026-10-13T12:00:00Z', confirmedAt: '2026-10-13T12:00:00Z', attachments,
    items: [{ id: 'item', serviceId, position: 1, serviceNameSnapshot: 'Venda de CRM', descriptionSnapshot: null, quantity: '1.0000', unitPrice: '5000.00', grossAmount: '5000.00', discountAmount: '0.00', totalAmount: '5000.00', performedOn: null }],
    installments: [{ id: 'part', number: 1, paycode: '0476', paymentMethod: 'PIX', amount: '5000.00', dueOn: '2026-10-20', initialReceivedOn: null, paidAmount: '0.00', remainingAmount: '5000.00', paymentStatus: 'PENDING', movements: [] }] });
  await page.route('https://uploads.example.test/**', async route => {
    const headers = route.request().headers();
    const cors = { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-methods': 'PUT, OPTIONS', 'access-control-allow-headers': 'content-type, cache-control' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    expect(route.request().method()).toBe('PUT'); expect(headers['content-type']).toBe('image/png'); expect(headers['cache-control']).toBe('private, no-store');
    expect(headers).not.toHaveProperty('authorization'); expect(headers).not.toHaveProperty('cookie'); expect(headers).not.toHaveProperty('x-company-id');
    uploadHeaderCheck = true;
    await route.fulfill({ status: 200, headers: cors });
  });
  await page.route('https://downloads.example.test/**', route => route.fulfill({ body: '%PDF-1.7 test', headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="Contrato.pdf"' } }));
  await page.route('**:3000/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (json: unknown) => route.fulfill({ json, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' } });
    if (request.method() === 'OPTIONS') return reply({});
    if (url.pathname === '/auth/me') return reply({ id: 'user', name: 'Pedro', email: 'pedro@example.test' });
    if (url.pathname === '/companies') return reply([{ id: companyId, name: 'GestãoNF', role: 'OWNER' }]);
    if (url.pathname === '/files/capabilities') return reply({ enabled: true, mimeTypes: ['image/png', 'image/jpeg', 'application/pdf'], imageMaxBytes: 10485760, pdfMaxBytes: 26214400, maxAttachments: 10, uploadTtlSeconds: 600 });
    if (url.pathname === '/files/uploads') { beginBody = request.postDataJSON(); expect(request.headers()['idempotency-key']).toBeTruthy(); expect(request.headers()['x-company-id']).toBe(companyId); return reply({ file: { ...newFile, status: 'PENDING' }, upload: { url: 'https://uploads.example.test/staging', method: 'PUT', headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }, expiresAt: '2026-10-13T13:00:00Z' } }); }
    if (url.pathname === `/files/${newFileId}/complete`) { completionStarted = true; await completeGate; return reply(newFile); }
    if (url.pathname === `/files/${oldFileId}/access`) return reply({ url: 'https://downloads.example.test/contract', fileName: 'Contrato.pdf', expiresAt: '2026-10-13T13:00:00Z' });
    if (url.pathname === `/sales/${saleId}/confirmed`) { savedBody = request.postDataJSON(); attachments = [oldFile, { ...newFile, saleId }]; version++; return reply(sale()); }
    if (url.pathname === `/sales/${saleId}`) return reply(sale());
    if (url.pathname === '/sales') return reply({ items: [sale()], total: 1, limit: 20, offset: 0 });
    if (url.pathname === '/customers') return reply({ items: [{ id: customerId, name: 'Cliente do contrato', kind: 'PF', status: 'ACTIVE' }], total: 1 });
    if (url.pathname === '/services') return reply({ items: [{ id: serviceId, name: 'Venda de CRM', status: 'ACTIVE', suggestedUnitPrice: '5000.00' }], total: 1 });
    return reply({ items: [], total: 0 });
  });
  await page.goto(`/portal-de-servicos?editar=${saleId}`);
  await expect(page.getByRole('heading', { name: 'Editar venda #14872' })).toBeVisible();
  await expect(page.locator('.sale-editor-heading__actions').getByRole('button', { name: 'Anexar arquivo' })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar Contrato.pdf' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('Contrato.pdf');
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Anexar arquivo' }).click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
  await expect.poll(() => completionStarted).toBe(true);
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
  releaseComplete();
  await expect(page.getByRole('button', { name: 'Baixar foto.png' })).toBeVisible();
  expect(beginBody).toMatchObject({ fileName: 'foto.png', mimeType: 'image/png' }); expect(uploadHeaderCheck).toBe(true);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('heading', { name: 'Portal de Serviços' })).toBeVisible();
  expect(savedBody).toMatchObject({ attachmentIds: [oldFileId, newFileId] });
  await page.getByRole('button', { name: 'Abrir pedido 14872' }).click();
  await expect(page.getByRole('button', { name: 'Baixar foto.png' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar Contrato.pdf' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Anexar arquivo' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('seleção recusa extensão inválida e upload indisponível não bloqueia a venda', async ({ page }) => {
  const companyId = '11111111-1111-4111-8111-111111111111';
  let enabled = true, uploadRequests = 0;
  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:3000/**', async route => {
    const url = new URL(route.request().url());
    const reply = (json: unknown) => route.fulfill({ json, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key' } });
    if (route.request().method() === 'OPTIONS') return reply({});
    if (url.pathname === '/auth/me') return reply({ id: 'user', name: 'Pedro', email: 'pedro@example.test' });
    if (url.pathname === '/companies') return reply([{ id: companyId, name: 'GestãoNF', role: 'OWNER' }]);
    if (url.pathname === '/files/capabilities') return reply({ enabled, mimeTypes: ['image/png', 'image/jpeg', 'application/pdf'], imageMaxBytes: 10485760, pdfMaxBytes: 26214400, maxAttachments: 10, uploadTtlSeconds: 600 });
    if (url.pathname === '/files/uploads') uploadRequests++;
    return reply({ items: [], total: 0 });
  });
  await page.goto('/portal-de-servicos'); await page.getByRole('button', { name: 'Nova venda de serviço', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Anexar arquivo' })).toBeEnabled();
  await page.getByLabel('Selecionar anexos da venda').setInputFiles({ name: 'script.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toHaveText('Selecione um arquivo PNG, JPEG ou PDF.'); expect(uploadRequests).toBe(0);
  enabled = false; await page.reload(); await page.getByRole('button', { name: 'Nova venda de serviço', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Anexar arquivo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Registrar venda de serviço' })).toBeEnabled();
});
