// @ts-nocheck -- Complex cross-module type dependencies; needs dedicated pass.
/**
 * PURPOSE: Centralize project-root-constrained file operations for workspace
 * mutation, upload, and download routes.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import { extractProjectDirectory } from './projects.js';
import { resolveFlowBatchesRoot, resolveFlowRunsRoot } from './domains/workflows/flow-runtime-paths.js';

/**
 * Normalize a relative workspace path into POSIX-style form for API payloads.
 *
 * @param {string} projectRoot
 * @param {string} targetPath
 * @returns {string}
 */
function toProjectRelativePath(projectRoot, targetPath) {
    const relativePath = path.relative(projectRoot, targetPath);
    return relativePath === '' ? '' : relativePath.split(path.sep).join('/');
}

/**
 * Reject names that would escape the current directory or create ambiguous entries.
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitizeEntryName(name) {
    if (typeof name !== 'string') {
        throw new Error('Entry name is required');
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
        throw new Error('Entry name is required');
    }

    if (trimmedName === '.' || trimmedName === '..') {
        throw new Error('Entry name is invalid');
    }

    if (trimmedName.includes('/') || trimmedName.includes('\\')) {
        throw new Error('Entry name must not contain path separators');
    }

    return trimmedName;
}

/**
 * Normalize upload-relative paths and reject traversal attempts early.
 *
 * @param {string} relativePath
 * @returns {string}
 */
export function sanitizeUploadRelativePath(relativePath) {
    if (typeof relativePath !== 'string') {
        throw new Error('Upload path is required');
    }

    const normalizedPath = relativePath.replace(/\\/g, '/').trim();
    if (!normalizedPath) {
        throw new Error('Upload path is required');
    }

    if (normalizedPath.startsWith('/')) {
        throw new Error('Upload path must be relative');
    }

    const segments = normalizedPath.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error('Upload path is invalid');
    }

    return segments.join('/');
}

/**
 * Resolve the real project root directory for a route request.
 *
 * @param {string} projectName
 * @returns {Promise<string>}
 */
export async function resolveProjectRoot(projectName) {
    const projectDirectory = await extractProjectDirectory(projectName).catch(() => null);
    if (!projectDirectory) {
        const error = new Error('Project not found');
        error.statusCode = 404;
        throw error;
    }

    try {
        return await fsPromises.realpath(projectDirectory);
    } catch {
        return path.resolve(projectDirectory);
    }
}

/**
 * Resolve the project root and fall back to a caller-provided absolute path hint
 * when project-name discovery metadata is missing for a specific session view.
 *
 * @param {string} projectName
 * @param {string | null | undefined} projectPathHint
 * @returns {Promise<string>}
 */
export async function resolveProjectRootWithHint(projectName, projectPathHint) {
    const hintedPath = typeof projectPathHint === 'string' ? projectPathHint.trim() : '';

    try {
        const resolvedRoot = await resolveProjectRoot(projectName);
        const resolvedStats = await fsPromises.stat(resolvedRoot).catch(() => null);

        if (resolvedStats?.isDirectory()) {
            return resolvedRoot;
        }
    } catch (error) {
        if (!hintedPath) {
            throw error;
        }
    }

    if (!hintedPath) {
        const error = new Error('Project not found');
        error.statusCode = 404;
        throw error;
    }

    const resolvedHint = path.resolve(hintedPath);
    const hintedStats = await fsPromises.stat(resolvedHint).catch(() => null);
    if (!hintedStats?.isDirectory()) {
        const error = new Error('Project not found');
        error.statusCode = 404;
        throw error;
    }

    try {
        return await fsPromises.realpath(resolvedHint);
    } catch {
        return resolvedHint;
    }
}

/**
 * Resolve a path inside a project root, handling both absolute and relative inputs.
 *
 * @param {string} projectRoot
 * @param {string} inputPath
 * @param {{ allowRoot?: boolean }} [options]
 * @returns {Promise<{ projectRoot: string, absolutePath: string, relativePath: string }>}
 */
export async function resolveProjectPath(projectRoot, inputPath, options = {}) {
    const { allowRoot = false } = options;

    if (typeof inputPath !== 'string') {
        const error = new Error('Path is required');
        error.statusCode = 400;
        throw error;
    }

    const trimmedPath = inputPath.trim();
    if (!trimmedPath) {
        if (!allowRoot) {
            const error = new Error('Path is required');
            error.statusCode = 400;
            throw error;
        }

        return {
            projectRoot,
            absolutePath: projectRoot,
            relativePath: '',
        };
    }

    const candidatePath = path.isAbsolute(trimmedPath)
        ? path.resolve(trimmedPath)
        : path.resolve(projectRoot, trimmedPath);
    const relativePath = path.relative(projectRoot, candidatePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        const error = new Error('Path must be under project root');
        error.statusCode = 403;
        throw error;
    }

    return {
        projectRoot,
        absolutePath: candidatePath,
        relativePath: toProjectRelativePath(projectRoot, candidatePath),
    };
}

/**
 * Check whether an absolute path lives inside a filesystem root after resolving
 * symlinks where possible.
 *
 * @param {string} rootPath
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
async function isPathInsideRoot(rootPath, targetPath) {
    const resolvedRoot = await fsPromises.realpath(rootPath).catch(() => path.resolve(rootPath));
    const resolvedTarget = await fsPromises.realpath(targetPath).catch((error) => {
        if (error?.code === 'ENOENT') {
            return path.resolve(targetPath);
        }
        throw error;
    });
    const relativePath = path.relative(resolvedRoot, resolvedTarget);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

/**
 * Return unique project path candidates that can have generated the oz flow repo key.
 *
 * @param {string} projectRoot
 * @param {string | null | undefined} projectPathHint
 * @returns {string[]}
 */
