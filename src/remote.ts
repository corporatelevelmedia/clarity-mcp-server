import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

import pkg from "../package.json" with { type: "json" };

import {
  ANALYTICS_DASHBOARD_DESCRIPTION,
  ANALYTICS_DASHBOARD_TOOL,
  CLARITY_API_TOKEN,
  DOCUMENTATION_DESCRIPTION,
  DOCUMENTATION_TOOL,
  SESSION_RECORDINGS_DESCRIPTION,
  SESSION_RECORDINGS_TOOL
} from "./constants.js";
import {
  SYSTEM_INSTRUCTIONS_PROMPT
} from "./instructions.js";
import {
  listSessionRecordingsAsync,
  queryAnalyticsDashboardAsync,
  queryDocumentationAsync
} from "./tools.js";
import {
  ListRequest,
  SearchRequest,
} from "./types.js";

// Create a separate MCP server for each request.
function createMcpServer() {
const server = new McpServer(
  {
    name: pkg.name,
    version: pkg.version,
    capabilities: {
      resources: {},
      tools: {}
    },
  },
  {
    instructions: SYSTEM_INSTRUCTIONS_PROMPT,
  }
);

// Register the query-analytics-data tool
server.tool(
  ANALYTICS_DASHBOARD_TOOL,             /* Name */
  ANALYTICS_DASHBOARD_DESCRIPTION,      /* Description */
  SearchRequest,                        /* Parameter Schema */
  {                                     /* Metadata & Annotations */
    title: "Query Analytics Dashboard",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  async ({ query }) => {
    return await queryAnalyticsDashboardAsync(query, Intl.DateTimeFormat().resolvedOptions().timeZone);
  }
);

// Register the session-recordings tool
server.tool(
  SESSION_RECORDINGS_TOOL,              /* Name */
  SESSION_RECORDINGS_DESCRIPTION,       /* Description */
  ListRequest,                          /* Parameter Schema */
  {                                     /* Metadata & Annotations */
    title: "List Session Recordings",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  async ({ filters, sortBy, count }) => {
    const now = new Date().toISOString();

    // Calculate end as now, start as now - numOfDays
    const endDate = new Date(filters?.date?.end || now);
    const startDate = new Date(filters?.date?.start || now);

    if (!filters?.date?.start) {
      startDate.setDate(endDate.getDate() - 2);
    }

    return await listSessionRecordingsAsync(startDate, endDate, filters, sortBy, count);
  }
);

// Register the query-documentation-resources tool
server.tool(
  DOCUMENTATION_TOOL,                   /* Name */
  DOCUMENTATION_DESCRIPTION,            /* Description */
  SearchRequest,                        /* Parameter Schema */
  {                                     /* Metadata & Annotations */
    title: "Query Documentation Resources",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  },
  async ({ query }) => {
    return await queryDocumentationAsync(query);
  }
);

return server;
}

const secret = process.env.MCP_AUTH_TOKEN;
if (!secret || !CLARITY_API_TOKEN) throw new Error("Missing MCP_AUTH_TOKEN or CLARITY_API_TOKEN");
const port = Number(process.env.PORT || 10000);
const httpServer = createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.url !== "/mcp") { res.writeHead(404).end(); return; }
  const provided = (req.headers.authorization || "").replace(/^Bearer /i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.writeHead(401, { "www-authenticate": 'Bearer realm="CLM Clarity MCP"' }).end();
    return;
  }
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }).end(); return; }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
    res.on("close", () => { void transport.close(); void server.close(); });
  } catch (error) {
    console.error("MCP request error", error);
    if (!res.headersSent) res.writeHead(500).end();
    await transport.close();
    await server.close();
  }
});
httpServer.listen(port, "0.0.0.0", () => console.error("Clarity MCP listening on port", port));
