/**
 * 文件目的：呈现可横向拖动的待处理会话卡片。
 * 业务意义：用户在手机或电脑上右滑即可完成，同时保留点击进入与键盘操作。
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { SessionProvider } from '../../types/app';
import SessionProviderLogo from '../llm-logo-provider/SessionProviderLogo';

type SessionAttentionCardProps = {
  provider: SessionProvider;
  sessionId: string;
  projectName: string;
  firstRequest: string;
  latestRequest: string;
  isSubmitting: boolean;
  onNavigate: () => void;
  onHandled: () => Promise<boolean>;
};

type PointerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  axis: 'pending' | 'horizontal' | 'vertical';
};

const SWIPE_START_DISTANCE = 8;
const SWIPE_MIN_TRIGGER = 92;
const SWIPE_MAX_TRIGGER = 150;

/** 绘制卡片完成动作所需的轻量图标。 */
function CheckIcon({ className = '' }: { className?: string }) {
  /** 业务目的：动作背景在拖动过程中保持清晰且无需额外图标依赖。 */
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="m5 12.5 4.25 4.25L19 7" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 绘制右滑方向提示。 */
function SwipeArrowIcon({ className = '' }: { className?: string }) {
  /** 业务目的：让首次使用者无需尝试即可理解卡片的完成方向。 */
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 12h13m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 提供右滑完成、左滑回弹、点击进入和键盘等价操作。
 */
export default function SessionAttentionCard({
  provider,
  sessionId,
  projectName,
  firstRequest,
  latestRequest,
  isSubmitting,
  onNavigate,
  onHandled,
}: SessionAttentionCardProps) {
  /** 业务目的：只让当前拖动卡片更新，避免整张看板随指针移动重渲染。 */
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const gestureRef = useRef<PointerGesture | null>(null);
  const dragXRef = useRef(0);
  const suppressClickRef = useRef(false);
  const hasDistinctLatestRequest = latestRequest.trim() !== firstRequest.trim();
  const hintId = `session-attention-hint-${provider}-${sessionId}`;

  /** 将拖动距离换算为当前卡片宽度下的完成阈值。 */
  const swipeTrigger = (): number => {
    /** 业务目的：窄屏不难触发，宽屏也不会因轻微拖动而误完成。 */
    const cardWidth = cardRef.current?.getBoundingClientRect().width || 360;
    return Math.min(SWIPE_MAX_TRIGGER, Math.max(SWIPE_MIN_TRIGGER, cardWidth * 0.28));
  };

  /** 同步保存渲染位移和手势瞬时值，确保释放事件读取最后一帧。 */
  const updateDragX = (nextDragX: number) => {
    /** 业务目的：快速滑动时不依赖 React 状态提交时序判断阈值。 */
    dragXRef.current = nextDragX;
    setDragX(nextDragX);
  };

  /** 开始记录一根主指针，触控纵向滚动仍交给页面。 */
  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    /** 业务目的：鼠标右键和提交中的卡片不能启动新的手势。 */
    if (isSubmitting || isExiting || (event.pointerType === 'mouse' && event.button !== 0)) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: 'pending',
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  /** 根据主移动方向区分横滑操作和纵向浏览。 */
  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    /** 业务目的：左滑只给出轻微阻尼，右滑完整跟手并显示完成动作。 */
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (gesture.axis === 'pending' && Math.hypot(deltaX, deltaY) >= SWIPE_START_DISTANCE) {
      gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }
    if (gesture.axis !== 'horizontal') return;
    suppressClickRef.current = true;
    updateDragX(deltaX >= 0 ? deltaX : Math.max(-28, deltaX * 0.18));
  };

  /** 结束手势；越过阈值时滑出并提交，否则回到原位。 */
  const finishPointerGesture = async (event: ReactPointerEvent<HTMLElement>) => {
    /** 业务目的：一次释放只提交一次，并在失败或并发新活动时恢复卡片。 */
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setIsDragging(false);
    if (gesture.axis !== 'horizontal' || dragXRef.current < swipeTrigger()) {
      updateDragX(0);
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      return;
    }
    suppressClickRef.current = true;
    setIsExiting(true);
    updateDragX((cardRef.current?.getBoundingClientRect().width || 360) + 48);
    const handled = await onHandled();
    if (!handled) {
      setIsExiting(false);
      updateDragX(0);
    }
  };

  /** 系统取消指针时只回弹，不把不完整手势解释为完成。 */
  const cancelPointerGesture = (event: ReactPointerEvent<HTMLElement>) => {
    /** 业务目的：来电、滚动接管等触控中断不能误处理会话。 */
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    suppressClickRef.current = true;
    setIsDragging(false);
    updateDragX(0);
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  /** 处理点击进入，拖动释放后的合成点击会被忽略。 */
  const handleClick = () => {
    /** 业务目的：横滑只完成任务，不意外打开会话。 */
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onNavigate();
  };

  /** 为无法使用拖动手势的用户提供等价键盘路径。 */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    /** 业务目的：Enter 打开，右方向键直接完成，与视觉方向保持一致。 */
    if (event.key === 'Enter') {
      event.preventDefault();
      onNavigate();
    } else if (event.key === 'ArrowRight' && !isSubmitting && !isExiting) {
      event.preventDefault();
      setIsExiting(true);
      updateDragX((cardRef.current?.getBoundingClientRect().width || 360) + 48);
      void onHandled().then((handled) => {
        if (!handled) {
          setIsExiting(false);
          updateDragX(0);
        }
      });
    }
  };

  const trigger = swipeTrigger();
  const completionProgress = Math.min(1, Math.max(0, dragX / trigger));

  return (
    <div className="relative overflow-hidden rounded-2xl bg-emerald-600 shadow-sm">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 flex items-center gap-2 px-5 text-sm font-semibold text-white"
        style={{ opacity: Math.max(0.3, completionProgress) }}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <CheckIcon className="h-5 w-5" />
        </span>
        {completionProgress >= 1 ? '松开完成' : '右滑完成'}
      </div>

      <article
        ref={cardRef}
        data-testid={`session-attention-card-${provider}:${sessionId}`}
        data-swipe-state={isExiting ? 'completing' : dragX > 0 ? 'swiping' : 'idle'}
        role="button"
        tabIndex={isSubmitting ? -1 : 0}
        aria-describedby={hintId}
        aria-keyshortcuts="Enter ArrowRight"
        aria-disabled={isSubmitting}
        className={`relative touch-pan-y cursor-grab select-none rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm will-change-transform hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing sm:px-5 ${isDragging ? 'transition-none' : 'transition-transform duration-200 ease-out motion-reduce:transition-none'}`}
        style={{
          transform: `translate3d(${dragX}px, 0, 0)`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => void finishPointerGesture(event)}
        onPointerCancel={cancelPointerGesture}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <div className="mb-4 flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-muted-foreground" title={provider}>
            <SessionProviderLogo provider={provider} className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">{projectName}</span>
          <span id={hintId} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/80">
            <SwipeArrowIcon className="h-4 w-4" />
            右滑完成
          </span>
        </div>

        <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-foreground">
          {firstRequest}
        </p>

        {hasDistinctLatestRequest ? (
          <>
            <p aria-label="中间请求已省略" className="my-1 text-[15px] leading-6 text-muted-foreground">...</p>
            <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-foreground">
              {latestRequest}
            </p>
          </>
        ) : null}
      </article>
    </div>
  );
}
