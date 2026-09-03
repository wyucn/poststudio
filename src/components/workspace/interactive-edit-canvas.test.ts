import assert from "node:assert/strict";
import test from "node:test";
import {
  keyboardDelta,
  moveOverlay,
  resizeOverlay,
  type Overlay,
} from "./interactive-edit-canvas";

test("keyboard arrows expose precise and accelerated normalized deltas", () => {
  assert.deepEqual(keyboardDelta("ArrowLeft", false), { dx: -5, dy: 0 });
  assert.deepEqual(keyboardDelta("ArrowDown", true), { dx: 0, dy: 25 });
  assert.equal(keyboardDelta("Enter", false), null);
});

const point: Overlay = {
  id: 1,
  imageId: "image-1",
  type: "point",
  x1: 100,
  y1: 200,
  label: "图1 点选 #1",
  token: "图1<point>100 200</point>",
};

const box: Overlay = {
  id: 2,
  imageId: "image-1",
  type: "box",
  x1: 100,
  y1: 100,
  x2: 300,
  y2: 400,
  label: "图1 框选 #2",
  token: "图1<bbox>100 100 300 400</bbox>",
};

test("point marks move by normalized pointer delta and stay in bounds", () => {
  const moved = moveOverlay(point, 100, 100, 200, 250);
  assert.equal(moved.x1, 200);
  assert.equal(moved.y1, 350);

  const clamped = moveOverlay(point, 0, 0, 2000, 2000);
  assert.equal(clamped.x1, 999);
  assert.equal(clamped.y1, 999);
});

test("box marks preserve size while moving and clamp at image edges", () => {
  const moved = moveOverlay(box, 200, 200, 0, 50);
  assert.deepEqual(
    { x1: moved.x1, y1: moved.y1, x2: moved.x2, y2: moved.y2 },
    { x1: 0, y1: 0, x2: 200, y2: 300 }
  );
});

test("box resize handles update the requested edges with a minimum size", () => {
  const expanded = resizeOverlay(box, "se", 520, 640);
  assert.deepEqual(
    {
      x1: expanded.x1,
      y1: expanded.y1,
      x2: expanded.x2,
      y2: expanded.y2,
    },
    { x1: 100, y1: 100, x2: 520, y2: 640 }
  );

  const minimum = resizeOverlay(box, "nw", 500, 600);
  assert.deepEqual(
    {
      x1: minimum.x1,
      y1: minimum.y1,
      x2: minimum.x2,
      y2: minimum.y2,
    },
    { x1: 284, y1: 384, x2: 300, y2: 400 }
  );
});
