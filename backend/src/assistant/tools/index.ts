// backend/src/assistant/tools/index.ts
import type { DatabaseService } from '../../database/database.module.js';
import type { CustomersService } from '../../customers/customers.service.js';
import type { FinanceReadService } from '../../finance/finance-read.service.js';
import type { ReportsReadService } from '../../reports/reports-read.service.js';
import type { SalesService } from '../../sales/sales.service.js';
import type { ServicesService } from '../../services/services.service.js';
import { createCustomerSearchTool, createServiceSearchTool } from './catalog-tools.js';
import { createCustomerOperation, updateCustomerOperation } from './customer-operations.js';
import { createReceivablesTool } from './finance-tools.js';
import { createServiceOperation, updateServiceOperation } from './service-operations.js';
import { ToolRegistry } from './registry.js';
import { createReportTool } from './report-tools.js';
import { createSaleDetailTool, createSalesListTool } from './sales-tools.js';
import { newTopicTool, switchCompanyTool } from './session-tools.js';

export type ReadServices = { customers: CustomersService; services: ServicesService; sales: SalesService; finance: FinanceReadService; reports: ReportsReadService };

/** Registro padrão. Fases seguintes acrescentam operações WRITE aqui. */
export function createToolRegistry(database: DatabaseService, readers: ReadServices) {
  return new ToolRegistry()
    .registerRead(createCustomerSearchTool(readers.customers))
    .registerRead(createServiceSearchTool(readers.services))
    .registerRead(createSalesListTool(database.db, readers.sales))
    .registerRead(createSaleDetailTool(database.db, readers.sales))
    .registerRead(createReceivablesTool(readers.finance))
    .registerRead(createReportTool(readers.reports))
    .registerRead(switchCompanyTool)
    .registerRead(newTopicTool)
    .registerWrite(createCustomerOperation(readers.customers))
    .registerWrite(updateCustomerOperation(readers.customers))
    .registerWrite(createServiceOperation(readers.services))
    .registerWrite(updateServiceOperation(readers.services));
}
