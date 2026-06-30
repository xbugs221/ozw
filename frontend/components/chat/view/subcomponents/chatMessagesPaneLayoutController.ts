/**
 * PURPOSE: Own chat transcript virtualization, row measurement, and target-message scrolling.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject, UIEvent as ReactUIEvent } from 'react';

import type { ChatMessage } from '../../types/types';
import { getIntrinsicMessageKey } from '../../utils/messageKeys';
import { buildTurnDisplayBlocks, type TurnDisplayBlock } from '../../utils/turnNonBodyCollapse';
import {
  buildTranscriptVirtualLayout,
  calculateTranscriptVirtualRange,
} from '../../utils/transcriptVirtualization';

const MAX_RENDERED_TRANSCRIPT_MESSAGES = 150;
const VIRTUAL_MESSAGE_OVERSCAN = 32;
const ESTIMATED_MESSAGE_HEIGHT = 96;

type UseChatMessagesPaneLayoutArgs = {
  visibleMessages: ChatMessage[];
  scrollContainerRef: RefObject<HTMLDivElement>;
  isFollowingLatest: boolean;
  scrollTargetMessageKey?: string | null;
  activeTailDefaultOpen?: boolean;
};

type VirtualTurnDisplayBlock = {
  block: TurnDisplayBlock;
  blockIndex: number;
  blockKey: string;
  sourceIndex: number;
};

/**
 * Return the messages that are physically represented by one display block.
 */
function getBlockMessages(block: TurnDisplayBlock): ChatMessage[] {
  if (block.kind === 'turn-non-body-group') {
    return block.items.flatMap((item) => item.messages);
  }
  return [block.message];
}

