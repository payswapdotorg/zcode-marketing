/**
 * Tool registrar — the shared registration closure for every marketing tool
 * (W3-1). Keeps the per-tool contract uniform: zod input/output schemas, MCP
 * annotations, typed error mapping, and the W3-4 panel routing (`_meta.ui`).
 * Split into its own module when the tool set outgrew one file (W4) so the
 * wave modules (server.ts, w4Tools.ts) register through the same contract.
 */
import type { z } from 'zod';
import { ZodError } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PANEL_URI, SURFACE_ID } from './serverConstants.js';
import { MarketingToolError } from './runtime.js';

export const textResult = (text: string, structuredContent?: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text }],
  ...(structuredContent ? { structuredContent } : {}),
});

export interface ToolConfig<In extends z.ZodRawShape, Out extends z.ZodRawShape> {
  description: string;
  input: In;
  output: Out;
  readOnly: boolean;
  /** Route results to the workspace panel (W3-4): the host opens/refreshes the surface. */
  panel?: boolean;
}

export type ToolRegistrar = <In extends z.ZodRawShape, Out extends z.ZodRawShape>(
  name: string,
  config: ToolConfig<In, Out>,
  execute: (
    input: z.infer<z.ZodObject<In>>,
  ) => Promise<{ text: string; structured: z.infer<z.ZodObject<Out>> }>,
) => void;

export function createRegistrar(server: McpServer): ToolRegistrar {
  return <In extends z.ZodRawShape, Out extends z.ZodRawShape>(
    name: string,
    config: ToolConfig<In, Out>,
    execute: (
      input: z.infer<z.ZodObject<In>>,
    ) => Promise<{ text: string; structured: z.infer<z.ZodObject<Out>> }>,
  ) => {
    server.registerTool(
      name,
      {
        description: config.description,
        inputSchema: config.input,
        outputSchema: config.output,
        annotations: {
          readOnlyHint: config.readOnly,
          destructiveHint: false,
          idempotentHint: config.readOnly,
        },
        _meta: {
          ui: config.panel
            ? { resourceUri: PANEL_URI, surface: SURFACE_ID, visibility: ['model', 'app'] }
            : { visibility: ['model'] },
        },
      },
      (async (input: z.infer<z.ZodObject<In>>) => {
        try {
          const { text, structured } = await execute(input);
          return textResult(text, structured as Record<string, unknown>);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code =
            error instanceof ZodError
              ? 'invalid_input'
              : error instanceof MarketingToolError
                ? error.code
                : 'marketing_failure';
          if (code === 'marketing_failure') {
            process.stderr.write(`[marketing] ${name}: ${String(error)}\n`);
          }
          return {
            isError: true,
            ...textResult(`[${code}] ${message}`, { error: { code, message } }),
          };
        }
      }) as never,
    );
  };
}
