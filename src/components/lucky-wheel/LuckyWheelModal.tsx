import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import {
  fetchLuckyWheelPool,
  fetchLuckyWheelDailyStatus,
  startLuckyWheel,
  spinLuckyWheel,
  claimLuckyWheelReward,
  abandonLuckyWheel,
  type LuckyWheelReward,
  type LuckyWheelSpinResult,
} from '../../api/luckyWheel';
import { cn } from '../../lib/utils';

// 扇区配色 - 嘉年华暖色调
const SECTOR_COLORS = [
  '#fde68a', '#fca5a5', '#fcd34d', '#fdba74',
  '#f9a8d4', '#a5b4fc', '#86efac', '#93c5fd',
  '#f0abfc', '#c4b5fd', '#6ee7b7', '#7dd3fc',
  '#fecaca', '#fed7aa', '#d9f99d', '#bae6fd',
];

interface LuckyWheelModalProps {
  open: boolean;
  onClose: () => void;
}

export function LuckyWheelModal({ open, onClose }: LuckyWheelModalProps) {
  const familyId = useFamilyStore(s => s.family?.id);
  const currentChildId = useModeStore(s => s.currentChildId);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const toast = useToastStore();

  const [pool, setPool] = useState<LuckyWheelReward[]>([]);
  const [dailyStatus, setDailyStatus] = useState({ used_coin_today: false, ticket_count: 0 });
  const [loading, setLoading] = useState(true);
  const [payType, setPayType] = useState<'coin' | 'ticket'>('coin');
  const [wishKey, setWishKey] = useState<string>('');
  const [started, setStarted] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [remaining, setRemaining] = useState(3);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastResult, setLastResult] = useState<LuckyWheelSpinResult | null>(null);
  const [claimed, setClaimed] = useState(false);

  // 加载奖池和状态
  useEffect(() => {
    if (!open || !familyId || !currentChildId) return;
    setLoading(true);
    Promise.all([
      fetchLuckyWheelPool(familyId),
      fetchLuckyWheelDailyStatus(currentChildId),
    ]).then(([p, d]) => {
      setPool(p);
      setDailyStatus(d);
    }).catch(e => toast.error(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [open, familyId, currentChildId, toast]);

  // 重置状态
  const resetState = useCallback(() => {
    setStarted(false);
    setSessionId('');
    setRemaining(3);
    setRotation(0);
    setLastResult(null);
    setClaimed(false);
    setWishKey('');
  }, []);

  useEffect(() => {
    if (open) resetState();
  }, [open, resetState]);

  // 计算每个扇区的中心角度
  const sectorCount = pool.length;
  const sectorAngle = sectorCount > 0 ? 360 / sectorCount : 0;

  // 根据 reward_key 找到扇区索引
  const getSectorIndex = useCallback((key: string) => {
    return pool.findIndex(r => r.reward_key === key);
  }, [pool]);

  // 处理关闭
  const handleClose = useCallback(async () => {
    if (sessionId && started && !claimed && lastResult) {
      // 有未领取结果，自动发放
      try {
        await abandonLuckyWheel(sessionId);
        toast.info('已自动发放最后一次抽取结果');
      } catch { /* ignore */ }
    } else if (sessionId && started && !claimed) {
      // 开启了但还没抽取，也调用 abandon 结束 session
      try { await abandonLuckyWheel(sessionId); } catch { /* ignore */ }
    }
    onClose();
  }, [sessionId, started, claimed, lastResult, onClose, toast]);

  // 开始抽奖
  const handleStart = async () => {
    if (!currentChildId) return;
    if (payType === 'coin' && dailyStatus.used_coin_today) {
      toast.info('今日付费抽奖次数已用完，可以使用背包内的幸运大转盘券继续抽奖');
      return;
    }
    if (payType === 'ticket' && dailyStatus.ticket_count <= 0) {
      toast.error('背包内没有幸运大转盘券');
      return;
    }
    setSpinning(true);
    try {
      const res = await startLuckyWheel(currentChildId, payType, wishKey || undefined);
      if (!res.session_id) {
        toast.error(res.message);
        setSpinning(false);
        return;
      }
      if (res.message && res.message !== 'ok') {
        toast.info(res.message);
      }
      setSessionId(res.session_id);
      setRemaining(res.remaining_spins);
      setStarted(true);
      setSpinning(false);
      await refreshMembers();
    } catch (e: any) {
      toast.error(e?.message ?? '开启失败');
      setSpinning(false);
    }
  };

  // 单次抽取
  const handleSpin = async () => {
    if (!sessionId || remaining <= 0) return;
    setSpinning(true);
    setLastResult(null);
    try {
      const res = await spinLuckyWheel(sessionId);
      if (res.message !== 'ok') {
        toast.error(res.message);
        setSpinning(false);
        return;
      }
      // 计算旋转角度：目标扇区转到顶部（指针位置）
      const idx = getSectorIndex(res.reward_key);
      if (idx >= 0) {
        // 扇区中心角度 = idx * sectorAngle + sectorAngle/2
        // 转盘需要旋转使该扇区指向 12 点方向（即 -90 度位置）
        const targetAngle = 360 - (idx * sectorAngle + sectorAngle / 2);
        // 加 5 圈旋转
        const finalRotation = rotation + 360 * 5 + (targetAngle - (rotation % 360));
        setRotation(finalRotation);
      }
      // 等待动画完成
      setTimeout(() => {
        setLastResult(res);
        setRemaining(res.remaining_spins);
        setSpinning(false);
      }, 3500);
    } catch (e: any) {
      toast.error(e?.message ?? '抽取失败');
      setSpinning(false);
    }
  };

  // 领取奖励
  const handleClaim = async () => {
    if (!sessionId || !lastResult) return;
    try {
      const res = await claimLuckyWheelReward(sessionId);
      setClaimed(true);
      if (res.wish_hit) {
        if (res.coin_refunded) {
          toast.success('许愿成功！已退还20金币');
        } else {
          toast.info('许愿成功！本次使用转盘券，无金币退还');
        }
      } else {
        toast.success(`恭喜获得：${res.reward_name}`);
      }
      await refreshMembers();
    } catch (e: any) {
      toast.error(e?.message ?? '领取失败');
    }
  };

  // 生成 SVG 扇形路径
  const describeArc = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
  };

  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const angleRad = (angleDeg - 90) * Math.PI / 180;
    return {
      x: cx + r * Math.cos(angleRad),
      y: cy + r * Math.sin(angleRad),
    };
  };

  // 扇区文字位置
  const getTextPos = (cx: number, cy: number, r: number, idx: number) => {
    const angle = idx * sectorAngle + sectorAngle / 2;
    return polarToCartesian(cx, cy, r * 0.65, angle);
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={handleClose} title="🎡 幸运大转盘" size="xl">
      {loading ? (
        <Loading />
      ) : (
        <div className="flex flex-col items-center -mx-6 -mb-6 px-6 pb-6 pt-2 rounded-b-2xl" style={{
          background: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 40%, #fde68a 100%)',
        }}>
          {/* 顶部装饰彩条 */}
          <div className="w-full h-2 rounded-full mb-2" style={{
            background: 'linear-gradient(90deg, #f87171, #fbbf24, #34d399, #60a5fa, #a78bfa, #f472b6, #f87171)',
            backgroundSize: '200% 100%',
          }} />
          {/* 支付方式 + 许愿（开始前可选） */}
          {!started && (
            <div className="w-full space-y-4 mb-4">
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setPayType('coin')}
                  className={cn(
                    'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                    payType === 'coin' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600'
                  )}
                >
                  🪙 金币开启 (20金币)
                </button>
                <button
                  onClick={() => setPayType('ticket')}
                  disabled={dailyStatus.ticket_count <= 0}
                  className={cn(
                    'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                    payType === 'ticket' ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-600',
                    dailyStatus.ticket_count <= 0 && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  🎫 转盘券开启 (剩余{dailyStatus.ticket_count}张)
                </button>
              </div>
              {/* 许愿选择 */}
              <div className="text-center">
                <span className="text-xs text-gray-500 mr-2">许愿（可选）：</span>
                <select
                  value={wishKey}
                  onChange={e => setWishKey(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm max-w-[200px]"
                >
                  <option value="">不许愿</option>
                  {pool.map(r => (
                    <option key={r.reward_key} value={r.reward_key}>{r.name}</option>
                  ))}
                </select>
              </div>
              {payType === 'coin' && dailyStatus.used_coin_today && (
                <p className="text-xs text-red-500 text-center">今日付费次数已用完，请使用转盘券</p>
              )}
            </div>
          )}

          {/* 转盘 */}
          <div className="relative w-80 h-80 sm:w-[30rem] sm:h-[30rem]">
            {/* 指针 */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
              <div className="w-0 h-0 border-l-[14px] border-r-[14px] border-t-[24px] border-l-transparent border-r-transparent border-t-red-500" />
            </div>
            {/* 转盘 SVG */}
            <svg
              viewBox="0 0 400 400"
              className="w-full h-full rounded-full shadow-lg"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: spinning ? 'transform 3.5s cubic-bezier(0.17, 0.67, 0.12, 0.99)' : 'none',
              }}
            >
              <circle cx="200" cy="200" r="195" fill="#fff" stroke="#fbbf24" strokeWidth="6" />
              {pool.map((reward, idx) => {
                const startAngle = idx * sectorAngle;
                const endAngle = (idx + 1) * sectorAngle;
                const color = SECTOR_COLORS[idx % SECTOR_COLORS.length];
                const textPos = getTextPos(200, 200, 195, idx);
                const textRotation = idx * sectorAngle + sectorAngle / 2;
                // 下半圈文字翻转180度，保持正向可读
                const displayRotation = textRotation > 90 && textRotation < 270 ? textRotation + 180 : textRotation;
                // 文字沿半径方向纵向排列（从中心向外）
                const chars = reward.name.slice(0, 6).split('');
                return (
                  <g key={reward.reward_key}>
                    <path
                      d={describeArc(200, 200, 195, startAngle, endAngle)}
                      fill={color}
                      stroke="#fff"
                      strokeWidth="1"
                    />
                    <text
                      x={textPos.x}
                      y={textPos.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="13"
                      fontWeight="600"
                      fill="#374151"
                      transform={`rotate(${displayRotation}, ${textPos.x}, ${textPos.y})`}
                    >
                      {chars.map((ch, ci) => (
                        <tspan
                          key={ci}
                          x={textPos.x}
                          dy={ci === 0 ? -((chars.length - 1) * 7) : 14}
                        >
                          {ch}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
              <circle cx="200" cy="200" r="42" fill="#fff" stroke="#fbbf24" strokeWidth="4" />
            </svg>
            {/* 中心按钮 */}
            <button
              onClick={started ? handleSpin : handleStart}
              disabled={spinning || claimed}
              className={cn(
                'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full font-bold text-base shadow-lg transition-all',
                'bg-gradient-to-br from-amber-400 to-orange-500 text-white',
                (spinning || claimed) && 'opacity-60 cursor-not-allowed',
                !spinning && !claimed && 'hover:scale-105 active:scale-95'
              )}
            >
              {spinning ? '...' : started ? '抽取' : '开始'}
            </button>
          </div>

          {/* 剩余次数 */}
          {started && (
            <div className="mt-4 text-sm text-gray-600">
              剩余抽取次数：<span className="font-bold text-amber-600">{remaining}</span> / 3
            </div>
          )}

          {/* 结果展示 */}
          {lastResult && !claimed && (
            <div className="mt-4 w-full p-4 bg-amber-50 rounded-xl text-center">
              <p className="text-sm text-gray-500">本次抽到</p>
              <p className="text-lg font-bold text-amber-600 my-1">{lastResult.reward_name}</p>
              <div className="flex gap-2 justify-center mt-3">
                {remaining > 0 && (
                  <Button variant="secondary" onClick={handleSpin} disabled={spinning}>
                    继续抽取
                  </Button>
                )}
                <Button onClick={handleClaim}>领取此奖励</Button>
              </div>
            </div>
          )}

          {claimed && (
            <div className="mt-4 text-center">
              <p className="text-green-600 font-medium">奖励已发放到背包/账户 🎉</p>
              <Button className="mt-3" onClick={onClose}>关闭</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
