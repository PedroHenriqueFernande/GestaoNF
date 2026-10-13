import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
config({ path: fileURLToPath(new URL('../../../.env',import.meta.url)), quiet:true });
const client = postgres(process.env.DATABASE_URL!,{max:1,onnotice:()=>{}});
try {
  const [audit] = await client`select count(*)::int as total, count(*) filter (where owner_count<>1)::int as ambiguous from (select c.id,count(cu.user_id) as owner_count from companies c left join company_users cu on cu.company_id=c.id and cu.role='OWNER' group by c.id) data`;
  console.log(`Empresas verificadas: ${audit.total}. Mapeamentos de titular ambíguos: ${audit.ambiguous}.`);
  if (audit.ambiguous) process.exitCode=1;
} catch { console.error('Não foi possível auditar a migração de usuários.');process.exitCode=1; }
finally { await client.end(); }
