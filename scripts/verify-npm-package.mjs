#!/usr/bin/env node
/**
 * PURPOSE: Audit one already-built npm tarball before it can enter the release
 * matrix or the public registry.
 *
 * The verifier reads the tarball instead of the working tree so every later
 * job can prove that it tested the exact candidate selected for publication.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const MAX_PACKED_BYTES = 5 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 15 * 1024 * 1024;
const MAX_FILE_COUNT = 1200;
const MAX_TAR_BYTES = MAX_UNPACKED_BYTES + (MAX_FILE_COUNT + 4) * 512;
const MAX_JS_ENTRY_BYTES = 1024 * 1024;
const MAX_JS_SOURCE_BYTES = 4 * 1024 * 1024;
const EXPECTED_PACKAGE_NAME = 'ozw';
const FORBIDDEN_INSTALL_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'preprepare',
  'prepare',
  'postprepare',
  'publish',
  'postpublish',
];
const REQUIRED_FILES = [
  'LICENSE',
  'README.md',
  'npm-shrinkwrap.json',
  'package.json',
  'dist/index.html',
  'dist/manifest.webmanifest',
  'dist/sw.js',
  'dist/pwa/icon-192.png',
  'dist/pwa/icon-512.png',
  'dist-node/backend/cli.js',
  'dist-node/backend/index.js',
  'dist-node/backend/database/init.sql',
  'dist-node/backend/commands/aliases/analysis.md',
  'dist-node/backend/commands/aliases/archive.md',
  'dist-node/backend/commands/aliases/explore.md',
  'dist-node/backend/commands/aliases/fix.md',
  'dist-node/backend/commands/aliases/git-clean.md',
  'dist-node/backend/commands/aliases/git-review.md',
  'dist-node/backend/commands/aliases/git-summary.md',
  'dist-node/backend/commands/aliases/propose.md',
];
const ALLOWED_ROOTS = new Set([
  'LICENSE',
  'README.md',
  'npm-shrinkwrap.json',
  'package.json',
  'dist',
  'dist-node',
]);
const FORBIDDEN_PATH_PATTERNS = [
  { pattern: /(?:^|\/)node_modules(?:\/|$)/, reason: 'bundled node_modules' },
  { pattern: /(?:^|\/)(?:tests?|test-results|docs)(?:\/|$)/, reason: 'test or planning content' },
  { pattern: /(?:^|\/)scripts(?:\/|$)/, reason: 'development scripts' },
  { pattern: /^(?:backend|shared)(?:\/|$)/, reason: 'TypeScript source tree' },
  { pattern: /\.(?:ts|tsx|map)$/i, reason: 'source or source map' },
  { pattern: /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/i, reason: 'runtime database' },
  { pattern: /(?:^|\/)\.env(?:\.|$)/, reason: 'environment configuration' },
  { pattern: /\.(?:pem|key|p12|pfx|crt)$/i, reason: 'credential file' },
];
const SENSITIVE_PATH_WORD_PATTERN = /(?:^|[-_.])(?:credentials?|private[-_.]?key|secrets?|tokens?)(?:[-_.]|$)/iu;
const ALLOWED_SENSITIVE_CODE_PATHS = new Set([
  'dist-node/backend/git-credential-env.js',
  'dist-node/backend/security/access-token.js',
  'dist-node/backend/security/jwt-secret.js',
  'dist-node/backend/session-token-usage.js',
]);
const PRIVATE_KEY_MARKERS = [
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN ENCRYPTED PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN DSA PRIVATE KEY-----',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
];

/** Print usage and terminate with an actionable failure. */
function usage(message) {
  if (message) console.error(`npm package audit failed: ${message}`);
  console.error('Usage: node scripts/verify-npm-package.mjs <package.tgz>');
  process.exit(2);
}

