import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wheelZoomFactor, clampZoom } from './wheelZoom';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('one mouse notch matches the schematic canvas (d3-zoom) step', () => {
  // Measured on the schematic canvas: deltaY -120 zooms by 1.181x. Every viewer
  // must agree with that number or the same gesture feels different per view.
  assert.ok(close(wheelZoomFactor({ deltaY: -120 }), 2 ** 0.24, 1e-9));
  assert.ok(Math.abs(wheelZoomFactor({ deltaY: -120 }) - 1.181) < 0.001);
});

test('zoom is proportional to wheel magnitude, not to event count', () => {
  // This is the property the layout canvas used to violate: it applied a fixed
  // 1.1x per EVENT, so a trackpad emitting many tiny deltas zoomed wildly.
  const fiveSmall = wheelZoomFactor({ deltaY: -10 }) ** 5;
  const oneBig = wheelZoomFactor({ deltaY: -50 });
  assert.ok(close(fiveSmall, oneBig), `${fiveSmall} != ${oneBig}`);
});

test('a gentle trackpad glide stays gentle', () => {
  // 15 events of -4 is a light two-finger glide; it must not multiply the zoom.
  const glide = wheelZoomFactor({ deltaY: -4 }) ** 15;
  assert.ok(glide < 1.1, `glide zoomed ${glide}x — too sensitive`);
});

test('zoom in and out are exact inverses', () => {
  const inF = wheelZoomFactor({ deltaY: -120 });
  const outF = wheelZoomFactor({ deltaY: 120 });
  assert.ok(close(inF * outF, 1), `${inF} * ${outF} != 1`);
});

test('a zero delta does not move the zoom', () => {
  assert.equal(wheelZoomFactor({ deltaY: 0 }), 1);
});

test('ctrl/pinch zooms faster, like the schematic canvas', () => {
  // d3 scales ctrl-wheel 10x: browsers send tiny deltas for a trackpad pinch.
  assert.ok(close(wheelZoomFactor({ deltaY: -10, ctrlKey: true }), 2 ** 0.2));
  assert.ok(close(wheelZoomFactor({ deltaY: -10, ctrlKey: true }) ** 5, 2));
});

test('line and page delta modes are scaled to pixel-equivalents', () => {
  // Firefox/Windows report deltaMode 1 (lines); treating those as pixels would
  // make one notch a no-op.
  assert.ok(close(wheelZoomFactor({ deltaY: -3, deltaMode: 1 }), 2 ** 0.15));
  assert.ok(close(wheelZoomFactor({ deltaY: -1, deltaMode: 2 }), 2 ** 1));
});

test('clampZoom holds the view inside its limits', () => {
  assert.equal(clampZoom(10, 0.05, 4), 4);
  assert.equal(clampZoom(0.001, 0.05, 4), 0.05);
  assert.equal(clampZoom(1, 0.05, 4), 1);
});
