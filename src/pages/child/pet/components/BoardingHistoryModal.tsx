import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { useToastStore } from '../../../../store/toastStore';
import { cn } from '../../../../lib/utils';
import { getBoardingHistory } from '../../../../api/pets';
import type { BoardingHistoryItem } from '../../../../api/types';

// 格式化日期为简洁中文显示
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return '今日';
  if (diff === 1) return '昨日';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function BoardingHistoryModal({ memberId, onClose }: {
  memberId: string;
  onClose: () => void;
}) {
  const toast = useToastStore();
  const [list, setList] = useState<BoardingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getBoardingHistory(memberId, 30);
        if (!cancelled) setList(data);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memberId]);

  // 按日期分组
  const grouped = useMemo(() => {
    const map = new Map<string, BoardingHistoryItem[]>();
    list.forEach(item => {
      if (!map.has(item.board_date)) map.set(item.board_date, []);
      map.get(item.board_date)!.push(item);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [list]);

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <Modal open onClose={onClose} title="托管明细" size="md">
      {loading ? (
        <div className="text-center py-10 text-sm text-slate-400">加载中...</div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-10 text-sm text-slate-400">暂无托管记录</div>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {grouped.map(([date, items]) => {
            const isToday = date === todayStr;
            const totalCoin = items.reduce((s, i) => s + Number(i.coin_gain || 0), 0);
            const totalExp = items.reduce((s, i) => s + (i.exp_gain || 0), 0);
            return (
              <div key={date} className={cn(
                'rounded-xl border-2 overflow-hidden',
                isToday ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-100 bg-white'
              )}>
                {/* 日期头部 */}
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50/80">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-700">{formatDate(date)}</span>
                    {isToday && (
                      <span className="px-1.5 py-0.5 rounded-full bg-indigo-500 text-white text-[9px] font-bold">今日</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500">
                    <span>{items.length} 只</span>
                    {totalExp > 0 && <span className="text-emerald-600">经验+{totalExp}</span>}
                    {totalCoin > 0 && <span className="text-amber-600">金币+{Math.round(totalCoin)}</span>}
                  </div>
                </div>
                {/* 宠物明细列表 */}
                <div className="divide-y divide-slate-50">
                  {items.map(item => (
                    <div key={item.pet_id + date} className="flex items-center gap-2 px-3 py-2">
                      <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-50 overflow-hidden flex-shrink-0">
                        {item.pet_image_url ? (
                          <img src={item.pet_image_url} alt={item.pet_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-base">{item.pet_emoji || '🐾'}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-700 truncate">{item.pet_name}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-[9px] text-slate-500 flex-wrap">
                          {item.hunger_gain > 0 && <span className="text-orange-500">体力+{item.hunger_gain}</span>}
                          {item.clean_gain > 0 && <span className="text-sky-500">清洁+{item.clean_gain}</span>}
                          {item.happiness_gain > 0 && <span className="text-pink-500">心情+{item.happiness_gain}</span>}
                          {item.exp_gain > 0 && <span className="text-emerald-500">经验+{item.exp_gain}</span>}
                          {Number(item.coin_gain) > 0 && <span className="text-amber-500">金币+{Math.round(Number(item.coin_gain))}</span>}
                          {item.hunger_gain === 0 && item.clean_gain === 0 && item.happiness_gain === 0 && item.exp_gain === 0 && Number(item.coin_gain) === 0 && (
                            <span className="text-slate-400">属性已满，无收益变化</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
