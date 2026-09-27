/**
 * PURPOSE: Set package manifests to the release tag version in the CI workspace.
 * The repository's main branch keeps its version unchanged between releases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Parse a stable release tag or version input into its npm package version. */
export function parseReleaseTag(tagOrVersion) {
  const match = String(tagOrVersion || '').match(/^v?([0-9]+\.[0-9]+\.[0-9]+)$/);
  if (!match) {
    throw new Error(`Release version must use stable SemVer (X.Y.Z or vX.Y.Z): ${tagOrVersion}`);
  }

  return match[1];
}

/** Write the tag version into package manifests before CI installs or packs. */
export function prepareReleasePackage(tagOrVersion, rootDirectory = process.cwd()) {
  const version = parseReleaseTag(tagOrVersion);
  const releaseTag = `v${version}`;
  const changeEntry = buildReleaseChangeEntry(releaseTag, rootDirectory);
  const packagePath = `${rootDirectory}/package.json`;
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const shrinkwrapPath = `${rootDirectory}/npm-shrinkwrap.json`;
  if (fs.existsSync(shrinkwrapPath)) {
    const shrinkwrap = JSON.parse(fs.readFileSync(shrinkwrapPath, 'utf8'));
    shrinkwrap.version = version;
    if (shrinkwrap.packages?.['']) {
      shrinkwrap.packages[''].version = version;
    }
    fs.writeFileSync(shrinkwrapPath, `${JSON.stringify(shrinkwrap, null, 2)}\n`);
  }

  const changelogPath = path.join(rootDirectory, 'CHANGELOG.md');
  const existingChangelog = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, 'utf8')
    : '# Changelog\n\n';
  const changelogBody = existingChangelog.replace(/^# Changelog\s*/i, '');
  const entryPattern = new RegExp(
    `^## ${releaseTag.replaceAll('.', '\\.')} - [\\s\\S]*?(?=^## |$)`,
    'm',
  );
  const nextBody = entryPattern.test(changelogBody)
    ? changelogBody.replace(entryPattern, `${changeEntry}\n\n`)
    : `${changeEntry}\n\n${changelogBody.trimStart()}`;
  fs.writeFileSync(changelogPath, `# Changelog\n\n${nextBody.trimEnd()}\n`);
  fs.writeFileSync(
    path.join(rootDirectory, 'release-notes.md'),
    `${changeEntry}\n\n### Install\n\n\`npm install -g @xbugs221/ozw && ozw\`\n`,
  );

  return version;
}

/** Build the release changelog entry from first-parent commit subjects since the prior version tag. */
function buildReleaseChangeEntry(releaseTag, rootDirectory) {
  const previousTags = execFileSync(
    'git',
    ['tag', '--merged', 'HEAD', '--list', 'v*.*.*', '--sort=-version:refname'],
    { cwd: rootDirectory, encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== releaseTag);
  const previousTag = previousTags[0];
  if (previousTag && compareVersions(releaseTag, previousTag) <= 0) {
    throw new Error(`Release version ${releaseTag} must be newer than ${previousTag}`);
  }
  const revisionRange = previousTag ? `${previousTag}..HEAD` : 'HEAD';
  const commitSubjects = execFileSync(
    'git',
    ['log', '--first-parent', '--format=%s', revisionRange],
    { cwd: rootDirectory, encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .map((subject) => subject.trim())
    .filter(Boolean);
  const changes = commitSubjects.length > 0
    ? commitSubjects.map((subject) => `- ${subject}`).join('\n')
    : '- No additional commits since the previous release.';
  const releaseDate = new Date().toISOString().slice(0, 10);

  return `## ${releaseTag} - ${releaseDate}\n\n### Changes\n${changes}`;
}

/** Compare stable release tag numbers by major, minor, and patch components. */
function compareVersions(leftTag, rightTag) {
  const left = parseReleaseTag(leftTag).split('.').map(Number);
  const right = parseReleaseTag(rightTag).split('.').map(Number);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const version = prepareReleasePackage(process.argv[2]);
  process.stdout.write(`${version}\n`);
}
