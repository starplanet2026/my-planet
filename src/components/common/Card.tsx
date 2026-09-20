import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white rounded-cute shadow-sm border border-star-100',
        onClick && 'cursor-pointer hover:shadow-md transition-shadow active:scale-[0.97] transition-transform',
        className
      )}
    >
      {children}
    </div>
  );
}
