/**
 * 文件目的：渲染 Hermes Inspector 的只读会话选择、加载状态与组件化时间线。
 * 业务边界：页面只提供检视动作，不暴露任何执行、审批或会话修改入口。
 */
import type { InspectorTranscript } from './session-api';
import { listSessions, loadTranscript, searchSessions } from './session-api';
import { createTranscriptComponents } from './transcript-components';

type SDK = Record<string, any>;

/** 创建使用宿主 React 实例的元素，避免插件打包第二份 React。 */
function element(React: any, type: any, props?: Record<string, any> | null, ...children: any[]): any {
  return React.createElement(type, props, ...children);
}

/** 从 Hermes 会话记录中选择稳定可读的列表标题。 */
function sessionTitle(row: Record<string, any>): string {
  return String(row.title || row.summary || row.id || row.session_id || '未命名会话');
}

/** 标题已经等于会话 ID 时省略重复副标题，保持列表和可访问名称简洁。 */
function sessionSecondaryId(row: Record<string, any>): string | null {
  const id = String(row.id || row.session_id || '');
  return id && id !== sessionTitle(row) ? id : null;
}

/** 创建供 Dashboard 注册的 Inspector 页面组件。 */
export function createInspectorView(sdk: SDK): () => any {
  const React = sdk.React;
  const { useEffect, useState } = sdk.hooks;
  const { Button, Input, Label, Badge } = sdk.components;
  const { TranscriptTimeline } = createTranscriptComponents(sdk);

  return function InspectorView(): any {
    /** 用户路径：从独立 Tab 或 profile/session 深链检视只读会话。 */
    const params = new URLSearchParams(window.location.search);
    const [profile, setProfile] = useState(params.get('profile') || 'default');
    const [sessionId, setSessionId] = useState(params.get('session') || '');
    const [search, setSearch] = useState('');
    const [sessions, setSessions] = useState([] as any[]);
    const [transcript, setTranscript] = useState(null as InspectorTranscript | null);
    const [error, setError] = useState('');
    const [rawOpen, setRawOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);

    useEffect(() => {
      let active = true;
      setSessions([]);
      setError('');
      const normalizedSearch = search.trim();
      const request = normalizedSearch
        ? searchSessions(sdk.fetchJSON, profile, normalizedSearch)
        : listSessions(sdk.fetchJSON, profile);
      request.then(value => active && setSessions(value)).catch(reason => active && setError(String(reason)));
      return () => { active = false; };
    }, [profile, search]);

    useEffect(() => {
      setTranscript(null);
      setRawOpen(false);
      if (!sessionId) return undefined;
      let active = true;
      setError('');
      loadTranscript(sdk.fetchJSON, profile, sessionId)
        .then(value => active && setTranscript(value))
        .catch(reason => active && setError(String(reason)));
      return () => { active = false; };
    }, [profile, sessionId]);

    return element(React, 'main', { className: 'hti-root', 'data-component': 'HermesTranscriptInspector' },
      element(React, 'header', { className: 'hti-header' },
        element(React, 'div', { className: 'hti-heading' },
          element(React, 'div', null,
            element(React, 'h1', null, '渲染'),
            element(React, 'p', null, '从压缩链路到最终回复，按真实执行顺序阅读。')),
          element(React, Badge, { variant: 'outline', className: 'hti-readonly-badge' }, '只读')),
        element(React, 'p', { className: 'hti-notice' }, '仅展示已持久化的 reasoning，不代表模型隐藏推理。')),
      element(React, 'div', { className: 'hti-layout' },
        element(React, 'aside', { className: 'hti-sidebar' },
          element(React, 'button', {
            type: 'button',
            className: 'hti-picker-toggle',
            'aria-expanded': pickerOpen,
            onClick: () => setPickerOpen((value: boolean) => !value),
          },
            element(React, 'span', null, sessionId ? sessionTitle(sessions.find(row => String(row.id || row.session_id) === sessionId) || { id: sessionId }) : '选择会话'),
            element(React, 'span', { 'aria-hidden': true }, pickerOpen ? '▾' : '▸')),
          element(React, 'div', { className: 'hti-sidebar-body', 'data-open': pickerOpen ? 'true' : 'false' },
            element(React, 'div', { className: 'hti-sidebar-controls' },
              element(React, Label, { htmlFor: 'hti-profile' }, 'Profile'),
              element(React, Input, {
                id: 'hti-profile', value: profile, onChange: (event: any) => setProfile(event.target.value),
              }),
              element(React, Label, { htmlFor: 'hti-search' }, '搜索会话'),
              element(React, Input, {
                id: 'hti-search', value: search, placeholder: '标题、内容或会话 ID',
                onChange: (event: any) => setSearch(event.target.value),
              })),
            element(React, 'div', { className: 'hti-session-count' }, `${sessions.length} 个会话`),
            element(React, 'nav', { className: 'hti-sessions', 'aria-label': 'Hermes 会话' },
              ...sessions.map(row => element(React, 'button', {
                key: row.id || row.session_id,
                type: 'button',
                className: String(row.id || row.session_id) === sessionId ? 'active' : '',
                'aria-current': String(row.id || row.session_id) === sessionId ? 'page' : undefined,
                onClick: () => {
                  setSessionId(String(row.id || row.session_id));
                  setPickerOpen(false);
                },
              },
              element(React, 'span', { className: 'hti-session-title' }, sessionTitle(row)),
              sessionSecondaryId(row)
                ? element(React, 'span', { className: 'hti-session-id' }, sessionSecondaryId(row))
                : null))))),
        element(React, 'section', { className: 'hti-content' },
          error ? element(React, 'p', { role: 'alert', className: 'hti-page-error' }, error) : null,
          transcript ? element(React, React.Fragment, null,
            element(React, 'div', { className: 'hti-summary' },
              element(React, 'div', null,
                element(React, 'span', { className: 'hti-summary-label' }, '当前会话'),
                element(React, 'strong', null, transcript.sessionId)),
              element(React, 'div', { className: 'hti-lineage' },
                element(React, 'span', null, 'Compression lineage'),
                element(React, 'code', null, transcript.lineage.map(row => row.id).join(' → ')))),
            element(React, 'div', { className: 'hti-actions' },
              element(React, Button, {
                variant: 'ghost', size: 'sm', 'data-testid': 'hermes-inspector-raw-toggle',
                onClick: () => setRawOpen((value: boolean) => !value),
              }, rawOpen ? '隐藏原始记录' : '显示原始记录')),
            element(React, TranscriptTimeline, { turns: transcript.turns, rawOpen }),
          ) : element(React, 'div', { className: 'hti-empty' },
            element(React, 'strong', null, sessionId ? '正在读取会话…' : '请选择会话'),
            element(React, 'span', null, sessionId ? '正在合并 compression lineage' : '从左侧列表开始检视')))),
    );
  };
}
