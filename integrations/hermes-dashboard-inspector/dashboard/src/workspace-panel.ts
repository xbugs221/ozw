/**
 * 文件目的：提供 OZW 风格的工作区文件树、Markdown 预览和 CodeMirror 文本编辑保存流程。
 * 业务边界：所有文件操作都限定到会话绑定的 workspace id。
 */
import { EditorView } from '@codemirror/view';
import { renderMarkdownHtml } from './transcript-components';
import {
  isMarkdownPath,
  listFiles,
  readFile,
  writeFile,
  type FileEntry,
  type Workspace,
} from './workbench-api';

type SDK = Record<string, any>;
type CodeEditorProps = { value: string; onChange: (value: string) => void };
type WorkspacePanelProps = { workspace: Workspace | null };

/** 创建使用宿主 React 实例的元素，避免插件打包第二份 React。 */
function element(React: any, type: any, props?: Record<string, any> | null, ...children: any[]): any {
  return React.createElement(type, props, ...children);
}

/** 返回文件名对应的轻量图标语义，不引入额外图标包。 */
function fileIcon(entry: FileEntry, expanded = false): string {
  if (entry.type === 'directory') return expanded ? '▾' : '▸';
  if (isMarkdownPath(entry.path)) return 'M';
  if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(entry.path)) return '▧';
  return '·';
}

