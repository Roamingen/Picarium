/** 悬浮钮几何：与 docs/mock/browser-p3-button.html 的变体二一致。 */
export const BUTTON_SIZE = 28;
export const EDGE_MARGIN = 8;
export const MENU_GAP = 6;
export const MENU_WIDTH = 196;
export const MENU_HEIGHT = 112;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** 太小的图（表情、头像、图标）不挂钮，避免打扰。 */
export function isTrackableImage(img: {
  naturalWidth: number;
  naturalHeight: number;
  width: number;
  height: number;
}): boolean {
  return Math.min(img.width, img.height, img.naturalWidth, img.naturalHeight) >= 48;
}

/** 钮贴在图片右下角（避开 B 站大图查看器右上角的关闭钮），靠近视口边缘时夹回来。 */
export function placeButton(rect: Box, vp: Viewport): { left: number; top: number } {
  const maxLeft = Math.max(EDGE_MARGIN, vp.width - BUTTON_SIZE - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, vp.height - BUTTON_SIZE - EDGE_MARGIN);
  return {
    left: Math.min(Math.max(rect.right - BUTTON_SIZE - EDGE_MARGIN, EDGE_MARGIN), maxLeft),
    top: Math.min(Math.max(rect.bottom - BUTTON_SIZE - EDGE_MARGIN, EDGE_MARGIN), maxTop),
  };
}

/** 菜单右对齐到钮；钮在图片右下角，优先向上展开，上面放不下才翻到下方。 */
export function placeMenu(
  button: { left: number; top: number },
  vp: Viewport,
): { left: number; top: number; above: boolean } {
  const maxLeft = Math.max(EDGE_MARGIN, vp.width - MENU_WIDTH - EDGE_MARGIN);
  const aboveTop = button.top - MENU_GAP - MENU_HEIGHT;
  const belowTop = button.top + BUTTON_SIZE + MENU_GAP;
  const above = aboveTop >= EDGE_MARGIN;
  return {
    left: Math.min(Math.max(button.left + BUTTON_SIZE - MENU_WIDTH, EDGE_MARGIN), maxLeft),
    top: above
      ? aboveTop
      : Math.min(belowTop, Math.max(EDGE_MARGIN, vp.height - MENU_HEIGHT - EDGE_MARGIN)),
    above,
  };
}
