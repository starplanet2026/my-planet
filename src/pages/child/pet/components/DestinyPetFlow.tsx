import { useState, useEffect } from 'react';
import { Modal } from '../../../../components/common/Modal';
import { Button } from '../../../../components/common/Button';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { useModeStore } from '../../../../store/modeStore';
import { usePetTraits } from '../../../../hooks/usePetTraits';
import { cn } from '../../../../lib/utils';
import {
  QUIZ_QUESTIONS, computeDestinyResult,
  type DestinyResult, type DimensionResult,
} from '../../../../lib/destinyPetData';
import {
  fetchDestinyState, saveDestinyResult, findDestinyShopItem, adoptDestinyPet,
  updatePetInfo, checkPet,
} from '../../../../api/pets';
import { supabase } from '../../../../api/client';
import type { PetShopItem, Pet, PetRarity } from '../../../../api/types';

// 稀有度徽章
const RARITY_LABEL: Record<string, string> = { common: '普通', rare: '稀有', epic: '史诗' };
const RARITY_CLS: Record<string, string> = {
  common: 'bg-slate-100 text-slate-500',
  rare: 'bg-blue-100 text-blue-600',
  epic: 'bg-purple-100 text-purple-600',
};

// 维度两端文案（与 DIM_META 对应）
const DIM_LABELS: Record<string, { left: string; right: string }> = {
  EI: { left: 'E 外向', right: 'I 内向' },
  SN: { left: 'S 务实', right: 'N 想象' },
  TF: { left: 'T 理性', right: 'F 共情' },
  JP: { left: 'J 规划', right: 'P 随性' },
};

// 系统圆体（先用系统字体）
const ROUNDED_FONT = {
  fontFamily: 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
} as const;

// 单维度对比条（含胜出端高亮 + 档位短句）
function DimBar({ d }: { d: DimensionResult }) {
  const labels = DIM_LABELS[d.dim];
  const leftWins = d.letter === d.leftLetter;
  const rightWins = d.letter === d.rightLetter;
  const lp = Math.round(d.leftRatio * 100);
  const rp = Math.round(d.rightRatio * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] font-medium">
        <span className={cn(leftWins ? 'text-rose-500' : 'text-slate-400')}>{labels.left} {lp}%</span>
        <span className={cn(rightWins ? 'text-indigo-500' : 'text-slate-400')}>{rp}% {labels.right}</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
        <div className={cn('h-full', leftWins ? 'bg-rose-400' : 'bg-rose-200')} style={{ width: `${lp}%` }} />
        <div className={cn('h-full', rightWins ? 'bg-indigo-400' : 'bg-indigo-200')} style={{ width: `${rp}%` }} />
      </div>
      <p className="text-[11px] text-slate-500 leading-snug whitespace-nowrap">{d.phrase}</p>
    </div>
  );
}

/**
 * 「我的本命宠」性格测试流程：介绍弹窗 → 32 题 → 结果弹窗 → 免费领养/起名
 * 一生一次（粒度 member），领养前可无限次重新测试
 */
