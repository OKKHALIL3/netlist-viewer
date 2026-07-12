import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from './viewerStore';
import { makeDesign } from '../layout-viewer/__fixtures__/fixtures';
import { parseDspf } from '../layout-viewer/dspf/parseDspf';

test('loadLayout correlates against the loaded design and inits layer visibility', () => {
  const s = useViewerStore.getState();
  s.loadDesign(makeDesign('TOP', { TOP: [['X9', 'BLK']], BLK: [] }, { BLK: ['M1', 'M2'] }));
  const data = parseDspf([
    '*|NET N 1', '*|S (X9/M1:o 0 0)', '*|S (X9/M2:o 2 2)',
    'R1 X9/M1:o X9/M2:o 1 $layer=metal2',
    '*|I (X9/M1:d X9/M1 d nch 0.5 0 0)',
    '*|I (X9/M2:d X9/M2 d nch 0.5 2 2)',
  ].join('\n'));
  useViewerStore.getState().loadLayout(data);

  const st = useViewerStore.getState();
  assert.ok(st.layoutModel);
  assert.equal(st.layoutModel!.instances.some(i => i.id === 'x9'), true);
  assert.deepEqual(st.layerVisibility, { metal2: true });

  st.toggleLayer('metal2');
  assert.equal(useViewerStore.getState().layerVisibility.metal2, false);

  st.setAppMode('layout');
  assert.equal(useViewerStore.getState().appMode, 'layout');

  // loading a fresh CDL clears the layout + returns to schematic mode
  useViewerStore.getState().loadDesign(makeDesign('TOP2', { TOP2: [] }));
  const reset = useViewerStore.getState();
  assert.equal(reset.layoutModel, null);
  assert.equal(reset.appMode, 'schematic');
});
