#!/usr/bin/env node
/**
 * PURPOSE: Remove the complete compiled server tree before a release build so
 * stale modules or runtime state can never leak into an npm tarball.
 */

import { rm } from 'node:fs/promises';
import path from 'node:path';

const serverOutputPath = path.resolve('dist-node');
const serverBuildInfoPath = path.resolve('.tmp/tsbuildinfo/build.tsbuildinfo');

/** Remove only the repository's dedicated TypeScript output and incremental cache. */
async function cleanServerBuild() {
  await Promise.all([
    rm(serverOutputPath, { recursive: true, force: true }),
    rm(serverBuildInfoPath, { force: true }),
  ]);
}

await cleanServerBuild();
