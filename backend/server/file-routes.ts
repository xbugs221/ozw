/**
 * 文件目的：定义项目文件读写、上传、下载和目录浏览 API 的注册边界。
 * 业务意义：文件系统操作需要独立边界，避免与会话和 workflow API 混在同一入口文件。
 */

const SKIPPED_TREE_ENTRIES = new Set(['node_modules', 'dist', 'build', '.git', '.svn', '.hg']);
type LooseRecord = Record<string, any>;

/**
 * 判断目录树接口是否应跳过该条目。
 */
export function shouldSkipProjectTreeEntry(entryName: string): boolean {
    return SKIPPED_TREE_ENTRIES.has(entryName);
}

/**
 * 把单组三位权限转换为 rwx 文本。
 */
export function permissionBitsToRwx(perm: number): string {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

/**
 * 注册项目文件浏览、读写、上传和下载路由。
 */
export function registerFileRoutes(deps: any): void {
    const { app, authenticateToken, path, fs, fsPromises, WORKSPACES_ROOT, validateWorkspacePath, resolveProjectRootWithHint, resolveReadableProjectPath, resolveProjectPath, buildMutationResponse, joinProjectChildPath, sanitizeEntryName, sanitizeUploadRelativePath, createDirectoryArchive, sendDownload, withLoggedFallback, classifyProjectFile, TEXT_SAMPLE_BYTES, mime } = deps;
    const expandWorkspacePath = (inputPath: string) => {
        if (!inputPath) return inputPath;
        if (inputPath === '~') {
            return WORKSPACES_ROOT;
        }
        if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
            return path.join(WORKSPACES_ROOT, inputPath.slice(2));
        }
        return inputPath;
    };
    // Helper function to convert permissions to rwx format
    function shouldSkipTreeEntry(entryName: string): boolean {
        return shouldSkipProjectTreeEntry(entryName);
    }

    // Helper function to convert permissions to rwx format
    function permToRwx(perm: number): string {
        return permissionBitsToRwx(perm);
    }

    async function getFileTree(dirPath: string, maxDepth = 3, currentDepth = 0, showHidden = true): Promise<LooseRecord[]> {
        const items: LooseRecord[] = [];

        try {
            const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (!showHidden && entry.name.startsWith('.')) {
                    continue;
                }

                // Skip heavy build directories and VCS directories.
                if (shouldSkipTreeEntry(entry.name)) {
                    continue;
                }

                const itemPath = path.join(dirPath, entry.name);
                const item: LooseRecord = {
                    name: entry.name,
                    path: itemPath,
                    type: entry.isDirectory() ? 'directory' : 'file'
                };

                // Get file stats for additional metadata
                try {
                    const stats = await fsPromises.stat(itemPath);
                    item.size = stats.size;
                    item.modified = stats.mtime.toISOString();

                    // Convert permissions to rwx format
                    const mode = stats.mode;
                    const ownerPerm = (mode >> 6) & 7;
                    const groupPerm = (mode >> 3) & 7;
                    const otherPerm = mode & 7;
                    item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
                    item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
                } catch (statError: any) {
                    // If stat fails, provide default values
                    item.size = 0;
                    item.modified = null;
                    item.permissions = '000';
                    item.permissionsRwx = '---------';
                }

                if (entry.isDirectory()) {
                    if (currentDepth < maxDepth) {
                        // Recursively get subdirectories but limit depth.
                        try {
                            // Check if we can access the directory before trying to read it.
                            await fsPromises.access(item.path, fs.constants.R_OK);
                            item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
                            item.hasChildren = item.children.length > 0;
                        } catch (e: any) {
                            // Silently skip directories we can't access (permission denied, etc.).
                            item.children = [];
                            item.hasChildren = false;
                        }
                    } else {
                        // Keep a child indicator for lazy loading without expanding content.
                        try {
                            const childEntries = await fsPromises.readdir(item.path, { withFileTypes: true });
                            item.hasChildren = childEntries.some((childEntry: any) => {
                                if (shouldSkipTreeEntry(childEntry.name)) {
                                    return false;
                                }
                                return showHidden || !childEntry.name.startsWith('.');
                            });
                        } catch (e: any) {
                            item.hasChildren = false;
                        }
                    }
                }

                items.push(item);
            }
        } catch (error: any) {
            // Only log non-permission errors to avoid spam
            if (error.code !== 'EACCES' && error.code !== 'EPERM') {
                console.error('Error reading directory:', error);
            }
        }

        return items.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }


    // Browse filesystem endpoint for project suggestions - uses existing getFileTree
    app.get('/api/browse-filesystem', authenticateToken, async (req: any, res: any) => {
        try {
            const { path: dirPath } = req.query;

            console.log('[API] Browse filesystem request for path:', dirPath);
            console.log('[API] WORKSPACES_ROOT is:', WORKSPACES_ROOT);
            // Default to home directory if no path provided
            const defaultRoot = WORKSPACES_ROOT;
            let targetPath = dirPath ? expandWorkspacePath(String(dirPath)) : defaultRoot;

            // Resolve and normalize the path
            targetPath = path.resolve(targetPath);

            // Security check - ensure path is within allowed workspace root
            const validation = await validateWorkspacePath(targetPath);
            if (!validation.valid) {
                return res.status(403).json({ error: validation.error });
            }
            const resolvedPath = validation.resolvedPath || targetPath;

            // Security check - ensure path is accessible
            try {
                await fs.promises.access(resolvedPath);
                const stats = await fs.promises.stat(resolvedPath);

                if (!stats.isDirectory()) {
                    return res.status(400).json({ error: 'Path is not a directory' });
                }
            } catch (err: any) {
                return res.status(404).json({ error: 'Directory not accessible' });
            }

            // Use existing getFileTree function with shallow depth (only direct children)
            const fileTree = await getFileTree(resolvedPath, 1, 0, false); // maxDepth=1, showHidden=false

            // Filter only directories and format for suggestions
            const directories = fileTree
                .filter(item => item.type === 'directory')
                .map(item => ({
                    path: item.path,
                    name: item.name,
                    type: 'directory'
                }))
                .sort((a, b) => {
                    const aHidden = a.name.startsWith('.');
                    const bHidden = b.name.startsWith('.');
                    if (aHidden && !bHidden) return 1;
                    if (!aHidden && bHidden) return -1;
                    return a.name.localeCompare(b.name);
                });

            // Add common directories if browsing home directory
            const suggestions = [];
            let resolvedWorkspaceRoot = defaultRoot;
            try {
                resolvedWorkspaceRoot = await fsPromises.realpath(defaultRoot);
            } catch (error: any) {
                // Use default root as-is if realpath fails
            }
            if (resolvedPath === resolvedWorkspaceRoot) {
                const commonDirs = ['Desktop', 'Documents', 'Projects', 'Development', 'Dev', 'Code', 'workspace'];
                const existingCommon = directories.filter(dir => commonDirs.includes(dir.name));
                const otherDirs = directories.filter(dir => !commonDirs.includes(dir.name));

                suggestions.push(...existingCommon, ...otherDirs);
            } else {
                suggestions.push(...directories);
            }

            res.json({
                path: resolvedPath,
                suggestions: suggestions
            });

        } catch (error: any) {
            console.error('Error browsing filesystem:', error);
            res.status(500).json({ error: 'Failed to browse filesystem' });
        }
    });

    app.post('/api/create-folder', authenticateToken, async (req: any, res: any) => {
        try {
            const { path: folderPath } = req.body;
            if (!folderPath) {
                return res.status(400).json({ error: 'Path is required' });
            }
            const expandedPath = expandWorkspacePath(folderPath);
            const resolvedInput = path.resolve(expandedPath);
            const validation = await validateWorkspacePath(resolvedInput);
            if (!validation.valid) {
                return res.status(403).json({ error: validation.error });
            }
            const targetPath = validation.resolvedPath || resolvedInput;
            const parentDir = path.dirname(targetPath);
            try {
                await fs.promises.access(parentDir);
            } catch (err: any) {
                return res.status(404).json({ error: 'Parent directory does not exist' });
            }
            try {
                await fs.promises.access(targetPath);
                return res.status(409).json({ error: 'Folder already exists' });
            } catch (err: any) {
                // Folder doesn't exist, which is what we want
            }
            try {
                await fs.promises.mkdir(targetPath, { recursive: false });
                res.json({ success: true, path: targetPath });
            } catch (mkdirError: any) {
                if (mkdirError.code === 'EEXIST') {
                    return res.status(409).json({ error: 'Folder already exists' });
                }
                throw mkdirError;
            }
        } catch (error: any) {
            console.error('Error creating folder:', error);
            res.status(500).json({ error: 'Failed to create folder' });
        }
    });

    /**
     * Read file content endpoint with centralized project-root confinement.
     */
    app.get('/api/projects/:projectName/file', authenticateToken, async (req: any, res: any) => {
        try {
            const { projectName } = req.params;
            const { filePath, projectPath } = req.query;
            const projectPathHint = String(projectPath || '');
            const projectRoot = await resolveProjectRootWithHint(projectName, projectPathHint);
            const { absolutePath, readOnly } = await resolveReadableProjectPath(projectRoot, String(filePath || ''), {
                projectPathHint,
            });
            const fullBuffer = await fsPromises.readFile(absolutePath);
            const classification = classifyProjectFile(absolutePath, fullBuffer.subarray(0, TEXT_SAMPLE_BYTES));
            const responseClassification = readOnly ? { ...classification, editable: false } : classification;

            if (classification.fileType === 'text' || classification.fileType === 'markdown') {
                res.json({
                    ...responseClassification,
                    content: fullBuffer.toString('utf8'),
                    path: absolutePath,
                });
                return;
            }

            res.json({
                ...responseClassification,
                path: absolutePath,
            });
        } catch (error: any) {
            console.error('Error reading file:', error);
            if (error.statusCode) {
                res.status(error.statusCode).json({ error: error.message });
            } else if (error.code === 'ENOENT') {
                res.status(404).json({ error: 'File not found' });
            } else if (error.code === 'EACCES') {
                res.status(403).json({ error: 'Permission denied' });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });

    /**
     * Serve binary file content endpoint (for images, etc.) within project root.
     */
    app.get('/api/projects/:projectName/files/content', authenticateToken, async (req: any, res: any) => {
        try {
            const { projectName } = req.params;
            const { path: filePath, projectPath } = req.query;
            const projectPathHint = String(projectPath || '');
            const projectRoot = await resolveProjectRootWithHint(projectName, projectPathHint);
            const { absolutePath } = await resolveReadableProjectPath(projectRoot, String(filePath || ''), {
                projectPathHint,
            });

            // Check if file exists
            try {
                await fsPromises.access(absolutePath);
            } catch (error: any) {
                return res.status(404).json({ error: 'File not found' });
            }

            // Get file extension and set appropriate content type
            const mimeType = mime.lookup(absolutePath) || 'application/octet-stream';
            res.setHeader('Content-Type', mimeType);

            // Stream the file
            const fileStream = fs.createReadStream(absolutePath);
            fileStream.pipe(res);

            fileStream.on('error', (error: any) => {
                console.error('Error streaming file:', error);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error reading file' });
                }
            });

        } catch (error: any) {
            console.error('Error serving binary file:', error);
            if (error.statusCode && !res.headersSent) {
                res.status(error.statusCode).json({ error: error.message });
            } else if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    });

    /**
     * Save file content endpoint with centralized project-root confinement.
     */
    app.put('/api/projects/:projectName/file', authenticateToken, async (req: any, res: any) => {
        try {
            const { projectName } = req.params;
            const { filePath, content, projectPath } = req.body;

            if (content === undefined) {
                return res.status(400).json({ error: 'Content is required' });
            }

            const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
            const { absolutePath } = await resolveProjectPath(projectRoot, String(filePath || ''));

            // Write the new content
            await fsPromises.writeFile(absolutePath, content, 'utf8');

            res.json(buildMutationResponse(projectRoot, absolutePath, {
                type: 'file',
                message: 'File saved successfully',
            }));
        } catch (error: any) {
            console.error('Error saving file:', error);
            if (error.statusCode) {
                res.status(error.statusCode).json({ error: error.message });
            } else if (error.code === 'ENOENT') {
                res.status(404).json({ error: 'File or directory not found' });
            } else if (error.code === 'EACCES') {
                res.status(403).json({ error: 'Permission denied' });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });

    /**
     * Rename a file or directory while keeping the entry inside the same project root.
     */
    app.put('/api/projects/:projectName/files/rename', authenticateToken, async (req: any, res: any) => {
        try {
            const { projectName } = req.params;
            const { oldPath, newName, projectPath } = req.body;
            const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
            const { absolutePath: sourcePath } = await resolveProjectPath(projectRoot, String(oldPath || ''));
            const nextName = sanitizeEntryName(newName);
            const destinationPath = joinProjectChildPath(path.dirname(sourcePath), nextName);

            if (sourcePath === projectRoot) {
                return res.status(400).json({ error: 'Project root cannot be renamed' });
            }

            const sourceStats = await withLoggedFallback(fsPromises.stat(sourcePath), null, 'stat source path for rename');
            if (!sourceStats) {
                return res.status(404).json({ error: 'Path not found' });
            }

            const destinationExists = await withLoggedFallback(fsPromises.access(destinationPath).then(() => true), false, 'check destination path exists for rename');
            if (destinationExists) {
                return res.status(409).json({ error: 'Target path already exists' });
            }

            await fsPromises.rename(sourcePath, destinationPath);

            res.json(buildMutationResponse(projectRoot, destinationPath, {
                type: sourceStats.isDirectory() ? 'directory' : 'file',
                message: 'Path renamed successfully',
            }));
        } catch (error: any) {
            console.error('Error renaming project entry:', error);
            if (error.statusCode) {
                res.status(error.statusCode).json({ error: error.message });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });

    /**
     * Delete a file or directory within the selected project root.
     */
    app.delete('/api/projects/:projectName/files', authenticateToken, async (req: any, res: any) => {
        try {
            const { projectName } = req.params;
            const { path: targetPath, projectPath } = req.body;
            const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
            const { absolutePath } = await resolveProjectPath(projectRoot, String(targetPath || ''));

            if (absolutePath === projectRoot) {
                return res.status(400).json({ error: 'Project root cannot be deleted' });
            }

            const targetStats = await withLoggedFallback(fsPromises.stat(absolutePath), null, 'stat project file path');
            if (!targetStats) {
                return res.status(404).json({ error: 'Path not found' });
            }

            await fsPromises.rm(absolutePath, { recursive: true, force: false });

            res.json(buildMutationResponse(projectRoot, absolutePath, {
                type: targetStats.isDirectory() ? 'directory' : 'file',
                message: 'Path deleted successfully',
            }));
        } catch (error: any) {
            console.error('Error deleting project entry:', error);
            if (error.statusCode) {
                res.status(error.statusCode).json({ error: error.message });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });

    /**
     * Upload plain files into the selected project root.
     */
    app.post('/api/projects/:projectName/files/upload', authenticateToken, async (req: any, res: any) => {
        try {
            const multer = (await import('multer')).default;
            const upload = multer({ storage: multer.memoryStorage() });

            upload.array('files')(req, res, async (uploadError) => {
                if (uploadError) {
                    return res.status(400).json({ error: 'Failed to process upload payload' });
                }

                const files = Array.isArray(req.files) ? req.files : [];
                const { targetPath = '', relativePaths = '[]', projectPath = '' } = req.body;

                if (files.length === 0) {
                    return res.status(400).json({ error: 'No files provided' });
                }

                let parsedRelativePaths;
                try {
                    parsedRelativePaths = JSON.parse(relativePaths);
                } catch {
                    return res.status(400).json({ error: 'relativePaths must be valid JSON' });
                }

                if (!Array.isArray(parsedRelativePaths) || parsedRelativePaths.length !== files.length) {
                    return res.status(400).json({ error: 'relativePaths must match uploaded files' });
                }

                const projectRoot = await resolveProjectRootWithHint(req.params.projectName, String(projectPath || ''));
                const { absolutePath: targetDirectory } = await resolveProjectPath(projectRoot, String(targetPath), {
                    allowRoot: true,
                });
                const targetStats = await withLoggedFallback(fsPromises.stat(targetDirectory), null, 'stat target upload directory');
                if (!targetStats?.isDirectory()) {
                    return res.status(404).json({ error: 'Target directory not found' });
                }

                for (let index = 0; index < files.length; index += 1) {
                    const relativeUploadPath = sanitizeUploadRelativePath(parsedRelativePaths[index]);
                    if (relativeUploadPath.includes('/')) {
                        return res.status(400).json({ error: 'Folder uploads are not supported' });
                    }

                    const destinationPath = path.resolve(targetDirectory, relativeUploadPath);
                    const relativeToTarget = path.relative(targetDirectory, destinationPath);
                    if (relativeToTarget.startsWith('..') || path.isAbsolute(relativeToTarget)) {
                        return res.status(403).json({ error: 'Upload path must stay under project root' });
                    }

                    await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
                    await fsPromises.writeFile(destinationPath, files[index].buffer);
                }

                res.json({
                    success: true,
                    uploadedCount: files.length,
                    message: 'Upload completed successfully',
                });
            });
        } catch (error: any) {
            console.error('Error uploading project files:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * Download a single project file without text transcoding.
     */
    app.get('/api/projects/:projectName/files/download', authenticateToken, async (req: any, res: any) => {
        try {
            const { projectName } = req.params;
            const { path: targetPath, projectPath } = req.query;
            const projectPathHint = String(projectPath || '');
            const projectRoot = await resolveProjectRootWithHint(projectName, projectPathHint);
            const { absolutePath } = await resolveReadableProjectPath(projectRoot, String(targetPath || ''), {
                projectPathHint,
            });
            const targetStats = await withLoggedFallback(fsPromises.stat(absolutePath), null, 'stat project file path');

            if (!targetStats) {
                return res.status(404).json({ error: 'File not found' });
            }
            if (!targetStats.isFile()) {
                return res.status(400).json({ error: 'Requested path is not a file' });
            }

            return sendDownload(res, absolutePath, path.basename(absolutePath));
        } catch (error: any) {
            console.error('Error downloading project file:', error);
            if (error.statusCode) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: error.message });
        }
    });

    /**
     * Download a directory as a zip archive while preserving nested relative paths.
     */
    app.get('/api/projects/:projectName/folders/download', authenticateToken, async (req: any, res: any) => {
        try {
            const { projectName } = req.params;
            const { path: targetPath, projectPath } = req.query;
            const projectRoot = await resolveProjectRootWithHint(projectName, String(projectPath || ''));
            const { absolutePath } = await resolveProjectPath(projectRoot, String(targetPath || ''));
            const targetStats = await withLoggedFallback(fsPromises.stat(absolutePath), null, 'stat project file path');

            if (!targetStats) {
                return res.status(404).json({ error: 'Folder not found' });
            }
            if (!targetStats.isDirectory()) {
                return res.status(400).json({ error: 'Requested path is not a directory' });
            }

            const archivePath = String(await createDirectoryArchive(absolutePath));
            return (sendDownload as any)(res, archivePath, `${path.basename(String(absolutePath))}.zip`, path.dirname(archivePath));
        } catch (error: any) {
            console.error('Error downloading project folder:', error);
            if (error.statusCode) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            return res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/projects/:projectName/files', authenticateToken, async (req: any, res: any) => {
        try {
            const rawProjectName = req.params.projectName;
            const pathQuery = req.query.path;
            const projectPathQuery = req.query.projectPath;
            const depthQuery = req.query.depth;
            const showHiddenQuery = req.query.showHidden;

            const targetPath = typeof pathQuery === 'string' ? pathQuery : '';
            let maxDepth = 10;

            if (typeof depthQuery === 'string') {
                const parsedDepth = Number.parseInt(depthQuery, 10);
                if (!Number.isNaN(parsedDepth) && parsedDepth >= 0) {
                    maxDepth = parsedDepth;
                }
            }

            const showHidden = showHiddenQuery ? showHiddenQuery !== 'false' : true;

            try {
                const projectRoot = await resolveProjectRootWithHint(rawProjectName, String(projectPathQuery || ''));
                const projectTarget = await resolveProjectPath(projectRoot, targetPath, { allowRoot: true });
                const absolutePath = projectTarget.absolutePath;

                await fsPromises.access(absolutePath);

                const files = await getFileTree(absolutePath, maxDepth, 0, showHidden);
                res.json(files);
            } catch (e: any) {
                if (e.statusCode === 403) {
                    return res.status(403).json({ error: e.message || 'Path is not allowed' });
                }
                if (e.statusCode === 404) {
                    return res.status(404).json({ error: 'Project path not found' });
                }
                if (e.statusCode === 400) {
                    return res.status(400).json({ error: e.message || 'Invalid request' });
                }
                if (e.code === 'ENOENT') {
                    return res.status(404).json({ error: 'Project path not found' });
                }
                throw e;
            }
        } catch (error: any) {
            console.error('[ERROR] File tree error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });
}
