import { Inject, Injectable } from '@nestjs/common';
import { assistantRuns, users, whatsappInboxEvents, whatsappLinks, whatsappSessions } from '@gestaonf/database/schema';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { connectionToken, WhatsAppLinkService } from '../whatsapp/whatsapp-link.service.js';
import { WhatsAppOutboundService } from '../whatsapp/whatsapp-outbound.service.js';
import type { OutboundButton } from '../whatsapp/meta-cloud.client.js';
import { ActionService } from './actions/action.service.js';
import { actionButtons, parseActionButton } from './actions/action-summary.js';
import { describeCause } from './actions/error-translator.js';
import { AgentOrchestrator } from './agent-orchestrator.service.js';
import { COMPANY_BUTTON_PREFIX, companyQuestion, findCompanyByName, resolveCompany, type CompanyOption } from './company-selection.js';
import { ConversationService, type Conversation, type NewMessage } from './conversation.service.js';
import { loadExecutionContext, type ExecutionContext } from './execution-context.js';
import { bold, buttonReplyId, withCompanyHeader } from './nero-format.js';
import { NERO_PROMPT_VERSION } from './prompt.js';

type Event = typeof whatsappInboxEvents.$inferSelect;
type Link = { id: string; userId: string; mode: string };

const OPT_OUT = /^(?:parar(?: todas as mensagens)?|desconectar(?: meu)? whatsapp)$/i;
const CONFIRM_TEXT = /^(?:sim|pode|confirmo|confirma|confirmar|pode (?:gravar|confirmar|lan[cç]ar|salvar))[.!]*$/i;
const CANCEL_TEXT = /^(?:cancela|cancelar|n[aã]o|deixa pra l[aá]|esquece)[.!]*$/i;
const LINK_ACK = /^(?:confirmado|confirmei|j[aá] confirmei|ok|pronto|feito)[.!]*$/i;

const TEXT = {
  unlinked: 'Este número ainda não está vinculado ao GestãoNF. Entre em Nero no sistema, gere o QR Code e envie a mensagem pronta.',
  optOut: 'Este número foi desconectado de todas as suas empresas. Para voltar a usar o Nero, vincule novamente pelo GestãoNF.',
  unsupported: 'Por enquanto, envie sua solicitação ao Nero em texto.',
  noCompany: 'Este número não possui uma empresa vinculada com acesso ativo. Entre em Nero no GestãoNF e vincule a empresa por QR Code.',
  pendingLink: 'Para concluir o vínculo, volte ao GestãoNF e confirme o número na tela do Nero.',
  disabled: 'O Nero está temporariamente indisponível. Tente novamente mais tarde ou use o GestãoNF.',
  failure: 'Não consegui concluir agora. Nada foi alterado. Tente novamente em alguns instantes.',
  revoked: 'O acesso a essa empresa foi removido. Me diga de novo o que precisa.',
  stale: 'Essa proposta não está mais disponível. Me diga de novo o que precisa.',
  expired: 'Essa proposta expirou. Quer que eu prepare de novo?',
  already: 'Isso já foi gravado. ✅',
  canceled: 'Cancelado. Nada foi gravado.',
  retry: 'Não consegui gravar agora e nada foi alterado. Toque em Confirmar de novo em instantes.',
  noPending: 'Não há nada aguardando confirmação.',
};

