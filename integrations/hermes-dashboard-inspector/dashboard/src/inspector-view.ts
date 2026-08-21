/**
 * 文件目的：组合 Hermes Workbench 的会话栏、TUI/渲染聊天区以及文件/终端工作区。
 * 业务边界：一个会话只使用其后端绑定的工作区；插件不修改 Hermes 核心状态。
 */
import type { InspectorTranscript } from './session-api';
import { listSessions, loadTranscript, searchSessions } from './session-api';
import { createTerminalPanel } from './terminal-panel';
import { createTranscriptComponents } from './transcript-components';
import { loadWorkspace, type Workspace } from './workbench-api';
import { createWorkspacePanel } from './workspace-panel';

type SDK = Record<string, any>;
type CenterMode = 'chat' | 'render';
type RightMode = 'files' | 'shell';
type Drawer = 'sessions' | 'workspace' | null;

/** 创建使用宿主 React 实例的元素，避免插件打包第二份 React。 */
function element(React: any, type: any, props?: Record<string, any> | null, ...children: any[]): any {
  return React.createElement(type, props, ...children);
}

/** 从 Hermes 会话记录中选择稳定可读的列表标题。 */
function sessionTitle(row: Record<string, any>): string {
  return String(row.title || row.summary || row.name || row.id || row.session_id || '未命名会话 / Untitled');
}

/** 从会话记录读取稳定 ID。 */
function rowSessionId(row: Record<string, any>): string {
  return String(row.id || row.session_id || '');
}

/** 格式化会话时间，无法识别时不展示伪造值。 */
function sessionTime(row: Record<string, any>): string {
  const raw = row.updated_at ?? row.last_active ?? row.created_at ?? row.timestamp;
  const numeric = typeof raw === 'number' && raw < 1_000_000_000_000 ? raw * 1000 : raw;
  const date = new Date(numeric ?? 0);
  return Number.isFinite(date.getTime()) && date.getTime() > 0
    ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
}

/** 渲染一个紧凑的双语分段切换器。 */
function Segmented({ React, value, onChange, items }: {
  React: any;
  value: string;
  onChange: (value: any) => void;
  items: Array<{ value: string; label: string }>;
}): any {
  return element(React, 'div', { className: 'hti-segmented', role: 'tablist' },
    ...items.map(item => element(React, 'button', {
      key: item.value,
      type: 'button',
      role: 'tab',
      'aria-selected': value === item.value,
      className: value === item.value ? 'active' : '',
      onClick: () => onChange(item.value),
    }, item.label)));
}

