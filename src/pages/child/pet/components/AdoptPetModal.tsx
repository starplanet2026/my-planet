import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../../../components/common/Modal';
import { Button } from '../../../../components/common/Button';
import { useToastStore } from '../../../../store/toastStore';
import { useFamilyStore } from '../../../../store/familyStore';
import { useModeStore } from '../../../../store/modeStore';
import { cn } from '../../../../lib/utils';
import { ShoppingBag, Heart, Dices, Sparkles } from 'lucide-react';
import { fetchPetShopItems, buyPetItem, checkPet, updatePetInfo, fetchGachaConfig } from '../../../../api/pets';
import { supabase } from '../../../../api/client';
import type { PetShopItem, Pet, GachaConfig } from '../../../../api/types';

// 性格测试题
const QUIZ_QUESTIONS = [
  {
    q: '你最喜欢的活动是？',
    options: [
      { text: '户外运动', trait: 'active' },
      { text: '安静看书', trait: 'calm' },
      { text: '和朋友聚会', trait: 'social' },
      { text: '独自旅行', trait: 'independent' },
    ],
  },
  {
    q: '你理想的周末是？',
    options: [
      { text: '公园散步', trait: 'active' },
      { text: '家里宅着', trait: 'calm' },
      { text: '朋友来家里', trait: 'social' },
      { text: '一个人冒险', trait: 'independent' },
    ],
  },
  {
    q: '你希望宠物是？',
    options: [
      { text: '活力满满', trait: 'active' },
      { text: '安静乖巧', trait: 'calm' },
      { text: '亲人友善', trait: 'social' },
      { text: '独立有个性', trait: 'independent' },
    ],
  },
];

// trait → 推荐描述
const TRAIT_DESC: Record<string, { title: string; desc: string }> = {
  active: { title: '活力型', desc: '适合喜欢运动的你，每天陪你跑步散步！' },
  calm: { title: '安静型', desc: '适合喜欢安静的你，乖巧地陪你看书。' },
  social: { title: '亲人型', desc: '热情友善，来客人也会开心迎接。' },
  independent: { title: '独立型', desc: '有个性不粘人，给你足够空间。' },
};

// 萌宠奇遇记故事场景
const STORIES = [
  {
    title: '下雨的夜晚',
    desc: '窗外下着大雨，你听到微弱的叫声...',
    choices: [
      { text: '出门看看', next: 1 },
      { text: '不管它', next: -1 },
    ],
  },
  {
    title: '路边的小家伙',
    desc: '你发现一只淋湿的小猫蜷缩在纸箱里，它抬起头望着你...',
    choices: [
      { text: '带它回家', next: 2, emoji: '🐱' },
      { text: '太麻烦了', next: -1 },
    ],
  },
  {
    title: '宠物店的奇遇',
    desc: '路过宠物店，一只小狗朝你扑来，摇着尾巴...',
    choices: [
      { text: '领养它', next: 2, emoji: '🐶' },
      { text: '再看看', next: -1 },
    ],
  },
];

type AdoptMode = 'menu' | 'quiz' | 'gacha' | 'story';

// 根据 trait 推荐具体宠物（排除已拥有的）
function recommendPetByTrait(trait: string, items: PetShopItem[], ownedIds?: Set<string>): PetShopItem | null {
  // 问题16: 剔除已拥有的宠物
  const available = ownedIds && ownedIds.size > 0
    ? items.filter(i => !ownedIds.has(i.id))
    : items;
  if (available.length === 0) return null;
  const dogs = available.filter(i => i.subcategory === 'dog');
  const cats = available.filter(i => i.subcategory === 'cat');
  if (trait === 'active' || trait === 'social') {
    return dogs[0] || available[0];
  }
  return cats[0] || available[0];
}

