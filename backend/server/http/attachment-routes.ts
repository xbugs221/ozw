/**
 * 文件目的：定义聊天附件上传和音频转写 API 的注册边界。
 * 业务意义：route module 直接声明自身依赖，避免通过宽泛依赖隐藏权限边界。
 */

type LooseRecord = Record<string, any>;

export interface AttachmentRouteDeps {
    app: any; authenticateToken: any; path: any; fsPromises: any; fetch: any; CHAT_UPLOAD_ROOT: string; sanitizeFilename: any; persistChatUploads: any; withLoggedFallback: any;
}

/**
 * 注册附件和转写相关 HTTP 路由。
 */
export function registerAttachmentRoutes(deps: AttachmentRouteDeps): void {
    const { app, authenticateToken, path, fsPromises, fetch, CHAT_UPLOAD_ROOT, sanitizeFilename, persistChatUploads, withLoggedFallback } = deps;

// Audio transcription endpoint
const transcribeAudioHandler = async (req: any, res: any) => {
    try {
        const multer = (await import('multer')).default;
        const upload = multer({ storage: multer.memoryStorage() });

        // Handle multipart form data
        upload.single('audio')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: 'Failed to process audio file' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No audio file provided' });
            }

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
            }

            try {
                // Create form data for OpenAI
                const FormData = (await (Function('return import(\'form-data\')')() as Promise<any>)).default;
                const formData = new FormData();
                formData.append('file', req.file.buffer, {
                    filename: req.file.originalname,
                    contentType: req.file.mimetype
                });
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'json');
                formData.append('language', 'en');

                // Make request to OpenAI
                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...formData.getHeaders()
                    },
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
                }

                const data = await response.json();
                let transcribedText = data.text || '';

                // Check if enhancement mode is enabled
                const mode = req.body.mode || 'default';

                // If no transcribed text, return empty
                if (!transcribedText) {
                    return res.json({ text: '' });
                }

                // If default mode, return transcribed text without enhancement
                if (mode === 'default') {
                    return res.json({ text: transcribedText });
                }

                // Handle different enhancement modes
                try {
                    const OpenAI = (await (Function('return import(\'openai\')')() as Promise<any>)).default;
                    const openai = new OpenAI({ apiKey });

                    let prompt, systemMessage, temperature = 0.7, maxTokens = 800;

                    switch (mode) {
                        case 'prompt':
                            systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
                            prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
                            break;

                        case 'vibe':
                        case 'instructions':
                        case 'architect':
                            systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
                            temperature = 0.5; // Lower temperature for more controlled output
                            prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
                            break;

                        default:
                            // No enhancement needed
                            break;
                    }

                    // Only make GPT call if we have a prompt
                    if (prompt) {
                        const completion = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemMessage },
                                { role: 'user', content: prompt }
                            ],
                            temperature: temperature,
                            max_tokens: maxTokens
                        });

                        transcribedText = completion.choices[0].message.content || transcribedText;
                    }

                } catch (gptError: any) {
                    console.error('GPT processing error:', gptError);
                    // Fall back to original transcription if GPT fails
                }

                res.json({ text: transcribedText });

            } catch (error: any) {
                console.error('Transcription error:', error);
                res.status(500).json({ error: error.message });
            }
        });
    } catch (error: any) {
        console.error('Endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
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
