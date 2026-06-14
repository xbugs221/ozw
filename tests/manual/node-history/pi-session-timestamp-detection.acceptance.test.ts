// @ts-nocheck -- proposal tests execute through tsx against current source.
/**
 * PURPOSE: Lock the business contract for Pi session activity timestamps on
 * project overview cards so old Pi sessions are not shown as "just now".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatTimeAgo } from '../../../frontend/utils/dateUtils.ts';
import { createSessionViewModel } from '../../../frontend/components/sidebar/utils/utils.ts';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function translate(key, params = {}) {
  /**
   * Return deterministic labels for the timestamp keys used by the front-end.
   */
  const labels = {
    'time.justNow': '刚刚',
    'time.oneMinuteAgo': '1 分钟前',
    'time.minutesAgo': `${params.count} 分钟前`,
    'time.oneHourAgo': '1 小时前',
    'time.hoursAgo': `${params.count} 小时前`,
    'time.oneDayAgo': '1 天前',
    'time.daysAgo': `${params.count} 天前`,
    'status.unknown': '未知时间',
  };
  return labels[key] || key;
}

function renderPiSessionTime(session) {
  /**
   * Exercise the same front-end path used by ProjectOverviewPanel cards.
   */
  const viewModel = createSessionViewModel(
    {
      id: 'c7',
      __provider: 'pi',
      title: '排查历史任务',
      ...session,
    },
    NOW,
    translate,
  );
  return formatTimeAgo(viewModel.sessionTime, NOW, translate, 'Asia/Makassar');
}

test('历史 Pi transcript ISO activity 时间不会显示为刚刚', () => {
  const label = renderPiSessionTime({
    lastActivity: '2026-06-01T10:00:00.000Z',
    updated_at: '2026-06-01T10:00:00.000Z',
    createdAt: '2026-06-01T09:30:00.000Z',
  });

  assert.equal(label, '2 小时前');
  assert.notEqual(label, '刚刚');
});

test('未来 Pi activity 时间戳不得被误判为刚刚', () => {
  const label = renderPiSessionTime({
    lastActivity: '2026-06-01T12:30:00.000Z',
    updated_at: '2026-06-01T12:30:00.000Z',
    createdAt: '2026-06-01T09:30:00.000Z',
  });

  assert.notEqual(label, '刚刚');
});

test('Pi 秒级 epoch activity 字符串按真实历史时间展示', () => {
  const label = renderPiSessionTime({
    lastActivity: '1717243200',
    updated_at: '1717243200',
    createdAt: '1717241400',
  });

  assert.notEqual(label, '刚刚');
  assert.notEqual(label, '未知时间');
  assert.match(label, /2024-06-01|天前|小时前/);
});
