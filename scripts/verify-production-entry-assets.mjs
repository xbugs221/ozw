/**
 * PURPOSE: Guard production route and interaction boundaries against eager
 * editor, terminal, Markdown, or full syntax-highlighter downloads.
 *
 * OUTPUT: Silently passes when every budget holds and throws with a detailed
 * error when a boundary or budget is violated. Set OZW_VERIFY_ENTRY_REPORT=1
 * to also print the full per-graph asset report on success.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST_DIRECTORY = path.resolve('dist');
const ENTRY_HTML_PATH = path.join(DIST_DIRECTORY, 'index.html');
const MANIFEST_PATH = path.join(DIST_DIRECTORY, '.vite', 'manifest.json');
const ENTRY_GZIP_BUDGET_BYTES = 250 * 1024;
const AUTHENTICATED_HOME_GZIP_BUDGET_BYTES = 400 * 1024;
const PLAIN_TEXT_EDITOR_GZIP_BUDGET_BYTES = 190 * 1024;
const PRISM_SHARED_RUNTIME_GZIP_BUDGET_BYTES = 30 * 1024;
const PRISM_LANGUAGE_REQUEST_GZIP_BUDGET_BYTES = 30 * 1024;
const FORBIDDEN_ENTRY_ASSET_PATTERNS = [/vendor-codemirror/i, /vendor-xterm/i];
const EDITOR_LANGUAGE_PACKAGES = ['css', 'html', 'javascript', 'json', 'markdown', 'python'];

/**
 * Resolve a built asset reference without allowing it to escape dist.
 */
function resolveBuiltAsset(reference, importerPath = ENTRY_HTML_PATH) {
  const assetPath = reference.startsWith('/')
    ? path.join(DIST_DIRECTORY, reference.replace(/^\/+/, ''))
    : path.resolve(path.dirname(importerPath), reference);
  if (!assetPath.startsWith(`${DIST_DIRECTORY}${path.sep}`)) {
    throw new Error(`Production asset escapes dist: ${reference}`);
  }
  return assetPath;
}

/**
 * Read JavaScript and stylesheet references emitted directly into index.html.
 */
function readHtmlEntryAssets(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
}

/**
 * Read only static JavaScript imports; dynamic imports are intentionally not
 * part of the login entry graph.
 */
function readStaticJavaScriptImports(source) {
  const imports = [];
  const importPattern = /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    if (match[1].startsWith('.')) imports.push(match[1]);
  }
  return imports;
}

/**
 * Traverse the browser's static entry graph starting from index.html.
 */
function collectStaticEntryAssets(initialReferences) {
  const assets = new Set();
  const queue = initialReferences.map((reference) => resolveBuiltAsset(reference));

  while (queue.length > 0) {
    const assetPath = queue.shift();
    if (!assetPath || assets.has(assetPath)) continue;
    if (!fs.existsSync(assetPath)) throw new Error(`Missing production entry asset: ${assetPath}`);
    assets.add(assetPath);

    if (assetPath.endsWith('.js')) {
      const source = fs.readFileSync(assetPath, 'utf8');
      readStaticJavaScriptImports(source).forEach((reference) => {
        queue.push(resolveBuiltAsset(reference, assetPath));
      });
    }
  }

  return [...assets];
}

/**
 * Traverse Vite manifest imports for a route chunk without following its
 * dynamic feature imports.
 */
