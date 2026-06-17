/**
 * 文件目的：锁定项目文件路由 helper 的目录树过滤和权限文本行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  permissionBitsToRwx,
  shouldSkipProjectTreeEntry,
} from '../../backend/server/file-routes.ts';

test('file route helpers keep heavy/internal directories out of project tree', () => {
  /**
   * 项目文件树不能暴露沉重构建目录或 VCS 内部目录。
   */
  assert.equal(shouldSkipProjectTreeEntry('node_modules'), true);
  assert.equal(shouldSkipProjectTreeEntry('dist'), true);
  assert.equal(shouldSkipProjectTreeEntry('build'), true);
  assert.equal(shouldSkipProjectTreeEntry('.git'), true);
  assert.equal(shouldSkipProjectTreeEntry('src'), false);
});

test('file route helpers render rwx permission bits for inspectable file metadata', () => {
  /**
   * 权限文本需要稳定映射三位权限，方便用户快速判断文件可读写状态。
   */
  assert.equal(permissionBitsToRwx(7), 'rwx');
  assert.equal(permissionBitsToRwx(6), 'rw-');
  assert.equal(permissionBitsToRwx(5), 'r-x');
  assert.equal(permissionBitsToRwx(0), '---');
});
