/**
 * PURPOSE: Keep heavyweight workspace capabilities outside the production
 * login entry and require the build-time compressed asset guard.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname);

/**
 * Read a repository source file for import-boundary assertions.
 */
async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('authentication entry defers the workspace and onboarding terminal', async () => {
  /** First login must not download the authenticated workspace or xterm. */
  const app = await readSource('frontend/App.tsx');
  const onboarding = await readSource('frontend/components/auth/Onboarding.tsx');

  assert.match(app, /lazy\(\(\)\s*=>\s*import\(['"]\.\/components\/app\/AppContent['"]\)\)/);
  assert.doesNotMatch(app, /import\s+AppContent\s+from/);
  assert.match(onboarding, /lazy\(\(\)\s*=>\s*import\(['"]\.\/LoginModal['"]\)\)/);
  assert.match(onboarding, /activeLoginProvider\s*&&\s*\(/);
  assert.doesNotMatch(onboarding, /import\s+LoginModal\s+from/);
});

test('workspace loads editor, terminal, chat, and rich Markdown by interaction', async () => {
  /** Homepage navigation must stay independent from rich feature runtimes. */
  const mainContent = await readSource('frontend/components/main-content/view/MainContent.tsx');
  const deferredMarkdown = await readSource('frontend/components/chat/view/subcomponents/DeferredMarkdown.tsx');
  const frontendEntry = await readSource('frontend/main.tsx');

  for (const featurePath of [
    '../../chat/view/ChatInterface',
    '../../code-editor/view/EditorSidebar',
    '../../standalone-shell/view/StandaloneShell',
    './subcomponents/WorkflowDetailView',
  ]) {
    assert.match(mainContent, new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\(['"]${featurePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\)\\)`));
  }
  assert.match(mainContent, /if\s*\(!props\.editingFile\)\s*return null/);
  assert.match(deferredMarkdown, /lazy\(\(\)\s*=>\s*import\(['"]\.\/Markdown['"]\)/);
  assert.doesNotMatch(frontendEntry, /katex\/dist\/katex\.min\.css/);
});

test('production build enforces a small static entry without editor or terminal vendors', async () => {
  /** Build success must include a real artifact graph and gzip budget check. */
  const packageJson = JSON.parse(await readSource('package.json')) as { scripts?: Record<string, string> };
  const verifier = await readSource('scripts/verify-production-entry-assets.mjs');
  const viteConfig = await readSource('vite.config.ts');

  assert.match(packageJson.scripts?.build || '', /verify-production-entry-assets\.mjs/);
  assert.match(verifier, /vendor-codemirror/);
  assert.match(verifier, /vendor-xterm/);
  assert.match(verifier, /ENTRY_GZIP_BUDGET_BYTES/);
  assert.match(verifier, /AUTHENTICATED_HOME_GZIP_BUDGET_BYTES/);
  assert.match(viteConfig, /manifest:\s*true/);
  assert.doesNotMatch(viteConfig, /chunkSizeWarningLimit:\s*2500/);
  assert.doesNotMatch(viteConfig, /'vendor-codemirror':\s*\[\s*['"]@uiw\/react-codemirror/);
});

test('plain-text editor defers syntax languages and rich Markdown preview', async () => {
  /** Opening one file must not download every supported syntax package. */
  const editorExtensions = await readSource('frontend/components/code-editor/utils/editorExtensions.ts');
  const editorSurface = await readSource('frontend/components/code-editor/view/subcomponents/CodeEditorSurface.tsx');
  const verifier = await readSource('scripts/verify-production-entry-assets.mjs');
  const viteConfig = await readSource('vite.config.ts');

  for (const languagePackage of ['css', 'html', 'javascript', 'json', 'markdown', 'python']) {
    assert.match(editorExtensions, new RegExp(`import\\(['"]@codemirror/lang-${languagePackage}['"]\\)`));
    assert.doesNotMatch(editorExtensions, new RegExp(`import\\s+[^;]+from\\s+['"]@codemirror/lang-${languagePackage}['"]`));
  }
  assert.match(editorSurface, /lazy\(\(\)\s*=>\s*import\(['"]\.\/markdown\/MarkdownPreview['"]\)\)/);
  assert.match(verifier, /PLAIN_TEXT_EDITOR_GZIP_BUDGET_BYTES/);
  assert.match(verifier, /assertEditorFeatureBoundaries/);
  assert.doesNotMatch(viteConfig, /'vendor-codemirror':\s*\[/);
});

test('Prism parser and languages load only when a code block requests them', async () => {
  /** Chat and Markdown preview must not bundle the complete language catalog. */
  const highlighterConsumers = await Promise.all([
    readSource('frontend/components/chat/view/subcomponents/Markdown.tsx'),
    readSource('frontend/components/chat/tools/components/ContentRenderers/ContextCommandContent.tsx'),
    readSource('frontend/components/code-editor/view/subcomponents/markdown/MarkdownCodeBlock.tsx'),
  ]);
  const verifier = await readSource('scripts/verify-production-entry-assets.mjs');

  for (const source of highlighterConsumers) {
    assert.match(source, /PrismAsyncLight\s+as\s+SyntaxHighlighter/);
    assert.doesNotMatch(source, /\bPrism\s+as\s+SyntaxHighlighter/);
  }
  assert.match(verifier, /PRISM_SHARED_RUNTIME_GZIP_BUDGET_BYTES/);
  assert.match(verifier, /inspectPrismRuntime/);
  assert.match(verifier, /Prism runtime leaked into the plain-text editor graph/);
});

test('both Markdown highlighter entries preserve complete language class ids', async () => {
  /** Rendering entry points must share the tested punctuation-safe extractor. */
  const chatMarkdown = await readSource('frontend/components/chat/view/subcomponents/Markdown.tsx');
  const editorMarkdown = await readSource('frontend/components/code-editor/view/subcomponents/markdown/MarkdownCodeBlock.tsx');
  const syntaxLanguage = await readSource('frontend/utils/syntaxLanguage.ts');

  for (const source of [chatMarkdown, editorMarkdown]) {
    assert.match(source, /getSyntaxLanguageFromClassName\(className\)/);
    assert.doesNotMatch(source, /language-\(\\w\+\)/);
  }
  assert.match(syntaxLanguage, /language-\(\[\^\\s\]\+\)/);
});
