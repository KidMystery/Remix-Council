/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */
import React from 'react';

interface SwipeDeckProps {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function SwipeDeck({ children, className = '', ariaLabel }: SwipeDeckProps) {
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className={[
        'flex gap-3 overflow-x-auto snap-x snap-mandatory',
        '[-ms-overflow-style:none] [scrollbar-width:none]',
        '[&::-webkit-scrollbar]:hidden',
        'md:grid md:grid-cols-3 md:overflow-visible md:gap-4',
        className,
      ].join(' ')}
    >
      {React.Children.map(children, (child) => (
        <div className="min-w-full snap-center md:min-w-0">
          {child}
        </div>
      ))}
    </div>
  );
}
