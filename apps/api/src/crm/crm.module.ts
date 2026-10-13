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
import { SalesModule } from '../sales/sales.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ProposalsController } from './proposals.controller.js';
import { ProposalsService } from './proposals.service.js';
import { ProposalReadService } from './proposal-read.service.js';
import { ProposalDocumentService } from './proposal-document.service.js';

@Module({
  imports: [AuthModule, SalesModule, CustomersModule], controllers: [CrmController, MeetingsController, ProposalsController],
  providers: [CrmPolicyService, CrmHistoryService, LeadCaptureService, LeadsService, OpportunitiesService, MeetingsService, MeetingReminderService, ProposalsService, ProposalReadService, ProposalDocumentService],
  exports: [LeadCaptureService, LeadsService, OpportunitiesService, MeetingsService, MeetingReminderService, ProposalsService],
})
export class CrmModule {}
