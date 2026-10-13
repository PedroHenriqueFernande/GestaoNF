import { applyDecorators, Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { idSchema, keySchema } from './crm.schemas.js';
import { conflictSchema, createMeetingSchema, meetingHistorySchema, meetingListSchema, meetingStatusSchema, notificationListSchema, reopenMeetingSchema, rescheduleMeetingSchema, updateMeetingSchema, updateMeetingSettingsSchema } from './meeting.schemas.js';
import { MeetingReminderService } from './meeting-reminder.service.js';
import { MeetingsService } from './meetings.service.js';

const body = (schema: z.ZodType) => ({ schema: z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown> });
const query = (schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { io: 'input' });
  return applyDecorators(...Object.entries(json.properties ?? {}).map(([name, field]) => ApiQuery({ name, required: ['from', 'to'].includes(name), schema: field as Record<string, unknown> })));
};
const ctx = (r: RequestContext) => ({ companyId: r.companyId!, userId: r.userId! });
@ApiTags('CRM · Agenda')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('crm')
export class MeetingsController {
  constructor(@Inject(MeetingsService) private readonly meetings: MeetingsService, @Inject(MeetingReminderService) private readonly reminders: MeetingReminderService) {}

  @Post('meetings') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiBody(body(createMeetingSchema))
  @ApiOperation({ summary: 'Agenda reunião e qualifica somente a oportunidade explícita autorizada' })
  create(@Req() r: RequestContext, @Body() input: unknown, @Headers('idempotency-key') key: unknown) { return this.meetings.create(ctx(r), parseInput(createMeetingSchema, input), parseInput(keySchema, key)); }
  @Get('meetings') @query(meetingListSchema)
  list(@Req() r: RequestContext, @Query() input: unknown) { return this.meetings.list(ctx(r), parseInput(meetingListSchema, input)); }
  @Post('meetings/conflicts') @HttpCode(200) @ApiBody(body(conflictSchema))
  conflicts(@Req() r: RequestContext, @Body() input: unknown) { return this.meetings.conflicts(ctx(r), parseInput(conflictSchema, input)); }
  @Get('meetings/responsibles')
  responsibles(@Req() r: RequestContext) { return this.meetings.responsibles(ctx(r)); }
  @Get('meetings/:id')
  get(@Req() r: RequestContext, @Param('id') id: unknown) { return this.meetings.get(ctx(r), parseInput(idSchema, id)); }
  @Patch('meetings/:id') @ApiBody(body(updateMeetingSchema))
  update(@Req() r: RequestContext, @Param('id') id: unknown, @Body() input: unknown) { return this.meetings.update(ctx(r), parseInput(idSchema, id), parseInput(updateMeetingSchema, input)); }
  @Post('meetings/:id/reschedule') @HttpCode(200) @ApiBody(body(rescheduleMeetingSchema))
  reschedule(@Req() r: RequestContext, @Param('id') id: unknown, @Body() input: unknown) { return this.meetings.reschedule(ctx(r), parseInput(idSchema, id), parseInput(rescheduleMeetingSchema, input)); }
  @Patch('meetings/:id/status') @ApiBody(body(meetingStatusSchema))
  status(@Req() r: RequestContext, @Param('id') id: unknown, @Body() input: unknown) { return this.meetings.status(ctx(r), parseInput(idSchema, id), parseInput(meetingStatusSchema, input)); }
  @Post('meetings/:id/reopen') @HttpCode(200) @ApiBody(body(reopenMeetingSchema))
  reopen(@Req() r: RequestContext, @Param('id') id: unknown, @Body() input: unknown) { return this.meetings.reopen(ctx(r), parseInput(idSchema, id), parseInput(reopenMeetingSchema, input)); }
  @Get('meetings/:id/history') @query(meetingHistorySchema)
  history(@Req() r: RequestContext, @Param('id') id: unknown, @Query() input: unknown) { const page = parseInput(meetingHistorySchema, input); return this.meetings.history(ctx(r), parseInput(idSchema, id), page.limit, page.offset); }
  @Get('meeting-settings')
  settings(@Req() r: RequestContext) { return this.meetings.getSettings(ctx(r)); }
  @Patch('meeting-settings') @ApiBody(body(updateMeetingSettingsSchema))
  updateSettings(@Req() r: RequestContext, @Body() input: unknown) { return this.meetings.updateSettings(ctx(r), parseInput(updateMeetingSettingsSchema, input)); }
  @Get('notifications') @query(notificationListSchema)
  notifications(@Req() r: RequestContext, @Query() input: unknown) { return this.reminders.notifications(ctx(r), parseInput(notificationListSchema, input)); }
  @Patch('notifications/:id/read')
  read(@Req() r: RequestContext, @Param('id') id: unknown) { return this.reminders.read(ctx(r), parseInput(idSchema, id)); }
}
