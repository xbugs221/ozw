/**
 * 文件目的：把 Inspector 源码构建为 Hermes Dashboard 可直接加载的单 IIFE。
 * 业务边界：插件必须使用 Dashboard SDK 的 React，不得携带第二份 React runtime。
 */
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const integrationRoot = path.dirname(fileURLToPath(import.meta.url));
const MAX_IIFE_BYTES = 512 * 1024;
const MAX_IIFE_GZIP_BYTES = 128 * 1024;
const FORBIDDEN_REACT_IMPORT = /^(?:react(?:\/.*)?|react-dom(?:\/.*)?)$/;
const EMBEDDED_REACT_FINGERPRINTS = [
  '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
  'react.production.min.js',
  'react.development.js',
  'react-dom.production',
  'react-dom.development',
  'Symbol.for("react.element")',
  "Symbol.for('react.element')",
];

/** 拒绝 React runtime 依赖，并验证最终产物仍是小型单 IIFE。 */
function dashboardSDKBoundary(): Plugin {
  return {
    name: 'hermes-dashboard-sdk-boundary',
    apply: 'build',
    // 必须先于 Vite 的默认解析器运行，否则 react 可能已经被解析为本地文件。
    enforce: 'pre',
    resolveId(source, importer) {
      if (!FORBIDDEN_REACT_IMPORT.test(source)) return null;
      this.error(
        `Hermes Inspector must use sdk.React; forbidden runtime import "${source}"`
        + (importer ? ` from ${importer}` : ''),
      );
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(output => output.type === 'chunk');
      if (chunks.length !== 1) {
        this.error(`Hermes Inspector must emit one IIFE chunk; received ${chunks.length}`);
      }

      const [chunk] = chunks;
      if (chunk.dynamicImports.length > 0 || chunk.isDynamicEntry) {
        this.error('Hermes Inspector must not emit dynamic imports or dynamic entry chunks');
      }

      const fingerprint = EMBEDDED_REACT_FINGERPRINTS.find(value => chunk.code.includes(value));
      if (fingerprint) {
        this.error(`Hermes Inspector bundle contains an embedded React fingerprint: ${fingerprint}`);
      }

      const rawBytes = Buffer.byteLength(chunk.code);
      const gzipBytes = gzipSync(chunk.code).byteLength;
      if (rawBytes > MAX_IIFE_BYTES || gzipBytes > MAX_IIFE_GZIP_BYTES) {
        this.error(
          `Hermes Inspector bundle exceeds budget: ${rawBytes} raw bytes / ${gzipBytes} gzip bytes `
          + `(limits: ${MAX_IIFE_BYTES} / ${MAX_IIFE_GZIP_BYTES})`,
        );
      }
    },
  };
}

export default defineConfig({
  // 独立插件只发布自身 bundle，不复制 ozw 根目录 public/ 的 PWA 资源。
  publicDir: false,
  plugins: [dashboardSDKBoundary()],
  build: {
    outDir: path.resolve(integrationRoot, 'dashboard/dist'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(integrationRoot, 'dashboard/src/index.ts'),
      name: 'HermesTranscriptInspector',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: asset => asset.name?.endsWith('.css') ? 'style.css' : '[name][extname]',
      },
    },
  },
});