function collectManifestStaticChunkKeys(manifest, initialKeys) {
  const visitedKeys = new Set();
  const queue = [...initialKeys];

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visitedKeys.has(key)) continue;
    visitedKeys.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing production manifest chunk: ${key}`);
    for (const importKey of chunk.imports || []) queue.push(importKey);
  }

  return visitedKeys;
}

/**
 * Resolve the built files referenced by a route's static manifest graph.
 */
function collectManifestStaticAssets(manifest, initialKeys) {
  const assets = new Set();
  for (const key of collectManifestStaticChunkKeys(manifest, initialKeys)) {
    const chunk = manifest[key];
    if (chunk.file) assets.add(resolveBuiltAsset(`/${chunk.file}`));
    for (const cssFile of chunk.css || []) assets.add(resolveBuiltAsset(`/${cssFile}`));
  }
  return [...assets];
}

/**
 * Build a deterministic byte report for a set of production assets.
 */
function buildAssetReport(assetPaths) {
  return assetPaths.map((assetPath) => {
    const contents = fs.readFileSync(assetPath);
    return {
      asset: `/${path.relative(DIST_DIRECTORY, assetPath).replaceAll(path.sep, '/')}`,
      bytes: contents.length,
      gzipBytes: zlib.gzipSync(contents).length,
    };
  }).sort((left, right) => left.asset.localeCompare(right.asset));
}

/**
 * Reject editor and terminal vendor chunks from a static route graph.
 */
function assertNoHeavyFeatureAssets(report, graphName) {
  const forbiddenAssets = report.filter(({ asset }) => (
    FORBIDDEN_ENTRY_ASSET_PATTERNS.some((pattern) => pattern.test(asset))
  ));
  if (forbiddenAssets.length > 0) {
    throw new Error(`Heavy feature bundles leaked into ${graphName}: ${forbiddenAssets.map(({ asset }) => asset).join(', ')}`);
  }
}

/**
 * Require editor languages and rich Markdown preview to remain interaction-only
 * dynamic entries rather than joining the plain-text editor graph.
 */
function assertEditorFeatureBoundaries(manifest, editorKey) {
  const editorChunk = manifest[editorKey];
  const staticEditorKeys = collectManifestStaticChunkKeys(manifest, [editorKey]);
  const dynamicEditorKeys = new Set(editorChunk.dynamicImports || []);

  for (const languagePackage of EDITOR_LANGUAGE_PACKAGES) {
    const packageMarker = `@codemirror/lang-${languagePackage}/dist/index.js`;
    const pnpmPackageMarker = `@codemirror+lang-${languagePackage}@`;
    const languageKey = Object.keys(manifest).find((key) => (
      key.includes(packageMarker) || key.includes(pnpmPackageMarker)
    ));
    if (!languageKey || !dynamicEditorKeys.has(languageKey)) {
      throw new Error(`Editor language package is not a direct dynamic entry: ${languagePackage}`);
    }
    if (staticEditorKeys.has(languageKey)) {
      throw new Error(`Editor language package leaked into the plain-text graph: ${languagePackage}`);
    }
  }

  const markdownPreviewKey = Object.entries(manifest).find(([key, chunk]) => (
    key.endsWith('MarkdownPreview.tsx')
      || chunk.src?.endsWith('MarkdownPreview.tsx')
      || chunk.name === 'MarkdownPreview'
  ))?.[0];
  if (!markdownPreviewKey || !dynamicEditorKeys.has(markdownPreviewKey) || staticEditorKeys.has(markdownPreviewKey)) {
    throw new Error('Rich Markdown preview must remain outside the plain-text editor graph');
  }
}

/**
 * Require Prism languages and its parser core to remain request-driven chunks
 * while keeping the shared renderer substantially smaller than the full set.
 */
function inspectPrismRuntime(manifest, plainTextEditorAssets) {
  const manifestEntries = Object.entries(manifest);
  const coreKey = manifestEntries.find(([, chunk]) => (
    chunk.isDynamicEntry && chunk.name === 'core'
  ))?.[0];
  const runtimeEntry = manifestEntries.find(([, chunk]) => (
    coreKey && (chunk.dynamicImports || []).includes(coreKey)
  ));
  if (!coreKey || !runtimeEntry) {
    throw new Error('Prism parser core must remain an on-demand dynamic entry');
  }

  const [runtimeKey, runtimeChunk] = runtimeEntry;
  const bashKey = (runtimeChunk.dynamicImports || []).find((key) => (
    manifest[key]?.isDynamicEntry && manifest[key]?.name === 'bash'
  ));
  if (!bashKey) {
    throw new Error('Prism languages must remain individual on-demand entries');
  }

  const runtimeAssetPath = resolveBuiltAsset(`/${runtimeChunk.file}`);
  if (plainTextEditorAssets.includes(runtimeAssetPath)) {
    throw new Error('Prism runtime leaked into the plain-text editor graph');
  }

  const report = buildAssetReport([runtimeAssetPath]);
  if (report[0].gzipBytes > PRISM_SHARED_RUNTIME_GZIP_BUDGET_BYTES) {
    throw new Error(`Prism shared runtime is ${report[0].gzipBytes} gzip bytes; budget is ${PRISM_SHARED_RUNTIME_GZIP_BUDGET_BYTES}`);
  }

  const languageRequestAssets = [...collectManifestStaticChunkKeys(manifest, [coreKey, bashKey])]
    .filter((key) => !manifest[key].isEntry && manifest[key].name !== 'vendor-react')
    .flatMap((key) => {
      const chunk = manifest[key];
      return [chunk.file, ...(chunk.css || [])]
        .filter(Boolean)
        .map((file) => resolveBuiltAsset(`/${file}`));
    });
  const languageRequestReport = buildAssetReport([...new Set(languageRequestAssets)]);
  const languageRequestGzipBytes = languageRequestReport.reduce((total, asset) => total + asset.gzipBytes, 0);
  if (languageRequestGzipBytes > PRISM_LANGUAGE_REQUEST_GZIP_BUDGET_BYTES) {
    throw new Error(`Prism representative language request is ${languageRequestGzipBytes} gzip bytes; budget is ${PRISM_LANGUAGE_REQUEST_GZIP_BUDGET_BYTES}`);
  }

  return {
    runtimeKey,
    coreKey,
    bashKey,
    report,
    languageRequestReport,
    languageRequestGzipBytes,
  };
}

/**
 * Fail the build when the static login graph exceeds its budget or includes a
 * feature bundle that belongs behind an interaction boundary.
 */
function verifyProductionEntry() {
  const html = fs.readFileSync(ENTRY_HTML_PATH, 'utf8');
  const assets = collectStaticEntryAssets(readHtmlEntryAssets(html));
  const report = buildAssetReport(assets);
  assertNoHeavyFeatureAssets(report, 'the production entry');

  const totalGzipBytes = report.reduce((total, asset) => total + asset.gzipBytes, 0);
  if (totalGzipBytes > ENTRY_GZIP_BUDGET_BYTES) {
    throw new Error(`Production entry is ${totalGzipBytes} gzip bytes; budget is ${ENTRY_GZIP_BUDGET_BYTES}`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestEntries = Object.entries(manifest);
  const entryKey = manifestEntries.find(([, chunk]) => chunk.isEntry)?.[0];
  const appContentKey = manifestEntries.find(([key, chunk]) => (
    key.endsWith('frontend/components/app/AppContent.tsx')
      || chunk.src === 'frontend/components/app/AppContent.tsx'
      || (chunk.isDynamicEntry && chunk.name === 'AppContent')
  ))?.[0];
  const editorKey = manifestEntries.find(([key, chunk]) => (
    key.endsWith('frontend/components/code-editor/view/EditorSidebar.tsx')
      || chunk.src === 'frontend/components/code-editor/view/EditorSidebar.tsx'
      || (chunk.isDynamicEntry && chunk.name === 'EditorSidebar')
  ))?.[0];
  if (!entryKey || !appContentKey || !editorKey) {
    throw new Error('Production manifest is missing the entry, AppContent, or EditorSidebar route');
  }

  const authenticatedHomeAssets = collectManifestStaticAssets(manifest, [entryKey, appContentKey]);
  const authenticatedHomeReport = buildAssetReport(authenticatedHomeAssets);
  assertNoHeavyFeatureAssets(authenticatedHomeReport, 'the authenticated home route');
  const authenticatedHomeGzipBytes = authenticatedHomeReport.reduce((total, asset) => total + asset.gzipBytes, 0);
  if (authenticatedHomeGzipBytes > AUTHENTICATED_HOME_GZIP_BUDGET_BYTES) {
    throw new Error(`Authenticated home route is ${authenticatedHomeGzipBytes} gzip bytes; budget is ${AUTHENTICATED_HOME_GZIP_BUDGET_BYTES}`);
  }

  assertEditorFeatureBoundaries(manifest, editorKey);
  const authenticatedHomeAssetSet = new Set(authenticatedHomeAssets);
  const plainTextEditorAssets = collectManifestStaticAssets(manifest, [entryKey, appContentKey, editorKey])
    .filter((assetPath) => !authenticatedHomeAssetSet.has(assetPath));
  const plainTextEditorReport = buildAssetReport(plainTextEditorAssets);
  const plainTextEditorGzipBytes = plainTextEditorReport.reduce((total, asset) => total + asset.gzipBytes, 0);
  if (plainTextEditorGzipBytes > PLAIN_TEXT_EDITOR_GZIP_BUDGET_BYTES) {
    throw new Error(`Plain-text editor adds ${plainTextEditorGzipBytes} gzip bytes; budget is ${PLAIN_TEXT_EDITOR_GZIP_BUDGET_BYTES}`);
  }
  const prismRuntime = inspectPrismRuntime(manifest, plainTextEditorAssets);

  const summary = {
    entry: { assets: report, totalGzipBytes, budgetBytes: ENTRY_GZIP_BUDGET_BYTES },
    authenticatedHome: {
      assets: authenticatedHomeReport,
      totalGzipBytes: authenticatedHomeGzipBytes,
      budgetBytes: AUTHENTICATED_HOME_GZIP_BUDGET_BYTES,
    },
    plainTextEditor: {
      assets: plainTextEditorReport,
      totalGzipBytes: plainTextEditorGzipBytes,
      budgetBytes: PLAIN_TEXT_EDITOR_GZIP_BUDGET_BYTES,
    },
    syntaxHighlighter: {
      sharedAssets: prismRuntime.report,
      parserCoreEntry: prismRuntime.coreKey,
      representativeLanguageEntry: prismRuntime.bashKey,
      sharedBudgetBytes: PRISM_SHARED_RUNTIME_GZIP_BUDGET_BYTES,
      representativeLanguageAssets: prismRuntime.languageRequestReport,
      representativeLanguageGzipBytes: prismRuntime.languageRequestGzipBytes,
      representativeLanguageBudgetBytes: PRISM_LANGUAGE_REQUEST_GZIP_BUDGET_BYTES,
    },
  };
  if (process.env.OZW_VERIFY_ENTRY_REPORT === '1') {
    console.log(JSON.stringify(summary, null, 2));
  }
}

verifyProductionEntry();
