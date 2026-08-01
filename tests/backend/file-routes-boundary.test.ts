/**
 * 文件目的：锁定项目文件路由 helper 的权限文本行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  permissionBitsToRwx,
} from '../../backend/server/file-routes.ts';

test('file route helpers render rwx permission bits for inspectable file metadata', () => {
  /**
   * 权限文本需要稳定映射三位权限，方便用户快速判断文件可读写状态。
   */
  assert.equal(permissionBitsToRwx(7), 'rwx');
  assert.equal(permissionBitsToRwx(6), 'rw-');
  assert.equal(permissionBitsToRwx(5), 'r-x');
  assert.equal(permissionBitsToRwx(0), '---');
});
