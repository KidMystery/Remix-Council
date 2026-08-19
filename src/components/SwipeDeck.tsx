import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SwipeDeckProps {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  hasExpandedChild?: boolean;
}

export function SwipeDeck({ children, className = '', ariaLabel, hasExpandedChild = false }: SwipeDeckProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const childArray = React.Children.toArray(children).filter(Boolean);
  const totalCards = childArray.length;

  const checkScrollability = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);

    if (clientWidth > 0) {
      const newIndex = Math.round(scrollLeft / (clientWidth * 0.8 || 1));
      setActiveIndex(Math.max(0, Math.min(newIndex, totalCards - 1)));
    }
  }, [totalCards]);

  useEffect(() => {
    checkScrollability();
    window.addEventListener('resize', checkScrollability);
    return () => window.removeEventListener('resize', checkScrollability);
  }, [checkScrollability, childArray.length]);

  const handleScroll = () => {
    checkScrollability();
  };

  const scrollByAmount = (direction: 'left' | 'right') => {
    if (!containerRef.current) return;
    const step = containerRef.current.clientWidth * 0.75;
    const targetLeft = direction === 'left'
      ? containerRef.current.scrollLeft - step
      : containerRef.current.scrollLeft + step;
    containerRef.current.scrollTo({ left: targetLeft, behavior: 'smooth' });
  };

  const scrollToIndex = (index: number) => {
    if (!containerRef.current) return;
    const children = containerRef.current.children;
    if (children && children[index]) {
      (children[index] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      setActiveIndex(index);
    }
  };

  return (
    <div className="w-full max-w-full min-w-0 flex flex-col gap-2 relative group/deck">
      {/* Top Deck Control Header: Count + Indicator Dots + Desktop Navigation Controls */}
      {totalCards > 1 && !hasExpandedChild && (
        <div className="flex items-center justify-between px-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span>{totalCards} Members</span>
            <div className="flex items-center gap-1">
              {childArray.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => scrollToIndex(idx)}
                  aria-label={`Go to response card ${idx + 1}`}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    activeIndex === idx
                      ? 'w-4 bg-cyan-600 dark:bg-cyan-400'
                      : 'w-1.5 bg-slate-300 dark:bg-slate-700 hover:bg-slate-400'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Desktop Arrow Navigation */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollByAmount('left')}
              disabled={!canScrollLeft}
              aria-label="Previous card"
              className="p-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => scrollByAmount('right')}
              disabled={!canScrollRight}
              aria-label="Next card"
              className="p-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Main Deck Container: Horizontal Scroll-Snap on Desktop & Mobile */}
      <div
        ref={containerRef}
        role="region"
        aria-label={ariaLabel}
        onScroll={handleScroll}
        className={[
          'w-full max-w-full min-w-0 flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2',
          'scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700',
          hasExpandedChild ? 'flex-col' : '',
          className,
        ].join(' ')}
      >
        {childArray.map((child, idx) => (
          <div
            key={idx}
            className={
              hasExpandedChild
                ? 'w-full min-w-full'
                : 'w-[320px] xs:w-[360px] sm:w-[420px] md:w-[460px] lg:w-[480px] min-w-[320px] xs:min-w-[360px] sm:min-w-[420px] md:min-w-[460px] lg:min-w-[480px] snap-start shrink-0'
            }
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
