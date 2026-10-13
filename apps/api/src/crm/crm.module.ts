import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CrmController } from './crm.controller.js';
import { CrmPolicyService } from './crm-policy.service.js';
import { CrmHistoryService } from './crm-history.service.js';
import { LeadCaptureService } from './lead-capture.service.js';
import { LeadsService } from './leads.service.js';
import { OpportunitiesService } from './opportunities.service.js';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';
import { MeetingReminderService } from './meeting-reminder.service.js';

@Module({
  imports: [AuthModule], controllers: [CrmController, MeetingsController],
  providers: [CrmPolicyService, CrmHistoryService, LeadCaptureService, LeadsService, OpportunitiesService, MeetingsService, MeetingReminderService],
  exports: [LeadCaptureService, LeadsService, OpportunitiesService, MeetingsService, MeetingReminderService],
})
export class CrmModule {}
