import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Lazily-started, long-lived MCP stdio clients for the two tool servers.
 * Agent nodes call `callTool` instead of talking to Supabase directly,
 * keeping every data-access path behind the MCP tool contracts defined in
 * `src/mcp/schemas.ts`.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..");

// tsx runs directly against src/**/*.ts; a production build runs the
// compiled dist/**/*.js. Point the spawned MCP server at whichever variant
// is currently executing, using the project's own local tsx binary so
// resolution doesn't depend on the parent process's PATH.
const isCompiled = currentDir.includes(`${path.sep}dist${path.sep}`) || currentDir.endsWith(`${path.sep}dist`);
const scriptExt = isCompiled ? "js" : "ts";
const runnerCommand = isCompiled ? process.execPath : path.join(projectRoot, "node_modules", ".bin", "tsx");

function serverScriptPath(scriptName: string): string {
  return path.join(currentDir, `${scriptName}.${scriptExt}`);
}

let auditClient: Promise<Client> | undefined;
let purchasingClient: Promise<Client> | undefined;

async function connectClient(clientName: string, scriptName: string): Promise<Client> {
  const client = new Client({ name: `supplyguard-${clientName}-client`, version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: runnerCommand,
    args: [serverScriptPath(scriptName)],
  });
  await client.connect(transport);
  return client;
}

export function getAuditClient(): Promise<Client> {
  auditClient ??= connectClient("audit", "auditServer");
  return auditClient;
}

export function getPurchasingClient(): Promise<Client> {
  purchasingClient ??= connectClient("purchasing", "purchasingServer");
  return purchasingClient;
}

/**
 * Calls an MCP tool and parses its (JSON-encoded text) result.
 */
export async function callTool<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  if (result.isError) {
    const message = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    throw new Error(`MCP tool "${name}" failed: ${message || "unknown error"}`);
  }

  const textBlock = result.content.find((block): block is { type: "text"; text: string } => block.type === "text");
  if (!textBlock) {
    throw new Error(`MCP tool "${name}" returned no text content`);
  }
  return JSON.parse(textBlock.text) as T;
}
