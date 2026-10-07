import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../common/validate.js';
import { allowedWebOrigins } from '../common/origins.js';
import { AccessGuard, type RequestContext } from './access.guard.js';
import { AuthService } from './auth.service.js';
import { loginSchema, refreshSchema, registerSchema, type ClientType } from './auth.schemas.js';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Cria a conta do usuário; a empresa é cadastrada depois' })
  @ApiBody({ schema: z.toJSONSchema(registerSchema, { io: 'input' }) as Record<string, unknown> })
  async register(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parseInput(registerSchema, body);
    const result = await this.auth.register(input);
    return this.respond(result, input.client, reply);
  }

  @Post('login')
  @HttpCode(200)
  @ApiBody({ schema: z.toJSONSchema(loginSchema, { io: 'input' }) as Record<string, unknown> })
  async login(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parseInput(loginSchema, body);
    const result = await this.auth.login(input);
    return this.respond(result, input.client, reply);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiBody({ schema: z.toJSONSchema(refreshSchema, { io: 'input' }) as Record<string, unknown> })
  async refresh(@Body() body: unknown, @Req() request: RequestContext, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parseInput(refreshSchema, body ?? {});
    const token = input.refreshToken ?? request.cookies?.refresh_token;
    if (!token) throw new BadRequestException('Refresh token necessário');
    if (!input.refreshToken) this.assertWebOrigin(request);
    const result = await this.auth.refresh(token);
    return this.respond(result, input.refreshToken ? 'mobile' : 'web', reply);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBody({ schema: z.toJSONSchema(refreshSchema, { io: 'input' }) as Record<string, unknown> })
  async logout(@Body() body: unknown, @Req() request: RequestContext, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = parseInput(refreshSchema, body ?? {});
    if (request.cookies?.refresh_token && !input.refreshToken) this.assertWebOrigin(request);
    await this.auth.logout(input.refreshToken ?? request.cookies?.refresh_token);
    reply.clearCookie('access_token', { path: '/' });
    reply.clearCookie('refresh_token', { path: '/auth' });
  }

  @Get('me')
  @UseGuards(AccessGuard)
  @ApiBearerAuth()
  async me(@Req() request: RequestContext) { return this.auth.me(request.userId!); }

  private respond<T extends { accessToken: string; refreshToken: string; expiresIn: number }>(result: T, client: ClientType, reply: FastifyReply) {
    if (client === 'mobile') return result;
    const secure = process.env.NODE_ENV === 'production';
    reply.setCookie('access_token', result.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: result.expiresIn });
    reply.setCookie('refresh_token', result.refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/auth', maxAge: 30 * 86400 });
    const { accessToken: _access, refreshToken: _refresh, ...publicResult } = result;
    return publicResult;
  }

  private assertWebOrigin(request: RequestContext) {
    const origin = request.headers.origin;
    if (!origin || !allowedWebOrigins().includes(origin)) {
      throw new BadRequestException('Origem da requisição inválida');
    }
  }
}