/** Run an npm command and parse its single-package JSON response. */
function readPackMetadata(tarballPath) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const stdout = execFileSync(
    npmCommand,
    ['pack', tarballPath, '--dry-run', '--ignore-scripts', '--json'],
    { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0]?.files)) {
    throw new Error('npm pack returned an unexpected manifest');
  }
  return result[0];
}

/** Decode one npm-generated tar header's octal size field. */
function readTarSize(archive, offset, entryPath = 'unknown entry') {
  const rawSize = archive.subarray(offset + 124, offset + 136).toString('ascii');
  const normalizedSize = rawSize.replace(/\0.*$/u, '').trim();
  if (!/^[0-7]+$/u.test(normalizedSize)) {
    throw new Error(`${entryPath} has an invalid tar size field`);
  }
  return Number.parseInt(normalizedSize, 8);
}

/** Reject archive paths that could escape or alias the package root. */
function normalizeArchivePath(entryPath) {
  if (entryPath.includes('\\') || entryPath.includes('\0')) {
    throw new Error(`unsafe tar entry path: ${entryPath}`);
  }
  const normalizedPath = path.posix.normalize(entryPath);
  if (
    !entryPath.startsWith('package/')
    || normalizedPath !== entryPath
    || normalizedPath === 'package'
    || normalizedPath === 'package/'
    || normalizedPath.startsWith('../')
    || normalizedPath.startsWith('/')
  ) {
    throw new Error(`unsafe tar entry path: ${entryPath}`);
  }
  return normalizedPath.slice('package/'.length);
}

/** Detect common private-key armor without decoding an entire archive entry. */
function containsPrivateKey(content) {
  return PRIVATE_KEY_MARKERS.some((marker) => content.includes(marker));
}

/** Detect sensitive names while allowing only reviewed production modules. */
function findSensitivePathReason(filePath) {
  if (/\.(?:pem|key|p12|pfx|crt)$/iu.test(filePath)) return 'credential file';
  if (ALLOWED_SENSITIVE_CODE_PATHS.has(filePath)) return undefined;
  return filePath.split('/').some((component) => SENSITIVE_PATH_WORD_PATTERN.test(component))
    ? 'sensitive path'
    : undefined;
}

/** Scan regular files from an npm tarball without extracting archive paths. */
function readCandidateArchive(tarballPath) {
  const archive = gunzipSync(fs.readFileSync(tarballPath), { maxOutputLength: MAX_TAR_BYTES });
  const packageJsonEntries = [];
  const shrinkwrapEntries = [];
  const packagedPaths = new Set();
  const javascriptSources = new Map();
  const sensitiveContentPaths = [];
  let totalJavaScriptBytes = 0;

  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/u, '');
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const packagePath = normalizeArchivePath(entryPath);
    const entryType = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (entryType !== '0') {
      throw new Error(`unsupported tar entry type ${JSON.stringify(entryType)}: ${entryPath}`);
    }
    const entrySize = readTarSize(archive, offset, entryPath);
    const contentStart = offset + 512;
    const contentEnd = contentStart + entrySize;
    if (!Number.isSafeInteger(entrySize) || contentEnd > archive.length) {
      throw new Error(`invalid tar entry size for ${entryPath}`);
    }
    if (packagedPaths.has(packagePath)) {
      throw new Error(`duplicate tar entry: ${entryPath}`);
    }
    packagedPaths.add(packagePath);

    if (packagePath === 'package.json') {
      packageJsonEntries.push(archive.subarray(contentStart, contentEnd).toString('utf8'));
    }
    if (packagePath === 'npm-shrinkwrap.json') {
      shrinkwrapEntries.push(archive.subarray(contentStart, contentEnd).toString('utf8'));
    }
    if (packagePath.startsWith('dist-node/') && packagePath.endsWith('.js')) {
      if (entrySize > MAX_JS_ENTRY_BYTES) {
        throw new Error(`JavaScript entry exceeds ${MAX_JS_ENTRY_BYTES} bytes: ${packagePath}`);
      }
      totalJavaScriptBytes += entrySize;
      if (totalJavaScriptBytes > MAX_JS_SOURCE_BYTES) {
        throw new Error(`JavaScript sources exceed ${MAX_JS_SOURCE_BYTES} bytes`);
      }
      javascriptSources.set(
        packagePath,
        archive.subarray(contentStart, contentEnd).toString('utf8'),
      );
    }
    if (
      (packagePath.startsWith('dist-node/') || packagePath === 'package.json' || packagePath === 'npm-shrinkwrap.json')
      && containsPrivateKey(archive.subarray(contentStart, contentEnd))
    ) {
      sensitiveContentPaths.push(packagePath);
    }
    offset = contentStart + Math.ceil(entrySize / 512) * 512;
  }

  if (packageJsonEntries.length !== 1) {
    throw new Error(`expected one package/package.json entry, found ${packageJsonEntries.length}`);
  }
  if (shrinkwrapEntries.length !== 1) {
    throw new Error(`expected one package/npm-shrinkwrap.json entry, found ${shrinkwrapEntries.length}`);
  }
  return {
    packageJson: JSON.parse(packageJsonEntries[0]),
    shrinkwrap: JSON.parse(shrinkwrapEntries[0]),
    packagedPaths,
    javascriptSources,
    sensitiveContentPaths,
  };
}

