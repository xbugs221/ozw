/**
 * Resolve the package root directory regardless of whether the code is running
 * from source (backend/) or compiled output (dist-node/backend/).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function resolvePackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('package.json not found in ancestor directories');
}
