export function Loading({ text = '加载中...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <svg className="animate-spin h-8 w-8 text-blue-500 mb-3" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 animate-pulse">
      <div className="h-4 bg-slate-200 rounded w-2/3 mb-3" />
      <div className="h-3 bg-slate-100 rounded w-1/2 mb-2" />
      <div className="h-3 bg-slate-100 rounded w-1/3" />
    </div>
  );
}
