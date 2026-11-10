import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { SupportHelpCatalog } from './help-catalog.js';
import { SupportActionsService } from './support-actions.service.js';
import { destinations } from './support-blocks.js';
import { SupportChatService } from './support-chat.service.js';
import { SUPPORT_CONFIG, type SupportConfig } from './support-config.js';
import { SupportConversationsService } from './support-conversations.service.js';
import { actionIdSchema, helpIdSchema, sendMessageSchema } from './support.schemas.js';

const ctx = (request: RequestContext) => ({ companyId: request.companyId!, userId: request.userId! });

@ApiTags('Assistente de suporte')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('support')
export class SupportController {
  constructor(
    @Inject(SupportChatService) private readonly chat: SupportChatService,
    @Inject(SupportConversationsService) private readonly conversations: SupportConversationsService,
    @Inject(SupportActionsService) private readonly actions: SupportActionsService,
    @Inject(SupportHelpCatalog) private readonly catalog: SupportHelpCatalog,
    @Inject(SUPPORT_CONFIG) private readonly config: SupportConfig,
  ) {}

  @Get('conversation')
  @ApiOperation({ summary: 'Conversa ativa do usuário nesta empresa' })
  async conversation(@Req() request: RequestContext) {
    const current = await this.conversations.active(ctx(request));
    return { conversation: current ? { id: current.id, messages: await this.conversations.messages(current.id) } : null, aiEnabled: this.config.enabled };
  }

  @Post('conversation/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envia uma mensagem ao assistente' })
  send(@Req() request: RequestContext, @Body() body: unknown) {
    return this.chat.send(ctx(request), parseInput(sendMessageSchema, body).text);
  }

  @Post('conversation/reset')
  @HttpCode(204)
  async reset(@Req() request: RequestContext) { await this.conversations.reset(ctx(request)); }

  @Post('actions/:id/confirm')
  @HttpCode(200)
  async confirm(@Req() request: RequestContext, @Param('id') id: string) {
    return { block: await this.actions.confirm(ctx(request), parseInput(actionIdSchema, id)) };
  }

  @Post('actions/:id/cancel')
  @HttpCode(200)
  async cancel(@Req() request: RequestContext, @Param('id') id: string) {
    return { block: await this.actions.cancel(ctx(request), parseInput(actionIdSchema, id)) };
  }

  @Get('help')
  help() { return this.catalog.list(); }

  @Get('help/:id')
  article(@Param('id') id: string) {
    const article = this.catalog.get(parseInput(helpIdSchema, id));
    if (!article) throw new NotFoundException('Artigo de ajuda não encontrado');
    return { id: article.id, titulo: article.titulo, to: article.rota ? destinations[article.rota] : null, conteudo: article.conteudo };
  }
}