function buildWorkflowRuntimeProjectPathCandidates(projectRoot, projectPathHint) {
    const candidates = [projectRoot];
    const hintedPath = typeof projectPathHint === 'string' ? projectPathHint.trim() : '';
    if (hintedPath) {
        candidates.push(path.resolve(hintedPath));
    }
    return [...new Set(candidates.filter(Boolean))];
}

/**
 * Resolve a readable file path, allowing normal project files plus read-only oz flow
 * runtime artifacts generated for the same project.
 *
 * @param {string} projectRoot
 * @param {string} inputPath
 * @param {{ allowRoot?: boolean, projectPathHint?: string }} [options]
 * @returns {Promise<{ projectRoot: string, absolutePath: string, relativePath: string, readOnly: boolean, scope: string }>}
 */
export async function resolveReadableProjectPath(projectRoot, inputPath, options = {}) {
    try {
        const projectTarget = await resolveProjectPath(projectRoot, inputPath, options);
        return {
            ...projectTarget,
            readOnly: false,
            scope: 'project',
        };
    } catch (error) {
        const trimmedPath = typeof inputPath === 'string' ? inputPath.trim() : '';
        if (error?.statusCode !== 403 || !path.isAbsolute(trimmedPath)) {
            throw error;
        }

        const absolutePath = path.resolve(trimmedPath);
        const projectCandidates = buildWorkflowRuntimeProjectPathCandidates(projectRoot, options.projectPathHint);
        const allowedRoots = projectCandidates.flatMap((candidate) => [
            resolveFlowRunsRoot(candidate),
            resolveFlowBatchesRoot(candidate),
        ]);
        for (const runtimeRoot of allowedRoots) {
            if (await isPathInsideRoot(runtimeRoot, absolutePath)) {
                return {
                    projectRoot,
                    absolutePath,
                    relativePath: absolutePath,
                    readOnly: true,
                    scope: 'workflow-runtime',
                };
            }
        }

        throw error;
    }
}

/**
 * Resolve a project path for a route request in one call.
 *
 * @param {string} projectName
 * @param {string} inputPath
 * @param {{ allowRoot?: boolean }} [options]
 * @returns {Promise<{ projectRoot: string, absolutePath: string, relativePath: string }>}
 */
export async function resolveProjectTarget(projectName, inputPath, options = {}) {
    const projectRoot = await resolveProjectRoot(projectName);
    return resolveProjectPath(projectRoot, inputPath, options);
}

/**
 * Join a validated child name onto an already validated directory path.
 *
 * @param {string} parentDirectory
 * @param {string} childName
 * @returns {string}
 */
export function joinProjectChildPath(parentDirectory, childName) {
    return path.join(parentDirectory, sanitizeEntryName(childName));
}

/**
 * Build a folder zip archive using the host `zip` utility so binary bytes stay untouched.
 *
 * @param {string} sourceDirectory
 * @returns {Promise<string>}
 */
export async function createDirectoryArchive(sourceDirectory) {
    const tempDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ozw-folder-download-'));
    const archivePath = path.join(tempDirectory, `${path.basename(sourceDirectory)}.zip`);

    return new Promise((resolve, reject) => {
        const zipProcess = spawn(
            'zip',
            ['-r', '-q', archivePath, path.basename(sourceDirectory)],
            { cwd: path.dirname(sourceDirectory) },
        );

        let stderr = '';
        zipProcess.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        zipProcess.on('error', (error) => {
            reject(error);
        });

        zipProcess.on('close', (code) => {
            if (code === 0) {
                resolve(archivePath);
                return;
            }

            const error = new Error(stderr.trim() || `zip exited with code ${code}`);
            reject(error);
        });
    });
}

/**
 * Remove a temporary file or directory best-effort after a response finishes.
 *
 * @param {string} targetPath
 * @returns {Promise<void>}
 */
export async function cleanupTemporaryPath(targetPath) {
    await fsPromises.rm(targetPath, { recursive: true, force: true }).catch(() => {});
}

/**
 * Send a file download response with a stable attachment name and cleanup hook.
 *
 * @param {import('express').Response} res
 * @param {string} filePath
 * @param {string} downloadName
 * @param {string | null} cleanupPath
 * @returns {void}
 */
export function sendDownload(res, filePath, downloadName, cleanupPath = null) {
    if (cleanupPath) {
        res.on('finish', () => {
            void cleanupTemporaryPath(cleanupPath);
        });
        res.on('close', () => {
            void cleanupTemporaryPath(cleanupPath);
        });
    }

    res.download(filePath, downloadName, (error) => {
        if (error && !res.headersSent) {
            res.status(500).json({ error: 'Failed to download file' });
        }
    });
}

/**
 * Build consistent mutation payloads for frontend refresh and feedback flows.
 *
 * @param {string} projectRoot
 * @param {string} absolutePath
 * @param {{ message: string, type: 'file' | 'directory' }} metadata
 * @returns {{ success: true, path: string, relativePath: string, type: 'file' | 'directory', message: string }}
 */
export function buildMutationResponse(projectRoot, absolutePath, metadata) {
    return {
        success: true,
        path: absolutePath,
        relativePath: toProjectRelativePath(projectRoot, absolutePath),
        type: metadata.type,
        message: metadata.message,
    };
}
