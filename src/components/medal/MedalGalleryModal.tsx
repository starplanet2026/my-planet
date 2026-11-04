import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { useToastStore } from '../../store/toastStore';
import {
  listFamilyMedals, listMemberMedals, MEDAL_SERIES_LABELS,
  type Medal, type MemberMedal,
} from '../../api/medals';

interface Props {
  open: boolean;
  onClose: () => void;
  familyId: string;
  memberId: string;
}

export function MedalGalleryModal({ open, onClose, familyId, memberId }: Props) {
  const toast = useToastStore();
  const [medals, setMedals] = useState<Medal[]>([]);
  const [holdings, setHoldings] = useState<Record<string, MemberMedal>>({});
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Medal | null>(null);

  useEffect(() => {
    if (!open || !familyId || !memberId) return;
    setLoading(true);
    Promise.all([listFamilyMedals(familyId), listMemberMedals(memberId)])
      .then(([list, holds]) => {
        setMedals(list.filter(m => m.is_active));
        const map: Record<string, MemberMedal> = {};
        holds.forEach(h => { map[h.medal_id] = h; });
        setHoldings(map);
      })
      .catch(e => toast.error(e?.message ?? '勋章加载失败'))
      .finally(() => setLoading(false));
  }, [open, familyId, memberId]);

  const totalEarned = medals.filter(m => holdings[m.id]).length;

  return (
    <Modal open={open} onClose={onClose} title="我的勋章" size="lg">
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          已解锁 {totalEarned} / {medals.length} 枚 · 满足条件自动发放，断签不会回收
        </p>

        {loading ? (
          <div className="py-10 text-center text-slate-400 text-sm">加载中…</div>
        ) : medals.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-sm">勋章库还没有配置勋章</div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 max-h-[60vh] overflow-y-auto pr-1">
            {medals.map(m => {
              const hold = holdings[m.id];
              const owned = !!hold;
              return (
                <button
                  key={m.id}
                  onClick={() => setDetail(m)}
                  className={`relative flex flex-col items-center p-2 rounded-2xl border transition-all ${
                    owned ? 'bg-amber-50 border-amber-200 hover:shadow-md' : 'bg-slate-50 border-slate-100'
                  }`}
                >
                  {owned && hold.count > 1 && (
                    <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                      ×{hold.count}
                    </span>
                  )}
                  {m.icon ? (
                    <img src={m.icon} alt="" className={`w-12 h-12 rounded-full object-cover ${owned ? '' : 'grayscale opacity-50'}`} />
                  ) : (
                    <span className={`text-3xl leading-none ${owned ? '' : 'grayscale opacity-40'}`}>🏅</span>
                  )}
                  <span className={`mt-1.5 text-[11px] font-medium text-center leading-tight ${owned ? 'text-amber-700' : 'text-slate-400'}`}>
                    {m.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="勋章详情">
        {detail && (
          <div className="flex flex-col items-center text-center space-y-2">
            {detail.icon ? (
              <img src={detail.icon} alt="" className="w-20 h-20 rounded-full object-cover" />
            ) : (
              <span className="text-5xl">🏅</span>
            )}
            <h3 className="text-lg font-bold text-slate-800">{detail.name}</h3>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">{MEDAL_SERIES_LABELS[detail.series]}</span>
              {detail.tier && <span>{detail.tier}</span>}
              {holdings[detail.id] && <span className="text-amber-600 font-medium">已拥有 ×{holdings[detail.id].count}</span>}
            </div>
            {detail.description && <p className="text-sm text-slate-600 leading-relaxed">{detail.description}</p>}
            {detail.condition_text && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2 w-full">
                获取条件：{detail.condition_text}
              </p>
            )}
            {detail.reward_card_name && (
              <p className="text-xs text-emerald-600">
                奖励：{detail.reward_card_name}{detail.reward_card_count > 1 ? ` ×${detail.reward_card_count}` : ''}
              </p>
            )}
          </div>
        )}
      </Modal>
    </Modal>
  );
}
