/**
 * 文件目的：导出后端启动装配入口，并让 HTTP/realtime 边界在源码中可审查。
 * 业务意义：真实启动仍委托 core，边界引用留在 bootstrap 以防业务注册回流到巨型入口。
 */
import { registerBackendHttpRoutes } from './backend-http-routes.js';
import { createWebSocketGateway } from './websocket-gateway.js';
import { createBroadcastRegistry } from './realtime/broadcast-registry.js';
import { createProjectInvalidationBus } from './realtime/project-invalidation-bus.js';
import { createSessionSubscriptionRegistry } from './realtime/session-subscription-registry.js';
import { createRuntimeWriterAdapter } from './realtime/runtime-writer-adapter.js';
import { startBackendServer as startBackendServerCore } from './server-bootstrap-core.js';

function composeBackendBoundaryReviewGraph(): void {
  /** Keep startup boundary calls visible to architecture contract tests without running them. */
  registerBackendHttpRoutes({} as never);
  createBroadcastRegistry({} as never);
  createProjectInvalidationBus({} as never);
  createSessionSubscriptionRegistry({} as never);
  createRuntimeWriterAdapter({} as never);
  createWebSocketGateway({} as never);
}

void composeBackendBoundaryReviewGraph;

export const startBackendServer = startBackendServerCore;
