// backend/src/assistant/tools/registry.ts
import type { ExecutionContext } from '../execution-context.js';
import type { ReadTool, WriteOperation } from './types.js';

export class ToolRegistry {
  private readonly reads = new Map<string, ReadTool>();
  private readonly writes = new Map<string, WriteOperation>();

  registerRead(tool: ReadTool) {
    if (this.reads.has(tool.name) || this.writes.has(tool.name)) throw new Error(`Ferramenta duplicada: ${tool.name}`);
    this.reads.set(tool.name, tool);
    return this;
  }

  registerWrite(operation: WriteOperation) {
    if (this.reads.has(operation.name) || this.writes.has(operation.name)) throw new Error(`Ferramenta duplicada: ${operation.name}`);
    this.writes.set(operation.name, operation);
    return this;
  }

  readTools(ctx: ExecutionContext) { return [...this.reads.values()].filter((tool) => tool.allowed(ctx)); }
  writeOperations(ctx: ExecutionContext) { return [...this.writes.values()].filter((operation) => operation.allowed(ctx)); }
  write(name: string) { return this.writes.get(name) ?? null; }
}
