import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SignJWT } from 'jose';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { and, count, eq } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { DatabaseService } from '../src/database/database.module.js';
import { UsersModule } from '../src/users/users.module.js';
import { UsersService } from '../src/users/users.service.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { CompaniesModule } from '../src/companies/companies.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { EmailDispatchService } from '../src/emails/email-dispatch.service.js';
import { ResendProviderService } from '../src/emails/resend-provider.service.js';
import { EmailPayloadService } from '../src/emails/email-payload.service.js';
import { testAccount } from './account-fixture.js';
import { WhatsAppLinkService } from '../src/whatsapp/whatsapp-link.service.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const databaseName = `gestaonf_users_test_${randomUUID().replace(/-/g, '').slice(0,12)}`;
const secret = 'users-isolated-test-secret-with-at-least-32-characters';
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: ReturnType<typeof drizzle<typeof s>>;
let app: NestFastifyApplication, service: UsersService, auth: AuthService, dispatcher: EmailDispatchService, payloads: EmailPayloadService, provider: ResendProviderService;
let owner: string, stranger: string, account: string, accountB: string, companyA: string, companyB: string, otherCompany: string, passwordHash: string;
const password = 'senha-de-teste-123456';
@Global() @Module({ providers: [{ provide: DatabaseService, useFactory: () => ({ db }) }], exports: [DatabaseService] }) class TestDatabaseModule {}
@Module({ imports: [TestDatabaseModule, UsersModule, CompaniesModule] }) class TestAppModule {}
async function http(method: 'GET'|'POST'|'PATCH', url: string, body?: unknown, userId: string | null = owner, key?: string, companyId = companyA) {
  const token = userId ? await new SignJWT({}).setProtectedHeader({ alg:'HS256' }).setSubject(userId).setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret)) : null;
  return app.inject({ method, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-company-id': companyId, ...(key ? { 'idempotency-key':key } : {}), ...(body !== undefined ? { 'content-type':'application/json' } : {}) }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
}
async function invite(companyIds = [companyA], email = `${randomUUID()}@example.test`, key = randomUUID()) {
  const result = await http('POST', `/accounts/${account}/user-invitations`, { name:'Ana Souza', email, companyIds }, owner, key);
  expect(result.statusCode).toBe(202);
  const id = result.json().id as string;
  return { ...result.json(), token: await tokenFor(id) } as { id:string; version:number; token:string; email:string };
}
async function tokenFor(id: string) {
  const rows = await db.select().from(s.emailMessages).where(eq(s.emailMessages.invitationId,id));
  const row = rows.sort((a,b) => b.invitationVersion! - a.invitationVersion!)[0];
  const body = payloads.decrypt(row.encryptedPayload!,row.encryptionKeyId!,`${row.invitationId}:${row.invitationVersion}`);
  return body.text.match(/token=([A-Za-z0-9_-]{43})/)![1];
}
async function acceptNew(token: string, clientType = 'mobile') { return http('POST','/user-invitations/accept-new',{ token,password,passwordConfirmation:password,client:clientType },null); }
async function resetResend(id: string) { await db.update(s.userInvitations).set({ lastSentAt:new Date(Date.now()-120_000) }).where(eq(s.userInvitations.id,id)); }
async function latestRow(id: string) { return (await db.select().from(s.userInvitations).where(eq(s.userInvitations.id,id)))[0]; }
beforeAll(async () => {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL requerida para banco isolado');
  admin = postgres(databaseUrl,{ max:1,onnotice:()=>{} }); await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(),{ max:10,onnotice:()=>{} });
  for (const m of readMigrationFiles({ migrationsFolder:fileURLToPath(new URL('../../../packages/database/drizzle',import.meta.url)) })) for (const statement of m.sql) await client.unsafe(statement);
  db = drizzle(client,{ schema:s });
  for (const [key,value] of Object.entries({ JWT_SECRET:secret, RESEND_ENABLED:'true',RESEND_API_KEY:'re_fake_test',RESEND_TEST_MODE:'false',RESEND_FROM:'GestãoNF <mail@example.test>',RESEND_TEST_RECIPIENT:'owner@example.test',RESEND_WEBHOOK_SECRET:'',RESEND_REPLY_TO:'',EMAIL_COMPANY_DAILY_LIMIT:'100',EMAIL_PAYLOAD_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),EMAIL_PAYLOAD_ENCRYPTION_KEY_ID:'v1',WEB_ORIGIN:'http://localhost:5173',ACCOUNTS_ALLOW_LOCAL_ACTIVATION:'false',NODE_ENV:'test' })) vi.stubEnv(key,value);
  app = await NestFactory.create<NestFastifyApplication>(TestAppModule,new FastifyAdapter(),{ logger:false });
  await app.register(cookie); await app.init(); await app.getHttpAdapter().getInstance().ready();
  service = app.get(UsersService); auth = app.get(AuthService); dispatcher = app.get(EmailDispatchService); payloads = app.get(EmailPayloadService); provider = app.get(ResendProviderService);
  passwordHash = await auth.hashPassword(password);
},60_000);
beforeEach(async () => {
  if (!/^gestaonf_users_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Banco isolado inválido');
  await client.unsafe('TRUNCATE TABLE users, accounts, invitation_request_limits CASCADE');
  [owner,stranger] = (await db.insert(s.users).values([{ name:'Titular',email:'owner@example.test' },{ name:'Outro titular',email:'stranger@example.test' }]).returning()).map(u=>u.id);
  await db.insert(s.userCredentials).values([{ userId:owner,passwordHash },{ userId:stranger,passwordHash }]);
  account = await testAccount(db,owner); accountB = await testAccount(db,stranger);
  [companyA,companyB] = (await db.insert(s.companies).values([{ accountId:account,name:'Empresa A' },{ accountId:account,name:'Empresa B' }]).returning()).map(c=>c.id);
  [otherCompany] = (await db.insert(s.companies).values({ accountId:accountB,name:'Empresa externa' }).returning()).map(c=>c.id);
  await db.insert(s.companyUsers).values([{ companyId:companyA,userId:owner,role:'OWNER' },{ companyId:companyB,userId:owner,role:'OWNER' },{ companyId:otherCompany,userId:stranger,role:'OWNER' }]);
  Object.assign(provider.config,{ enabled:true,testMode:false,from:'GestãoNF <mail@example.test>',dailyLimit:100 });
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify({ id:randomUUID() }))));
});
afterEach(()=>{ vi.restoreAllMocks();vi.unstubAllGlobals(); });
afterAll(async()=>{ if(app)await app.close();if(client)await client.end();if(admin){if(!/^gestaonf_users_test_[a-f0-9]{12}$/.test(databaseName))throw new Error('Banco isolado inválido');await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}vi.unstubAllEnvs(); });