@Injectable()
export class NiloService {
  /** Eventos que já receberam alguma resposta nesta execução: um erro posterior não deve mandar o aviso de falha por cima. */
  private readonly replied = new Set<string>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WhatsAppLinkService) private readonly links: WhatsAppLinkService,
    @Inject(WhatsAppOutboundService) private readonly outbound: WhatsAppOutboundService,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(ActionService) private readonly actions: ActionService,
    @Inject(AgentOrchestrator) private readonly orchestrator: AgentOrchestrator,
  ) {}

  async processInboxEvent(eventId: string) {
    const [event] = await this.database.db.select().from(whatsappInboxEvents).where(eq(whatsappInboxEvents.id, eventId)).limit(1);
    if (!event || event.processedAt) return;
    // Mensagens de um mesmo remetente são processadas em ordem, mesmo com vários workers.
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.connectionId + ':' + event.senderId}, 0))`);
      await this.processLockedEvent(eventId);
    });
  }

  private async finish(eventIds: string[], error?: string) {
    await this.database.db.update(whatsappInboxEvents).set({ processedAt: new Date(), processingError: error ?? null }).where(inArray(whatsappInboxEvents.id, eventIds));
  }

  private async plain(event: Event, body: string, key: string, linkId?: string) {
    await this.outbound.enqueueText({ connectionId: event.connectionId, recipientId: event.senderId, linkId: linkId ?? null, logicalKey: `${key}:${event.id}`, body });
    this.replied.add(event.id);
  }

  /** Envia texto ou botões dentro da conversa e grava a fala do Nero no histórico, na mesma transação. */
  private async say(event: Event, link: Link, conversation: Conversation, body: string, key: string, options: { buttons?: OutboundButton[]; memory?: string } = {}) {
    await this.database.db.transaction(async (tx) => {
      const input = {
        connectionId: event.connectionId, recipientId: event.senderId, linkId: link.id, conversationId: conversation.id,
        companyId: conversation.status === 'ACTIVE' ? conversation.companyId : null, companyLinkId: conversation.status === 'ACTIVE' ? conversation.companyLinkId : null,
        logicalKey: key, body,
      };
      const outboundMessageId = options.buttons ? await this.outbound.enqueueInteractive({ ...input, buttons: options.buttons }, tx) : await this.outbound.enqueueText(input, tx);
      await this.conversations.append(conversation.id, [{ role: 'ASSISTANT', content: options.memory ?? body, source: 'SYSTEM', outboundMessageId }], tx);
    });
    this.replied.add(event.id);
    await this.conversations.touch(conversation.id);
  }

  private async activeLink(event: Event): Promise<Link | null> {
    const [link] = await this.database.db.select({ id: whatsappLinks.id, userId: whatsappLinks.userId, mode: whatsappSessions.mode })
      .from(whatsappLinks).innerJoin(whatsappSessions, eq(whatsappSessions.linkId, whatsappLinks.id)).innerJoin(users, eq(users.id, whatsappLinks.userId))
      .where(and(eq(whatsappLinks.connectionId, event.connectionId), eq(whatsappLinks.senderId, event.senderId), eq(whatsappLinks.status, 'ACTIVE'), eq(users.status, 'ACTIVE'))).limit(1);
    return link ?? null;
  }

  /** Mensagens de texto ainda não processadas do mesmo remetente formam um único turno (rajada). */
  private async collectBurst(event: Event) {
    const rows = await this.database.db.select().from(whatsappInboxEvents)
      .where(and(eq(whatsappInboxEvents.connectionId, event.connectionId), eq(whatsappInboxEvents.senderId, event.senderId), eq(whatsappInboxEvents.messageType, 'text'), isNull(whatsappInboxEvents.processedAt), lte(whatsappInboxEvents.receivedAt, new Date())))
      .orderBy(asc(whatsappInboxEvents.receivedAt), asc(whatsappInboxEvents.id));
    const batch = rows.filter((row) => row.id === event.id || (row.messageText?.trim() && !connectionToken(row.messageText) && !OPT_OUT.test(row.messageText.trim())));
    return batch.some((row) => row.id === event.id) ? batch : [event];
  }

  private async processLockedEvent(eventId: string) {
    const [event] = await this.database.db.select().from(whatsappInboxEvents).where(eq(whatsappInboxEvents.id, eventId)).limit(1);
    if (!event || event.processedAt) return;
    let batchIds = [event.id];
    try {
      const text = event.messageText?.trim() ?? '';
      // Um remetente conhecido pode provar outra empresa; token de QR nunca vai para a IA.
      if (text) {
        const challenge = await this.links.captureCandidate(event.connectionId, event.senderId, event.senderId, text);
        if (challenge) { await this.plain(event, challenge.message, 'link'); await this.finish(batchIds); return; }
      }
      const link = await this.activeLink(event);
      if (!link) {
        // Número novo que acabou de ler o QR: a orientação certa é confirmar na web, não "vincular".
        const waitingWeb = text && !buttonReplyId(event.payload) && LINK_ACK.test(text) && await this.links.hasPendingCandidate(event.connectionId, event.senderId);
        if (text) await this.plain(event, waitingWeb ? TEXT.pendingLink : TEXT.unlinked, waitingWeb ? 'link-pending' : 'link');
        await this.finish(batchIds); return;
      }
      if (link.mode === 'PAUSED') { await this.finish(batchIds); return; }
      if (text && OPT_OUT.test(text)) {
        await this.links.disconnectNumber(link.id, link.userId);
        await this.plain(event, TEXT.optOut, 'opt-out'); await this.finish(batchIds); return;
      }
      const buttonId = buttonReplyId(event.payload);
      if (text && !buttonId && LINK_ACK.test(text) && await this.links.hasPendingCandidate(event.connectionId, event.senderId)) {
        await this.plain(event, TEXT.pendingLink, 'link-pending', link.id); await this.finish(batchIds); return;
      }
      if (!buttonId && (event.messageType !== 'text' || !text)) { await this.plain(event, TEXT.unsupported, 'unsupported', link.id); await this.finish(batchIds); return; }
      const eligible: CompanyOption[] = await this.links.eligibleCompanies(link.id, link.userId);
      if (!eligible.length) { await this.plain(event, TEXT.noCompany, 'no-company', link.id); await this.finish(batchIds); return; }
      const conversation = await this.conversations.resumeOrOpen(link, eligible);
      if (buttonId) await this.handleButton(event, link, conversation, eligible, buttonId);
      else {
        const batch = await this.collectBurst(event);
        batchIds = batch.map((item) => item.id);
        await this.handleTurn(batch, link, conversation, eligible);
      }
      await this.database.db.update(whatsappSessions).set({ lastInboundAt: event.receivedAt, updatedAt: new Date() }).where(eq(whatsappSessions.linkId, link.id));
      await this.finish(batchIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      await this.database.db.update(assistantRuns).set({ status: 'FAILED', errorMessage: message, finishedAt: new Date() }).where(inArray(assistantRuns.inboxEventId, batchIds));
      // Se o usuário já recebeu uma resposta neste evento, só registramos o erro.
      if (!batchIds.some((id) => this.replied.has(id))) await this.plain(event, TEXT.failure, 'nilo-error');
      await this.finish(batchIds, message);
    } finally {
      for (const id of [event.id, ...batchIds]) this.replied.delete(id);
    }
  }

  private async handleTurn(batch: Event[], link: Link, conversation: Conversation, eligible: CompanyOption[]) {
    const last = batch.at(-1)!;
    const texts = batch.map((item) => item.messageText!.trim());
    const userMessages: NewMessage[] = batch.map((item) => ({ role: 'USER', content: item.messageText!.trim(), source: 'TEXT', inboxEventId: item.id }));

    if (conversation.status === 'AWAITING_COMPANY') {
      // Só interpreta "1"/nome como escolha se já houver um pedido guardado nesta conversa.
      const hasRequest = (await this.conversations.history(conversation.id)).some((item) => item.role === 'USER');
      const choice = hasRequest && texts.length === 1 ? resolveCompany(eligible, { text: texts[0], buttonId: null }) : null;
      if (choice) {
        const active = await this.conversations.selectCompany(conversation.id, choice);
        if (active) return this.respondAfterSelection(last, link, active, eligible);
      }
      await this.conversations.append(conversation.id, userMessages);
      return this.askCompany(last, link, conversation, eligible);
    }

    const pending = await this.actions.pending(conversation.id);
    // "sim"/"cancelar" digitados só valem quando a última fala do Nero é a própria proposta pendente.
    const answersProposal = pending ? await this.lastSpeechIs(conversation.id, pending.summaryText) : false;
    if (texts.length === 1 && CONFIRM_TEXT.test(texts[0])) {
      if (pending && answersProposal) return this.confirmAction(last, link, conversation, eligible, pending.id);
      if (!pending) {
        // Proposta que venceu: "sim" digitado logo depois dela recebe o aviso de expiração, não vai ao modelo.
        const latest = await this.actions.latest(conversation.id);
        if (latest?.status === 'EXPIRED' && await this.lastSpeechIs(conversation.id, latest.summaryText)) return this.say(last, link, conversation, TEXT.expired, `nero:${last.id}`);
        if (/^(?:confirmo|confirma|confirmar)[.!]*$/i.test(texts[0])) return this.say(last, link, conversation, TEXT.noPending, `nero:${last.id}`);
      }
    }
    if (pending && answersProposal && texts.length === 1 && CANCEL_TEXT.test(texts[0])) return this.cancelAction(last, link, conversation, pending.id);
    await this.conversations.append(conversation.id, userMessages);
    return this.respond(last, link, conversation, eligible);
  }

  private async handleButton(event: Event, link: Link, conversation: Conversation, eligible: CompanyOption[], buttonId: string) {
    if (buttonId.startsWith(COMPANY_BUTTON_PREFIX)) {
      const choice = conversation.status === 'AWAITING_COMPANY' ? resolveCompany(eligible, { text: null, buttonId }) : null;
      const active = choice ? await this.conversations.selectCompany(conversation.id, choice) : null;
      if (active) {
        const hasRequest = (await this.conversations.history(active.id)).some((item) => item.role === 'USER');
        if (!hasRequest) return this.say(event, link, active, `Certo, ${bold(choice!.name)}. Como posso ajudar?`, `nero:${event.id}`);
        return this.respondAfterSelection(event, link, active, eligible);
      }
      return this.say(event, link, conversation, 'Essa escolha não está mais disponível. Me diga de novo o que precisa.', `nero:${event.id}`);
    }
    const parsed = parseActionButton(buttonId);
    if (!parsed || conversation.status !== 'ACTIVE') return this.say(event, link, conversation, TEXT.stale, `nero:${event.id}`);
    if (parsed.verb === 'confirm') return this.confirmAction(event, link, conversation, eligible, parsed.actionId);
    if (parsed.verb === 'cancel') return this.cancelAction(event, link, conversation, parsed.actionId);
    // Corrigir só vale para a proposta que ainda está pendente; ela é substituída antes de o modelo preparar outra.
    const pending = await this.actions.pending(conversation.id);
    if (pending?.id !== parsed.actionId) return this.say(event, link, conversation, TEXT.stale, `nero:${event.id}`);
    await this.actions.supersede(parsed.actionId, conversation.id, link.userId);
    await this.conversations.append(conversation.id, [{ role: 'USER', content: 'Quero corrigir a proposta.', source: 'BUTTON', inboxEventId: event.id }]);
    return this.respond(event, link, conversation, eligible, 'O usuário tocou em Corrigir. Pergunte o que ele quer mudar e depois prepare uma nova proposta completa.');
  }

  /** A última fala do Nero (ignorando registros de ferramenta) é exatamente `text`? */
  private async lastSpeechIs(conversationId: string, text: string | null) {
    if (!text) return false;
    const last = (await this.conversations.history(conversationId)).filter((item) => item.role !== 'TOOL').at(-1);
    return last?.role === 'ASSISTANT' && last.content === text.trim();
  }

  /** Escolha de empresa feita em conversa aberta por troca de empresa: o pedido veio da conversa anterior. */
  private async respondAfterSelection(event: Event, link: Link, conversation: Conversation, eligible: CompanyOption[]) {
    if (await this.conversations.openedByCompanySwitch(conversation)) {
      const name = eligible.find((item) => item.companyLinkId === conversation.companyLinkId)?.name ?? '';
      return this.respond(event, link, conversation, eligible, `A empresa desta conversa já foi trocada para ${name}. Atenda o pedido do usuário nesta empresa, sem chamar trocar_empresa de novo.`);
    }
    return this.respond(event, link, conversation, eligible);
  }

  private async askCompany(event: Event, link: Link, conversation: Conversation, eligible: CompanyOption[]) {
    const question = companyQuestion(eligible);
    return this.say(event, link, conversation, question.body, `nero-company:${event.id}`, { buttons: question.buttons });
  }

  /** Modelo e versão do prompt, para rastrear o comportamento; a coluna aceita 80 caracteres. */
  private runModel() {
    const version = `@${NERO_PROMPT_VERSION}`;
    return `${this.orchestrator.modelName.slice(0, 80 - version.length)}${version}`;
  }

  private async startRun(event: Event, link: Link, company: CompanyOption) {
    const [created] = await this.database.db.insert(assistantRuns).values({
      inboxEventId: event.id, linkId: link.id, companyId: company.companyId, companyLinkId: company.companyLinkId, userId: link.userId, model: this.runModel(),
    }).onConflictDoUpdate({ target: assistantRuns.inboxEventId, set: { companyId: company.companyId, companyLinkId: company.companyLinkId, status: 'RUNNING' } }).returning({ id: assistantRuns.id });
    return created.id;
  }

  private async contextFor(event: Event, link: Link, conversation: Conversation, eligible: CompanyOption[]): Promise<{ ctx: ExecutionContext; company: CompanyOption } | null> {
    const company = eligible.find((item) => item.companyLinkId === conversation.companyLinkId && item.companyId === conversation.companyId);
    if (!company) return null;
    const runId = await this.startRun(event, link, company);
    const ctx = await loadExecutionContext(this.database.db, {
      channel: 'WHATSAPP', userId: link.userId, companyId: company.companyId, companyLinkId: company.companyLinkId, companyName: company.name,
      companyCount: eligible.length, linkId: link.id, conversationId: conversation.id, runId,
    });
    return ctx ? { ctx, company } : null;
  }

  private async respond(event: Event, link: Link, conversation: Conversation, eligible: CompanyOption[], developerNote?: string, rerun = false): Promise<void> {
    if (!this.orchestrator.enabled()) return this.say(event, link, conversation, TEXT.disabled, `nero:${event.id}`);
    const resolved = await this.contextFor(event, link, conversation, eligible);
    if (!resolved) { await this.conversations.close(conversation.id, 'LINK_REVOKED'); return this.plain(event, TEXT.revoked, 'nero-revoked', link.id); }
    const { ctx, company } = resolved;
    const pending = await this.actions.pending(conversation.id);
    const result = await this.orchestrator.run(ctx, { history: await this.conversations.history(conversation.id), pendingSummary: pending?.summaryText ?? null, developerNote });
    await this.conversations.append(conversation.id, result.memories.map((memory) => ({ role: 'TOOL' as const, content: memory, source: 'SYSTEM' as const })));
    await this.database.db.update(assistantRuns).set({ status: 'COMPLETED', toolCallCount: sql`coalesce(${assistantRuns.toolCallCount}, 0) + ${result.toolCallCount}`, inputTokens: sql`coalesce(${assistantRuns.inputTokens}, 0) + ${result.inputTokens}`, outputTokens: sql`coalesce(${assistantRuns.outputTokens}, 0) + ${result.outputTokens}`, finishedAt: new Date() }).where(eq(assistantRuns.id, ctx.runId));
    const key = `nero:${event.id}${rerun ? ':2' : ''}`;

    if (result.outcome.kind === 'SWITCH_COMPANY') {
      const named = result.outcome.companyName;
      if (named && findCompanyByName([company], named)) return this.say(event, link, conversation, `Já estamos na ${bold(company.name)}.`, key);
      // Rerun: a troca já foi feita; outro pedido de troca não troca de novo (evita ida e volta entre empresas).
      if (rerun) return this.say(event, link, conversation, `Estamos na ${bold(company.name)}. Se quiser falar de outra empresa, me diga qual.`, key);
      const others = eligible.filter((item) => item.companyLinkId !== company.companyLinkId);
      // A escolha automática entre duas empresas só vale quando o usuário não citou nenhuma.
      const target = findCompanyByName(others, named) ?? (named === null && eligible.length === 2 ? others[0] ?? null : null);
      const carried = await this.conversations.trailingUserMessages(conversation.id);
      await this.conversations.close(conversation.id, 'COMPANY_SWITCH');
      const next = await this.conversations.open(link, target);
      await this.conversations.append(next.id, carried.map((item) => ({ role: 'USER' as const, content: item.content, source: item.source as NewMessage['source'], inboxEventId: item.inboxEventId })));
      if (!target) return this.askCompany(event, link, next, eligible);
      return this.respond(event, link, next, eligible, `A empresa desta conversa já foi trocada para ${target.name}. Atenda o pedido do usuário nesta empresa, sem chamar trocar_empresa de novo.`, true);
    }
    if (result.outcome.kind === 'PROPOSAL') {
      try {
        await this.say(event, link, conversation, result.outcome.summary, `nero-proposal:${result.outcome.actionId}`, { buttons: actionButtons(result.outcome.actionId) });
      } catch (error) {
        // Sem a mensagem enviada o usuário não pode confirmar: a proposta não deve ficar pendente.
        await this.actions.supersede(result.outcome.actionId, conversation.id, link.userId);
        throw error;
      }
    } else {
      await this.say(event, link, conversation, withCompanyHeader(result.outcome.text, company.name, eligible.length), key, { memory: result.outcome.text });
    }
    if (result.closeAfterTurn) await this.conversations.close(conversation.id, 'NEW_TOPIC');
  }

  private async confirmAction(event: Event, link: Link, conversation: Conversation, eligible: CompanyOption[], actionId: string) {
    const resolved = await this.contextFor(event, link, conversation, eligible);
    if (!resolved) { await this.conversations.close(conversation.id, 'LINK_REVOKED'); return this.plain(event, TEXT.revoked, 'nero-revoked', link.id); }
    const result = await this.actions.confirm(actionId, resolved.ctx);
    await this.database.db.update(assistantRuns).set({ status: 'COMPLETED', finishedAt: new Date() }).where(eq(assistantRuns.id, resolved.ctx.runId));
    const key = `nero-action:${actionId}:${event.id}`;
    if (result.status === 'EXECUTED') {
      await this.conversations.append(conversation.id, [{ role: 'TOOL', content: `Proposta confirmada e gravada: ${result.labels.join('; ')}.`, source: 'SYSTEM' }]);
      return this.say(event, link, conversation, [`✅ Pronto! Gravei na ${bold(resolved.company.name)}:`, ...result.labels.map((label) => `• ${label}`)].join('\n'), key);
    }
    if (result.status === 'ALREADY_EXECUTED') return this.say(event, link, conversation, TEXT.already, key);
    if ('current' in result) return this.say(event, link, conversation, result.current === 'EXPIRED' ? TEXT.expired : TEXT.stale, key);
    if (!('cause' in result)) return;
    if (result.status === 'RETRYABLE') return this.say(event, link, conversation, TEXT.retry, key);
    const cause = describeCause(result.cause);
    await this.conversations.append(conversation.id, [{ role: 'TOOL', content: `A gravação confirmada falhou e nada foi salvo. Motivo: ${cause}`, source: 'SYSTEM' }]);
    if (!this.orchestrator.enabled()) return this.say(event, link, conversation, `⚠️ Nada foi gravado. ${result.cause.message}`, key);
    return this.respond(event, link, conversation, eligible, `A gravação confirmada falhou e nada foi salvo. Motivo: ${cause}. Comece a resposta com "⚠️ Nada foi gravado." Explique o motivo em palavras simples e sugira uma correção concreta.`);
  }

  private async cancelAction(event: Event, link: Link, conversation: Conversation, actionId: string) {
    const canceled = await this.actions.reject(actionId, conversation.id, link.userId);
    if (canceled) await this.conversations.append(conversation.id, [{ role: 'TOOL', content: 'Usuário cancelou a proposta. Nada foi gravado.', source: 'SYSTEM' }]);
    return this.say(event, link, conversation, canceled ? TEXT.canceled : TEXT.stale, `nero-action:${actionId}:${event.id}`);
  }
}
