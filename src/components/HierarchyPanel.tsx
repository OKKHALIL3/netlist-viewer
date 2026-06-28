import { useMemo, useState } from 'react';
import { useViewerStore, type BreadcrumbEntry } from '../store/viewerStore';
import { pathToInstanceId } from '../layout-viewer/correlate';
import type { Design } from '../parser/types';

interface TreeNode {
  id: string;
  instanceId: string;
  cellName: string;
  isExternal: boolean;
  children: TreeNode[];
  busSize?: number;
  // Full breadcrumb path from the top cell down to (and including) this
  // node — this tree spans the whole design, not just the current cell, so
  // navigating to a node must replace the breadcrumb wholesale (goToPath)
  // rather than push relative to wherever the canvas currently is.
  path: BreadcrumbEntry[];
}

function buildTree(cellName: string, design: Design, parentPath: BreadcrumbEntry[], visited = new Set<string>()): TreeNode[] {
  if (visited.has(cellName)) return [];
  visited.add(cellName);
  const cell = design.cells.get(cellName);
  if (!cell) return [];

  // Group by busBase
  const grouped = new Map<string, typeof cell.instances>();
  for (const inst of cell.instances) {
    const key = inst.busBase ?? inst.id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(inst);
  }

  const nodes: TreeNode[] = [];
  for (const [key, insts] of grouped) {
    const rep = insts[0];
    const isBus = insts.length > 1;
    const isExternal = !design.cells.has(rep.master);
    const instanceId = isBus ? `${key}<${Math.max(...insts.map(i => i.busIndex ?? 0))}:0>` : rep.id;
    const path = [...parentPath, { label: instanceId, cellName: rep.master }];
    const children = isExternal ? [] : buildTree(rep.master, design, path, new Set(visited));
    nodes.push({
      id: key,
      instanceId,
      cellName: rep.master,
      isExternal,
      children,
      busSize: isBus ? insts.length : undefined,
      path,
    });
  }
  return nodes;
}

function TreeRow({
  node,
  currentCell,
  depth,
}: {
  node: TreeNode;
  currentCell: string;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const { goToPath } = useViewerStore();
  const appMode = useViewerStore(s => s.appMode);
  const layoutModel = useViewerStore(s => s.layoutModel);
  const selection = useViewerStore(s => s.selection);
  const selectAndFocus = useViewerStore(s => s.selectAndFocus);
  const hasChildren = node.children.length > 0;
  const canDescend = !node.isExternal;

  // In layout mode a row maps to a layout instance box (normalized instance path).
  const layoutId = pathToInstanceId(node.path.slice(1).map(e => e.label));
  const inLayout = appMode === 'layout' && !!layoutModel;
  const hasBox = inLayout && layoutModel!.instances.some(i => i.id === layoutId);
  const isActive = inLayout
    ? selection?.type === 'instance' && selection.id === layoutId
    : node.cellName === currentCell;

  const handleClick = () => {
    if (hasChildren) setOpen(o => !o);
    if (inLayout) {
      if (hasBox) selectAndFocus({ type: 'instance', id: layoutId });   // highlight + frame on the canvas
    } else if (canDescend) {
      goToPath(node.path, null);
    }
  };

  return (
    <>
      <div
        className={`tree-row${isActive ? ' active' : ''}${inLayout && !hasBox ? ' nobox' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        title={inLayout
          ? (hasBox ? `Show ${node.cellName} on the layout` : 'No correlated layout box')
          : canDescend ? `Descend into ${node.cellName}` : 'External cell'}
      >
        <span className="tree-chev">{hasChildren ? (open ? '▾' : '▸') : ''}</span>
        <span className={`tree-ic ${node.isExternal ? 'leaf' : 'cell'}`}>
          {node.isExternal ? 'L' : '▦'}
        </span>
        <span className="tree-id">{node.instanceId}</span>
        <span className="tree-master">
          {node.cellName}
          {node.busSize ? ` ×${node.busSize}` : ''}
        </span>
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map(child => (
            <TreeRow key={child.id} node={child} currentCell={currentCell} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  );
}

export function HierarchyPanel() {
  const { design, currentCell, goToPath } = useViewerStore();
  const appMode = useViewerStore(s => s.appMode);
  const layoutModel = useViewerStore(s => s.layoutModel);
  const selection = useViewerStore(s => s.selection);
  const selectAndFocus = useViewerStore(s => s.selectAndFocus);

  const tree = useMemo(() => {
    if (!design) return [];
    return buildTree(design.topCell, design, [{ label: design.topCell, cellName: design.topCell }]);
  }, [design]);

  if (!design) return null;

  const inLayout = appMode === 'layout' && !!layoutModel;
  // The top row maps to the whole-design (depth-0) box in layout mode.
  const topActive = inLayout
    ? selection?.type === 'instance' && selection.id === ''
    : design.topCell === currentCell;
  const onTopClick = () => {
    if (inLayout) selectAndFocus({ type: 'instance', id: '' });
    else goToPath([{ label: design.topCell, cellName: design.topCell }], null);
  };

  return (
    <div className="panel-left">
      <div className="panel-head">
        <h3>Hierarchy</h3>
      </div>
      <div className="tree-scroll">
        {/* Top cell row */}
        <div
          className={`tree-row${topActive ? ' active' : ''}`}
          style={{ paddingLeft: 8 }}
          onClick={onTopClick}
        >
          <span className="tree-chev">▾</span>
          <span className="tree-ic cell">▦</span>
          <span className="tree-id">top</span>
          <span className="tree-master">{design.topCell}</span>
        </div>
        {tree.map(node => (
          <TreeRow key={node.id} node={node} currentCell={currentCell} depth={1} />
        ))}
      </div>
    </div>
  );
}
