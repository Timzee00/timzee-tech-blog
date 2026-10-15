// Pure visual viewport placement for Android keyboard and pinch-zoom.
// All values are layout-viewport CSS pixel coordinates.
export function placeMentionMenu(rect, viewport = {}, { maxWidth = 300, maxHeight = 260 } = {}) {
  const leftEdge = Number(viewport.offsetLeft) || 0;
  const topEdge = Number(viewport.offsetTop) || 0;
  const width = Math.max(0, Number(viewport.width) || 0);
  const height = Math.max(0, Number(viewport.height) || 0);
  const margin = 8;
  const displayWidth = Math.max(80, Math.min(maxWidth, width - margin*2));
  const x = Math.max(leftEdge+margin, Math.min(Number(rect.left) || 0,
    leftEdge + width - displayWidth - margin));
  const bottom = topEdge + height;
  const above = Math.max(0,(Number(rect.top)||0)-topEdge-margin*2);
  const below = Math.max(0,bottom-(Number(rect.bottom)||0)-margin*2);
  const useAbove = below<145 && above>below;
  const room = useAbove ? above : below;
  const menuHeight = Math.max(60,Math.min(maxHeight,room));
  const y = useAbove
    ? Math.max(topEdge+margin,(Number(rect.top)||0)-menuHeight-margin)
    : Math.min(bottom-menuHeight-margin,(Number(rect.bottom)||0)+margin);
  return {left:x,top:Math.max(topEdge+margin,y),width:displayWidth,maxHeight:menuHeight};
}