/** Require the published production dependency graph to match the package root exactly. */
function auditProductionShrinkwrap(packageJson, shrinkwrap) {
  const errors = [];
  const root = shrinkwrap?.packages?.[''];
  const expectedDependencies = packageJson.dependencies ?? {};
  const expectedOptionalDependencies = packageJson.optionalDependencies ?? {};
  const optionalDependencyNames = Object.keys(expectedOptionalDependencies).sort();

  if (shrinkwrap?.lockfileVersion !== 3) errors.push('npm shrinkwrap must use lockfileVersion 3');
  if (shrinkwrap?.name !== packageJson.name || shrinkwrap?.version !== packageJson.version) {
    errors.push('npm shrinkwrap name/version must match package.json');
  }
  if (!root || root.name !== packageJson.name || root.version !== packageJson.version) {
    errors.push('npm shrinkwrap root name/version must match package.json');
  }
  if (JSON.stringify(root?.engines ?? {}) !== JSON.stringify(packageJson.engines ?? {})) {
    errors.push('npm shrinkwrap root engines must match package.json');
  }
  if (JSON.stringify(root?.bin ?? {}) !== JSON.stringify(packageJson.bin ?? {})) {
    errors.push('npm shrinkwrap root bin must match package.json');
  }
  if (JSON.stringify(root?.dependencies ?? {}) !== JSON.stringify(expectedDependencies)) {
    errors.push('npm shrinkwrap root dependencies must match package.json');
  }
  if (
    optionalDependencyNames.length !== 1
    || optionalDependencyNames[0] !== 'node-pty'
    || typeof expectedOptionalDependencies['node-pty'] !== 'string'
    || !expectedOptionalDependencies['node-pty'].trim()
  ) {
    errors.push('package optionalDependencies must contain only node-pty');
  }
  if (Object.hasOwn(expectedDependencies, 'node-pty')) {
    errors.push('node-pty must not be a required dependency');
  }
  if (JSON.stringify(root?.optionalDependencies ?? {}) !== JSON.stringify(expectedOptionalDependencies)) {
    errors.push('npm shrinkwrap root optionalDependencies must match package.json');
  }
  if (root?.devDependencies) {
    errors.push('npm shrinkwrap root must not contain devDependencies');
  }
  if (shrinkwrap?.packages?.['node_modules/node-pty']?.optional !== true) {
    errors.push('npm shrinkwrap must mark node-pty optional');
  }

  for (const [packagePath, entry] of Object.entries(shrinkwrap?.packages ?? {})) {
    if (entry?.dev === true) errors.push(`npm shrinkwrap contains a dev package: ${packagePath}`);
    if (entry?.devDependencies) {
      errors.push(`npm shrinkwrap contains devDependencies metadata: ${packagePath}`);
    }
    for (const field of ['resolved', 'version']) {
      const value = entry?.[field];
      if (typeof value === 'string' && /^(?:file|git\+|git|github|workspace):/iu.test(value)) {
        errors.push(`npm shrinkwrap contains a non-registry ${field}: ${packagePath}`);
      }
    }
    const resolved = entry?.resolved;
    if (typeof resolved === 'string') {
      try {
        const url = new URL(resolved);
        if (url.username || url.password) {
          errors.push(`npm shrinkwrap contains credentials in resolved URL: ${packagePath}`);
        }
      } catch {
        errors.push(`npm shrinkwrap contains an invalid resolved URL: ${packagePath}`);
      }
    }
  }
  if (/"(?:_auth|_authToken|authToken|password)"\s*:/u.test(JSON.stringify(shrinkwrap))) {
    errors.push('npm shrinkwrap contains credential metadata');
  }
  return errors;
}

