import { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Loading } from '../common/Loading';
import { useToastStore } from '../../store/toastStore';
import { useFamilyStore } from '../../store/familyStore';
import { fetchLuckyWheelPool, updateLuckyWheelWeights, type LuckyWheelReward } from '../../api/luckyWheel';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LuckyWheelConfigModal({ open, onClose }: Props) {
  const familyId = useFamilyStore(s => s.family?.id);
  const toast = useToastStore();
  const [pool, setPool] = useState<LuckyWheelReward[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !familyId) return;
    setLoading(true);
    fetchLuckyWheelPool(familyId)
      .then(p => {
        setPool(p);
        const w: Record<string, number> = {};
        p.forEach(r => { w[r.reward_key] = r.weight; });
        setWeights(w);
      })
      .catch(e => toast.error(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [open, familyId, toast]);

  const handleWeightChange = (key: string, val: string) => {
    const n = parseInt(val, 10);
    setWeights(prev => ({ ...prev, [key]: isNaN(n) ? 0 : Math.max(0, n) }));
  };

  const handleSave = async () => {
    if (!familyId) return;
    setSaving(true);
    try {
      const configs = pool.map(r => ({ reward_key: r.reward_key, weight: weights[r.reward_key] ?? 0 }));
      await updateLuckyWheelWeights(familyId, configs);
      toast.success('权重已保存');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const totalWeight = pool.reduce((s, r) => s + (weights[r.reward_key] ?? 0), 0);

  return (
    <Modal open={open} onClose={onClose} title="🎡 幸运大转盘权重配置" size="md">
      {loading ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            奖池集合固定（普通特权卡 + 4项稀有奖励），仅可调整权重数值。权重越大被抽中概率越高。
          </p>
          <div className="text-xs text-amber-600">当前总权重：{totalWeight}</div>
          <div className="max-h-[50vh] overflow-y-auto space-y-2">
            {pool.map(r => (
              <div key={r.reward_key} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {r.reward_type === 'star' ? '⭐ ' : '🎁 '}{r.name}
                  </div>
                  <div className="text-[10px] text-gray-400 truncate">{r.description ?? '—'}</div>
                </div>
                <input
                  type="number"
                  min={0}
                  value={weights[r.reward_key] ?? 0}
                  onChange={e => handleWeightChange(r.reward_key, e.target.value)}
                  className="w-20 px-2 py-1 border border-gray-200 rounded text-sm text-center"
                />
                {totalWeight > 0 && (
                  <span className="text-[10px] text-gray-400 w-12 text-right">
                    {(((weights[r.reward_key] ?? 0) / totalWeight) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" fullWidth onClick={onClose} disabled={saving}>取消</Button>
            <Button fullWidth loading={saving} onClick={handleSave}>保存权重</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
