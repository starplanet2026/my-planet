import { Component, type ReactNode } from 'react';

const RELOAD_KEY = 'mp_page_reload_ts';

/** 判断是否为「分包/模块加载失败」（部署更新后旧 chunk 失效会偶发出现） */
function isChunkLoadError(message: string): boolean {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(message);
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * 页面级错误边界。
 *
 * 背景：全站原只有一个全局 ErrorBoundary，且 KeepAlive 会把访问过的页面永久保留挂载
 * （仅 display:none 隐藏）。任何单个页面渲染抛错后，该页面仍在渲染树中反复抛错，
 * 会把整个应用（含其它页面）一起打进「页面开小差了」，且必须整页刷新才能恢复。
 *
 * 本组件包在每个 KeepAlive 页面内，只兜住当前页面的异常：
 * - 单页出错不再影响其它页面与 TopBar/底部导航
 * - 分包加载失败自动刷新一次（无需用户手动刷新）
 * - 其它异常提供「重试」（重置本页边界）与「刷新页面」
 */
export class PageBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (isChunkLoadError(message)) {
      // 12 秒内只自动刷新一次，避免死循环
      const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
      if (Date.now() - last > 12000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
        return;
      }
    }
    console.error('[PageBoundary] 页面渲染异常:', error, info);
  }

  handleRetry = () => this.setState({ hasError: false, message: undefined });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="py-16 flex flex-col items-center justify-center px-6 text-center">
        <div className="text-4xl mb-3">🛠️</div>
        <h2 className="text-base font-bold text-slate-700 mb-1">该页面出错了</h2>
        <p className="text-xs text-slate-400 mb-4 max-w-xs">
          可以点击重试，或刷新页面继续使用，其它功能不受影响。
        </p>
        <div className="flex gap-2">
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 rounded-lg bg-green-500 text-white text-sm font-medium hover:bg-green-600 active:scale-95 transition"
          >
            重试
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-500 text-sm font-medium hover:bg-slate-50 active:scale-95 transition"
          >
            刷新页面
          </button>
        </div>
        {this.state.message && (
          <p className="text-[11px] text-slate-300 mt-3 max-w-md break-all">{this.state.message}</p>
        )}
      </div>
    );
  }
}
