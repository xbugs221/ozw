/**
 * PURPOSE: Own chat search target parsing, history loading, and DOM highlight navigation.
 */
import { useEffect, useMemo, useRef } from 'react';

import type { ChatMessage } from '../types/types';

type SearchTarget = {
  query: string;
  messageKey: string;
};

type UseChatSearchNavigationArgs = {
  locationSearch: string;
  selectedSessionId?: string | null;
  chatMessages: ChatMessage[];
  visibleMessages: ChatMessage[];
  isLoadingMoreMessages: boolean;
  isLoadingAllMessages: boolean;
  allMessagesLoaded: boolean;
  searchHighlightRetry: number;
  setSearchHighlightRetry: (updater: (attempt: number) => number) => void;
  loadMessagesUntilTarget: (target: { messageKey: string }) => Promise<unknown> | void;
  revealLoadedMessage: (messageKey: string) => void;
};

function clearSearchHighlights(): void {
  /** Remove prior highlight wrappers before applying a new target. */
  document.querySelectorAll('.chat-search-highlight').forEach((element) => {
    const parent = element.parentNode;
    if (!parent) {
      return;
    }

    parent.replaceChild(document.createTextNode(element.textContent || ''), element);
    parent.normalize();
  });
}

function collectHighlightTextNodes(targetElement: HTMLElement): Text[] {
  /** Collect visible text nodes that can safely be wrapped with mark elements. */
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(targetElement, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;
      if (!parent || parent.closest('.chat-search-highlight')) {
        return NodeFilter.FILTER_REJECT;
      }

      if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }
  return textNodes;
}

function highlightSingleTextNode(textNode: Text, matcher: RegExp): boolean {
  /** Wrap direct regex matches within one DOM text node. */
  const textContent = textNode.nodeValue || '';
  matcher.lastIndex = 0;
  if (!matcher.test(textContent)) {
    return false;
  }

  matcher.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of textContent.matchAll(matcher)) {
    const startIndex = match.index ?? 0;
    if (startIndex > lastIndex) {
      fragment.appendChild(document.createTextNode(textContent.slice(lastIndex, startIndex)));
    }

    const highlight = document.createElement('mark');
    highlight.className = 'chat-search-highlight';
    highlight.textContent = match[0];
    fragment.appendChild(highlight);
    lastIndex = startIndex + match[0].length;
  }

  if (lastIndex < textContent.length) {
    fragment.appendChild(document.createTextNode(textContent.slice(lastIndex)));
  }

  textNode.parentNode?.replaceChild(fragment, textNode);
  return true;
}

function highlightAcrossTextNodes(textNodes: Text[], query: string): boolean {
  /** Wrap a search phrase that spans multiple text nodes. */
  const combinedText = textNodes.map((textNode) => textNode.nodeValue || '').join('');
  const combinedMatchIndex = combinedText.toLowerCase().indexOf(query.toLowerCase());
  if (combinedMatchIndex < 0) {
    return false;
  }

  let cursor = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  const matchEndIndex = combinedMatchIndex + query.length;

  for (const textNode of textNodes) {
    const textLength = (textNode.nodeValue || '').length;
    const nodeStart = cursor;
    const nodeEnd = cursor + textLength;

    if (!startNode && combinedMatchIndex >= nodeStart && combinedMatchIndex <= nodeEnd) {
      startNode = textNode;
      startOffset = combinedMatchIndex - nodeStart;
    }
    if (!endNode && matchEndIndex >= nodeStart && matchEndIndex <= nodeEnd) {
      endNode = textNode;
      endOffset = matchEndIndex - nodeStart;
      break;
    }

    cursor = nodeEnd;
  }

  if (!startNode || !endNode) {
    return false;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const highlight = document.createElement('mark');
  highlight.className = 'chat-search-highlight';
  highlight.appendChild(range.extractContents());
  range.insertNode(highlight);
  return true;
}

function applySearchHighlight(targetElement: HTMLElement, query: string, shouldScroll: boolean): boolean {
  /** Scroll to the target message and mark the matching query text. */
  if (shouldScroll) {
    targetElement.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return true;
  }

  const textNodes = collectHighlightTextNodes(targetElement);
  const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(escapedQuery, 'gi');
  const didHighlightSingleNode = textNodes.some((textNode) => highlightSingleTextNode(textNode, matcher));
  return didHighlightSingleNode || highlightAcrossTextNodes(textNodes, normalizedQuery);
}

export function useChatSearchNavigation({
  locationSearch,
  selectedSessionId,
  chatMessages,
  visibleMessages,
  isLoadingMoreMessages,
  isLoadingAllMessages,
  allMessagesLoaded,
  searchHighlightRetry,
  setSearchHighlightRetry,
  loadMessagesUntilTarget,
  revealLoadedMessage,
}: UseChatSearchNavigationArgs): SearchTarget | null {
  /** Coordinate loading and highlighting for URL-driven chat search targets. */
  const scrolledSearchTargetRef = useRef<string | null>(null);
  const activeSearchTarget = useMemo(() => {
    const params = new URLSearchParams(locationSearch);
    const query = params.get('chatSearch');
    const messageKey = params.get('messageKey');
    return query && messageKey ? { query, messageKey } : null;
  }, [locationSearch]);

  useEffect(() => {
    scrolledSearchTargetRef.current = null;
    setSearchHighlightRetry(() => 0);
  }, [activeSearchTarget?.messageKey, activeSearchTarget?.query, setSearchHighlightRetry]);

  useEffect(() => {
    if (!activeSearchTarget || !selectedSessionId) {
      return;
    }

    const hasTargetMessage = chatMessages.some((message) => message.messageKey === activeSearchTarget.messageKey);
    if (hasTargetMessage) {
      revealLoadedMessage(activeSearchTarget.messageKey);
      return;
    }
    if (isLoadingMoreMessages || isLoadingAllMessages || allMessagesLoaded) {
      return;
    }

    void loadMessagesUntilTarget({ messageKey: activeSearchTarget.messageKey });
  }, [
    activeSearchTarget,
    allMessagesLoaded,
    chatMessages,
    isLoadingAllMessages,
    isLoadingMoreMessages,
    loadMessagesUntilTarget,
    revealLoadedMessage,
    selectedSessionId,
  ]);

  useEffect(() => {
    clearSearchHighlights();
    if (!activeSearchTarget || !selectedSessionId) {
      return;
    }

    const retrySearchHighlight = () => {
      if (searchHighlightRetry >= 60) {
        return undefined;
      }
      const retryHandle = window.setTimeout(() => {
        setSearchHighlightRetry((attempt) => attempt + 1);
      }, 100);
      return () => window.clearTimeout(retryHandle);
    };

    const selector = `.chat-message[data-message-key="${CSS.escape(activeSearchTarget.messageKey)}"]`;
    const targetElement = document.querySelector<HTMLElement>(selector);
    if (!targetElement) {
      return retrySearchHighlight();
    }

    const targetSignature = `${activeSearchTarget.messageKey}:${activeSearchTarget.query}`;
    const shouldScroll = scrolledSearchTargetRef.current !== targetSignature;
    if (shouldScroll) {
      scrolledSearchTargetRef.current = targetSignature;
    }

    if (!applySearchHighlight(targetElement, activeSearchTarget.query, shouldScroll)) {
      return retrySearchHighlight();
    }

    const refreshHighlight = retrySearchHighlight();
    return () => {
      refreshHighlight?.();
      clearSearchHighlights();
    };
  }, [activeSearchTarget, chatMessages, searchHighlightRetry, selectedSessionId, setSearchHighlightRetry, visibleMessages]);

  return activeSearchTarget;
}
