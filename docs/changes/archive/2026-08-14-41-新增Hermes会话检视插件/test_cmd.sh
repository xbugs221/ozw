#!/bin/bash
# 文件目的：运行变更 41 的真实 Hermes Dashboard 插件验收流程。
set -e
cd "$(dirname "$0")/../../.."
pnpm exec tsx --test docs/changes/archive/2026-08-14-41-新增Hermes会话检视插件/tests/hermes-inspector-dashboard.acceptance.spec.ts
