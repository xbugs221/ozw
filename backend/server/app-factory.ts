/**
 * 文件目的：定义后端 Express app 组装边界。
 * 业务意义：静态资源、中间件和 SPA fallback 属于应用壳层，避免继续散落在 legacy 入口中。
 */
import express from 'express';

/**
 * 创建后端 Express 应用实例。
 */
export function createBackendApp(): express.Express {
    return express();
}

/**
 * 注册基础中间件、健康检查和 API key 边界。
 */
export function configureAppMiddleware(deps: any): void {
    const { app, cors, express, installMode, isAllowedCorsOrigin, validateApiKey } = deps;
    app.use(cors({
      origin: (origin: any, callback: any) => {
        callback(null, isAllowedCorsOrigin(origin));
      },
      credentials: true,
    }));
    app.use(express.json({
        limit: '50mb',
        type: (req: any) => {
            // Skip multipart/form-data requests (for file uploads like images)
            const contentType = req.headers['content-type'] || '';
            if (contentType.includes('multipart/form-data')) {
                return false;
            }
            return contentType.includes('json');
        }
    }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));

    // Public health check endpoint (no authentication required)
    app.get('/health', (req: any, res: any) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            installMode
        });
    });

    // Optional API key validation (if configured)
    app.use('/api', validateApiKey);
}

/**
 * 注册 public/dist 静态资源。
 */
export function registerStaticAssets(deps: any): void {
    const { app, express, path, PKG_ROOT } = deps;
    // Serve static public assets.
    app.use(express.static(path.join(PKG_ROOT, 'public')));

    // Static files served after API routes
    // Add cache control: HTML files should not be cached, but assets can be cached
    app.use(express.static(path.join(PKG_ROOT, 'dist'), {
        setHeaders: (res: any, filePath: string) => {
            if (filePath.endsWith('.html')) {
                // Prevent HTML caching to avoid service worker issues after builds
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
                // Cache static assets for 1 year (they have hashed names)
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        }
    }));
}

/**
 * 注册 API 404 和 SPA fallback。
 */
export function registerSpaFallback(deps: any): void {
    const { app, fs, path, PKG_ROOT, shouldServeSpaIndex } = deps;
    // Serve React app for all other routes (excluding static files)
    app.use('/api', (req: any, res: any) => {
        res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
    });

    // Serve React app for all other routes (excluding static files)
    app.get('*', (req: any, res: any) => {
        // Skip static asset requests while still serving dotted workflow run ids.
        if (!shouldServeSpaIndex(req)) {
            return res.status(404).send('Not found');
        }

        // Only serve index.html for HTML routes, not for static assets
        // Static assets should already be handled by express.static middleware above
        const indexPath = path.join(PKG_ROOT, 'dist/index.html');

        // Check if dist/index.html exists (production build available)
        if (fs.existsSync(indexPath)) {
            // Set no-cache headers for HTML to prevent service worker issues
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.sendFile(indexPath);
        } else {
            // In development, redirect to Vite dev server only if dist doesn't exist
            res.redirect(`http://localhost:${process.env.VITE_PORT || 5173}`);
        }
    });
}
