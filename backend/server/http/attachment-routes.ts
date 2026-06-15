/**
 * 文件目的：定义聊天附件上传和音频转写 API 的注册边界。
 * 业务意义：上传与外部转写服务涉及文件、凭据和大小限制，应独立于入口装配。
 */

/**
 * 注册附件和转写相关 HTTP 路由。
 */
export function registerAttachmentRoutes(deps: any): void {
    /**
     * PURPOSE: Keep file upload and transcription endpoints auditable as an
     * attachment boundary while their implementations retain existing deps.
     */
    const { app, authenticateToken, handlers } = deps;
    app.post('/api/transcribe', authenticateToken, handlers.transcribeAudio);
    app.post('/api/projects/:projectName/upload-attachments', authenticateToken, handlers.uploadChatAttachments);
}
