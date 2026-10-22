import express from 'express';
import { z } from 'zod';
import { agentEnabled, runAgent } from '../agent.ts';
import { currentUser } from '../auth.ts';
import { config } from '../config.ts';
import { visibleTools } from '../catalog.ts';
import { h } from '../util.ts';

export const chatRouter = express.Router();

chatRouter.get(
  '/config',
  h(async (_req, res) => {
    const tools = await visibleTools(currentUser(res).role);
    res.json({
      enabled: agentEnabled(),
      provider: config.llm.provider,
      model: config.llm.model,
      toolMode: tools.length > config.llm.directToolLimit ? 'search' : 'direct',
    });
  }),
);

chatRouter.post(
  '/',
  h(async (req, res) => {
    const user = currentUser(res);
    const { message, history } = z.object({ message: z.string().trim().min(1).max(4_000), history: z.array(z.unknown()).max(200).optional() }).parse(req.body);

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    if (!agentEnabled()) {
      send('error', { message: 'The chat agent is not configured: set llm.apiKey in the Helm values (stored as a Kubernetes Secret).' });
      send('done', { history: history ?? [] });
      return void res.end();
    }

    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      for await (const evt of runAgent(user, message, history ?? [], abort.signal)) {
        const { type, ...data } = evt;
        send(type, data);
      }
    } catch (err) {
      console.error('agent failed', err);
      send('error', { message: `Agent failed: ${(err as Error).message}` });
    }
    res.end();
  }),
);
