#!/usr/bin/env node
/**
 * PURPOSE: Copy non-TypeScript backend assets into the compiled production tree
 * so an installed package can start without reading the source directories.
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, '..');
const runtimeAssets = [
  'backend/database/init.sql',
  'backend/commands/aliases',
];

/**
 * Remove source maps and stale source-map directives before packaging.
 */
async function removeSourceMaps(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await removeSourceMaps(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      await rm(entryPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const source = await readFile(entryPath, 'utf8');
      const productionSource = source.replace(
        /^[ \t]*\/\/[#@][ \t]*sourceMappingURL=.*(?:\r?\n|$)/gm,
        '',
      );
      if (productionSource !== source) {
        await writeFile(entryPath, productionSource);
      }
    }
  }));
}

/**
 * Copy one runtime asset to the same relative path under dist-node.
 */
async function copyRuntimeAsset(relativePath) {
  const sourcePath = path.join(packageRoot, relativePath);
  const destinationPath = path.join(packageRoot, 'dist-node', relativePath);

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await rm(destinationPath, { recursive: true, force: true });
  await cp(sourcePath, destinationPath, { recursive: true, force: true });
}

await Promise.all(runtimeAssets.map(copyRuntimeAsset));
await removeSourceMaps(path.join(packageRoot, 'dist-node'));
