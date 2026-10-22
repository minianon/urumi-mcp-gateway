import express from 'express';
import client from 'prom-client';
import { config } from './config.ts';

const registry = new client.Registry();
registry.setDefaultLabels({ pod: config.podName });
client.collectDefaultMetrics({ register: registry });

export const metrics = {
  toolCalls: new client.Counter({
    name: 'urumi_tool_calls_total',
    help: 'Tool calls routed through the gateway',
    labelNames: ['server', 'outcome', 'client'] as const,
    registers: [registry],
  }),
  toolLatency: new client.Histogram({
    name: 'urumi_tool_call_duration_seconds',
    help: 'End-to-end latency of tool calls, gateway to upstream and back',
    labelNames: ['server'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  }),
  upstreamUp: new client.Gauge({ name: 'urumi_upstream_up', help: '1 if the upstream MCP server is connected', labelNames: ['server'] as const, registers: [registry] }),
  upstreamTools: new client.Gauge({ name: 'urumi_upstream_tools', help: 'Tools advertised by the upstream', labelNames: ['server'] as const, registers: [registry] }),
  authFailures: new client.Counter({ name: 'urumi_mcp_auth_failures_total', help: 'Rejected MCP requests', labelNames: ['reason'] as const, registers: [registry] }),
  mcpSessions: new client.Gauge({ name: 'urumi_mcp_sse_streams', help: 'Open MCP SSE notification streams on this replica', registers: [registry] }),
};

/** Served on a separate port that the Ingress does not route to. */
export function startMetricsServer() {
  const app = express();
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType).send(await registry.metrics());
  });
  app.listen(config.metricsPort, () => console.log(`metrics on :${config.metricsPort}/metrics`));
}
