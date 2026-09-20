import { cn } from '../../lib/utils';

interface AvatarProps {
  emoji?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  alt?: string;
}

const sizeMap = {
  sm: 'w-6 h-6 text-sm',
  md: 'w-8 h-8 text-xl',
  lg: 'w-12 h-12 text-3xl',
  xl: 'w-16 h-16 text-5xl',
};

// 头像组件：如果 avatar_emoji 是 data URL（自定义上传图片），渲染为 <img>；否则渲染为 emoji 文本
export function Avatar({ emoji, size = 'md', className, alt }: AvatarProps) {
  const isImage = emoji?.startsWith('data:');
  const fallback = !emoji ? '🦁' : emoji;

  if (isImage) {
    return (
      <img
        src={emoji}
        alt={alt ?? '头像'}
        className={cn('rounded-full object-cover flex-shrink-0', sizeMap[size], className)}
      />
    );
  }

  return (
    <span className={cn('inline-flex items-center justify-center', sizeMap[size], className)}>
      {fallback}
    </span>
  );
}
