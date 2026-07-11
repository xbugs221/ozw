/**
 * 文件目的：把移动端终端的单指纵向滑动转换为 xterm.js 可编码的滚轮事件。
 * 业务意义：TMux 启用鼠标协议后仍能在触屏设备上浏览终端历史输出。
 */
import type { Terminal } from '@xterm/xterm';

const TOUCH_WHEEL_STEP_PX = 24;

/**
 * 在 xterm.js 鼠标协议激活时桥接触摸滚动，并返回资源清理函数。
 *
 * @param terminal - 已完成 open 的 xterm.js 终端实例。
 * @returns 卸载全部触摸监听器的清理函数。
 */
export function attachTerminalTouchScroll(terminal: Terminal): () => void {
  const terminalElement = terminal.element;
  if (!terminalElement) {
    return () => {};
  }

  let lastTouchY: number | null = null;
  let pendingDeltaY = 0;

  /** 记录单指手势起点，供后续位移计算。 */
  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      lastTouchY = null;
      pendingDeltaY = 0;
      return;
    }

    lastTouchY = event.touches[0].clientY;
    pendingDeltaY = 0;
  };

  /**
   * 仅在终端应用接管鼠标时转换纵向位移；普通缓冲区继续使用 xterm.js 原生触摸滚动。
   */
  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1 || lastTouchY === null) {
      return;
    }

    const touch = event.touches[0];
    const deltaY = lastTouchY - touch.clientY;
    lastTouchY = touch.clientY;

    if (!terminalElement.classList.contains('enable-mouse-events')) {
      pendingDeltaY = 0;
      return;
    }

    event.preventDefault();
    pendingDeltaY += deltaY;

    while (Math.abs(pendingDeltaY) >= TOUCH_WHEEL_STEP_PX) {
      const step = Math.sign(pendingDeltaY) * TOUCH_WHEEL_STEP_PX;
      terminalElement.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: step,
      }));
      pendingDeltaY -= step;
    }
  };

  /** 清空已结束或取消手势的临时状态。 */
  const resetTouch = () => {
    lastTouchY = null;
    pendingDeltaY = 0;
  };

  terminalElement.addEventListener('touchstart', handleTouchStart, { passive: true });
  terminalElement.addEventListener('touchmove', handleTouchMove, { passive: false });
  terminalElement.addEventListener('touchend', resetTouch, { passive: true });
  terminalElement.addEventListener('touchcancel', resetTouch, { passive: true });

  return () => {
    terminalElement.removeEventListener('touchstart', handleTouchStart);
    terminalElement.removeEventListener('touchmove', handleTouchMove);
    terminalElement.removeEventListener('touchend', resetTouch);
    terminalElement.removeEventListener('touchcancel', resetTouch);
  };
}