export function useChatMessagesPaneLayout({
  visibleMessages,
  scrollContainerRef,
  isFollowingLatest,
  scrollTargetMessageKey,
  activeTailDefaultOpen,
}: UseChatMessagesPaneLayoutArgs) {
  /** Coordinate stable message keys, virtual windows, and scroll positioning. */
  const messageKeyMapRef = useRef<WeakMap<ChatMessage, string>>(new WeakMap());
  const allocatedKeysRef = useRef<Set<string>>(new Set());
  const generatedMessageKeyCounterRef = useRef(0);
  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const pendingMeasurementFrameRef = useRef<number | null>(null);
  const followLatestScrollFrameRef = useRef<number | null>(null);
  const followLatestSecondScrollFrameRef = useRef<number | null>(null);
  const appliedScrollTargetKeyRef = useRef<string | null>(null);
  const hasPendingMeasurementUpdateRef = useRef(false);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const getMessageKey = useCallback((message: ChatMessage) => {
    /** Keep React keys stable across history prepends. */
    const existingKey = messageKeyMapRef.current.get(message);
    if (existingKey) {
      return existingKey;
    }

    const intrinsicKey = getIntrinsicMessageKey(message);
    if (intrinsicKey) {
      messageKeyMapRef.current.set(message, intrinsicKey);
      return intrinsicKey;
    }

    let candidateKey: string;
    do {
      generatedMessageKeyCounterRef.current += 1;
      candidateKey = `message-generated-${generatedMessageKeyCounterRef.current}`;
    } while (allocatedKeysRef.current.has(candidateKey));

    allocatedKeysRef.current.add(candidateKey);
    messageKeyMapRef.current.set(message, candidateKey);
    return candidateKey;
  }, []);

  const businessMessageKeys = useMemo(
    () => visibleMessages.map((message) => message.messageKey || getMessageKey(message)),
    [getMessageKey, visibleMessages],
  );
  const displayBlocks = useMemo(
    () => buildTurnDisplayBlocks(visibleMessages, { activeTailDefaultOpen }),
    [activeTailDefaultOpen, visibleMessages],
  );
  const displayBlockKeys = useMemo(() => {
    return displayBlocks.map((block, blockIndex) => {
      if (block.kind !== 'turn-non-body-group') {
        return getMessageKey(block.message);
      }

      const blockMessages = getBlockMessages(block);
      const firstKey = blockMessages[0] ? getMessageKey(blockMessages[0]) : `empty-${blockIndex}`;
      const lastKey = blockMessages.at(-1) ? getMessageKey(blockMessages.at(-1) as ChatMessage) : firstKey;
      return `turn-non-body-${block.turnKey}-${firstKey}-${lastKey}`;
    });
  }, [displayBlocks, getMessageKey]);
  const displayBlockSourceIndexes = useMemo(() => {
    return displayBlocks.map((block) => {
      const firstMessage = getBlockMessages(block)[0];
      if (!firstMessage) {
        return 0;
      }
      const sourceIndex = visibleMessages.indexOf(firstMessage);
      return sourceIndex >= 0 ? sourceIndex : 0;
    });
  }, [displayBlocks, visibleMessages]);
  const virtualLayout = useMemo(() => {
    return buildTranscriptVirtualLayout(
      displayBlockKeys,
      measuredHeightsRef.current,
      ESTIMATED_MESSAGE_HEIGHT,
    );
  }, [displayBlockKeys, measurementVersion]);
  const virtualRange = useMemo(() => {
    return calculateTranscriptVirtualRange({
      messageCount: displayBlocks.length,
      offsets: virtualLayout.offsets,
      totalHeight: virtualLayout.totalHeight,
      scrollTop,
      viewportHeight,
      estimatedMessageHeight: ESTIMATED_MESSAGE_HEIGHT,
      maxRenderedMessages: MAX_RENDERED_TRANSCRIPT_MESSAGES,
      overscan: VIRTUAL_MESSAGE_OVERSCAN,
    });
  }, [displayBlocks.length, scrollTop, viewportHeight, virtualLayout]);
  const virtualDisplayBlocks = useMemo<VirtualTurnDisplayBlock[]>(() => {
    return displayBlocks.slice(virtualRange.start, virtualRange.end).map((block, index) => {
      const blockIndex = virtualRange.start + index;
      return {
        block,
        blockIndex,
        blockKey: displayBlockKeys[blockIndex] || `display-block-${blockIndex}`,
        sourceIndex: displayBlockSourceIndexes[blockIndex] || 0,
      };
    });
  }, [
    displayBlockKeys,
    displayBlockSourceIndexes,
    displayBlocks,
    virtualRange.end,
    virtualRange.start,
  ]);
  const handleScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight);
  }, []);
  const scheduleFollowLatestMeasurementScroll = useCallback(() => {
    /** Keep follow mode pinned after measured heights replace estimates. */
    if (!isFollowingLatest) {
      return;
    }
    if (followLatestScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(followLatestScrollFrameRef.current);
    }
    if (followLatestSecondScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(followLatestSecondScrollFrameRef.current);
      followLatestSecondScrollFrameRef.current = null;
    }
    const scrollToMeasuredBottom = () => {
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }
      container.scrollTop = container.scrollHeight;
      setScrollTop(container.scrollTop);
      setViewportHeight(container.clientHeight);
    };
    followLatestScrollFrameRef.current = window.requestAnimationFrame(() => {
      followLatestScrollFrameRef.current = null;
      scrollToMeasuredBottom();
      followLatestSecondScrollFrameRef.current = window.requestAnimationFrame(() => {
        followLatestSecondScrollFrameRef.current = null;
        scrollToMeasuredBottom();
      });
    });
  }, [isFollowingLatest, scrollContainerRef]);

  const measureMessage = useCallback((messageKey: string, element: HTMLDivElement | null) => {
    /** Batch row height changes into one virtual layout refresh. */
    if (!element) {
      return;
    }
    const nextHeight = Math.max(1, element.getBoundingClientRect().height);
    const previousHeight = measuredHeightsRef.current.get(messageKey);
    if (!previousHeight || Math.abs(previousHeight - nextHeight) > 1) {
      measuredHeightsRef.current.set(messageKey, nextHeight);
      hasPendingMeasurementUpdateRef.current = true;
      if (pendingMeasurementFrameRef.current === null) {
        pendingMeasurementFrameRef.current = window.requestAnimationFrame(() => {
          pendingMeasurementFrameRef.current = null;
          if (!hasPendingMeasurementUpdateRef.current) {
            return;
          }
          hasPendingMeasurementUpdateRef.current = false;
          setMeasurementVersion((version) => version + 1);
        });
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const frameRef of [
        pendingMeasurementFrameRef,
        followLatestScrollFrameRef,
        followLatestSecondScrollFrameRef,
      ]) {
        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      }
    };
  }, []);
  useLayoutEffect(() => {
    scheduleFollowLatestMeasurementScroll();
  }, [measurementVersion, scheduleFollowLatestMeasurementScroll]);
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    setScrollTop(container.scrollTop);
    setViewportHeight(container.clientHeight);
  }, [scrollContainerRef, visibleMessages.length]);
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetKey = scrollTargetMessageKey || params.get('messageKey');
    if (!targetKey || visibleMessages.length === 0) {
      appliedScrollTargetKeyRef.current = null;
      return;
    }
    if (appliedScrollTargetKeyRef.current === targetKey) {
      return;
    }
    const targetIndex = businessMessageKeys.findIndex((key) => key === targetKey);
    const container = scrollContainerRef.current;
    if (targetIndex < 0 || !container) {
      return;
    }
    const targetBlockIndex = displayBlocks.findIndex((block) =>
      getBlockMessages(block).some((message) => (
        (message.messageKey || getMessageKey(message)) === targetKey
      )),
    );
    if (targetBlockIndex < 0) {
      return;
    }
    appliedScrollTargetKeyRef.current = targetKey;
    const targetTop = virtualLayout.offsets[targetBlockIndex] || 0;
    container.scrollTop = Math.max(0, targetTop - Math.floor(container.clientHeight / 2));
    setScrollTop(container.scrollTop);
    setViewportHeight(container.clientHeight);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const targetElement = document.querySelector<HTMLElement>(
          `.chat-message[data-message-key="${CSS.escape(targetKey)}"]`,
        );
        targetElement?.scrollIntoView({ block: 'center', behavior: 'auto' });
      });
    });
  }, [businessMessageKeys, displayBlocks, getMessageKey, scrollContainerRef, scrollTargetMessageKey, virtualLayout.offsets, visibleMessages.length]);

  return {
    handleScroll,
    maxRenderedTranscriptMessages: MAX_RENDERED_TRANSCRIPT_MESSAGES,
    measureMessage,
    virtualDisplayBlocks,
    virtualRange,
  };
}
