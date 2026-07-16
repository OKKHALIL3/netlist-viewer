import type { BreadcrumbEntry, SelectionType } from '../../store/viewerStore';
import { detectDeviceStructures } from '../../organize/deviceStructures';
import { classifyPin } from '../../layout/pinGroups';
import { traceDeviceConnectivity } from '../../hybrid/connectivity';
import { rankBySprawl } from '../../layout-viewer/insights';
import { getCachedDescription } from '../../ai/describeCell';
import { sliceParasitics } from '../queries/sliceParasitics';
import { findNets } from '../queries/findNets';
import { rankBlocksDetailed, rankNetsBy } from '../queries/rank';
import type { NetClass } from '../queries/netClass';
import type { CanonicalRef } from '../resolve';
import type { Ref } from '../refs';
import { fmtF, fmtOhm, fmtS } from './format';
import { err, NO_DESIGN, NO_DSPF, type ChatCtx, type ChatTool, type ToolResult } from './types';

// The bounded tool surface both chat brains dispatch. Every tool is a thin,
// verifiable wrapper over the pure query layer / store actions; nothing here
// generates content — answers can only cite what these return.

const refOf = (c: CanonicalRef): Ref =>
  c.kind === 'cell' ? { kind: 'cell', cell: c.cellName }
  : c.kind === 'block' ? { kind: 'block', path: c.hybridPath }
  : c.kind === 'net' ? { kind: 'net', net: c.netName, scope: c.scopes[0] }
  : { kind: 'device', cell: c.cellName, id: c.id };

const candidateData = (c: CanonicalRef) =>
  c.kind === 'cell' ? { kind: c.kind, cell: c.cellName, occurrences: c.total, firstPath: c.occurrences[0]?.map(p => p.label).join(' / ') }
  : c.kind === 'block' ? { kind: c.kind, blockPath: c.hybridPath, cell: c.cellName, category: c.category }
  : c.kind === 'net' ? { kind: c.kind, net: c.netName, inCell: c.cellName, scopes: c.scopes }
  : { kind: c.kind, device: c.id, inCell: c.cellName };

