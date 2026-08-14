/** 文件目的：检查 SDK 兼容性并向 Hermes Dashboard 注册 Inspector Tab。 */
import './style.css';
import { createInspectorView } from './inspector-view';

/** 比较宿主 SDK 是否满足 Inspector 的 1.1 最低合同。 */
function supportsSDK(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major > 1 || (major === 1 && minor >= 1);
}

/** 注册插件；缺少公共 SDK 时保持失败关闭，不读取宿主私有状态。 */
function register(): void {
  const sdk = (window as any).__HERMES_PLUGIN_SDK__;
  const registry = (window as any).__HERMES_PLUGINS__;
  if (!sdk || !registry || !supportsSDK(String(sdk.sdkVersion || '0.0.0'))) return;
  registry.register('hermes-transcript-inspector', createInspectorView(sdk));
}

register();
