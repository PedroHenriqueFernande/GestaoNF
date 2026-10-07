import { expect, test } from '@playwright/test';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const email = `web-${crypto.randomUUID()}@example.com`;

test.afterAll(async () => {
  const sql = postgres(process.env.DATABASE_URL ?? '');
  try {
    const [user] = await sql`select id from users where email = ${email}`;
    if (!user) return;
    const memberships = await sql`select company_id from company_users where user_id = ${user.id}`;
    for (const membership of memberships) {
      await sql`delete from customers where company_id = ${membership.company_id}`;
      await sql`delete from company_users where company_id = ${membership.company_id}`;
      await sql`delete from companies where id = ${membership.company_id}`;
    }
    await sql`delete from auth_sessions where user_id = ${user.id}`;
    await sql`delete from user_credentials where user_id = ${user.id}`;
    await sql`delete from users where id = ${user.id}`;
  } finally { await sql.end(); }
});

test('cadastro, busca, edição, inativação e reativação de cliente', async ({ page }, testInfo) => {
  let customerListGets = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/customers') customerListGets += 1;
  });
  await page.goto('/Clientes');
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeVisible();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByLabel(/Seu nome/).fill('Pessoa de Teste');
  await page.getByLabel(/Nome da empresa/).fill('Empresa de Teste');
  await page.getByLabel(/E-mail/).fill(email);
  await page.getByLabel(/Senha/).fill('senha-segura-para-teste-123');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pesquisar clientes' })).toBeVisible();
  expect(customerListGets).toBe(0);
  await page.getByRole('textbox', { name: 'Buscar clientes' }).fill('Ana');
  await page.waitForTimeout(450);
  expect(customerListGets).toBe(0);
  await page.getByRole('textbox', { name: 'Buscar clientes' }).fill('');

  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const desktopDialog = await dialog.boundingBox();
  expect(desktopDialog).not.toBeNull();
  expect(Math.abs(desktopDialog!.x + desktopDialog!.width / 2 - 720)).toBeLessThan(2);
  expect(Math.abs(desktopDialog!.y + desktopDialog!.height / 2 - 450)).toBeLessThan(2);
  await dialog.getByLabel(/Nome completo/).fill('Ana Oliveira');
  await dialog.getByLabel('CPF').fill('11111111111');
  await dialog.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Cliente não foi salvo.');
  await expect(dialog).toBeVisible();
  expect(customerListGets).toBe(0);
  await dialog.getByLabel('CPF').fill('52998224725');
  await dialog.getByLabel('E-mail').fill('ana@example.com');
  await dialog.getByLabel('Telefone / WhatsApp').fill('11987654321');
  await dialog.getByRole('button', { name: 'Cadastrar cliente' }).click();
  const toast = page.locator('.action-toast');
  await expect(toast).toContainText('Cliente cadastrado');
  await expect(toast).toContainText('Cadastro de Ana Oliveira concluído.');
  await expect(toast.locator('svg, button')).toHaveCount(0);
  await expect(toast).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(toast).toHaveCSS('border-left-color', 'rgb(23, 107, 135)');
  const toastBox = await toast.boundingBox();
  expect(toastBox).not.toBeNull();
  expect(toastBox!.x).toBeGreaterThan(1100);
  expect(toastBox!.x + toastBox!.width).toBeGreaterThan(1400);
  expect(toastBox!.y).toBeGreaterThan(60);
  await expect(toast).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('notificacao-cliente.png'), fullPage: true });
  expect(customerListGets).toBe(0);
  await page.getByRole('button', { name: 'Pesquisar clientes' }).click();
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toBeVisible();
  expect(customerListGets).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  expect(customerListGets).toBe(1);
  await page.getByRole('button', { name: 'Pesquisar clientes' }).click();
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toBeVisible();
  expect(customerListGets).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('clientes-desktop.png'), fullPage: true });

  await page.getByRole('textbox', { name: 'Buscar clientes' }).fill('Ana');
  await page.getByRole('button', { name: 'Pesquisar clientes' }).click();
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar clientes' }).fill('529.982.247-25');
  await page.getByRole('button', { name: 'Pesquisar clientes' }).click();
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar clientes' }).fill('(11) 98765-4321');
  await page.getByRole('button', { name: 'Pesquisar clientes' }).click();
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar clientes' }).fill('Ana');
  await page.getByRole('button', { name: 'Pesquisar clientes' }).click();
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toBeVisible();
  expect(customerListGets).toBe(6);
  await page.getByRole('button', { name: 'Editar Ana Oliveira' }).click();
  await expect(dialog.getByRole('heading', { name: 'Editar cliente' })).toBeVisible();
  await dialog.getByLabel('Observações').fill('Cliente preferencial');
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(toast).toContainText('Alterações salvas');

  await page.getByRole('button', { name: 'Inativar Ana Oliveira' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Inativar cliente' }).click();
  await expect(toast).toContainText('Cliente inativado');
  await expect(toast).toContainText('movido para Inativos');
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toHaveCount(0);
  await expect(page.getByText('Nenhum cliente ativo encontrado.')).toBeVisible();
  expect(customerListGets).toBe(6);
  await page.getByRole('button', { name: 'Inativos', exact: true }).click();
  expect(customerListGets).toBe(6);
  await page.getByRole('button', { name: 'Pesquisar clientes' }).click();
  await expect(page.getByRole('row', { name: /Ana Oliveira/ }).getByText('Inativo')).toBeVisible();
  expect(customerListGets).toBe(7);
  await page.getByRole('button', { name: 'Reativar Ana Oliveira' }).click();
  await expect(toast).toContainText('Cliente reativado');
  await expect(toast).toContainText('movido para Ativos');
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ativos', exact: true }).click();
  expect(customerListGets).toBe(7);
  await page.getByRole('button', { name: 'Pesquisar clientes' }).click();
  await expect(page.getByRole('row', { name: /Ana Oliveira/ })).toBeVisible();
  expect(customerListGets).toBe(8);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  const mobileCustomer = page.getByRole('article').filter({ hasText: 'Ana Oliveira' });
  await expect(mobileCustomer).toBeVisible();
  await expect(mobileCustomer.getByRole('button', { name: 'Editar' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('clientes-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const mobileDialog = await dialog.boundingBox();
  expect(mobileDialog).not.toBeNull();
  expect(Math.abs(mobileDialog!.x + mobileDialog!.width / 2 - 195)).toBeLessThan(2);
  expect(mobileDialog!.y).toBeGreaterThan(0);
  await dialog.getByLabel('Observações').scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Cadastrar cliente' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('formulario-mobile.png'), fullPage: true });
});
