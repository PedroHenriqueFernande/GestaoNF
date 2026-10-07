import { afterAll, expect, test } from 'vitest';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL não definida para os testes de integração.');
}

const hostname = new URL(databaseUrl).hostname;

if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
  throw new Error('Os testes de banco só podem usar o PostgreSQL local.');
}

const db = postgres(databaseUrl, { max: 1 });

afterAll(async () => {
  await db.end();
});

test('permite clientes sem documento e o mesmo documento em empresas diferentes', async () => {
  await expect(
    db.begin(async (tx) => {
      const [companyA] = await tx`INSERT INTO companies (name) VALUES ('Empresa A') RETURNING id`;
      const [companyB] = await tx`INSERT INTO companies (name) VALUES ('Empresa B') RETURNING id`;

      await tx`INSERT INTO customers (company_id, kind, name) VALUES (${companyA.id}, 'PF', 'Sem documento A')`;
      await tx`INSERT INTO customers (company_id, kind, name) VALUES (${companyA.id}, 'PF', 'Sem documento B')`;
      await tx`INSERT INTO customers (company_id, kind, name, tax_id) VALUES (${companyA.id}, 'PJ', 'Cliente A', '00000000E08G12')`;
      await tx`INSERT INTO customers (company_id, kind, name, tax_id) VALUES (${companyB.id}, 'PJ', 'Cliente B', '00000000E08G12')`;

      const [result] = await tx`SELECT count(*)::int AS total FROM customers WHERE company_id = ${companyA.id}`;
      expect(result.total).toBe(3);

      throw new Error('ROLLBACK_TEST_TRANSACTION');
    }),
  ).rejects.toThrow('ROLLBACK_TEST_TRANSACTION');
});

test('impede documento duplicado dentro da mesma empresa', async () => {
  await expect(
    db.begin(async (tx) => {
      const [company] = await tx`INSERT INTO companies (name) VALUES ('Empresa C') RETURNING id`;
      await tx`INSERT INTO customers (company_id, kind, name, tax_id) VALUES (${company.id}, 'PF', 'Pessoa A', '12345678909')`;
      await tx`INSERT INTO customers (company_id, kind, name, tax_id) VALUES (${company.id}, 'PF', 'Pessoa B', '12345678909')`;
    }),
  ).rejects.toMatchObject({ code: '23505' });
});

test('impede autor de outra empresa no cadastro', async () => {
  await expect(
    db.begin(async (tx) => {
      const [companyA] = await tx`INSERT INTO companies (name) VALUES ('Empresa D') RETURNING id`;
      const [companyB] = await tx`INSERT INTO companies (name) VALUES ('Empresa E') RETURNING id`;
      const email = `autor-${randomUUID()}@example.invalid`;
      const [user] = await tx`INSERT INTO users (name, email) VALUES ('Autor', ${email}) RETURNING id`;
      await tx`INSERT INTO company_users (company_id, user_id, role) VALUES (${companyA.id}, ${user.id}, 'OWNER')`;
      await tx`INSERT INTO customers (company_id, kind, name, created_by_user_id) VALUES (${companyB.id}, 'PF', 'Cliente B', ${user.id})`;
    }),
  ).rejects.toMatchObject({ code: '23503' });
});

test('rejeita formato de documento incoerente com o tipo de cliente', async () => {
  await expect(
    db.begin(async (tx) => {
      const [company] = await tx`INSERT INTO companies (name) VALUES ('Empresa F') RETURNING id`;
      await tx`INSERT INTO customers (company_id, kind, name, tax_id) VALUES (${company.id}, 'PF', 'Cliente com CNPJ', '00000000E08G12')`;
    }),
  ).rejects.toMatchObject({ code: '23514' });
});
