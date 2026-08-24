import React, { useState, useEffect, useRef } from 'react';

interface ConfirmButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onConfirm: () => void;
  confirmPrompt?: React.ReactNode;
  idleChildren?: React.ReactNode;
}

export const ConfirmButton: React.FC<ConfirmButtonProps> = ({
  onConfirm,
  confirmPrompt = "Click to confirm",
  idleChildren,
  onClick,
  className,
  ...props
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsConfirming(false);
      }
    };
    if (isConfirming) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isConfirming]);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (onClick) onClick(e);

    if (!isConfirming) {
      setIsConfirming(true);
    } else {
      setIsConfirming(false);
      onConfirm();
    }
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      className={
        isConfirming
          ? `text-red-100 bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded transition-all font-bold ${className || ''}`
          : className
      }
      {...props}
    >
      {isConfirming ? confirmPrompt : idleChildren || props.children}
    </button>
  );
};