// 星光值不足引导：展示当前余额、所需数额，并提供赚取入口
function InsufficientGuide({
  current,
  needed,
  onGoTasks,
  onGoChallenge,
  onGoPetGame,
}: {
  current: number;
  needed: number;
  onGoTasks: () => void;
  onGoChallenge: () => void;
  onGoPetGame: () => void;
}) {
  return (
    <div className="space-y-2 p-4 rounded-xl bg-red-50 border-2 border-red-200">
      <p className="text-sm font-bold text-red-600 text-center">
        星光值不足，去赚取：
      </p>
      <p className="text-xs text-slate-400 text-center">
        当前 {current} / 需要 {needed}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={onGoTasks}
          className="py-2 px-2 rounded-lg bg-white border border-amber-200 text-amber-700 text-xs font-medium hover:bg-amber-50 transition-colors"
        >
          领取成就
        </button>
        <button
          onClick={onGoChallenge}
          className="py-2 px-2 rounded-lg bg-white border border-purple-200 text-purple-700 text-xs font-medium hover:bg-purple-50 transition-colors"
        >
          智慧星战
        </button>
        <button
          onClick={onGoPetGame}
          className="py-2 px-2 rounded-lg bg-white border border-green-200 text-green-700 text-xs font-medium hover:bg-green-50 transition-colors"
        >
          萌宠闯关
        </button>
      </div>
    </div>
  );
}

