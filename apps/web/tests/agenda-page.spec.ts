import { expect, test, type Page } from '@playwright/test';

const companyId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const leadId = '33333333-3333-4333-8333-333333333333';
const opportunityId = '44444444-4444-4444-8444-444444444444';
const meetingId = '55555555-5555-4555-8555-555555555555';
const lead = { id: leadId, companyId, name: 'Mariana Andrade', organizationName: 'Andrade Consultoria', email: 'mariana@example.test', phone: null, archivedAt: null };
const opportunity = { id: opportunityId, contactId: leadId, title: 'Implantação CRM', lead: { id: leadId, name: lead.name, organizationName: lead.organizationName } };

async function setup(page: Page, withConflict = false) {
  const requests: unknown[] = [];
  await page.addInitScript((id) => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:3000/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    const send = (body: unknown) => route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' } });
    if (req.method() === 'OPTIONS') return send({});
    if (url.pathname === '/auth/me') return send({ id: userId, name: 'Pedro', email: 'pedro@example.test' });
    if (url.pathname === '/companies') return send([{ id: companyId, name: 'GestãoNF', role: 'OWNER' }]);
    if (url.pathname === '/companies/current') return send({ id: companyId, name: 'GestãoNF', role: 'OWNER', timezone: 'America/Sao_Paulo' });
    if (url.pathname === '/crm/meetings/responsibles') return send({ items: [{ id: userId, name: 'Pedro' }] });
    if (url.pathname === '/crm/meetings/conflicts') return send({ hasConflict: withConflict, items: withConflict ? [{ id: meetingId, title: 'Outra reunião', startsAt: '2026-10-14T13:00:00Z', endsAt: '2026-10-14T14:00:00Z' }] : [] });
    if (url.pathname === '/crm/meetings' && req.method() === 'POST') { requests.push(req.postDataJSON()); return send({ meetingId, opportunityQualified: true }); }
    if (url.pathname === '/crm/meetings') return send({ items: [], total: 0, summary: { total: 0, scheduled: 0, completed: 0, canceled: 0, noShow: 0 }, limit: 100, offset: 0 });
    if (url.pathname === '/crm/notifications') return send({ items: [], total: 0 });
    if (url.pathname === '/crm/leads') return send({ items: [lead], total: 1 });
    if (url.pathname === '/crm/opportunities') return send({ items: [opportunity], total: 1, summary: { total: 1, knownAmounts: 0, estimatedAmount: '0.00' }, limit: 100, offset: 0 });
    if (url.pathname === '/crm/meeting-settings') return send({ companyId, qualifyOpportunityOnMeeting: true, defaultReminderMinutes: 30, conflictPolicy: 'WARN', version: 1 });
    return send({});
  });
  return requests;
}

test('agenda reunião vinculada ao card e confirma conflito quando necessário', async ({ page }) => {
  const requests = await setup(page, true);
  await page.goto(`/agenda?${new URLSearchParams({ contactId: leadId, opportunityId, name: lead.name, title: opportunity.title })}`);
  await expect(page.getByRole('heading', { name: 'Reuniões' })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Lead', { exact: true })).toHaveValue(lead.name);
  await dialog.getByLabel('Início').fill('2026-10-14T10:00');
  await dialog.getByLabel('Término').fill('2026-10-14T11:00');
  await dialog.getByRole('button', { name: 'Agendar reunião', exact: true }).click();
  await expect(page.getByText('Horário ocupado para este responsável')).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirmar sobreposição' }).click();
  await dialog.getByRole('button', { name: 'Agendar reunião', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ contactId: leadId, opportunityId, allowConflict: true, timezone: 'America/Sao_Paulo' });
});

test('agenda fica utilizável em tela estreita', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/agenda');
  await expect(page.getByRole('heading', { name: 'Reuniões' })).toBeVisible();
  await expect(page.getByText('Nenhuma reunião nesta semana')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('abre lembrete, conclui reunião e mostra histórico', async ({ page }) => {
  await setup(page);
  let status = 'SCHEDULED';
  let version = 1;
  const changed: unknown[] = [];
  const meeting = () => ({ id: meetingId, companyId, contactId: leadId, opportunityId, title: 'Apresentação da proposta', assignedUserId: userId,
    startsAt: '2026-10-14T13:00:00Z', endsAt: '2026-10-14T14:00:00Z', timezone: 'America/Sao_Paulo', modality: 'ONLINE', location: null,
    meetingUrl: 'https://meet.example.test/sala', description: null, notes: null, status, outcomeNotes: null, nextSteps: null, cancellationReason: null,
    version, createdAt: '2026-10-13T12:00:00Z', updatedAt: '2026-10-13T12:00:00Z', lead, responsible: { id: userId, name: 'Pedro' },
    opportunity: { id: opportunityId, title: opportunity.title, commercialStatus: 'QUALIFIED' }, participants: [], reminderMinutes: [30] });
  await page.route('**:3000/crm/notifications**', async (route) => {
    await route.fulfill({ json: route.request().method() === 'PATCH' ? { id: 'notification' } : { items: [{ id: 'notification', meetingId, title: 'Reunião agendada', body: 'Apresentação da proposta começa em breve.', createdAt: '2026-10-14T12:30:00Z', readAt: null }], total: 1 }, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5173', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id', 'access-control-allow-methods': 'GET, PATCH, OPTIONS' } });
  });
  await page.route(`**:3000/crm/meetings/${meetingId}**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/history')) return route.fulfill({ json: { items: [{ id: 'event', kind: 'CREATED', actorType: 'USER', occurredAt: '2026-10-13T12:00:00Z' }], total: 1 } });
    if (url.pathname.endsWith('/status')) { changed.push(route.request().postDataJSON()); status = 'COMPLETED'; version++; return route.fulfill({ json: meeting() }); }
    return route.fulfill({ json: meeting() });
  });
  await page.goto('/agenda');
  await page.getByRole('button', { name: '1 lembretes não lidos' }).click();
  await page.getByRole('button', { name: /Apresentação da proposta começa em breve/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Apresentação da proposta' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Concluir' }).click();
  await dialog.getByPlaceholder('Resultado da reunião').fill('Proposta aceita.');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog.getByText('Concluída')).toBeVisible();
  expect(changed).toHaveLength(1);
  expect(changed[0]).toMatchObject({ expectedVersion: 1, status: 'COMPLETED', outcomeNotes: 'Proposta aceita.' });
  await dialog.getByRole('tab', { name: 'Histórico' }).click();
  await expect(dialog.getByText('Reunião criada')).toBeVisible();
});
