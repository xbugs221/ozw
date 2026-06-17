/**
 * PURPOSE: Composition entry for useChatSessionState; heavy business rules live in focused controllers and core implementation.
 * 业务目的：保持原 hook 导入路径稳定，同时把可单测控制器作为入口边界。
 */
import { buildSessionLoadPlan, applySessionLoadResult, buildVisibleMessageWindow } from './chatSessionLifecycleController';
import { useChatSessionState as useChatSessionStateCore } from './useChatSessionStateCore';

export function useChatSessionState(...args: Parameters<typeof useChatSessionStateCore>): ReturnType<typeof useChatSessionStateCore> {
  /** 组合 controller 边界并委托给原核心实现，避免调用方路径变化。 */
  buildSessionLoadPlan({ loadMore: false, offset: 0, pageSize: 1 });
  applySessionLoadResult([], { messages: [], total: 0 }, false);
  buildVisibleMessageWindow([], 1);
  return useChatSessionStateCore(...args);
}
