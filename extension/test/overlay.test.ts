import test from "node:test";
import assert from "node:assert/strict";
import {
  BUTTON_SIZE,
  EDGE_MARGIN,
  MENU_GAP,
  MENU_HEIGHT,
  MENU_WIDTH,
  isTrackableImage,
  placeButton,
  placeMenu,
} from "../src/lib/overlay";

test("太小的图不挂钮", () => {
  assert.equal(
    isTrackableImage({ width: 40, height: 40, naturalWidth: 200, naturalHeight: 200 }),
    false,
  );
  assert.equal(
    isTrackableImage({ width: 80, height: 80, naturalWidth: 80, naturalHeight: 80 }),
    true,
  );
});

test("钮贴在图片右下角并向视口内夹", () => {
  assert.deepEqual(
    placeButton(
      { left: 100, top: 100, right: 300, bottom: 250, width: 200, height: 150 },
      { width: 800, height: 600 },
    ),
    {
      left: 300 - BUTTON_SIZE - EDGE_MARGIN,
      top: 250 - BUTTON_SIZE - EDGE_MARGIN,
    },
  );
  assert.deepEqual(
    placeButton(
      { left: 0, top: 0, right: 790, bottom: 590, width: 790, height: 590 },
      { width: 800, height: 600 },
    ),
    {
      left: 790 - BUTTON_SIZE - EDGE_MARGIN,
      top: 590 - BUTTON_SIZE - EDGE_MARGIN,
    },
  );
  assert.deepEqual(
    placeButton(
      { left: -50, top: -50, right: 10, bottom: 10, width: 60, height: 60 },
      { width: 800, height: 600 },
    ),
    { left: EDGE_MARGIN, top: EDGE_MARGIN },
  );
});

test("菜单优先在钮上方、从钮右侧展开", () => {
  const m = placeMenu({ left: 300, top: 200 }, { width: 800, height: 600 });
  assert.equal(m.left, 300 + BUTTON_SIZE + MENU_GAP);
  assert.equal(m.top, 200 - MENU_GAP - MENU_HEIGHT);
  assert.equal(m.above, true);
});

test("钮贴近顶部时菜单翻到下方", () => {
  const m = placeMenu({ left: 300, top: 50 }, { width: 800, height: 600 });
  assert.equal(m.above, false);
  assert.equal(m.top, 50 + BUTTON_SIZE + MENU_GAP);
});

test("窄视口里菜单夹在边距内", () => {
  const m = placeMenu({ left: 0, top: 400 }, { width: 220, height: 600 });
  assert.equal(m.left, EDGE_MARGIN);
});

test("钮贴近右边缘时菜单往左夹回", () => {
  const m = placeMenu({ left: 700, top: 200 }, { width: 800, height: 600 });
  assert.equal(m.left, 800 - MENU_WIDTH - EDGE_MARGIN);
});
