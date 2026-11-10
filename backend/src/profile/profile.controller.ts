import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AccessGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { avatarIdSchema, beginAvatarUploadSchema, patchProfileSchema, uploadKeySchema } from './profile.schemas.js';
import { ProfileService } from './profile.service.js';

@UseGuards(AccessGuard) @Controller('profile')
export class ProfileController {
  private readonly empty = z.strictObject({});
  constructor(@Inject(ProfileService) private readonly profile: ProfileService) {}
  @Post('avatar/uploads')
  async begin(@Req() request: RequestContext, @Body() body: unknown, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(this.empty, query ?? {});
    reply.header('Cache-Control', 'private, no-store');
    const result = await this.profile.begin(request.userId!, parseInput(beginAvatarUploadSchema, body), parseInput(uploadKeySchema, request.headers['idempotency-key']));
    if (!result.upload) reply.code(200);
    return result;
  }
  @Post('avatar/uploads/:id/complete') @HttpCode(200)
  complete(@Req() request: RequestContext, @Param('id') id: string, @Body() body: unknown, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(this.empty, body === undefined ? {} : body);
    parseInput(this.empty, query ?? {});
    reply.header('Cache-Control', 'private, no-store');
    return this.profile.complete(request.userId!, parseInput(avatarIdSchema, id));
  }
  @Patch('me')
  patch(@Req() request: RequestContext, @Body() body: unknown, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(this.empty, query ?? {});
    reply.header('Cache-Control', 'private, no-store');
    return this.profile.patch(request.userId!, parseInput(patchProfileSchema, body));
  }
  @Get('avatar/access')
  access(@Req() request: RequestContext, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(this.empty, query ?? {});
    reply.header('Cache-Control', 'private, no-store');
    return this.profile.access(request.userId!);
  }
}
