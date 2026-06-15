#!/usr/bin/env node
/**
 * PURPOSE: Placeholder script kept for workflow compatibility while JS runtime copy
 * hand-off has been fully migrated to TypeScript compilation outputs.
 * 当前变更不再需要额外 runtime 复制，保留空脚本避免外部调用失败。
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

await writeFile(
  path.join('dist-node', '.copy-build-runtime-js.mjs.marker'),
  'copy-build-runtime-js.mjs 已废弃：当前不再复制手写 JS 运行时。\\n',
);
