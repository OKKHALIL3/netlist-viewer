// subcircuit_visualize — HTTP route.
//
// POST /subcircuit_visualize
//   Body: either the design JSON directly, or { design, ...options } where the
//   options are VisualizeOptions (cell, mode, hideSupply, nodeLayout, focusNet,
//   selection). See docs/subcircuit-visualize.md.
//   Returns: the laid-out scene JSON the viewer draws — { cell, topCell, nodes,
//   edges, positions, warnings }.
//
// Run with:  npm run serve:viz   (uses tsx; default port 8787, override with
// PORT). This is a thin, dependency-free wrapper around the headless
// `visualizeSubcircuit` core in src/viz — the same code path the browser canvas
// uses — so the API and the UI can never drift.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { visualizeSubcircuit, type VisualizeOptions } from '../src/viz/buildScene';
import { validateAndNormalizeDesign, DesignValidationError } from '../src/viz/validateDesign';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 64 * 1024 * 1024; // 64 MB — full-depth designs can be large.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Split a request body into the design payload and the render options. Accepts
// either the bare design, or an envelope { design, ...options }.
function splitPayload(parsed: unknown): { design: unknown; options: VisualizeOptions } {
  if (parsed && typeof parsed === 'object' && 'design' in (parsed as Record<string, unknown>)) {
    const { design, ...options } = parsed as Record<string, unknown>;
    return { design, options: options as VisualizeOptions };
  }
  return { design: parsed, options: {} };
}

async function handleVisualize(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    return send(res, 413, { error: err instanceof Error ? err.message : 'Could not read body' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return send(res, 400, { error: 'Body is not valid JSON' });
  }

  try {
    const { design: rawDesign, options } = splitPayload(parsed);
    const design = validateAndNormalizeDesign(rawDesign);
    const scene = await visualizeSubcircuit(design, options);
    return send(res, 200, { ...scene, warnings: design.warnings });
  } catch (err) {
    if (err instanceof DesignValidationError) return send(res, 422, { error: err.message });
    // A missing cell / layout failure — caller's input, report as 422.
    return send(res, 422, { error: err instanceof Error ? err.message : String(err) });
  }
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method === 'POST' && req.url?.split('?')[0] === '/subcircuit_visualize') {
    void handleVisualize(req, res);
    return;
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return send(res, 200, {
      service: 'subcircuit_visualize',
      usage: 'POST /subcircuit_visualize with the subcircuit design JSON (or { design, ...options })',
      docs: 'docs/subcircuit-visualize.md',
    });
  }
  send(res, 404, { error: `No route for ${req.method} ${req.url}` });
});

server.listen(PORT, () => {
  console.log(`subcircuit_visualize listening on http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/subcircuit_visualize`);
});