export function buildTools(getCtx: () => ChatCtx | null): ChatTool[] {
  const withCtx = (run: (ctx: ChatCtx, input: Record<string, unknown>) => ToolResult | Promise<ToolResult>) =>
    (input: Record<string, unknown>): ToolResult | Promise<ToolResult> => {
      const ctx = getCtx();
      if (!ctx) return err(NO_DESIGN);
      return run(ctx, input);
    };

  // Resolve a target string to exactly one block/cell, or explain why not.
  const resolveOne = (ctx: ChatCtx, target: string, kind: 'block' | 'cell' | 'net' | 'device') => {
    const { candidates, note } = ctx.resolver.resolveEntity(target, kind);
    if (candidates.length === 0) return { error: err(`Could not resolve "${target}" — ${note ?? 'no match'}.`) };
    return { ref: candidates[0], ambiguous: candidates.length > 1 };
  };

  const tools: ChatTool[] = [
    {
      name: 'get_context',
      description: 'Read the current UI context: active viewer, current cell, breadcrumb, selection, and what files are loaded. Call this to resolve deixis like "this block" or "here" before other tools.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: withCtx(ctx => ({
        data: {
          activeViewer: ctx.viewer.appMode,
          currentCell: ctx.viewer.currentCell,
          breadcrumb: ctx.viewer.breadcrumb.map(b => b.label).join(' / '),
          selection: ctx.viewer.selection,
          hybridSelectedBlock: ctx.hybrid.selected,
          topCell: ctx.design.topCell,
          cellCount: ctx.design.cells.size,
          dspfLoaded: ctx.dspfLoaded,
        },
      })),
    },
    {
      name: 'resolve_entity',
      description: 'Resolve a user mention ("the PLL", "ck", "M3", "XU1/XS2") to concrete design elements with navigable addresses. ALWAYS resolve mentions before trace_path, analyze_slice, or navigate. kind narrows the search.',
      input_schema: {
        type: 'object',
        properties: {
          mention: { type: 'string', description: 'the name or phrase the user used' },
          kind: { type: 'string', enum: ['cell', 'block', 'net', 'device'] },
        },
        required: ['mention'],
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        const { candidates, note } = ctx.resolver.resolveEntity(String(input.mention ?? ''), input.kind as never);
        return {
          data: { candidates: candidates.map(candidateData), note },
          refs: candidates.map(refOf),
          isError: candidates.length === 0,
        };
      }),
    },
    {
      name: 'explain_block',
      description: 'Structured facts about a cell or block: ports with roles, detected device structures (differential pairs, current mirrors, ...), functional category, stats, and connected neighbor blocks. The evidence base for "what does this block do".',
      input_schema: {
        type: 'object',
        properties: { target: { type: 'string', description: 'cell name or block path' } },
        required: ['target'],
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        const r = resolveOne(ctx, String(input.target ?? ''), 'block');
        const c = r.ref ?? (resolveOne(ctx, String(input.target ?? ''), 'cell').ref);
        if (!c) return r.error!;
        const cellName = c.kind === 'block' || c.kind === 'cell' || c.kind === 'device' ? c.cellName : c.cellName;
        const cell = ctx.design.cells.get(cellName);
        if (!cell) return err(`Cell "${cellName}" not found in the design.`);

        const netKind = new Map(cell.nets.map(n => [n.name, n.kind]));
        const ports = cell.ports.map(p => ({ name: p.name, role: classifyPin(p.name, netKind.get(p.name) ?? 'signal', cell.ports) }));
        const structures = detectDeviceStructures(cell, cell.primitives).map(s => ({ kind: s.kind, label: s.label, devices: s.memberIds }));

        const refs: Ref[] = [{ kind: 'cell', cell: cellName }];
        for (const s of structures) for (const id of s.devices.slice(0, 4)) refs.push({ kind: 'device', cell: cellName, id });

        let block: Record<string, unknown> | null = null;
        let neighbors: string[] = [];
        if (c.kind === 'block' && ctx.hybrid.model) {
          const b = ctx.hybrid.model.blocks.get(c.hybridPath);
          if (b) {
            block = {
              path: b.path, category: b.category, devicesRecursive: b.devices,
              nets: b.netCount, pins: b.pins, pinRoles: b.pinRoles, supplyDomains: b.domains,
            };
            if (ctx.hybrid.conductors) {
              const trace = traceDeviceConnectivity(ctx.design, ctx.hybrid.model, ctx.hybrid.conductors, c.hybridPath);
              neighbors = [...trace.blocks].slice(0, 8);
              for (const n of neighbors) refs.push({ kind: 'block', path: n });
            }
          }
        }

        return {
          data: {
            cell: cellName,
            ports,
            deviceCount: cell.primitives.length,
            subBlockCount: cell.instances.length,
            structures,
            block,
            connectedNeighborBlocks: neighbors,
            cachedAiDescription: getCachedDescription(cellName),
          },
          refs,
        };
      }),
    },
    {
      name: 'trace_path',
      description: 'Trace the signal path between two pins across the hierarchy and solve per-net R/C/Elmore from the DSPF. Endpoints are "block/path:PIN" (empty block path or "top" = top-level port). Renders the path in the Hybrid viewer. Use resolve_entity/trace_net first to find endpoints.',
      input_schema: {
        type: 'object',
        properties: {
          fromPin: { type: 'string', description: 'e.g. "xu1/xs2:CK" or "top:IN"' },
          toPin: { type: 'string' },
        },
        required: ['fromPin', 'toPin'],
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        if (!ctx.hybrid.model) return err('Hybrid model unavailable — this design has not been indexed yet.');
        if (!ctx.hybrid.pathMode) ctx.hybrid.togglePathMode();
        ctx.hybrid.setPathPins(String(input.fromPin ?? ''), String(input.toPin ?? ''));
        const st = ctx.hybrid.readPathState();
        if (!st.pathPinsValid) return err(`Endpoints did not resolve: "${input.fromPin}" / "${input.toPin}". Check block paths and pin names (resolve_entity can help).`);
        if (!st.pathResult) return err('No signal path connects those two pins (supplies are excluded from tracing).');
        ctx.viewer.setAppMode('hybrid');
        const p = st.pathParasitics;
        const segments = p?.segments.map(s => ({
          net: s.net, status: s.status,
          r: s.r, rFmt: fmtOhm(s.r), c: s.c, cFmt: fmtF(s.c), elmore: s.elmore, elmoreFmt: fmtS(s.elmore),
        })) ?? null;
        const refs: Ref[] = st.pathResult.blocks.map(b => ({ kind: 'block', path: b } as Ref));
        for (const n of st.pathResult.netNames) refs.push({ kind: 'net', net: n });
        return {
          data: {
            blocks: st.pathResult.blocks,
            nets: st.pathResult.netNames,
            hopCount: st.pathResult.netCount,
            layers: st.pathLayers,
            parasitics: p ? { segments, totalR: p.totalR, totalRFmt: fmtOhm(p.totalR), totalC: p.totalC, totalCFmt: fmtF(p.totalC), totalElmore: p.totalElmore, totalElmoreFmt: fmtS(p.totalElmore), matched: p.matched, solved: p.solved } : NO_DSPF,
          },
          refs,
          uiEffect: 'Path rendered as an overlay in the Hybrid viewer.',
        };
      }),
    },
    {
      name: 'trace_net',
      description: 'Find the electrical conductor a net belongs to and which blocks it reaches — the net-first entry to tracing. Returns the blocks on the conductor and device endpoints usable as trace_path pins.',
      input_schema: {
        type: 'object',
        properties: {
          net: { type: 'string' },
          nearBlock: { type: 'string', description: 'optional block path that scopes which copy of the net is meant' },
        },
        required: ['net'],
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        const cond = ctx.hybrid.conductors;
        if (!cond) return err('Connectivity graph unavailable — this design has not been indexed yet.');
        const netName = String(input.net ?? '').trim();
        const near = input.nearBlock ? String(input.nearBlock) : null;

        // Candidate scopes: the explicit nearBlock, the resolver's hits, then top.
        const scopes: string[] = [];
        if (near !== null) scopes.push(near);
        const { candidates } = ctx.resolver.resolveEntity(netName, 'net');
        for (const c of candidates) if (c.kind === 'net') scopes.push(...c.scopes);
        scopes.push('');

        let hit: { scope: string; id: number } | null = null;
        for (const scope of scopes) {
          const id = cond.idOf.get(`${scope}|${netName}`);
          if (id !== undefined) { hit = { scope, id }; break; }
        }
        if (!hit) return err(`Net "${netName}" is not on any signal conductor${near ? ` near "${near}"` : ''} — check the name, or it may be a supply net (supplies are not traced).`);

        const blocks = [...(cond.blocksOf.get(hit.id) ?? [])];
        const deviceBlocks = [...(cond.deviceBlocksOf.get(hit.id) ?? [])];
        const memberNets = (cond.members.get(hit.id) ?? []).map(m => ({ scope: m.scope, net: m.net }));
        return {
          data: {
            net: netName,
            scope: hit.scope,
            blocksOnConductor: blocks,
            deviceEndpointBlocks: deviceBlocks,
            spellingsByScope: memberNets.slice(0, 12),
            hint: 'To measure the path, call trace_path with "BLOCK:PIN" endpoints — pick blocks from deviceEndpointBlocks and pins from their cells.',
          },
          refs: [{ kind: 'net', net: netName, scope: hit.scope }, ...blocks.slice(0, 8).map(b => ({ kind: 'block', path: b } as Ref))],
        };
      }),
    },
    {
      name: 'find_nets',
      description: 'Search nets by predicate: heuristic class (bias/clock/signal) crossed with coupling and total-cap thresholds and an optional name pattern. Requires a loaded DSPF. Returns a selectable result table.',
      input_schema: {
        type: 'object',
        properties: {
          class: { type: 'string', enum: ['bias', 'clock', 'signal', 'any'] },
          minCouplingFf: { type: 'number', description: 'minimum summed coupling in femtofarads' },
          minTotalCapFf: { type: 'number' },
          namePattern: { type: 'string' },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        if (!ctx.layoutData || !ctx.hybrid.couplingPairs) return err(NO_DSPF);
        const { rows, total } = findNets({
          data: ctx.layoutData,
          pairs: ctx.hybrid.couplingPairs,
          supplyIdx: ctx.supplyIdx ?? new Set(),
          classes: ctx.netClasses,
          klass: (input.class as NetClass | 'any') ?? 'any',
          minCouplingF: typeof input.minCouplingFf === 'number' ? input.minCouplingFf * 1e-15 : undefined,
          minTotalCapF: typeof input.minTotalCapFf === 'number' ? input.minTotalCapFf * 1e-15 : undefined,
          namePattern: input.namePattern ? String(input.namePattern) : undefined,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        });
        const classNote = input.class && input.class !== 'any' ? `Net class "${input.class}" is a HEURISTIC (derived from cell taxonomy and net names). ` : '';
        return {
          data: {
            note: `${classNote}${rows.length} of ${total} matching nets shown.`,
            nets: rows.map(r => ({ net: r.net, class: r.class, coupling: fmtF(r.couplingTotal), worstPartner: r.worstPartner ? { net: r.worstPartner.net, cap: fmtF(r.worstPartner.cap) } : null, totalCap: fmtF(r.totalCap) })),
          },
          table: {
            columns: ['Net', 'Class', 'Coupling', 'Worst partner', 'Total cap'],
            rows: rows.map(r => ({
              cells: [r.net, r.class, fmtF(r.couplingTotal), r.worstPartner ? `${r.worstPartner.net} (${fmtF(r.worstPartner.cap)})` : '—', fmtF(r.totalCap)],
              ref: { kind: 'net', net: r.net } as Ref,
            })),
            note: `${classNote}Showing ${rows.length} of ${total}.`,
          },
        };
      }),
    },
    {
      name: 'analyze_slice',
      description: 'Parasitic summary of a block: per-net wire R, grounded C, coupling C, pin C sums over every DSPF net the block (and its subtree) touches, with top coupled partners. All figures are exact sums of extracted elements.',
      input_schema: {
        type: 'object',
        properties: { block: { type: 'string' }, limit: { type: 'number' } },
        required: ['block'],
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        if (!ctx.layoutData || !ctx.hybrid.couplingPairs) return err(NO_DSPF);
        if (!ctx.hybrid.model) return err('Hybrid model unavailable.');
        const r = resolveOne(ctx, String(input.block ?? ''), 'block');
        if (!r.ref || r.ref.kind !== 'block') return r.error ?? err(`"${input.block}" is not a block.`);
        const b = ctx.hybrid.model.blocks.get(r.ref.hybridPath);
        if (!b) return err(`Block "${r.ref.hybridPath}" not found.`);
        if (!b.dspfNets || b.dspfNets.size === 0) return err(`No DSPF nets correlate to block "${b.path}" — the extraction may not cover it.`);
        const out = sliceParasitics(b.dspfNets, ctx.layoutData, ctx.hybrid.couplingPairs, typeof input.limit === 'number' ? input.limit : 25);
        return {
          data: {
            block: b.path,
            netCount: out.netCount,
            totals: { wireR: fmtOhm(out.totals.r), groundedC: fmtF(out.totals.cGround), couplingC: fmtF(out.totals.cCoupling), pinC: fmtF(out.totals.cPin) },
            truncated: out.truncated ? `showing top ${out.nets.length} of ${out.netCount} nets by C` : false,
            nets: out.nets.map(n => ({ net: n.net, wireR: fmtOhm(n.rTotal), groundedC: fmtF(n.cGround), couplingC: fmtF(n.cCoupling), partners: n.partners.map(p => `${p.net} (${fmtF(p.cap)})`) })),
          },
          table: {
            columns: ['Net', 'Wire R (Σ)', 'Grounded C', 'Coupling C', 'Top partner'],
            rows: out.nets.map(n => ({
              cells: [n.net, fmtOhm(n.rTotal), fmtF(n.cGround), fmtF(n.cCoupling), n.partners[0] ? `${n.partners[0].net} (${fmtF(n.partners[0].cap)})` : '—'],
              ref: { kind: 'net', net: n.net } as Ref,
            })),
            note: out.truncated ? `Top ${out.nets.length} of ${out.netCount} nets by capacitance.` : undefined,
          },
          refs: [{ kind: 'block', path: b.path }],
        };
      }),
    },
    {
      name: 'rank_blocks',
      description: 'Rank blocks by the routing-criticality composite (devices, nets, parasitic elements, coupling) with per-component breakdown so you can explain WHY each block ranks high.',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'number' } },
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        if (!ctx.hybrid.model) return err('Hybrid model unavailable.');
        const ranked = rankBlocksDetailed(ctx.hybrid.model, ctx.hybrid.weights, typeof input.limit === 'number' ? input.limit : 10);
        return {
          data: ranked.map(r => ({ block: r.path || '(top)', score: Number(r.score.toFixed(3)), devices: r.components.devices, nets: r.components.nets, parasiticElements: r.components.parasitics, coupling: r.components.coupling === null ? null : fmtF(r.components.coupling) })),
          table: {
            columns: ['Block', 'Score', 'Devices', 'Nets', 'R+C elems', 'Coupling'],
            rows: ranked.map(r => ({
              cells: [r.path || '(top)', r.score.toFixed(3), String(r.components.devices), String(r.components.nets), r.components.parasitics === null ? '—' : String(r.components.parasitics), r.components.coupling === null ? '—' : fmtF(r.components.coupling)],
              ref: { kind: 'block', path: r.path } as Ref,
            })),
            note: ctx.dspfLoaded ? undefined : 'No DSPF loaded — parasitic and coupling components are missing from the score.',
          },
          refs: ranked.slice(0, 5).map(r => ({ kind: 'block', path: r.path } as Ref)),
        };
      }),
    },
    {
      name: 'rank_nets',
      description: 'Rank nets by summed coupling capacitance, total capacitance, or physical sprawl (bbox area vs the blocks they touch). Requires a loaded DSPF.',
      input_schema: {
        type: 'object',
        properties: {
          by: { type: 'string', enum: ['coupling', 'totalCap', 'sprawl'] },
          limit: { type: 'number' },
        },
        required: ['by'],
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        const limit = typeof input.limit === 'number' ? input.limit : 10;
        if (input.by === 'sprawl') {
          if (!ctx.layoutModel) return err(NO_DSPF);
          const rows = rankBySprawl(ctx.layoutModel, limit);
          return {
            data: rows.map(r => ({ net: r.name, areaUm2: r.area, reach: r.reach, instances: r.instances })),
            table: { columns: ['Net', 'Area (µm²)', 'Reach ratio', 'Blocks touched'], rows: rows.map(r => ({ cells: [r.name, r.area.toFixed(1), r.reach.toFixed(2), String(r.instances)], ref: { kind: 'net', net: r.name } as Ref })) },
          };
        }
        if (!ctx.layoutData || !ctx.hybrid.couplingPairs) return err(NO_DSPF);
        const rows = rankNetsBy(ctx.layoutData, ctx.hybrid.couplingPairs, ctx.supplyIdx ?? new Set(), input.by as 'coupling' | 'totalCap', limit);
        return {
          data: rows.map(r => ({ net: r.net, value: fmtF(r.value) })),
          table: { columns: ['Net', input.by === 'coupling' ? 'Σ coupling' : 'Total cap'], rows: rows.map(r => ({ cells: [r.net, fmtF(r.value)], ref: { kind: 'net', net: r.net } as Ref })) },
        };
      }),
    },
    {
      name: 'navigate',
      description: 'Jump the viewers to an element: open its cell, select it, and frame it. Verifies the jump landed. viewer chooses where to show it (defaults to the active viewer; block targets render best in hybrid).',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'name or path — resolved like resolve_entity' },
          kind: { type: 'string', enum: ['cell', 'block', 'net', 'device'] },
          viewer: { type: 'string', enum: ['schematic', 'layout', 'hybrid'] },
        },
        required: ['target'],
        additionalProperties: false,
      },
      run: withCtx((ctx, input) => {
        const { candidates, note } = ctx.resolver.resolveEntity(String(input.target ?? ''), input.kind as never);
        if (candidates.length === 0) return err(`Could not resolve "${input.target}" — ${note ?? 'no match'}.`);
        const c = candidates[0];
        const wantViewer = (input.viewer as 'schematic' | 'layout' | 'hybrid' | undefined) ?? ctx.viewer.appMode;

        if (c.kind === 'block' && wantViewer === 'hybrid') {
          ctx.viewer.setAppMode('hybrid');
          ctx.hybrid.jumpToPath(c.hybridPath);
          const landed = ctx.hybrid.readSelected() === c.hybridPath;
          if (!landed) return err(`Jump to "${c.hybridPath}" did not land (block missing from the hybrid model).`);
          return { data: { jumped: c.hybridPath, viewer: 'hybrid' }, refs: [refOf(c)], uiEffect: `Hybrid viewer opened at ${c.hybridPath} with its connectivity trace.` };
        }

        // Schematic/layout path: everything lands via goToPath + a selection.
        let crumbs: BreadcrumbEntry[];
        let selection: SelectionType | null = null;
        if (c.kind === 'block') { crumbs = c.crumbs.slice(0, -1); selection = { type: 'instance', id: c.crumbs[c.crumbs.length - 1].label }; }
        else if (c.kind === 'cell') { crumbs = c.occurrences[0] ?? [{ label: ctx.design.topCell, cellName: ctx.design.topCell }]; }
        else if (c.kind === 'net') {
          const occ = ctx.resolver.resolveEntity(c.cellName, 'cell').candidates[0];
          crumbs = occ && occ.kind === 'cell' ? occ.occurrences[0] : [{ label: ctx.design.topCell, cellName: ctx.design.topCell }];
          selection = { type: 'net', name: c.netName };
        } else {
          const occ = ctx.resolver.resolveEntity(c.cellName, 'cell').candidates[0];
          crumbs = occ && occ.kind === 'cell' ? occ.occurrences[0] : [{ label: ctx.design.topCell, cellName: ctx.design.topCell }];
          selection = { type: 'primitive', id: c.id };
        }
        if (wantViewer !== ctx.viewer.appMode && wantViewer !== 'hybrid') ctx.viewer.setAppMode(wantViewer);
        ctx.viewer.goToPath(crumbs, selection);
        const after = ctx.viewer.readBreadcrumb();
        const landed = after.length === crumbs.length && after[after.length - 1]?.cellName === crumbs[crumbs.length - 1]?.cellName;
        if (!landed) return err(`Navigation to "${input.target}" did not land — the occurrence path may be stale.`);
        return { data: { jumped: crumbs.map(p => p.label).join(' / '), selection, viewer: wantViewer }, refs: [refOf(c)], uiEffect: `Viewer framed ${input.target}.` };
      }),
    },
  ];

  return tools;
}
