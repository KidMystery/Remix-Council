/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */
import React, { useState, useRef, useEffect } from 'react';

interface SwipeDeckProps {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function SwipeDeck({ children, className = '', ariaLabel }: SwipeDeckProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const childArray = React.Children.toArray(children).filter(Boolean);
  const totalCards = childArray.length;

  // Track scroll position to update active dot on mobile
  const handleScroll = () => {
    if (!containerRef.current || totalCards === 0) return;
    const { scrollLeft, clientWidth } = containerRef.current;
    if (clientWidth === 0) return;
    const newIndex = Math.round(scrollLeft / clientWidth);
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < totalCards) {
      setActiveIndex(newIndex);
    }
  };

  const scrollToIndex = (index: number) => {
    if (!containerRef.current) return;
    const targetLeft = index * containerRef.current.clientWidth;
    containerRef.current.scrollTo({ left: targetLeft, behavior: 'smooth' });
    setActiveIndex(index);
  };

  return (
    <div className="w-full max-w-full min-w-0 flex flex-col gap-2">
      {/* Mobile Active Card Indicator Bar */}
      {totalCards > 1 && (
        <div className="flex md:hidden items-center justify-between px-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
          <span>Card {activeIndex + 1} of {totalCards}</span>
          <div className="flex items-center gap-1.5">
            {childArray.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => scrollToIndex(idx)}
                aria-label={`Go to response card ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  activeIndex === idx
                    ? 'w-4 bg-indigo-600 dark:bg-cyan-400'
                    : 'w-1.5 bg-slate-300 dark:bg-slate-700 hover:bg-slate-400'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Main Deck Container: Swipeable Snap on Mobile, Responsive Grid on Desktop */}
      <div
        ref={containerRef}
        role="region"
        aria-label={ariaLabel}
        onScroll={handleScroll}
        className={[
          'w-full max-w-full min-w-0 flex gap-3 overflow-x-auto snap-x snap-mandatory',
          '[-ms-overflow-style:none] [scrollbar-width:none]',
          '[&::-webkit-scrollbar]:hidden',
          'md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:overflow-visible md:gap-4',
          className,
        ].join(' ')}
      >
        {childArray.map((child, idx) => (
          <div
            key={idx}
            className="w-full min-w-full max-w-full snap-center md:min-w-0 md:max-w-none shrink-0 md:shrink"
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
