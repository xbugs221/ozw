/**
 * 文件目的：定义聊天附件上传 API 以及已下线音频转写入口的注册边界。
 * 业务意义：route module 直接声明自身依赖，避免通过宽泛依赖隐藏权限边界。
 */

import type {
    AuthMiddleware,
    FetchDeps,
    FsPromisesDeps,
    HttpRouteApp,
    PathDeps,
    UploadedFileLike,
} from './route-deps.js';

export interface AttachmentRouteDeps {
    app: HttpRouteApp;
    authenticateToken: AuthMiddleware;
    path: PathDeps;
    fsPromises: FsPromisesDeps;
    fetch: FetchDeps;
    CHAT_UPLOAD_ROOT: string;
    sanitizeFilename: (filename: string) => string;
    persistChatUploads: (files: UploadedFileLike[], options: { relativePaths: string[] | null; userId: number }) => Promise<{
        rootPath: string;
        attachments: unknown[];
    }>;
    withLoggedFallback: <T>(operation: Promise<T>, fallback: T, context: string) => Promise<T>;
}

/**
 * 注册附件和转写相关 HTTP 路由。
 */
export function registerAttachmentRoutes(deps: AttachmentRouteDeps): void {
    const { app, authenticateToken, path, fsPromises, fetch, CHAT_UPLOAD_ROOT, sanitizeFilename, persistChatUploads, withLoggedFallback } = deps;

const transcribeAudioHandler = async (req: any, res: any) => {
    /** Return an explicit disabled response while keeping the route non-operational. */
    res.status(410).json({ error: 'Audio transcription is no longer available' });
};

// Chat attachment upload endpoint
const uploadChatAttachmentsHandler = async (req: any, res: any) => {
    try {
        const multer = (await import('multer')).default;
        const uploadRoot = path.join(CHAT_UPLOAD_ROOT, String((req.user as any).id), '.incoming');

        await fsPromises.mkdir(uploadRoot, { recursive: true });

        /**
         * PURPOSE: Stage raw browser uploads in a temporary directory before we
         * move them into the final per-message batch tree under ~/ozw-uploads.
         */
        const storage = multer.diskStorage({
            destination: async (_request, _file, cb) => {
                cb(null, uploadRoot);
            },
            filename: (_request, file, cb) => {
                const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                cb(null, `${uniqueSuffix}-${sanitizeFilename(file.originalname)}`);
            }
        });

        const upload = multer({
            storage,
            limits: {
                fileSize: 25 * 1024 * 1024,
                files: 100
            }
        });

        upload.array('attachments', 100)(req, res, async (err) => {
            let uploadedFiles: any[] = [];
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No attachment files provided' });
            }

            try {
                let parsedRelativePaths = null;
                if (typeof req.body.relativePaths === 'string' && req.body.relativePaths) {
                    parsedRelativePaths = JSON.parse(req.body.relativePaths);
                    if (!Array.isArray(parsedRelativePaths) || parsedRelativePaths.length !== req.files.length) {
                        return res.status(400).json({ error: 'relativePaths must match uploaded files' });
                    }
                }

                uploadedFiles = Array.isArray(req.files) ? req.files : [];
                const persistedBatch = await persistChatUploads(uploadedFiles, {
                    relativePaths: parsedRelativePaths,
                    userId: (req.user as any).id,
                });

                res.json({
                    rootPath: persistedBatch.rootPath,
                    attachments: persistedBatch.attachments,
                });
            } catch (error: any) {
                console.error('Error processing chat attachments:', error);
                await Promise.all(uploadedFiles.map((file: any) => withLoggedFallback(fsPromises.unlink(file.path), undefined, 'cleanup failed chat attachment upload')));
                res.status(500).json({ error: 'Failed to process chat attachments' });
            }
        });
    } catch (error: any) {
        console.error('Error in chat attachment upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


    app.post('/api/transcribe', authenticateToken, transcribeAudioHandler);
    app.post('/api/projects/:projectName/upload-attachments', authenticateToken, uploadChatAttachmentsHandler);
}
