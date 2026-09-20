import { useState, useEffect } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { Button } from '../../../../components/common/Button';
import { Loading } from '../../../../components/common/Loading';
import { useToastStore } from '../../../../store/toastStore';
import { cn } from '../../../../lib/utils';
import { Star, Check, Flame } from 'lucide-react';
import { fetchPetCheckins, petCheckin } from '../../../../api/pets';
import type { PetCheckin } from '../../../../api/types';

// 5天周期：第 1-4 天每天 +1⭐，第 5 天 +4⭐，结束后重置
const CYCLE_LENGTH = 5;
const dayReward = (day: number) => (day === CYCLE_LENGTH ? 4 : 1);

export function PetCheckinModal({ memberId, onClose, onCheckin }: {
  memberId: string;
  onClose: () => void;
  onCheckin: () => void;
}) {
  const toast = useToastStore();
  const [checkins, setCheckins] = useState<PetCheckin[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    loadCheckins();
  }, [memberId]);

  const loadCheckins = async () => {
    setLoading(true);
    try {
      const data = await fetchPetCheckins(memberId);
      setCheckins(data);
    } catch (e: any) {
      toast.error(e?.message ?? '加载签到记录失败');
    } finally {
      setLoading(false);
    }
  };

  // 今日日期字符串（YYYY-MM-DD）
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCheckin = checkins.find(c => c.checkin_date === todayStr);
  const alreadyChecked = !!todayCheckin;

  // 最近一条记录（fetchPetCheckins 已按 checkin_date 倒序）
  const lastRecord = checkins[0] ?? null;
  const lastCycleDay = lastRecord?.cycle_day ?? 0;
  const consecutiveDays = lastRecord?.consecutive_days ?? 0;

  // 今日待签到的天数序号（已签到则指向下一天，未签到则指向当前天）
  let pendingDay = lastCycleDay + 1;
  if (pendingDay > CYCLE_LENGTH) pendingDay = 1;

  // 判断某一天是否已签到（cycle_day <= 最近一次的 cycle_day 即视为已签）
  const isSigned = (day: number) => day <= lastCycleDay;

  // 点击签到
  const handleCheckin = async () => {
    setChecking(true);
    try {
      const result = await petCheckin(memberId);
      if (result.success) {
        toast.success(result.message);
        onCheckin();
        // 重新加载签到记录，刷新 UI
        await loadCheckins();
      } else if (result.already_checked) {
        toast.info(result.message);
        await loadCheckins();
      } else {
        toast.error(result.message);
      }
    } catch (e: any) {
      toast.error(e?.message ?? '签到失败');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="每日签到" size="md">
      {loading ? (
        <Loading text="加载签到记录..." />
      ) : (
        <div className="space-y-5">
          {/* 连续签到天数 */}
          <div className="flex items-center justify-center gap-2">
            <Flame className={cn('w-5 h-5', consecutiveDays >= 3 ? 'text-orange-500' : 'text-slate-400')} />
            <span className="text-sm text-slate-500">已连续签到</span>
            <span className="text-lg font-bold text-orange-500">{consecutiveDays}</span>
            <span className="text-sm text-slate-500">天</span>
          </div>

          {/* 5天周期圆圈 */}
          <div className="flex justify-between gap-2">
            {Array.from({ length: CYCLE_LENGTH }, (_, i) => i + 1).map(day => {
              const signed = isSigned(day);
              const isPending = day === pendingDay && !signed;
              const reward = dayReward(day);
              return (
                <div
                  key={day}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-1.5 p-2.5 rounded-2xl border-2 transition-all',
                    signed && 'bg-emerald-50 border-emerald-300',
                    !signed && !isPending && 'bg-slate-50 border-slate-200',
                    isPending && 'bg-amber-50 border-amber-300 animate-bounce-soft',
                  )}
                >
                  <div
                    className={cn(
                      'w-11 h-11 rounded-full flex items-center justify-center text-white shadow-sm',
                      signed && 'bg-emerald-500',
                      !signed && !isPending && 'bg-slate-300',
                      isPending && 'bg-amber-400',
                    )}
                  >
                    {signed ? (
                      <Check className="w-5 h-5" />
                    ) : (
                      <span className="text-sm font-bold">{day}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Star className="w-3 h-3 text-amber-500" />
                    <span className="text-xs font-semibold text-slate-600">+{reward}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Day {day}</span>
                </div>
              );
            })}
          </div>

          {/* 周期规则说明 */}
          <div className="rounded-xl bg-purple-50 px-3 py-2 text-center">
            <p className="text-xs text-purple-600">
              连续签到 5 天可获得 <Star className="w-3 h-3 inline text-amber-500" /> 8 颗星，周期自动重置
            </p>
          </div>

          {/* 签到按钮 */}
          <Button
            onClick={handleCheckin}
            loading={checking}
            disabled={alreadyChecked}
            variant={alreadyChecked ? 'secondary' : 'primary'}
            fullWidth
          >
            {alreadyChecked ? '今日已签到' : '立即签到'}
          </Button>
        </div>
      )}
    </Modal>
  );
}