export function DestinyPetFlow({ onClose, onAdopted }: { onClose: () => void; onAdopted: () => void }) {
  const toast = useToastStore();
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? members.find(m => m.role === 'child')?.id ?? '';
  const { traitMap } = usePetTraits();

  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<'intro' | 'quiz' | 'result'>('intro');
  const [answers, setAnswers] = useState<number[]>(() => Array(QUIZ_QUESTIONS.length).fill(-1));
  const [quizIndex, setQuizIndex] = useState(0);
  // 当前题已选中的选项下标（短暂高亮后自动进入下一题）
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<DestinyResult | null>(null);
  const [shopItem, setShopItem] = useState<PetShopItem | null>(null);
  const [adoptedAt, setAdoptedAt] = useState<string | null>(null);
  const [alreadyOwns, setAlreadyOwns] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [namingPetId, setNamingPetId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [donePet, setDonePet] = useState<Pet | null>(null);
  const [compResult, setCompResult] = useState<number | null>(null);

  // 初次进入：读取本命宠状态（有作答记录则直接展示结果）
  useEffect(() => {
    if (!childId) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const st = await fetchDestinyState(childId);
        if (!alive) return;
        if (st.answers && st.answers.length === QUIZ_QUESTIONS.length) {
          const r = computeDestinyResult(st.answers);
          setResult(r);
          setAnswers(st.answers);
          setAdoptedAt(st.adoptedAt);
          setStage('result');
          const item = await findDestinyShopItem(r.profile.petName, r.profile.rarity, r.profile.priceStar);
          if (alive) setShopItem(item);
        } else {
          setStage('intro');
        }
      } catch {
        if (alive) setStage('intro');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [childId]);

  // 结果就绪后：查询是否已拥有同款本命宠（用于提示折算补偿）
  useEffect(() => {
    if (!childId || !shopItem) return;
    let alive = true;
    supabase.from('pets').select('id').eq('member_id', childId).eq('shop_item_id', shopItem.id).limit(1)
      .then(({ data }) => { if (alive) setAlreadyOwns(!!data && data.length > 0); });
    return () => { alive = false; };
  }, [childId, shopItem]);

  // 答题：答完 32 题即计算、保存并进入结果
  const handleAnswer = async (idx: number) => {
    const next = [...answers];
    next[QUIZ_QUESTIONS[quizIndex].id - 1] = idx;
    setAnswers(next);
    if (quizIndex + 1 >= QUIZ_QUESTIONS.length) {
      const r = computeDestinyResult(next);
      setResult(r);
      setStage('result');
      try { await saveDestinyResult(childId, next, r.code); } catch { /* 忽略保存失败，不影响展示 */ }
      try {
        const item = await findDestinyShopItem(r.profile.petName, r.profile.rarity, r.profile.priceStar);
        setShopItem(item);
      } catch { /* 忽略 */ }
    } else {
      setQuizIndex(quizIndex + 1);
    }
  };

  // 选中选项：先高亮（领取成就同款黄色），短暂停留后自动进入下一题
  const pickAnswer = (idx: number) => {
    if (picked !== null) return;
    setPicked(idx);
    window.setTimeout(() => {
      setPicked(null);
      handleAnswer(idx);
    }, 220);
  };

  // 重新测试（领养前不限次）
  const handleRestart = () => {
    setAnswers(Array(QUIZ_QUESTIONS.length).fill(-1));
    setQuizIndex(0);
    setPicked(null);
    setResult(null);
    setShopItem(null);
    setAlreadyOwns(false);
    setCompResult(null);
    setDonePet(null);
    setNamingPetId(null);
    setStage('quiz');
  };

  // 领养（免费；已有同款则折算等值星光值补偿）
  const handleAdopt = async () => {
    if (!childId || !shopItem) return;
    setAdopting(true);
    try {
      const res = await adoptDestinyPet(childId, shopItem.id);
      if (!res.success) {
        toast.error(res.message || '领养失败');
        return;
      }
      refreshMembers();
      onAdopted();
      if (res.compensated) {
        setAdoptedAt(new Date().toISOString());
        setCompResult(res.comp_star);
        toast.success(res.message);
      } else if (res.pet_id) {
        setNamingPetId(res.pet_id);
        setName('');
      }
    } catch (e: any) {
      toast.error(e?.message ?? '领养失败');
    } finally {
      setAdopting(false);
    }
  };

  // 命名（沿用现有起名流程）
  const handleSaveName = async () => {
    if (!namingPetId || !name.trim()) return;
    setSavingName(true);
    try {
      await updatePetInfo(namingPetId, childId, name.trim(), null);
      const pet = await checkPet(namingPetId);
      setDonePet(pet);
      setNamingPetId(null);
      setAdoptedAt(new Date().toISOString());
      refreshMembers();
      onAdopted();
      toast.success('命名成功！好好照顾它吧');
    } catch (e: any) {
      toast.error(e?.message ?? '命名失败');
    } finally {
      setSavingName(false);
    }
  };

  // 测试中关闭需二次确认
  const requestClose = () => {
    if (stage === 'quiz' && !result) { setConfirmExit(true); return; }
    onClose();
  };

  if (loading) {
    return (
      <Modal open onClose={onClose} title="我的本命宠" size="md">
        <div className="py-8 text-center text-sm text-slate-400" style={ROUNDED_FONT}>加载中...</div>
      </Modal>
    );
  }

  // ===== 介绍弹窗 =====
  if (stage === 'intro') {
    return (
      <Modal open onClose={onClose} title="我的本命宠" size="md">
        <div className="space-y-4 text-center" style={ROUNDED_FONT}>
          <div className="text-6xl">🐾</div>
          <p className="text-[15px] text-slate-600 leading-relaxed">
            回答 32 道性格小问题，测出你的专属人格，<br />免费领养与你最合拍的本命宠物！
          </p>
          <ul className="text-left text-xs text-slate-500 space-y-1.5 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <li>· 约需 3 分钟，凭第一感觉选择就好</li>
            <li>· 测试与领养完全免费，不消耗星光值</li>
            <li>· 每个小朋友一生只能领养一次哦</li>
          </ul>
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} className="flex-1">再等等</Button>
            <Button onClick={() => { setQuizIndex(0); setStage('quiz'); }} className="flex-1">马上开始测试</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ===== 答题 =====
  if (stage === 'quiz') {
    const q = QUIZ_QUESTIONS[quizIndex];
    const progress = Math.round((quizIndex / QUIZ_QUESTIONS.length) * 100);
    return (
      <>
        <Modal open onClose={requestClose} title="我的本命宠" size="md">
          <div className="space-y-4" style={ROUNDED_FONT}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>第 {quizIndex + 1} / {QUIZ_QUESTIONS.length} 题</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-star-300 to-star-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-700 text-center leading-relaxed">{q.text}</h3>
            <div className="grid grid-cols-2 gap-3">
              {q.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => pickAnswer(i)}
                  className={cn(
                    'min-h-[88px] p-3 rounded-2xl border-2 flex items-center justify-center text-center text-sm font-medium leading-snug transition-colors',
                    picked === i
                      ? 'bg-star-400 border-star-400 text-slate-800 font-bold'
                      : 'bg-white border-star-300 text-slate-700 hover:bg-star-50 hover:border-star-400'
                  )}
                >
                  {opt.text}
                </button>
              ))}
            </div>
          </div>
        </Modal>
        {confirmExit && (
          <Modal open onClose={() => setConfirmExit(false)} title="确定要退出测试吗？" size="sm">
            <div className="space-y-3" style={ROUNDED_FONT}>
              <p className="text-sm text-slate-500 text-center">退出后本次作答将不会保存哦～</p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setConfirmExit(false)} className="flex-1">继续测试</Button>
                <Button onClick={() => { setConfirmExit(false); onClose(); }} className="flex-1">退出</Button>
              </div>
            </div>
          </Modal>
        )}
      </>
    );
  }

  // ===== 结果弹窗 =====
  return (
    <Modal open onClose={onClose} title="我的本命宠" size="xl25">
      <div className="space-y-4" style={ROUNDED_FONT}>
        {result ? (
          <>
            {adoptedAt && (
              <div className="rounded-lg bg-green-50 border border-green-200 text-green-600 text-xs text-center py-1.5">
                已完成测试并领取本命宠（每位小朋友仅限一次）
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-4">
              {/* 左：性格分析 */}
              <div className="space-y-3 rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-center text-slate-500 font-medium leading-tight">
                  你的MBTI性格是：
                  <span className="text-4xl font-bold text-slate-700">{result.code} {result.profile.name}</span>
                </p>
                <p className="text-lg text-purple-600 leading-relaxed">{result.profile.desc}</p>
                <div className="space-y-3 pt-1">
                  {result.dimensions.map(d => <DimBar key={d.dim} d={d} />)}
                </div>
              </div>

              {/* 右：本命宠 */}
              <div className="space-y-3 rounded-2xl bg-gradient-to-b from-pink-50 to-amber-50 border border-pink-100 p-4 flex flex-col">
                {donePet ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm text-green-600 font-medium">领养成功！</p>
                    {donePet.image_url ? (
                      <img src={donePet.image_url} alt="" className="w-28 h-36 object-contain drop-shadow" />
                    ) : (
                      <div className="text-6xl">{donePet.emoji || '🐾'}</div>
                    )}
                    <p className="font-bold text-slate-700">{donePet.name || donePet.breed}</p>
                    <Button variant="ghost" onClick={onClose} className="w-full mt-1">完成</Button>
                  </div>
                ) : compResult !== null ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                    <div className="text-5xl">⭐</div>
                    <p className="text-sm text-amber-600 font-medium leading-relaxed">
                      你已拥有该本命宠，已折算<br /><span className="text-lg font-bold">{compResult}</span> 星光值补偿
                    </p>
                    <Button onClick={onClose} className="w-full">完成</Button>
                  </div>
                ) : namingPetId ? (
                  <div className="flex-1 flex flex-col justify-center gap-3">
                    <p className="text-sm text-slate-500 text-center">领养成功！给它取个名字吧</p>
                    {shopItem?.image_url ? (
                      <img src={shopItem.image_url} alt="" className="w-28 h-36 mx-auto object-contain drop-shadow" />
                    ) : (
                      <div className="text-6xl text-center">{shopItem?.emoji || '🐾'}</div>
                    )}
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="给它取个名字"
                      maxLength={10}
                      autoFocus
                      className="w-full px-3 py-2 rounded-xl border border-green-300 text-sm text-center"
                    />
                    <Button onClick={handleSaveName} disabled={savingName || !name.trim()} className="w-full">
                      {savingName ? '保存中...' : '确认命名'}
                    </Button>
                  </div>
                ) : shopItem ? (
                  <>
                    <p className="text-center text-slate-500 font-medium leading-tight">
                      你的本命宠物是：
                      <span className="text-4xl font-bold text-slate-700">{shopItem.name}</span>
                    </p>
                    <p className="text-lg text-star-600 leading-relaxed text-center">{result.profile.petText}</p>
                    <div className="flex-1 flex flex-col items-center justify-center gap-2">
                      {shopItem.image_url ? (
                        <img src={shopItem.image_url} alt="" className="w-32 h-40 object-contain drop-shadow" />
                      ) : (
                        <div className="text-6xl">{shopItem.emoji || '🐾'}</div>
                      )}
                      <p className="font-bold text-slate-700">{shopItem.name}</p>
                      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
                        <span className={cn('px-2 py-0.5 rounded-full font-medium', RARITY_CLS[shopItem.rarity as PetRarity])}>
                          {RARITY_LABEL[shopItem.rarity] ?? shopItem.rarity}
                        </span>
                        {shopItem.trait_id && traitMap[shopItem.trait_id]?.name && (
                          <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-600 font-medium">{traitMap[shopItem.trait_id].name}</span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">⭐ {result.profile.priceStar}</span>
                      </div>
                    </div>
                    {adoptedAt ? (
                      <Button variant="ghost" onClick={onClose} className="w-full">完成</Button>
                    ) : (
                      <div className="space-y-2">
                        {alreadyOwns && (
                          <p className="text-[11px] text-amber-600 text-center">你已拥有同款本命宠，领取将折算等值星光值补偿</p>
                        )}
                        <button
                          onClick={handleAdopt}
                          disabled={adopting}
                          className={cn(
                            'w-full py-2.5 rounded-full text-sm font-medium text-white transition-colors',
                            adopting ? 'bg-slate-300' : 'bg-star-400 hover:bg-star-500 active:bg-star-600'
                          )}
                        >
                          {adopting ? '领取中...' : '免费领养本命宠'}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-6">暂未找到对应的本命宠物，请稍后再试</p>
                )}
              </div>
            </div>

            {!adoptedAt && (
              <button onClick={handleRestart} className="w-full text-xs text-slate-400 py-1">重新测试</button>
            )}
          </>
        ) : (
          <p className="text-center text-sm text-slate-400 py-6">结果计算中...</p>
        )}
      </div>
    </Modal>
  );
}