/** 创建供 Dashboard 注册并覆盖 chat 路由的完整工作台组件。 */
export function createInspectorView(sdk: SDK): () => any {
  const React = sdk.React;
  const { useEffect, useState } = sdk.hooks;
  const { TranscriptTimeline } = createTranscriptComponents(sdk);
  const TerminalPanel = createTerminalPanel(sdk);
  const WorkspacePanel = createWorkspacePanel(sdk);

  return function HermesWorkbench(): any {
    /** 用户路径：选择会话后同时解析 transcript 与唯一工作区，再进入聊天、文件或 shell。 */
    const params = new URLSearchParams(window.location.search);
    const [profile, setProfile] = useState(params.get('profile') || 'default');
    const [sessionId, setSessionId] = useState(params.get('session') || '');
    const [search, setSearch] = useState('');
    const [sessions, setSessions] = useState([] as any[]);
    const [transcript, setTranscript] = useState(null as InspectorTranscript | null);
    const [workspace, setWorkspace] = useState(null as Workspace | null);
    const [centerMode, setCenterMode] = useState('chat' as CenterMode);
    const [rightMode, setRightMode] = useState('files' as RightMode);
    const [drawer, setDrawer] = useState(null as Drawer);
    const [rawOpen, setRawOpen] = useState(false);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [sessionLoading, setSessionLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
      let active = true;
      setSessionsLoading(true);
      setError('');
      const normalizedSearch = search.trim();
      const request = normalizedSearch
        ? searchSessions(sdk.fetchJSON, profile, normalizedSearch)
        : listSessions(sdk.fetchJSON, profile);
      request
        .then(value => active && setSessions(value))
        .catch(reason => active && setError(String(reason)))
        .finally(() => active && setSessionsLoading(false));
      return () => { active = false; };
    }, [profile, search]);

    useEffect(() => {
      setTranscript(null);
      setWorkspace(null);
      setRawOpen(false);
      if (!sessionId) return undefined;
      let active = true;
      setSessionLoading(true);
      setError('');
      Promise.all([
        loadTranscript(sdk.fetchJSON, profile, sessionId),
        loadWorkspace(sdk.fetchJSON, profile, sessionId),
      ]).then(([nextTranscript, nextWorkspace]) => {
        if (!active) return;
        setTranscript(nextTranscript);
        setWorkspace(nextWorkspace);
      }).catch(reason => active && setError(String(reason)))
        .finally(() => active && setSessionLoading(false));
      return () => { active = false; };
    }, [profile, sessionId]);

    /** 选择会话并同步深链，使刷新后仍回到同一会话。 */
    const selectSession = (nextId: string) => {
      setSessionId(nextId);
      setDrawer(null);
      const next = new URL(window.location.href);
      next.searchParams.set('profile', profile);
      next.searchParams.set('session', nextId);
      window.history.replaceState(null, '', next);
    };

    /** 构造桌面左栏与移动会话抽屉共用的列表。 */
    const sessionSidebar = element(React, 'aside', {
      className: `hti-session-sidebar${drawer === 'sessions' ? ' is-mobile-open' : ''}`,
      'aria-label': '会话 / Sessions',
    },
      element(React, 'header', { className: 'hti-pane-header hti-session-heading' },
        element(React, 'div', null,
          element(React, 'strong', null, 'Hermes'),
          element(React, 'span', null, '会话 / Sessions')),
        element(React, 'button', {
          type: 'button', className: 'hti-drawer-close', onClick: () => setDrawer(null),
          'aria-label': '关闭 / Close',
        }, '×')),
      element(React, 'div', { className: 'hti-session-controls' },
        element(React, 'label', { htmlFor: 'hti-profile' }, '配置 / Profile'),
        element(React, 'input', {
          id: 'hti-profile', value: profile, onChange: (event: any) => setProfile(event.target.value),
        }),
        element(React, 'label', { htmlFor: 'hti-search' }, '搜索 / Search'),
        element(React, 'input', {
          id: 'hti-search', value: search, placeholder: '标题、内容、ID / Title, content, ID',
          onChange: (event: any) => setSearch(event.target.value),
        })),
      element(React, 'div', { className: 'hti-session-meta' },
        sessionsLoading ? '加载中… / Loading…' : `${sessions.length} 个会话 / sessions`),
      element(React, 'nav', { className: 'hti-session-list' },
        ...sessions.map((row: Record<string, any>) => {
          const id = rowSessionId(row);
          return element(React, 'button', {
            key: id,
            type: 'button',
            className: id === sessionId ? 'active' : '',
            'aria-current': id === sessionId ? 'page' : undefined,
            onClick: () => selectSession(id),
          },
            element(React, 'span', { className: 'hti-session-title' }, sessionTitle(row)),
            element(React, 'span', { className: 'hti-session-subtitle' },
              element(React, 'code', null, id),
              element(React, 'time', null, sessionTime(row))));
        })));

    /** 构造中栏的 TUI 与持久化记录双视图。 */
    const centerPanel = element(React, 'section', { className: 'hti-center-pane' },
      element(React, 'header', { className: 'hti-pane-header hti-chat-header' },
        element(React, 'button', {
          type: 'button', className: 'hti-mobile-action is-left', onClick: () => setDrawer('sessions'),
          'aria-label': '打开会话 / Open sessions',
        }, '☰'),
        element(React, 'div', { className: 'hti-active-session' },
          element(React, 'strong', null, sessionId ? sessionTitle(sessions.find((row: Record<string, any>) => rowSessionId(row) === sessionId) || { id: sessionId }) : 'Hermes Workbench'),
          element(React, 'span', null, workspace ? workspace.path : '未绑定工作区 / No workspace')),
        element(React, Segmented, {
          React,
          value: centerMode,
          onChange: setCenterMode,
          items: [
            { value: 'chat', label: '聊天 / Chat' },
            { value: 'render', label: '记录 / Transcript' },
          ],
        }),
        element(React, 'button', {
          type: 'button', className: 'hti-mobile-action is-right', onClick: () => setDrawer('workspace'),
          'aria-label': '打开工作区 / Open workspace',
        }, '▤')),
      error ? element(React, 'div', { className: 'hti-page-error', role: 'alert' }, error) : null,
      !sessionId ? element(React, 'div', { className: 'hti-panel-empty' },
        element(React, 'strong', null, '选择会话 / Select a session'),
        element(React, 'span', null, '从左侧开始进入工作台。 / Choose a session to enter the workbench.'))
        : centerMode === 'chat'
          ? workspace ? element(React, TerminalPanel, {
            mode: 'chat', profile, sessionId, workspaceId: workspace.id, workspacePath: workspace.path,
          }) : element(React, 'div', { className: 'hti-panel-empty' },
            element(React, 'strong', null, sessionLoading ? '正在加载… / Loading…' : '未绑定工作区 / No workspace'),
            element(React, 'span', null, 'Hermes TUI 需要当前会话的工作区。 / Hermes TUI needs this session workspace.'))
          : transcript ? element(React, 'div', { className: 'hti-transcript-pane' },
            element(React, 'div', { className: 'hti-transcript-toolbar' },
              element(React, 'div', { className: 'hti-lineage' },
                element(React, 'span', null, '压缩链 / Compression lineage'),
                element(React, 'code', null, transcript.lineage.map((row: Record<string, any>) => row.id).join(' → '))),
              element(React, 'button', { type: 'button', onClick: () => setRawOpen((value: boolean) => !value) },
                rawOpen ? '隐藏原始记录 / Hide raw' : '原始记录 / Raw')),
            element(React, TranscriptTimeline, { turns: transcript.turns, rawOpen }))
            : element(React, 'div', { className: 'hti-panel-empty' },
              element(React, 'strong', null, '正在合并记录… / Loading transcript…'),
              element(React, 'span', null, '正在读取 compression lineage。 / Reading compression lineage.')));

    /** 构造桌面右栏与移动工作区抽屉。 */
    const rightPanel = element(React, 'aside', {
      className: `hti-right-pane${drawer === 'workspace' ? ' is-mobile-open' : ''}`,
      'aria-label': '工作区 / Workspace',
    },
      element(React, 'header', { className: 'hti-pane-header hti-right-header' },
        element(React, Segmented, {
          React,
          value: rightMode,
          onChange: setRightMode,
          items: [
            { value: 'files', label: '文件 / Files' },
            { value: 'shell', label: '终端 / Terminal' },
          ],
        }),
        element(React, 'button', {
          type: 'button', className: 'hti-drawer-close', onClick: () => setDrawer(null),
          'aria-label': '关闭 / Close',
        }, '×')),
      rightMode === 'files'
        ? element(React, WorkspacePanel, { workspace })
        : workspace && sessionId ? element(React, TerminalPanel, {
          mode: 'shell', profile, sessionId, workspaceId: workspace.id, workspacePath: workspace.path,
          active: rightMode === 'shell',
        }) : element(React, 'div', { className: 'hti-panel-empty' },
          element(React, 'strong', null, '未绑定工作区 / No workspace'),
          element(React, 'span', null, '终端只能进入当前会话工作区。 / Terminal is scoped to this session workspace.')));

    return element(React, 'main', { className: 'hti-root hti-workbench', 'data-component': 'HermesWorkbench' },
      sessionSidebar,
      centerPanel,
      rightPanel,
      drawer ? element(React, 'button', {
        type: 'button', className: 'hti-drawer-backdrop', onClick: () => setDrawer(null),
        'aria-label': '关闭抽屉 / Close drawer',
      }) : null);
  };
}
