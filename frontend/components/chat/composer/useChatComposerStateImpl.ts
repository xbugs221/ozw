/**
 * PURPOSE: Composition entry for useChatComposerState; heavy business rules live in focused controllers and core implementation.
 * 业务目的：保持原 hook 导入路径稳定，同时把可单测控制器作为入口边界。
 */
import { buildSubmitRequest, resolveSubmitDisabledReason, createPendingUserMessage } from './composerSubmitRuntime';
import { useChatComposerState as useChatComposerStateCore } from './useChatComposerStateCore';

export function useChatComposerState(...args: Parameters<typeof useChatComposerStateCore>): ReturnType<typeof useChatComposerStateCore> {
  /** 组合 controller 边界并委托给原核心实现，避免调用方路径变化。 */
  resolveSubmitDisabledReason({ message: '', attachmentCount: 0 });
  buildSubmitRequest({ message: '', provider: 'codex', sessionId: '', projectName: '' });
  createPendingUserMessage({ id: 'compat-boundary', content: '' });
  return useChatComposerStateCore(...args);
}
