/**
 * 文件目的：定义 HTTP route 注册模块共享的依赖注入类型边界。
 * 业务意义：让 server runtime 注入的 app、认证、数据读取和工作流函数可审查，避免 route deps 退化成 any。
 */

import type { RequestHandler } from 'express';

export type HttpRouteApp = {
    get(path: string, ...handlers: RequestHandler[]): unknown;
    post(path: string, ...handlers: RequestHandler[]): unknown;
    put(path: string, ...handlers: RequestHandler[]): unknown;
    delete(path: string, ...handlers: RequestHandler[]): unknown;
};

export type AuthMiddleware = RequestHandler;

export type LooseRecord = Record<string, unknown>;

export type ProjectLike = LooseRecord & {
    name?: string;
    routePath?: string;
    path?: string;
    fullPath?: string;
};

export type WorkflowLike = LooseRecord & {
    id?: string;
    name?: string;
};

export type ProjectInvalidationEvent = {
    reason: string;
    changedProjectPath?: string;
};

export type HeavyReadCoalescer = {
    run<T>(key: string, producer: () => T | Promise<T>): Promise<T>;
};

export type FsPromisesDeps = {
    stat(path: string): Promise<{ isDirectory(): boolean }>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
    unlink(path: string): Promise<unknown>;
    readFile(path: string, encoding: BufferEncoding): Promise<string>;
};

export type PathDeps = {
    join(...paths: string[]): string;
};

export type OsDeps = {
    homedir(): string;
};

export type ChildProcessLike = {
    stdout: { on(event: 'data', listener: (data: Buffer) => void): unknown };
    stderr: { on(event: 'data', listener: (data: Buffer) => void): unknown };
    on(event: 'close', listener: (code: number | null) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
};

export type SpawnDeps = (command: string, args: string[], options: LooseRecord) => ChildProcessLike;

export type FetchDeps = typeof fetch;

export type UploadedFileLike = {
    path: string;
    originalname?: string;
    mimetype?: string;
    buffer?: Buffer;
};
