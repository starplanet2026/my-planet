import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * 全局错误边界：捕获子树渲染期异常，避免整页白屏无法恢复。
 * 出错时展示友好提示 + 重试按钮，点击重试重置内部状态重新渲染。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[ErrorBoundary] 捕获渲染异常:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, message: undefined });
    // 重置后仍异常的场景，提供刷新整页的兜底
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-star-50 px-6 text-center">
          <div className="text-5xl mb-4">🪐</div>
          <h2 className="text-lg font-bold text-slate-700 mb-1">页面开小差了</h2>
          <p className="text-sm text-slate-400 mb-5 max-w-xs">
            页面加载遇到问题，可以重试或刷新页面继续使用。
          </p>
          <div className="flex gap-2">
            <button
              onClick={this.handleReload}
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
            <p className="text-[11px] text-slate-300 mt-4 max-w-md break-all">{this.state.message}</p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
