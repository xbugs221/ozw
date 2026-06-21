// 文件目的：用源码契约锁定消息加载、项目刷新和 UI 保护的性能边界。
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_PATH = path.join(REPO_ROOT, 'test-results/29-performance-boundary/source-audit.json');

type PerformanceAudit = {
  sessionRuntime: {
    hasLoadAllMessages: boolean;
    loadAllUsesNullLimit: boolean;
    hasBulkLoaderModule: boolean;
    hasBulkPageSize: boolean;
  };
  projectRefresh: {
    hasSignatureBuilder: boolean;
    serializeUsesJsonStringify: boolean;
    projectsHaveChangesTouchesHeavyArrays: boolean;
  };
  existingGuards: {
    fileMentionsOnDemand: boolean;
    fileMentionsDepthAtMostTwo: boolean;
    fileMentionsHiddenDisabled: boolean;
    chatMessagesPaneVirtualized: boolean;
    chatMessagesWindowLimit: number | null;
  };
};

async function readRepoFile(relativePath: string): Promise<string> {
  /** Read source text without importing application modules. */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

async function pathExists(relativePath: string): Promise<boolean> {
  /** Check optional performance modules while keeping evidence generation complete. */
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

function extractFunctionBody(source: string, functionName: string): string {
  /** Extract a broad source slice around a function-like block for static contract checks. */
  const start = source.indexOf(functionName);
  if (start < 0) {
    return '';
  }
  return source.slice(start, Math.min(source.length, start + 5000));
}

function detectWindowLimit(source: string): number | null {
  /** Locate the virtualized message window limit when it is expressed as a numeric constant. */
  const match = source.match(
    /(?:MAX_RENDERED_TRANSCRIPT_MESSAGES|MAX_[A-Z_]*WINDOW[A-Z_]*|WINDOW_[A-Z_]*LIMIT|windowLimit)\s*[:=]\s*(\d+)/,
  );
  return match ? Number(match[1]) : null;
}

async function collectAudit(): Promise<PerformanceAudit> {
  /** Build a performance-boundary snapshot before assertions. */
  const sessionRuntime = await readRepoFile('frontend/components/chat/session/useChatSessionStateRuntime.ts');
  const loadAllMessagesBlock = extractFunctionBody(sessionRuntime, 'loadAllMessages');
  const bulkLoaderExists = await pathExists('frontend/components/chat/session/sessionBulkMessageLoader.ts');
  const bulkLoader = bulkLoaderExists
    ? await readRepoFile('frontend/components/chat/session/sessionBulkMessageLoader.ts')
    : '';

  const projectRefreshReducer = await readRepoFile('frontend/hooks/projects/projectRefreshReducer.ts');
  const projectsHaveChangesBlock = extractFunctionBody(projectRefreshReducer, 'projectsHaveChanges');

  const fileMentions = await readRepoFile('frontend/components/chat/hooks/useFileMentions.tsx');
  const chatMessagesPane = await readRepoFile('frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx');
  const windowLimit = detectWindowLimit(chatMessagesPane);

  return {
    sessionRuntime: {
      hasLoadAllMessages: loadAllMessagesBlock.length > 0,
      loadAllUsesNullLimit: /sessionMessages[\s\S]{0,300}\bnull\b/.test(loadAllMessagesBlock),
      hasBulkLoaderModule: bulkLoaderExists,
      hasBulkPageSize: /SESSION_BULK_MESSAGE_PAGE_SIZE|bulkMessagePageSize|pageSize/.test(bulkLoader),
    },
    projectRefresh: {
      hasSignatureBuilder: /buildProjectRefreshSignature|createProjectRefreshSignature/.test(projectRefreshReducer),
      serializeUsesJsonStringify: /const\s+serialize\s*=\s*\([^)]*\)\s*=>\s*JSON\.stringify/.test(projectRefreshReducer),
      projectsHaveChangesTouchesHeavyArrays: /\b(sessions|workflows|codexSessions|piSessions)\b/.test(
        projectsHaveChangesBlock,
      ),
    },
    existingGuards: {
      fileMentionsOnDemand: /showFileDropdown|isDropdownOpen|enabled/.test(fileMentions),
      fileMentionsDepthAtMostTwo: /depth\s*:\s*2|depth\s*<=\s*2/.test(fileMentions),
      fileMentionsHiddenDisabled: /showHidden\s*:\s*false/.test(fileMentions),
      chatMessagesPaneVirtualized: /virtual|visibleRange|overscan|useVirtual/.test(chatMessagesPane),
      chatMessagesWindowLimit: windowLimit,
    },
  };
}

async function writeEvidence(audit: PerformanceAudit): Promise<void> {
  /** Persist performance audit output for acceptance review. */
  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
}

test('full message loading is chunked and has an explicit page budget', async () => {
  const audit = await collectAudit();
  await writeEvidence(audit);

  assert.equal(audit.sessionRuntime.hasLoadAllMessages, true);
  assert.equal(audit.sessionRuntime.hasBulkLoaderModule, true);
  assert.equal(audit.sessionRuntime.hasBulkPageSize, true);
  assert.equal(audit.sessionRuntime.loadAllUsesNullLimit, false);
});

test('project refresh comparison uses stable signatures instead of deep JSON serialization', async () => {
  const audit = await collectAudit();
  await writeEvidence(audit);

  assert.equal(audit.projectRefresh.hasSignatureBuilder, true);
  assert.equal(audit.projectRefresh.serializeUsesJsonStringify, false);
  assert.equal(audit.projectRefresh.projectsHaveChangesTouchesHeavyArrays, false);
});

test('existing file mention and message virtualization performance guards stay in place', async () => {
  const audit = await collectAudit();
  await writeEvidence(audit);

  assert.equal(audit.existingGuards.fileMentionsOnDemand, true);
  assert.equal(audit.existingGuards.fileMentionsDepthAtMostTwo, true);
  assert.equal(audit.existingGuards.fileMentionsHiddenDisabled, true);
  assert.equal(audit.existingGuards.chatMessagesPaneVirtualized, true);
  assert.ok(
    audit.existingGuards.chatMessagesWindowLimit === null || audit.existingGuards.chatMessagesWindowLimit <= 150,
  );
});
