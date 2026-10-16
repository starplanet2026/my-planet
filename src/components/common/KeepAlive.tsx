import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PageBoundary } from './PageBoundary';

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
  // 是否已从 sessionStorage 还原过滚动位置（只在刷新后首次挂载时读一次）
  const scrollRestoredRef = useRef(false);
  const scrollKey = `mp-scroll:${pathname}`;

  useEffect(() => {
    if (active && !mounted) {
      setMounted(true);
    }
  }, [active, mounted]);

  // 浏览器刷新 / 标签被回收后重新挂载：还原上次停留的滚动位置
  useEffect(() => {
    if (!active || !mounted || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    try {
      const saved = sessionStorage.getItem(scrollKey);
      if (saved !== null) scrollYRef.current = Number(saved) || 0;
    } catch {
      // 忽略读取失败
    }
  }, [active, mounted, scrollKey]);

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

  // 切后台 / 关闭标签前把滚动位置写入 sessionStorage，刷新或标签回收后可还原
  useEffect(() => {
    if (!mounted || !active) return;
    const save = () => {
      try {
        sessionStorage.setItem(scrollKey, String(window.scrollY));
      } catch {
        // 忽略写入失败
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mounted, active, scrollKey]);

  if (!mounted) return null;

  return (
    <div
      className={className}
      style={{ display: active ? 'block' : 'none' }}
      aria-hidden={!active}
    >
      {/* 页面级错误隔离：单页崩溃不影响其它页面；分包加载失败自动刷新 */}
      <PageBoundary>{children}</PageBoundary>
    </div>
  );
}

