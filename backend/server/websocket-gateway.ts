/**
 * 文件目的：定义后端 WebSocket server 创建、认证和 path 分派边界。
 * 业务意义：聊天与 shell 连接共享同一 HTTP server，但 path 分派和认证应从启动入口中独立出来。
 */
import { WebSocketServer } from 'ws';
import { getWebSocketAuthToken } from '../websocket-auth.js';
import { authenticateWebSocket } from '../middleware/auth.js';
import { IS_PLATFORM } from '../constants/config.js';
import { handleChatConnection } from './chat-websocket.js';
import { handleShellConnection } from './shell-websocket.js';

/**
 * 创建并挂载 WebSocket gateway。
 */
export function createWebSocketGateway(deps: any): WebSocketServer {
    /**
     * PURPOSE: Keep authentication, server ownership, and URL dispatch in one
     * module so bootstrap only wires dependencies and lifecycle cleanup.
     */
    const { server, app, chatWebSocketDeps, shellWebSocketDeps } = deps;

    const wss = new WebSocketServer({
        server,
        verifyClient: (info: any) => {
            console.log('WebSocket connection attempt to:', info.req.url);

            if (IS_PLATFORM) {
                const user = authenticateWebSocket(undefined, info.req);
                if (!user) {
                    console.log('[WARN] Platform mode: No user found in database');
                    return false;
                }
                info.req.user = user;
                console.log('[OK] Platform mode WebSocket authenticated for user:', user.username);
                return true;
            }

            const token = getWebSocketAuthToken(info.req);
            const user = authenticateWebSocket(token || undefined, info.req);
            if (!user) {
                console.log('[WARN] WebSocket authentication failed');
                return false;
            }

            info.req.user = user;
            console.log('[OK] WebSocket authenticated for user:', user.username);
            return true;
        },
    });

    app.locals.wss = wss;

    wss.on('connection', (ws, request) => {
        const url = request.url;
        console.log('[INFO] Client connected to:', url);

        const urlObj = new URL(url || '/', 'http://localhost');
        const pathname = urlObj.pathname;

        if (pathname === '/shell') {
            handleShellConnection(shellWebSocketDeps, ws);
            return;
        }
        if (pathname === '/ws') {
            handleChatConnection(chatWebSocketDeps, ws, request);
            return;
        }

        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    });

    return wss;
}
