import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const baseClass = 'w-full rounded-xl border border-slate-200 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all min-h-[44px]';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-slate-700">{label}</label>}
      <input ref={ref} className={cn(baseClass, error && 'border-red-500 focus:ring-red-500', className)} {...props} />
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
);
Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-slate-700">{label}</label>}
      <textarea ref={ref} className={cn(baseClass, 'resize-none', error && 'border-red-500', className)} rows={3} {...props} />
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
);
Textarea.displayName = 'Textarea';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className, children, ...props }, ref) => (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-slate-700">{label}</label>}
      <select ref={ref} className={cn(baseClass, 'bg-white', error && 'border-red-500', className)} {...props}>
        {children}
      </select>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
);
Select.displayName = 'Select';