export function AdoptPetModal({
  onClose,
  onGoShop,
  onAdopted,
  onGoGame,
}: {
  onClose: () => void;
  onGoShop: () => void;
  onAdopted: () => void;
  onGoGame: () => void;
}) {
  const toast = useToastStore();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? members.find(m => m.role === 'child')?.id ?? '';

  const [mode, setMode] = useState<AdoptMode>('menu');
  const [quizStep, setQuizStep] = useState(0);
  const [traits, setTraits] = useState<string[]>([]);
  const [topTrait, setTopTrait] = useState('');
  const [petItems, setPetItems] = useState<PetShopItem[]>([]);
  const [recommendedPet, setRecommendedPet] = useState<PetShopItem | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [adoptedPet, setAdoptedPet] = useState<Pet | null>(null);
  // 问题16: 已拥有的宠物 shop_item_id 集合
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());

  const [gachaPaid, setGachaPaid] = useState(false);
  const [gachaCfg, setGachaCfg] = useState<GachaConfig | null>(null);
  const [gachaDraws, setGachaDraws] = useState(0);
  const [drawnItem, setDrawnItem] = useState<PetShopItem | null>(null);
  const [gachaResult, setGachaResult] = useState<Pet | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [storyStep, setStoryStep] = useState(0);
  // 问题11: 领养后直接弹起名框，不跳转
  const [namingPet, setNamingPet] = useState<{ petId: string; name: string } | null>(null);
  const [savingName, setSavingName] = useState(false);

  // 加载宠物商品 + 已拥有宠物
  useEffect(() => {
    if (family?.id && (mode === 'quiz' || mode === 'gacha')) {
      fetchPetShopItems('pet', undefined, false).then(items => {
        setPetItems(items);
      }).catch(() => {});
      // 问题16: 查询已拥有的宠物
      if (childId) {
        supabase.from('pets').select('shop_item_id').eq('member_id', childId)
          .then(({ data }) => {
            setOwnedIds(new Set((data ?? []).map((p: any) => p.shop_item_id).filter(Boolean)));
          }).catch(() => {});
      }
    }
  }, [family?.id, mode, childId]);

  // 组件挂载即加载抽卡配置（领养扣费/放弃扣费），避免进入抽卡后才异步加载导致短暂显示默认值
  useEffect(() => {
    if (!gachaCfg) {
      fetchGachaConfig().then(setGachaCfg).catch(() => {});
    }
  }, [gachaCfg]);

  const navigate = useNavigate();
  // 当前孩子的星光值
  const starValue = members.find(m => m.id === childId)?.star_value ?? 0;
  // 抽卡参数（从后台配置读取，未加载完成用默认值兜底）
  const adoptCost = gachaCfg?.adopt_cost ?? 150;
  const cancelPenalty = gachaCfg?.cancel_penalty ?? 45;
  // 星光值不足信息（RPC 返回不足错误时设置）
  const [insufficientInfo, setInsufficientInfo] = useState<{ current: number; needed: number } | null>(null);

  // 切换模式 / 星光值变化时清空不足提示，避免残留旧状态
  useEffect(() => {
    setInsufficientInfo(null);
  }, [mode, starValue]);

  // 检测 RPC 返回的"星光值不足"错误
  const isInsufficientError = (msg: string | null | undefined): boolean => {
    if (!msg) return false;
    const lower = msg.toLowerCase();
    return (
      msg.includes('不足') ||
      msg.includes('余额') ||
      msg.includes('不够') ||
      lower.includes('insufficient') ||
      lower.includes('balance') ||
      lower.includes('not enough')
    );
  };

  // 关闭弹窗并跳转到赚取星光值的页面
  const goEarnStars = (path: string) => {
    onClose();
    navigate(path);
  };

  // 抽卡：开始（不扣星光，只抽一个未拥有的宠物）
  const handleGachaStart = async () => {
    if (!childId) return;
    setDrawing(true);
    try {
      const { data, error } = await supabase.rpc('gacha_start', { p_member_id: childId });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        if (isInsufficientError(result?.message)) {
          setInsufficientInfo({ current: starValue, needed: adoptCost });
        } else {
          toast.error(result?.message || '抽卡失败');
        }
        return;
      }
      // 问题9: 抽卡开始不扣星光
      setGachaPaid(true);
      refreshMembers();
      // 用 RPC 返回的宠物信息设置 drawnItem
      setDrawnItem({
        id: result.drawn_item_id,
        name: result.drawn_item_name,
        emoji: result.drawn_item_emoji,
        image_url: result.drawn_item_image,
        type: 'pet',
        subcategory: 'dog',
        price_star: adoptCost,
        price_coin: 0,
        status: 'active',
        rarity: 'common',
      } as PetShopItem);
      setGachaDraws(1);
    } catch (e: any) {
      if (isInsufficientError(e?.message)) {
        setInsufficientInfo({ current: starValue, needed: adoptCost });
      } else {
        toast.error(e?.message ?? '抽卡失败');
      }
    } finally {
      setDrawing(false);
    }
  };

  // 抽卡：再抽一次（调用 gacha_start RPC，不扣星光）
  const handleGachaDraw = async () => {
    if (!childId) return;
    setDrawing(true);
    try {
      const { data, error } = await supabase.rpc('gacha_start', { p_member_id: childId });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        toast.error(result?.message || '抽取失败');
        return;
      }
      setDrawnItem({
        id: result.drawn_item_id,
        name: result.drawn_item_name,
        emoji: result.drawn_item_emoji,
        image_url: result.drawn_item_image,
        type: 'pet',
        subcategory: 'dog',
        price_star: adoptCost,
        price_coin: 0,
        status: 'active',
        rarity: 'common',
      } as PetShopItem);
      setGachaDraws(prev => prev + 1);
    } catch (e: any) {
      toast.error(e?.message ?? '抽取失败');
    } finally {
      setDrawing(false);
    }
  };

  // 抽卡：领养抽中的宠物（扣 adoptCost 星光值，从配置读取）
  const handleGachaAdopt = async () => {
    if (!childId || !drawnItem) return;
    setAdopting(true);
    try {
      const { data, error } = await supabase.rpc('gacha_adopt', {
        p_member_id: childId,
        p_shop_item_id: drawnItem.id,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        if (isInsufficientError(result?.message)) {
          setInsufficientInfo({ current: starValue, needed: adoptCost });
        } else if (result?.message?.includes('小屋') || result?.message?.includes('狗屋') || result?.message?.includes('住所') || result?.message?.includes('饲养位')) {
          toast.error(result.message);
        } else {
          toast.error(result?.message || '领养失败');
        }
        return;
      }
      toast.success(`领养成功！扣除${adoptCost}星光值`);
      refreshMembers();
      // 问题11: 直接弹起名框，不跳转
      if (result?.pet_id) {
        setNamingPet({ petId: result.pet_id, name: '' });
      }
      onAdopted();
    } catch (e: any) {
      if (isInsufficientError(e?.message)) {
        setInsufficientInfo({ current: starValue, needed: adoptCost });
      } else if (e?.message?.includes('小屋') || e?.message?.includes('狗屋') || e?.message?.includes('住所')) {
        toast.error(e.message);
      } else {
        toast.error(e?.message ?? '领养失败');
      }
    } finally {
      setAdopting(false);
    }
  };

  // 抽卡：放弃（扣 cancelPenalty 星光值，从配置读取）
  const handleGachaCancel = async () => {
    if (!childId) return;
    try {
      const { data, error } = await supabase.rpc('gacha_cancel', { p_member_id: childId });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.success) {
        toast.info(`已放弃，扣除${cancelPenalty}星光值`);
        refreshMembers();
      }
    } catch (e: any) {
      toast.error(e?.message ?? '放弃失败');
    } finally {
      onClose();
    }
  };

  // 问题9: 关闭弹窗时，如果已抽卡但未领养，按放弃处理
  const handleClose = () => {
    if (gachaPaid && drawnItem && !namingPet && !gachaResult) {
      handleGachaCancel();
    } else {
      onClose();
    }
  };

  // 问题11: 保存宠物名字
  const handleSaveName = async () => {
    if (!namingPet || !namingPet.name.trim()) return;
    setSavingName(true);
    try {
      await updatePetInfo(namingPet.petId, childId, namingPet.name.trim(), null);
      toast.success('命名成功！好好照顾它吧');
      const pet = await checkPet(namingPet.petId);
      setGachaResult(pet);
      setAdoptedPet(pet);
      setNamingPet(null);
      refreshMembers();
      onAdopted();
    } catch (e: any) {
      toast.error(e?.message ?? '命名失败');
    } finally {
      setSavingName(false);
    }
  };

  // 领养推荐的宠物
  const handleAdoptRecommended = async () => {
    if (!recommendedPet) return;
    setAdopting(true);
    try {
      const result = await buyPetItem(recommendedPet.id, childId);
      if (!result.success) {
        if (isInsufficientError(result.message)) {
          setInsufficientInfo({ current: starValue, needed: recommendedPet.price_star });
        } else if (result.message?.includes('小屋') || result.message?.includes('狗屋') || result.message?.includes('住所') || result.message?.includes('饲养位')) {
          toast.error(result.message);
        } else {
          toast.error(result.message || '领养失败');
        }
        return;
      }
      toast.success('领养成功！');
      refreshMembers();
      // 问题11: 直接弹起名框，不跳转
      if (result.pet_id) {
        setNamingPet({ petId: result.pet_id, name: '' });
      }
      onAdopted();
    } catch (e: any) {
      if (isInsufficientError(e?.message)) {
        setInsufficientInfo({ current: starValue, needed: recommendedPet.price_star });
      } else {
        toast.error(e?.message ?? '领养失败');
      }
    } finally {
      setAdopting(false);
    }
  };

  // 性格测试完成
  const finishQuiz = (allTraits: string[]) => {
    const traitCount: Record<string, number> = {};
    allTraits.forEach(t => traitCount[t] = (traitCount[t] || 0) + 1);
    const top = Object.entries(traitCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'active';
    setTopTrait(top);
    // 问题16: 传入 ownedIds 排除已拥有
    const pet = recommendPetByTrait(top, petItems, ownedIds);
    setRecommendedPet(pet);
  };

  // 选项菜单
  if (mode === 'menu') {
    const options = [
      { id: 'shop' as const, icon: <ShoppingBag className="w-6 h-6" />, label: '商城选购', desc: '直接去商城挑选喜欢的宠物', color: 'from-blue-400 to-cyan-500' },
      { id: 'quiz' as const, icon: <Heart className="w-6 h-6" />, label: '性格测试', desc: '答题测出最适合你的宠物', color: 'from-pink-400 to-rose-500' },
      { id: 'gacha' as const, icon: <Dices className="w-6 h-6" />, label: '抽卡', desc: `花${adoptCost}星光值，最多可抽取三次`, color: 'from-amber-400 to-orange-500' },
      { id: 'story' as const, icon: <Sparkles className="w-6 h-6" />, label: '萌宠奇遇记', desc: '在故事中与宠物相遇', color: 'from-purple-400 to-indigo-500' },
    ];
    return (
      <Modal open onClose={onClose} title="你想通过哪种方式获得你的宠物？" size="md">
        <div className="grid grid-cols-2 gap-3">
          {options.map(opt => (
            <button
              key={opt.id}
              onClick={() => opt.id === 'shop' ? onGoShop() : setMode(opt.id)}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-slate-50 hover:bg-white hover:shadow-md border border-slate-100 transition-all active:scale-95"
            >
              <div className={cn('flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br text-white shadow-sm', opt.color)}>
                {opt.icon}
              </div>
              <p className="font-bold text-slate-700 text-sm">{opt.label}</p>
              <p className="text-[11px] text-slate-400 text-center leading-tight">{opt.desc}</p>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  // 性格测试
  if (mode === 'quiz') {
    if (quizStep < QUIZ_QUESTIONS.length) {
      const q = QUIZ_QUESTIONS[quizStep];
      return (
        <Modal open onClose={onClose} title="性格测试" size="md">
          <div className="space-y-4">
            <div className="text-center">
              <span className="text-xs text-slate-400">第 {quizStep + 1} / {QUIZ_QUESTIONS.length} 题</span>
            </div>
            <h3 className="text-lg font-bold text-slate-700 text-center">{q.q}</h3>
            <div className="space-y-2">
              {q.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const newTraits = [...traits, opt.trait];
                    setTraits(newTraits);
                    if (quizStep + 1 >= QUIZ_QUESTIONS.length) {
                      setQuizStep(quizStep + 1);
                      finishQuiz(newTraits);
                    } else {
                      setQuizStep(quizStep + 1);
                    }
                  }}
                  className="w-full p-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm font-medium transition-colors"
                >
                  {opt.text}
                </button>
              ))}
            </div>
          </div>
        </Modal>
      );
    }
    // 测试结果
    const result = TRAIT_DESC[topTrait] || TRAIT_DESC.active;
    return (
      <Modal open onClose={onClose} title="测试结果" size="md">
        <div className="space-y-4 py-2">
          <div className="text-center">
            <p className="text-lg font-bold text-slate-700">推荐类型：{result.title}</p>
            <p className="text-sm text-slate-500 mt-1">{result.desc}</p>
          </div>

          {/* 问题11: 起名弹框 */}
          {namingPet ? (
            <div className="space-y-3 py-4">
              <p className="text-sm text-slate-500 text-center">领养成功！给它取个名字吧</p>
              {recommendedPet?.image_url ? (
                <img src={recommendedPet.image_url} alt="" className="w-28 h-36 mx-auto object-contain" />
              ) : (
                <div className="text-6xl text-center">{recommendedPet?.emoji || '🐾'}</div>
              )}
              <input
                value={namingPet.name}
                onChange={e => setNamingPet({ ...namingPet, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-green-300 text-sm text-center"
                placeholder="给它取个名字"
                maxLength={10}
                autoFocus
              />
              <Button onClick={handleSaveName} disabled={savingName || !namingPet.name.trim()} className="w-full">
                {savingName ? '保存中...' : '确认命名'}
              </Button>
            </div>
          ) : adoptedPet ? (
            // 命名完成
            <div className="text-center space-y-3 py-4">
              <p className="text-sm text-slate-500">领养成功！</p>
              {adoptedPet.image_url ? (
                <img src={adoptedPet.image_url} alt="" className="w-32 h-40 mx-auto object-contain" />
              ) : (
                <div className="text-6xl">{adoptedPet.emoji || '🐾'}</div>
              )}
              <p className="font-bold text-slate-700">{adoptedPet.name}</p>
              <Button variant="ghost" onClick={onClose} className="w-full">完成</Button>
            </div>
          ) : recommendedPet ? (
            // 推荐宠物
            <div className="space-y-3">
              <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                {recommendedPet.image_url ? (
                  <img src={recommendedPet.image_url} alt="" className="w-28 h-36 object-contain" />
                ) : (
                  <div className="text-6xl">{recommendedPet.emoji || '🐾'}</div>
                )}
                <p className="font-bold text-slate-700">{recommendedPet.name}</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium">
                    💰 {recommendedPet.base_coin_per_day || 0}/天
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">
                    {recommendedPet.price_star} 星光值
                  </span>
                </div>
              </div>
              {(insufficientInfo || starValue < recommendedPet.price_star) && (
                <InsufficientGuide
                  current={insufficientInfo?.current ?? starValue}
                  needed={insufficientInfo?.needed ?? recommendedPet.price_star}
                  onGoTasks={() => goEarnStars('/tasks')}
                  onGoChallenge={() => goEarnStars('/challenge')}
                  onGoPetGame={onGoGame}
                />
              )}
              <Button onClick={handleAdoptRecommended} disabled={adopting} className="w-full">
                {adopting ? '领养中...' : '立即领养'}
              </Button>
              <button onClick={() => onGoShop()} className="w-full text-xs text-slate-400">
                去商城看看其他宠物
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-slate-400 py-4">暂无可领养的宠物</p>
          )}
          <button onClick={() => { setMode('menu'); setQuizStep(0); setTraits([]); setAdoptedPet(null); }} className="text-xs text-slate-400 w-full text-center">
            返回菜单
          </button>
        </div>
      </Modal>
    );
  }

  // 抽卡：开始不扣，领养扣 adoptCost，放弃扣 cancelPenalty（均从配置读取）
  if (mode === 'gacha') {
    return (
      <Modal open onClose={handleClose} title="抽卡" size="md">
        <div className="space-y-4 py-2">
          {!gachaPaid ? (
            // 抽卡入口
            <div className="text-center space-y-4 py-4">
              <div className="text-8xl">🎁</div>
              <div>
                <p className="text-lg font-bold text-slate-700">宠物抽卡</p>
                <p className="text-sm text-slate-500 mt-1">
                  {`领养扣${adoptCost}星光值，最多可抽取三次`}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {`放弃扣${cancelPenalty}星光值（原价30%）`}
                </p>
              </div>
              {(insufficientInfo || starValue < adoptCost) && (
                <InsufficientGuide
                  current={insufficientInfo?.current ?? starValue}
                  needed={insufficientInfo?.needed ?? adoptCost}
                  onGoTasks={() => goEarnStars('/tasks')}
                  onGoChallenge={() => goEarnStars('/challenge')}
                  onGoPetGame={onGoGame}
                />
              )}
              <Button onClick={handleGachaStart} disabled={drawing} className="w-full">
                {drawing ? '抽取中...' : '开始抽卡'}
              </Button>
              <button onClick={() => setMode('menu')} className="text-xs text-slate-400">
                返回菜单
              </button>
            </div>
          ) : namingPet ? (
            // 问题11: 起名弹框
            <div className="space-y-3 py-4">
              <p className="text-sm text-slate-500 text-center">{`领养成功！扣除${adoptCost}星光值`}</p>
              {drawnItem?.image_url ? (
                <img src={drawnItem.image_url} alt="" className="w-28 h-36 mx-auto object-contain" />
              ) : (
                <div className="text-6xl text-center">{drawnItem?.emoji || '🐾'}</div>
              )}
              <input
                value={namingPet.name}
                onChange={e => setNamingPet({ ...namingPet, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-green-300 text-sm text-center"
                placeholder="给它取个名字"
                maxLength={10}
                autoFocus
              />
              <Button onClick={handleSaveName} disabled={savingName || !namingPet.name.trim()} className="w-full">
                {savingName ? '保存中...' : '确认命名'}
              </Button>
            </div>
          ) : gachaResult ? (
            // 命名完成结果
            <div className="text-center space-y-3 py-4">
              <p className="text-sm text-slate-500">领养成功！</p>
              {gachaResult.image_url ? (
                <img src={gachaResult.image_url} alt="" className="w-32 h-40 mx-auto object-contain" />
              ) : (
                <div className="text-6xl">{gachaResult.emoji || '🐾'}</div>
              )}
              <p className="font-bold text-slate-700">{gachaResult.name}</p>
              <Button variant="ghost" onClick={onClose} className="w-full">完成</Button>
            </div>
          ) : drawing ? (
            // 抽取中
            <div className="text-center space-y-4 py-8">
              <div className="text-6xl animate-pulse">🎁</div>
              <p className="text-sm text-slate-500">抽取中...</p>
            </div>
          ) : drawnItem ? (
            // 展示抽中的宠物
            <div className="space-y-4">
              <p className="text-center text-sm font-bold text-slate-700">
                第 {gachaDraws} 次抽取（共 3 次）
              </p>
              {gachaDraws >= 3 && (
                <p className="text-center text-xs text-amber-500">已抽完 3 次</p>
              )}
              <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                {drawnItem.image_url ? (
                  <img src={drawnItem.image_url} alt="" className="w-32 h-40 object-contain" />
                ) : (
                  <div className="text-6xl">{drawnItem.emoji || '🐾'}</div>
                )}
                <p className="font-bold text-slate-700">{drawnItem.name}</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium">
                    💰 {drawnItem.base_coin_per_day || 0}/天
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">
                    {drawnItem.rarity}
                  </span>
                </div>
              </div>
              {insufficientInfo && (
                <InsufficientGuide
                  current={insufficientInfo.current}
                  needed={insufficientInfo.needed}
                  onGoTasks={() => goEarnStars('/tasks')}
                  onGoChallenge={() => goEarnStars('/challenge')}
                  onGoPetGame={onGoGame}
                />
              )}
              <div className="flex gap-2">
                <Button onClick={handleGachaAdopt} disabled={adopting} className="flex-1">
                  {adopting ? '领养中...' : `领养它（扣${adoptCost}⭐）`}
                </Button>
                {gachaDraws < 3 ? (
                  <Button variant="ghost" onClick={handleGachaDraw} disabled={drawing} className="flex-1">
                    再抽一次
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={handleGachaCancel} className="flex-1">
                    {`放弃（扣${cancelPenalty}⭐）`}
                  </Button>
                )}
              </div>
              <button onClick={() => setMode('menu')} className="text-xs text-slate-400 w-full text-center">
                返回菜单
              </button>
            </div>
          ) : (
            <div className="text-center py-4">
              <button onClick={() => setMode('menu')} className="text-xs text-slate-400">
                返回菜单
              </button>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  // 萌宠奇遇记：iframe 加载 H5 剧情
  if (mode === 'story') {
    return <EncounterGameModal onClose={onClose} onGoShop={onGoShop} onBack={() => setMode('menu')} toast={toast} />;
  }

  return null;
}

// ====== 萌宠奇遇记：H5 iframe 集成 ======
function EncounterGameModal({
  onClose, onGoShop, onBack, toast,
}: {
  onClose: () => void;
  onGoShop: () => void;
  onBack: () => void;
  toast: ReturnType<typeof useToastStore>;
}) {
  const [adoptResult, setAdoptResult] = useState<{ name: string; emoji: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'encounter_adopt') {
        setAdoptResult({ name: e.data.name, emoji: e.data.emoji || '🐶' });
        toast.success(`奇遇了一只${e.data.name}！去商城领养吧`);
      } else if (e.data?.type === 'encounter_skip') {
        // 用户选择"再想想"，不做额外操作
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [toast]);

  // 领养成功后的结果页
  if (adoptResult) {
    return (
      <Modal open onClose={onClose} title="萌宠奇遇记" size="md">
        <div className="text-center space-y-4 py-4">
          <div className="text-5xl">{adoptResult.emoji}</div>
          <p className="text-sm text-slate-500">
            你遇见了 <span className="font-bold text-amber-600">{adoptResult.name}</span>！
            <br />去商城领养它吧～
          </p>
          <Button onClick={() => onGoShop()} className="w-full">去商城领养</Button>
          <button onClick={() => { setAdoptResult(null); onBack(); }} className="text-xs text-slate-400">
            返回菜单
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="萌宠奇遇记" size="md">
      <div className="relative">
        <iframe
          ref={iframeRef}
          src={`${import.meta.env.BASE_URL}encounter-game.html`}
          title="萌宠奇遇记"
          className="w-full h-[560px] rounded-xl border-0"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </Modal>
  );
}
