import { expect, test } from '@playwright/test';
import { localWebOrigin } from './origin';
import { ownerCompany } from './companies';

test('cadastro único salva cliente somente com nome', async ({ page }) => {
  const companyId = '11111111-1111-4111-8111-111111111111';
  let submitted: Record<string, unknown> | null = null;

  await page.addInitScript(id => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:4030/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (json: unknown) => route.fulfill({ json, headers: {
      'access-control-allow-origin': localWebOrigin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    } });

    if (request.method() === 'OPTIONS') return reply({});
    if (url.pathname === '/auth/me') return reply({ id: 'user', name: 'Pedro', email: 'pedro@example.test' });
    if (url.pathname === '/companies') return reply([ownerCompany(companyId, 'GestãoNF', 'acc')]);
    if (url.pathname === '/customers' && request.method() === 'POST') {
      submitted = request.postDataJSON();
      return reply({ id: '22222222-2222-4222-8222-222222222222', name: 'Maria Silva', kind: null, taxId: null, status: 'ACTIVE' });
    }
    if (url.pathname === '/customers') return reply({ items: [], total: 0, limit: 10, offset: 0 });
    return reply({});
  });

  await page.goto('/Clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).click();
  const form = page.getByRole('dialog', { name: 'Novo cliente' });
  await expect(form.getByRole('group', { name: 'Tipo de cliente' })).toHaveCount(0);
  await expect(form.getByRole('heading', { name: 'Identificação' })).toHaveCount(0);
  await expect(form.getByLabel('Nome', { exact: true })).toBeVisible();
  await expect(form.getByLabel('CPF/CNPJ')).toBeVisible();
  await expect(form.getByLabel('E-mail')).toBeVisible();
  await expect(form.getByLabel('Telefone / WhatsApp')).toBeVisible();
  await expect(form.getByLabel('Código IBGE')).toHaveCount(0);
  const nameBox = await form.getByLabel('Nome', { exact: true }).boundingBox();
  const documentBox = await form.getByLabel('CPF/CNPJ').boundingBox();
  const emailBox = await form.getByLabel('E-mail').boundingBox();
  const phoneBox = await form.getByLabel('Telefone / WhatsApp').boundingBox();
  const stateBox = await form.getByLabel('UF', { exact: true }).boundingBox();
  await expect(form.getByLabel('UF', { exact: true }).locator('option')).toHaveCount(28);
  const countryBox = await form.getByLabel('País do endereço').boundingBox();
  expect(nameBox && documentBox && emailBox && phoneBox && stateBox && countryBox).toBeTruthy();
  expect(documentBox!.x).toBeGreaterThan(nameBox!.x);
  expect(emailBox!.y).toBeGreaterThan(nameBox!.y);
  expect(phoneBox!.x).toBeGreaterThan(emailBox!.x);
  expect(countryBox!.y).toBeGreaterThan(phoneBox!.y);
  expect(countryBox!.x).toBeGreaterThan(stateBox!.x);

  await form.getByLabel('País do endereço').selectOption('US');
  await expect(form.getByLabel('Código postal no exterior')).toBeVisible();
  await expect(form.getByLabel('UF', { exact: true })).toHaveCount(0);
  await form.getByLabel('País do endereço').selectOption('BR');
  await expect(form.getByLabel('CEP', { exact: true })).toBeVisible();

  await form.getByLabel('CPF/CNPJ').fill('52998224725');
  await expect(form.getByLabel('CPF/CNPJ')).toHaveValue('529.982.247-25');
  await form.getByLabel('CPF/CNPJ').fill('11222333000181');
  await expect(form.getByLabel('CPF/CNPJ')).toHaveValue('11.222.333/0001-81');
  await form.getByLabel('CPF/CNPJ').clear();
  await form.getByLabel('Nome', { exact: true }).fill('Maria Silva');
  await form.getByRole('button', { name: 'Cadastrar cliente' }).click();

  await expect(form).toHaveCount(0);
  expect(submitted).toMatchObject({ name: 'Maria Silva', taxId: null });
  expect(submitted).not.toHaveProperty('kind');
  expect(submitted).not.toHaveProperty('tradeName');

  await page.route('https://viacep.com.br/ws/01001000/json/', route => route.fulfill({ json: {
    cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP', ibge: '3550308',
  } }));
  await page.getByRole('button', { name: 'Novo cliente' }).click();
  const addressForm = page.getByRole('dialog', { name: 'Novo cliente' });
  await addressForm.getByLabel('Nome', { exact: true }).fill('Ana Souza');
  await addressForm.getByLabel('CEP', { exact: true }).fill('01001-000');
  await addressForm.getByLabel('CEP', { exact: true }).press('Tab');
  await expect(addressForm.getByLabel('Logradouro')).toHaveValue('Praça da Sé');
  await expect(addressForm.getByLabel('Bairro')).toHaveValue('Sé');
  await expect(addressForm.getByLabel('Cidade', { exact: true })).toHaveValue('São Paulo');
  await expect(addressForm.getByLabel('UF', { exact: true })).toHaveValue('SP');
  await addressForm.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(addressForm).toHaveCount(0);
  expect(submitted).toMatchObject({
    name: 'Ana Souza', postalCode: '01001000', street: 'Praça da Sé', district: 'Sé', cityName: 'São Paulo', stateCode: 'SP', cityIbgeCode: '3550308', countryCode: 'BR',
  });

});