describe('usuários convidados, PostgreSQL e HTTP',()=>{
  it('publica contratos Swagger e exige titular sem aceitar campos de privilégio',async()=>{
    const docs=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
    expect(docs.paths['/user-invitations/accept-new'].post?.requestBody).toBeTruthy();
    expect((await http('GET',`/accounts/${account}/users`,undefined,null)).statusCode).toBe(401);
    expect((await http('GET',`/accounts/${account}/users`,undefined,stranger)).statusCode).toBe(404);
    expect((await http('POST',`/accounts/${account}/user-invitations`,{name:'A',email:'a@example.test',companyIds:[companyA],role:'OWNER'},owner,randomUUID())).statusCode).toBe(400);
  });
  it('cria somente convite/fila protegida e reserva uma vaga em cada empresa por 24h',async()=>{
    const created=await invite([companyA,companyB]);
    expect((await db.select({value:count()}).from(s.users))[0].value).toBe(2);
    expect((await db.select({value:count()}).from(s.companyUsers))[0].value).toBe(3);
    const row=await latestRow(created.id); expect(row.expiresAt.getTime()-Date.now()).toBeGreaterThan(86300_000); expect(row.expiresAt.getTime()-Date.now()).toBeLessThanOrEqual(86400_000);
    const [mail]=await db.select().from(s.emailMessages); expect(mail.textBody).toBeNull();expect(mail.htmlBody).toBeNull();expect(mail.encryptedPayload).not.toContain(created.token);
    const capacities=await service.capacity(account,owner);expect(capacities.every(c=>c.reserved===1&&c.occupied===0&&c.available===4)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    const list=(await http('GET',`/accounts/${account}/users`)).json();expect(JSON.stringify(list)).not.toContain(created.token);expect(JSON.stringify(list)).not.toContain('tokenHash');
  });
  it('idempotência cria uma vez em concorrência e detecta conteúdo diferente',async()=>{
    const key=randomUUID(),input={name:'Ana',email:'ana@example.test',companyIds:[companyA]};
    const results=await Promise.all(Array.from({length:4},()=>service.create(account,owner,input,key)));
    expect(new Set(results.map(r=>r.id)).size).toBe(1);expect((await db.select({value:count()}).from(s.emailMessages))[0].value).toBe(1);
    await expect(service.create(account,owner,{...input,name:'Outra'},key)).rejects.toMatchObject({status:409});
  });
  it('tem cinco vagas por empresa, última vaga concorrente e rollback de múltiplas empresas',async()=>{
    for(let i=0;i<4;i++)await invite([companyA]);
    const results=await Promise.all(Array.from({length:3},()=>http('POST',`/accounts/${account}/user-invitations`,{name:'Última',email:`${randomUUID()}@example.test`,companyIds:[companyA]},owner,randomUUID())));
    expect(results.filter(r=>r.statusCode===202)).toHaveLength(1);expect(results.filter(r=>r.statusCode===409)).toHaveLength(2);
    const blocked=await http('POST',`/accounts/${account}/user-invitations`,{name:'Multiplas',email:'multi@example.test',companyIds:[companyA,companyB]},owner,randomUUID());expect(blocked.statusCode).toBe(409);
    expect((await service.capacity(account,owner)).find(c=>c.companyId===companyB)?.reserved).toBe(0);
    await invite([companyB]);expect((await service.capacity(account,owner)).find(c=>c.companyId===companyB)?.reserved).toBe(1);
  });
  it('recusa empresa externa e falha no envio desfaz convite, reserva e comando',async()=>{
    const result=await http('POST',`/accounts/${account}/user-invitations`,{name:'A',email:'a@example.test',companyIds:[otherCompany]},owner,randomUUID());expect(result.statusCode).toBe(404);
    provider.config.enabled=false;
    expect((await http('POST',`/accounts/${account}/user-invitations`,{name:'A',email:'a@example.test',companyIds:[companyA]},owner,randomUUID())).statusCode).toBe(503);
    expect((await db.select({value:count()}).from(s.userInvitations))[0].value).toBe(0);
  });
  it('preview não consome; senha cria identidade, sessão e vínculos atômicos',async()=>{
    const created=await invite([companyA,companyB]);
    const preview=await http('POST','/user-invitations/preview',{token:created.token},null);expect(preview.json().nextStep).toBe('DEFINE_PASSWORD');expect((await latestRow(created.id)).status).toBe('PENDING');
    const accepted=await acceptNew(created.token,'web');expect(accepted.statusCode).toBe(201);expect(accepted.headers['set-cookie']).toBeTruthy();expect(accepted.json()).not.toHaveProperty('accessToken');
    const user=accepted.json().user;
    expect((await auth.login({email:created.email,password,client:'mobile'})).user.id).toBe(user.id);
    const memberships=await db.select().from(s.companyUsers).where(eq(s.companyUsers.userId,user.id));expect(memberships).toHaveLength(2);expect(memberships.every(m=>m.role==='COLLABORATOR')).toBe(true);
    expect((await latestRow(created.id)).status).toBe('ACCEPTED');expect((await service.capacity(account,owner)).every(c=>c.occupied===1&&c.reserved===0)).toBe(true);
    expect((await acceptNew(created.token)).statusCode).toBe(410);
  });
  it('aceite existente exige login correto e preserva nome, senha e outras empresas',async()=>{
    const created=await invite([companyA],'stranger@example.test');
    expect((await http('POST','/user-invitations/preview',{token:created.token},null)).json().nextStep).toBe('LOGIN');
    expect((await acceptNew(created.token)).statusCode).toBe(409);
    expect((await http('POST','/user-invitations/accept-existing',{token:created.token},owner)).statusCode).toBe(403);
    expect((await http('POST','/user-invitations/accept-existing',{token:created.token},stranger)).statusCode).toBe(200);
    expect((await http('POST','/user-invitations/accept-existing',{token:created.token},stranger)).statusCode).toBe(200);
    expect((await auth.login({email:'stranger@example.test',password,client:'mobile'})).user.name).toBe('Outro titular');
    expect((await db.select().from(s.companyUsers).where(eq(s.companyUsers.userId,stranger))).filter(m=>m.status==='ACTIVE')).toHaveLength(2);
  });
  it('duplo aceite cria somente uma identidade; corrida com cadastro pede login',async()=>{
    const created=await invite();const results=await Promise.all([acceptNew(created.token),acceptNew(created.token)]);
    expect(results.map(r=>r.statusCode).sort()).toEqual([201,410]);
    const another=await invite();await auth.register({name:'Nome real',email:another.email,password,client:'mobile'});
    expect((await acceptNew(another.token)).statusCode).toBe(409);expect((await latestRow(another.id)).status).toBe('PENDING');
  });
  it('aceite troca reserva pela quinta vaga e não exige vaga duplicada',async()=>{
    const invited=[];for(let i=0;i<5;i++)invited.push(await invite());
    for(const created of invited)expect((await acceptNew(created.token)).statusCode).toBe(201);
    const a=(await service.capacity(account,owner)).find(c=>c.companyId===companyA)!;expect(a).toMatchObject({occupied:5,reserved:0,available:0});
  });
  it('expiração lógica libera vaga antes do job; token vencido e revogado são inúteis',async()=>{
    const created=await invite();await db.update(s.userInvitations).set({expiresAt:new Date(Date.now()-1000)}).where(eq(s.userInvitations.id,created.id));
    expect((await service.capacity(account,owner)).find(c=>c.companyId===companyA)?.reserved).toBe(0);
    expect((await acceptNew(created.token)).statusCode).toBe(410);
    await service.expireDue();expect((await latestRow(created.id)).status).toBe('EXPIRED');
    const another=await invite();expect((await http('POST',`/accounts/${account}/user-invitations/${another.id}/revoke`,{version:1},owner,randomUUID())).statusCode).toBe(200);
    expect((await acceptNew(another.token)).statusCode).toBe(410);expect((await db.select().from(s.emailMessages).where(eq(s.emailMessages.invitationId,another.id)))[0].encryptedPayload).toBeNull();
  });
  it('reenvio gira link com nova validade e uma única reserva, respeitando cooldown',async()=>{
    const created=await invite();
    expect((await http('POST',`/accounts/${account}/user-invitations/${created.id}/resend`,{version:1},owner,randomUUID())).statusCode).toBe(429);
    await resetResend(created.id);const key=randomUUID();
    const resent=await http('POST',`/accounts/${account}/user-invitations/${created.id}/resend`,{version:1},owner,key);expect(resent.statusCode).toBe(202);
    expect((await http('POST',`/accounts/${account}/user-invitations/${created.id}/resend`,{version:1},owner,key)).statusCode).toBe(202);
    expect((await acceptNew(created.token)).statusCode).toBe(410);const token=await tokenFor(created.id);expect(token).not.toBe(created.token);
    expect((await service.capacity(account,owner)).find(c=>c.companyId===companyA)?.reserved).toBe(1);
    expect((await acceptNew(token)).statusCode).toBe(201);
  });
  it('editar destinos invalida link anterior e aplica só a nova seleção',async()=>{
    const created=await invite();await resetResend(created.id);
    const changed=await http('PATCH',`/accounts/${account}/user-invitations/${created.id}/companies`,{version:1,companyIds:[companyB]},owner,randomUUID());expect(changed.statusCode).toBe(200);
    expect((await acceptNew(created.token)).statusCode).toBe(410);
    const accepted=await acceptNew(await tokenFor(created.id));expect(accepted.json().companies.map((c:{id:string})=>c.id)).toEqual([companyB]);
  });
  it('worker envia conteúdo consistente e descarta link secreto após aceite do provedor',async()=>{
    const created=await invite();await dispatcher.dispatchOne();
    const payload=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);expect(payload.html).toContain('Aceitar convite');expect(payload.text).toContain(created.token);
    const [mail]=await db.select().from(s.emailMessages);expect(mail.sendStatus).toBe('ACCEPTED');expect(mail.encryptedPayload).toBeNull();expect(mail.deliveryStatus).toBe('PENDING');
    expect((await acceptNew(created.token)).statusCode).toBe(201);
  });
  it('worker não envia link cancelado ou para empresa suspensa',async()=>{
    const created=await invite([companyA,companyB]);await db.update(s.companies).set({status:'INACTIVE'}).where(eq(s.companies.id,companyB));await dispatcher.dispatchOne();expect(fetch).not.toHaveBeenCalled();
    expect((await db.select().from(s.emailMessages))[0].sendStatus).toBe('CANCELED');expect((await acceptNew(created.token)).statusCode).toBe(404);
  });
  it('assinatura suspensa e redução de cota negam aceite sem alteração parcial',async()=>{
    const created=await invite([companyA,companyB]);await db.update(s.accountSubscriptions).set({status:'SUSPENDED'}).where(eq(s.accountSubscriptions.accountId,account));expect((await acceptNew(created.token)).statusCode).toBe(403);
    await db.update(s.accountSubscriptions).set({status:'ACTIVE',additionalUsersPerCompany:0}).where(eq(s.accountSubscriptions.accountId,account));expect((await acceptNew(created.token)).statusCode).toBe(409);
    expect((await db.select({value:count()}).from(s.users))[0].value).toBe(2);expect((await latestRow(created.id)).status).toBe('PENDING');
  });
  it('gestão de empresas libera vagas e preserva identidade e vínculos externos',async()=>{
    const created=await invite([companyA,companyB],'stranger@example.test');await http('POST','/user-invitations/accept-existing',{token:created.token},stranger);
    const list=await service.list(account,owner,{search:'stranger',limit:25,offset:0});const member=list.items.find((m:Record<string,unknown>)=>m.type==='MEMBER')!;
    const changed=await http('PATCH',`/accounts/${account}/users/${stranger}/companies`,{companyIds:[companyB],version:member.version},owner,randomUUID());expect(changed.statusCode).toBe(200);
    expect((await http('GET','/companies',undefined,stranger)).json().map((c:{id:string})=>c.id).sort()).toEqual([companyB,otherCompany].sort());
    expect((await service.capacity(account,owner)).find(c=>c.companyId===companyA)?.available).toBe(5);
    expect((await http('PATCH',`/accounts/${account}/users/${stranger}/companies`,{companyIds:[companyB],version:member.version},owner,randomUUID())).statusCode).toBe(409);
    expect((await auth.login({email:'stranger@example.test',password,client:'mobile'})).user.id).toBe(stranger);
  });
  it('titular é protegido; convidado não administra usuários nem cria empresa da contratação',async()=>{
    const created=await invite([companyA],'stranger@example.test');await http('POST','/user-invitations/accept-existing',{token:created.token},stranger);
    expect((await http('GET',`/accounts/${account}/users`,undefined,stranger)).statusCode).toBe(404);
    expect((await http('POST','/companies',{name:'Invadida',accountId:account},stranger)).statusCode).toBe(404);
    const members=await service.list(account,owner,{search:'owner',limit:25,offset:0});const root=members.items.find((i:Record<string,unknown>)=>i.type==='MEMBER')!;
    expect((await http('POST',`/accounts/${account}/users/${owner}/deactivate`,{version:root.version},owner,randomUUID())).statusCode).toBe(409);
  });
  it('cadastro/login/aceite não criam contratação; abertura pública é pendente e idempotente',async()=>{
    const fresh=await auth.register({name:'Novo titular',email:'fresh@example.test',password,client:'mobile'});
    expect((await app.get(AccountsService).list(fresh.user.id))).toHaveLength(0);
    const key=randomUUID();const first=await http('POST','/accounts',{name:'Minha contratação'},fresh.user.id,key);expect(first.statusCode).toBe(201);expect(first.json().status).toBe('PENDING');
    expect((await http('POST','/accounts',{name:'Minha contratação'},fresh.user.id,key)).json().id).toBe(first.json().id);
    expect((await http('POST','/accounts',{name:'A',status:'ACTIVE'},fresh.user.id,randomUUID())).statusCode).toBe(400);
    expect((await http('POST','/companies',{name:'Nova',accountId:first.json().id},fresh.user.id)).statusCode).toBe(403);
  });
  it('ativação interna aplica prazo/cota com versão e evento idempotente',async()=>{
    const accounts=app.get(AccountsService),event=randomUUID();const input={status:'SUSPENDED' as const,source:'MANUAL' as const,additionalUsersPerCompany:5,currentPeriodEndsAt:null};
    await accounts.applySubscription(account,1,event,input);await accounts.applySubscription(account,1,event,input);
    expect((await http('GET','/companies')).json()).toHaveLength(0);
    const reactivated=await accounts.applySubscription(account,2,randomUUID(),{...input,status:'ACTIVE',currentPeriodEndsAt:new Date(Date.now()+86400_000).toISOString()});expect(reactivated.version).toBe(3);
    expect((await http('GET','/companies')).json()).toHaveLength(2);
  });
  it('modo de testes recusa e-mail externo sem reservar vaga',async()=>{
    provider.config.testMode=true;provider.config.from='GestãoNF <onboarding@resend.dev>';
    expect((await http('POST',`/accounts/${account}/user-invitations`,{name:'A',email:'external@example.test',companyIds:[companyA]},owner,randomUUID())).statusCode).toBe(400);
    expect((await service.capacity(account,owner)).every(c=>c.reserved===0)).toBe(true);
  });
  it('limite público persiste no banco e preview de token inválido não expõe usuário',async()=>{
    const created=await invite();for(let i=0;i<20;i++)await http('POST','/user-invitations/accept-existing',{token:'x'.repeat(43)},owner);
    expect((await http('POST','/user-invitations/accept-existing',{token:created.token},owner)).statusCode).toBe(429);
    const invalid=await http('POST','/user-invitations/preview',{token:'x'.repeat(43)},null);expect(invalid.statusCode).toBe(410);expect(invalid.body).not.toContain('owner@example.test');
  });
  it('rotação de chave lê fila anterior e criptografia rejeita outro contexto',()=>{
    const encrypted=payloads.encrypt({text:'segredo de convite de teste',html:'<p>Teste</p>'},'contexto-original');
    vi.stubEnv('EMAIL_PAYLOAD_ENCRYPTION_KEY',Buffer.alloc(32,8).toString('base64'));vi.stubEnv('EMAIL_PAYLOAD_ENCRYPTION_KEY_ID','v2');vi.stubEnv('EMAIL_PAYLOAD_PREVIOUS_KEYS',JSON.stringify({v1:Buffer.alloc(32,7).toString('base64')}));
    const rotated=new EmailPayloadService();
    expect(rotated.decrypt(encrypted.encryptedPayload,encrypted.encryptionKeyId,'contexto-original').text).toBe('segredo de convite de teste');
    expect(()=>rotated.decrypt(encrypted.encryptedPayload,encrypted.encryptionKeyId,'outro-convite')).toThrow();
    vi.stubEnv('EMAIL_PAYLOAD_ENCRYPTION_KEY',Buffer.alloc(32,7).toString('base64'));vi.stubEnv('EMAIL_PAYLOAD_ENCRYPTION_KEY_ID','v1');vi.stubEnv('EMAIL_PAYLOAD_PREVIOUS_KEYS','');
  });
  it('remoção revoga apenas o contexto do Nero e reativação não restaura consentimento antigo',async()=>{
    const created=await invite([companyA,companyB],'stranger@example.test');await http('POST','/user-invitations/accept-existing',{token:created.token},stranger);
    const [connection]=await db.insert(s.whatsappConnections).values({metaAppId:'users-test',messagingAccountId:'users-waba',phoneNumberId:'users-phone',displayPhoneNumber:'15550000000'}).returning();
    const [link]=await db.insert(s.whatsappLinks).values({connectionId:connection.id,userId:stranger,senderId:'5511999999999'}).returning();
    for(const [index,companyId] of [companyA,companyB].entries()){
      const [challenge]=await db.insert(s.whatsappLinkChallenges).values({connectionId:connection.id,userId:stranger,companyId,tokenHash:String(index+1).repeat(64),status:'CONFIRMED',confirmedAt:new Date(),expiresAt:new Date(Date.now()+600_000)}).returning();
      await db.insert(s.whatsappLinkCompanies).values({connectionId:connection.id,linkId:link.id,userId:stranger,companyId,challengeId:challenge.id});
    }
    const listing=await service.list(account,owner,{search:'stranger',limit:25,offset:0}),member=listing.items.find((m:Record<string,unknown>)=>m.type==='MEMBER')!;
    const changed=await service.updateCompanies(account,owner,stranger,[companyB],member.version as string,randomUUID());
    const contexts=await db.select().from(s.whatsappLinkCompanies);expect(contexts.find(c=>c.companyId===companyA)?.status).toBe('REVOKED');expect(contexts.find(c=>c.companyId===companyB)?.status).toBe('ACTIVE');
    expect((await db.select().from(s.whatsappLinks))[0].status).toBe('ACTIVE');expect((await db.select().from(s.whatsappConsentEvents))[0].actorUserId).toBe(owner);
    const links=new WhatsAppLinkService({db} as DatabaseService);expect((await links.eligibleCompanies(link.id,stranger)).map(c=>c.companyId)).toEqual([companyB]);
    await service.updateCompanies(account,owner,stranger,[companyA,companyB],changed.version as string,randomUUID());
    expect((await links.eligibleCompanies(link.id,stranger)).map(c=>c.companyId)).toEqual([companyB]);
  });
});