/** Extract relative ESM specifiers emitted by TypeScript without executing code. */
function findRelativeModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?(['"])(\.\.?\/[^'"\r\n]+)\1/gu,
    /\bimport\s*\(\s*(['"])(\.\.?\/[^'"\r\n]+)\1\s*(?:,\s*\{[^)]*\})?\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[2]);
  }
  return specifiers;
}

/** Resolve one relative ESM specifier to package paths Node may load. */
function resolveRelativeModuleCandidates(importerPath, specifier) {
  const bareSpecifier = specifier.split(/[?#]/u, 1)[0];
  const resolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), bareSpecifier));
  if (
    resolvedPath === '..'
    || resolvedPath.startsWith('../')
    || resolvedPath.startsWith('/')
    || !resolvedPath.startsWith('dist-node/')
  ) {
    throw new Error(`relative import escapes dist-node: ${importerPath} -> ${specifier}`);
  }
  if (path.posix.extname(resolvedPath)) return [resolvedPath];
  return [
    resolvedPath,
    `${resolvedPath}.js`,
    `${resolvedPath}.json`,
    `${resolvedPath}.node`,
    `${resolvedPath}/index.js`,
    `${resolvedPath}/index.json`,
    `${resolvedPath}/index.node`,
  ];
}

/** Require every packaged server module's relative dependency to be packaged too. */
function auditRelativeModuleClosure(packagedPaths, javascriptSources) {
  const errors = [];
  for (const [importerPath, source] of javascriptSources) {
    for (const specifier of findRelativeModuleSpecifiers(source)) {
      let candidates;
      try {
        candidates = resolveRelativeModuleCandidates(importerPath, specifier);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (!candidates.some((candidate) => packagedPaths.has(candidate))) {
        errors.push(`relative import is missing: ${importerPath} -> ${specifier}`);
      }
    }
  }
  return errors;
}

/** Return the first forbidden-content rule matching a packaged path. */
function findForbiddenRule(filePath) {
  const sensitivePathReason = findSensitivePathReason(filePath);
  if (sensitivePathReason) return { pattern: /$^/u, reason: sensitivePathReason };
  return FORBIDDEN_PATH_PATTERNS.find(({ pattern }) => pattern.test(filePath));
}

/** Validate metadata, production assets, content boundaries, and size budgets. */
function auditPackage(metadata, candidateArchive) {
  const errors = [];
  const {
    packageJson,
    shrinkwrap,
    packagedPaths: archivePaths,
    javascriptSources,
    sensitiveContentPaths,
  } = candidateArchive;
  const packagedPaths = new Set(metadata.files.map(({ path: filePath }) => filePath));
  const packageId = `${packageJson.name}@${packageJson.version}`;

  if (packageJson.name !== EXPECTED_PACKAGE_NAME) {
    errors.push(`package name must equal ${EXPECTED_PACKAGE_NAME}`);
  }
  if (metadata.id !== packageId) {
    errors.push(`npm manifest id ${metadata.id} does not match package.json ${packageId}`);
  }
  if (packageJson.bin?.ozw !== 'dist-node/backend/cli.js') {
    errors.push('bin.ozw must equal dist-node/backend/cli.js');
  }
  for (const scriptName of FORBIDDEN_INSTALL_SCRIPTS) {
    if (packageJson.scripts?.[scriptName]) {
      errors.push(`${scriptName} must be absent from the published package`);
    }
  }

  for (const requiredPath of REQUIRED_FILES) {
    if (!packagedPaths.has(requiredPath)) errors.push(`required file is missing: ${requiredPath}`);
  }

  for (const { path: filePath } of metadata.files) {
    const root = filePath.split('/')[0];
    if (!ALLOWED_ROOTS.has(root)) errors.push(`root is not allowed: ${filePath}`);
    const forbiddenRule = findForbiddenRule(filePath);
    if (forbiddenRule) errors.push(`${forbiddenRule.reason} is not allowed: ${filePath}`);
  }

  if (metadata.size > MAX_PACKED_BYTES) {
    errors.push(`packed size ${metadata.size} exceeds ${MAX_PACKED_BYTES} bytes`);
  }
  if (metadata.unpackedSize > MAX_UNPACKED_BYTES) {
    errors.push(`unpacked size ${metadata.unpackedSize} exceeds ${MAX_UNPACKED_BYTES} bytes`);
  }
  if (metadata.entryCount > MAX_FILE_COUNT) {
    errors.push(`file count ${metadata.entryCount} exceeds ${MAX_FILE_COUNT}`);
  }
  for (const metadataPath of packagedPaths) {
    if (!archivePaths.has(metadataPath)) errors.push(`npm manifest entry is missing from tar: ${metadataPath}`);
  }
  for (const archivePath of archivePaths) {
    if (!packagedPaths.has(archivePath)) errors.push(`tar entry is missing from npm manifest: ${archivePath}`);
  }
  errors.push(...auditRelativeModuleClosure(archivePaths, javascriptSources));
  for (const sensitivePath of sensitiveContentPaths) {
    errors.push(`private key content is not allowed: ${sensitivePath}`);
  }
  errors.push(...auditProductionShrinkwrap(packageJson, shrinkwrap));

  return errors;
}

/** Audit the tarball named on the command line. */
function main() {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  if (args.length !== 1) usage('exactly one tarball path is required');

  const tarballPath = path.resolve(process.cwd(), args[0]);
  if (!tarballPath.endsWith('.tgz')) usage('candidate must use the .tgz extension');
  const tarballStats = fs.statSync(tarballPath, { throwIfNoEntry: false });
  if (!tarballStats?.isFile()) {
    usage(`tarball does not exist: ${tarballPath}`);
  }
  if (tarballStats.size > MAX_PACKED_BYTES) {
    throw new Error(`packed size ${tarballStats.size} exceeds ${MAX_PACKED_BYTES} bytes`);
  }

  const candidateArchive = readCandidateArchive(tarballPath);
  const metadata = readPackMetadata(tarballPath);
  const errors = auditPackage(metadata, candidateArchive);
  if (errors.length > 0) {
    console.error(`npm package audit failed for ${metadata.id}:`);
    for (const error of [...new Set(errors)]) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    id: metadata.id,
    filename: path.basename(tarballPath),
    sha512: metadata.integrity,
    packedBytes: metadata.size,
    unpackedBytes: metadata.unpackedSize,
    fileCount: metadata.entryCount,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`npm package audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export {
  auditProductionShrinkwrap,
  auditRelativeModuleClosure,
  containsPrivateKey,
  findForbiddenRule,
  findRelativeModuleSpecifiers,
  normalizeArchivePath,
  readCandidateArchive,
  resolveRelativeModuleCandidates,
};
