import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

interface KeepAliveProps {
  /**
   * 激活判定：当返回 true 时该页面显示，否则隐藏（但不卸载）。
   * 首次激活后组件即被挂载并永久保留在内存中，后续切换仅切换 display。
   */
  when: (pathname: string) => boolean;
  children: ReactNode;
  /** 自定义类名，用于包裹层 */
  className?: string;
}

/**
 * KeepAlive：类 Vue <keep-alive> 的页面级缓存组件。
 *
 * - 首次进入对应路由时挂载子组件并缓存
 * - 切走时不卸载，仅 display:none 隐藏，保留全部组件状态（useState/useRef/已加载数据）
 * - 自动保存/恢复窗口滚动位置，切回时停留在上次浏览位置
 * - 再次进入时直接显示缓存实例，不触发 useEffect([]) 的重新执行
 *
 * 注意：子组件内依赖「每次进入都刷新」的逻辑需自行通过监听路由变化实现，
 * 本组件保证不强制重建。
 */
export function KeepAlive({ when, children, className }: KeepAliveProps) {
  const { pathname } = useLocation();
  const active = when(pathname);
  const [mounted, setMounted] = useState(active);
  const scrollYRef = useRef(0);
  const restoringRef = useRef(false);

  useEffect(() => {
    if (active && !mounted) {
      setMounted(true);
    }
  }, [active, mounted]);

  // 切走时保存滚动位置；切回时恢复
  useEffect(() => {
    if (active) {
      // 页面显示后恢复滚动位置（等一帧确保布局完成）
      restoringRef.current = true;
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollYRef.current);
        restoringRef.current = false;
      });
    } else if (mounted) {
      // 隐藏前保存当前滚动位置
      scrollYRef.current = window.scrollY;
    }
  }, [active, mounted]);

  if (!mounted) return null;

  return (
    <div
      className={className}
      style={{ display: active ? 'block' : 'none' }}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