/** 创建只使用原生 CodeMirror 包的受控文本编辑器。 */
function createCodeEditor(sdk: SDK): (props: CodeEditorProps) => any {
  const React = sdk.React;
  const { useEffect, useRef } = sdk.hooks;

  return function CodeEditor({ value, onChange }: CodeEditorProps): any {
    /** 编辑路径：挂载时创建 EditorView，切文件时重建以避免旧文档状态泄漏。 */
    const hostRef = useRef(null as HTMLDivElement | null);
    const changeRef = useRef(onChange);
    changeRef.current = onChange;

    useEffect(() => {
      if (!hostRef.current) return undefined;
      const view = new EditorView({
        doc: value,
        parent: hostRef.current,
        extensions: [
          EditorView.lineWrapping,
          EditorView.updateListener.of(update => {
            if (update.docChanged) changeRef.current(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'transparent' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)' },
            '.cm-content': { minHeight: '100%', padding: '12px 4px' },
            '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      });
      return () => view.destroy();
    }, []);

    return element(React, 'div', { ref: hostRef, className: 'hti-codemirror' });
  };
}

/** 创建文件树与编辑器组合面板。 */
export function createWorkspacePanel(sdk: SDK): (props: WorkspacePanelProps) => any {
  const React = sdk.React;
  const { useCallback, useEffect, useState } = sdk.hooks;
  const CodeEditor = createCodeEditor(sdk);

  /** 懒加载一个目录节点，目录状态与当前工作区生命周期绑定。 */
  function DirectoryNode({
    entry,
    workspaceId,
    onOpen,
  }: {
    entry: FileEntry;
    workspaceId: string;
    onOpen: (entry: FileEntry) => void;
  }): any {
    const [expanded, setExpanded] = useState(false);
    const [children, setChildren] = useState([] as FileEntry[]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');

    /** 展开目录时首次读取直接子项，折叠时保留缓存。 */
    const toggle = async () => {
      if (expanded) {
        setExpanded(false);
        return;
      }
      setExpanded(true);
      if (children.length > 0) return;
      setLoading(true);
      setLoadError('');
      try { setChildren(await listFiles(sdk.fetchJSON, workspaceId, entry.path)); }
      catch (error) { setLoadError(String(error)); }
      finally { setLoading(false); }
    };

    return element(React, 'li', { className: 'hti-tree-branch' },
      element(React, 'button', {
        type: 'button', className: 'hti-tree-row is-directory', onClick: toggle,
        title: entry.path,
      },
        element(React, 'span', { className: 'hti-file-icon', 'aria-hidden': true }, fileIcon(entry, expanded)),
        element(React, 'span', null, entry.name)),
      expanded ? element(React, 'ul', { className: 'hti-tree-children' },
        loading ? element(React, 'li', { className: 'hti-tree-loading' }, '加载中… / Loading…') : null,
        loadError ? element(React, 'li', { className: 'hti-tree-error', role: 'alert' }, loadError) : null,
        ...children.map((child: FileEntry) => child.type === 'directory'
          ? element(React, DirectoryNode, { key: child.path, entry: child, workspaceId, onOpen })
          : element(React, 'li', { key: child.path },
            element(React, 'button', {
              type: 'button', className: 'hti-tree-row', onClick: () => onOpen(child), title: child.path,
            },
              element(React, 'span', { className: 'hti-file-icon', 'aria-hidden': true }, fileIcon(child)),
              element(React, 'span', null, child.name))))
      ) : null);
  }

  return function WorkspacePanel({ workspace }: WorkspacePanelProps): any {
    /** 用户路径：浏览工作区，打开文件，在源码/预览间切换并显式保存。 */
    const [rootFiles, setRootFiles] = useState([] as FileEntry[]);
    const [selectedPath, setSelectedPath] = useState('');
    const [content, setContent] = useState('');
    const [savedContent, setSavedContent] = useState('');
    const [mode, setMode] = useState('edit' as 'edit' | 'preview');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
      setRootFiles([]);
      setSelectedPath('');
      setContent('');
      setSavedContent('');
      if (!workspace) return undefined;
      let active = true;
      setLoading(true);
      listFiles(sdk.fetchJSON, workspace.id, '')
        .then(files => active && setRootFiles(files))
        .catch(error => active && setMessage(String(error)))
        .finally(() => active && setLoading(false));
      return () => { active = false; };
    }, [workspace?.id]);

    /** 读取用户选择的文件，并根据扩展名选择默认视图。 */
    const openFile = useCallback(async (entry: FileEntry) => {
      if (!workspace) return;
      setSelectedPath(entry.path);
      setLoading(true);
      setMessage('');
      try {
        const nextContent = await readFile(sdk.authedFetch, workspace.id, entry.path);
        setContent(nextContent);
        setSavedContent(nextContent);
        setMode(isMarkdownPath(entry.path) ? 'preview' : 'edit');
      } catch (error) {
        setMessage(String(error));
      } finally {
        setLoading(false);
      }
    }, [workspace?.id]);

    /** 保存当前完整文档，成功后重置未保存状态。 */
    const save = useCallback(async () => {
      if (!workspace || !selectedPath || content === savedContent) return;
      setMessage('保存中… / Saving…');
      try {
        await writeFile(sdk.authedFetch, workspace.id, selectedPath, content);
        setSavedContent(content);
        setMessage('已保存 / Saved');
      } catch (error) {
        setMessage(String(error));
      }
    }, [content, savedContent, selectedPath, workspace?.id]);

    /** 捕获工作台内的标准保存快捷键。 */
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };

    if (!workspace) return element(React, 'div', { className: 'hti-panel-empty' },
      element(React, 'strong', null, '未绑定工作区 / No workspace'),
      element(React, 'span', null, '每个会话需要绑定一个工作区。 / Bind one workspace to this session.'));

    return element(React, 'div', { className: 'hti-workspace-panel', onKeyDown: handleKeyDown },
      element(React, 'aside', { className: 'hti-file-tree' },
        element(React, 'div', { className: 'hti-file-tree-heading', title: workspace.path },
          element(React, 'strong', null, workspace.name),
          element(React, 'span', null, workspace.path)),
        element(React, 'ul', { className: 'hti-tree-root' },
          loading && rootFiles.length === 0 ? element(React, 'li', { className: 'hti-tree-loading' }, '加载中… / Loading…') : null,
          ...rootFiles.map((entry: FileEntry) => entry.type === 'directory'
            ? element(React, DirectoryNode, { key: entry.path, entry, workspaceId: workspace.id, onOpen: openFile })
            : element(React, 'li', { key: entry.path },
              element(React, 'button', {
                type: 'button',
                className: `hti-tree-row${entry.path === selectedPath ? ' is-active' : ''}`,
                onClick: () => openFile(entry),
                title: entry.path,
              },
                element(React, 'span', { className: 'hti-file-icon', 'aria-hidden': true }, fileIcon(entry)),
                element(React, 'span', null, entry.name)))))),
      element(React, 'section', { className: 'hti-editor-pane' },
        selectedPath ? element(React, React.Fragment, null,
          element(React, 'header', { className: 'hti-editor-header' },
            element(React, 'div', { className: 'hti-editor-path', title: selectedPath },
              element(React, 'strong', null, selectedPath.split('/').at(-1)),
              element(React, 'span', null, selectedPath)),
            element(React, 'div', { className: 'hti-editor-actions' },
              isMarkdownPath(selectedPath) ? element(React, 'div', { className: 'hti-segmented' },
                element(React, 'button', { type: 'button', className: mode === 'edit' ? 'active' : '', onClick: () => setMode('edit') }, '源码 / Source'),
                element(React, 'button', { type: 'button', className: mode === 'preview' ? 'active' : '', onClick: () => setMode('preview') }, '预览 / Preview')) : null,
              element(React, 'button', {
                type: 'button', className: 'hti-save-button', disabled: content === savedContent, onClick: save,
              }, content === savedContent ? '已保存 / Saved' : '保存 / Save'))),
          message ? element(React, 'div', { className: 'hti-editor-message', role: 'status' }, message) : null,
          mode === 'preview'
            ? element(React, 'article', {
              className: 'hti-markdown-preview hti-rich-text',
              dangerouslySetInnerHTML: { __html: renderMarkdownHtml(content) },
            })
            : element(React, CodeEditor, { key: selectedPath, value: content, onChange: setContent }))
          : element(React, 'div', { className: 'hti-panel-empty' },
            element(React, 'strong', null, '选择文件 / Select a file'),
            element(React, 'span', null, '从左侧文件树打开文件。 / Open a file from the tree.'))));
  };
}
