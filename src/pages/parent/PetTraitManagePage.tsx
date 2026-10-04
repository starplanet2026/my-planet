import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Sparkles } from 'lucide-react';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Textarea } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';
import { EmptyState } from '../../components/common/EmptyState';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { fetchPetTraits, updatePetTrait } from '../../api/pets';
import type { PetTrait } from '../../api/types';

// 单条特质编辑卡片
function TraitCard({ trait, onUpdated }: {
  trait: PetTrait;
  onUpdated: (t: PetTrait) => void;
}) {
  const toast = useToastStore();
  const [name, setName] = useState(trait.name);
  const [hungerInitial, setHungerInitial] = useState(trait.hunger_initial);
  const [cleanInitial, setCleanInitial] = useState(trait.clean_initial);
  const [happinessInitial, setHappinessInitial] = useState(trait.happiness_initial);
  const [expMultiplier, setExpMultiplier] = useState(trait.exp_multiplier);
  const [coinMultiplier, setCoinMultiplier] = useState(trait.coin_multiplier);
  const [sicknessDays, setSicknessDays] = useState(trait.sickness_days);
  const [severeDays, setSevereDays] = useState(trait.severe_days);
  const [shopCardText, setShopCardText] = useState(trait.shop_card_text);
  const [detailText, setDetailText] = useState(trait.detail_text);
  const [saving, setSaving] = useState(false);

  // 切换到不同条目时同步表单初始值
  useEffect(() => {
    setName(trait.name);
    setHungerInitial(trait.hunger_initial);
    setCleanInitial(trait.clean_initial);
    setHappinessInitial(trait.happiness_initial);
    setExpMultiplier(trait.exp_multiplier);
    setCoinMultiplier(trait.coin_multiplier);
    setSicknessDays(trait.sickness_days);
    setSevereDays(trait.severe_days);
    setShopCardText(trait.shop_card_text);
    setDetailText(trait.detail_text);
  }, [trait.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!name.trim()) {
      toast.warning('请输入特质名称');
      return;
    }
    setSaving(true);
    try {
      const patch = {
        name: name.trim(),
        hunger_initial: Number(hungerInitial),
        clean_initial: Number(cleanInitial),
        happiness_initial: Number(happinessInitial),
        exp_multiplier: Number(expMultiplier),
        coin_multiplier: Number(coinMultiplier),
        sickness_days: Number(sicknessDays),
        severe_days: Number(severeDays),
        shop_card_text: shopCardText.trim(),
        detail_text: detailText.trim(),
      };
      // updatePetTrait 是 void 返回（RPC 走 update_pet_trait），用本地拼装的对象回填列表
      await updatePetTrait(trait.id, patch);
      toast.success(`特质「${patch.name}」已保存`);
      onUpdated({ ...trait, ...patch });
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      {/* 头部：序号 + 名称 + 状态徽章 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 text-xs font-bold flex items-center justify-center">
          {trait.id.slice(0, 1).toUpperCase() || '?'}
        </span>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 font-bold"
          placeholder="特质名称"
        />
        <span className={cn(
          'text-[10px] px-2 py-0.5 rounded-full font-medium',
          trait.is_active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
        )}>
          {trait.is_active ? '启用中' : '已停用'}
        </span>
      </div>

      {/* 数值参数：4 列网格 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <FieldNumber label="初始饱腹" value={hungerInitial} onChange={setHungerInitial} min={0} />
        <FieldNumber label="初始清洁" value={cleanInitial} onChange={setCleanInitial} min={0} />
        <FieldNumber label="初始心情" value={happinessInitial} onChange={setHappinessInitial} min={0} />
        <FieldNumber label="经验倍率" value={expMultiplier} onChange={setExpMultiplier} step={0.1} min={0} />
        <FieldNumber label="金币倍率" value={coinMultiplier} onChange={setCoinMultiplier} step={0.1} min={0} />
        <FieldNumber label="轻病天数" value={sicknessDays} onChange={setSicknessDays} min={0} />
        <FieldNumber label="重病天数" value={severeDays} onChange={setSevereDays} min={0} />
      </div>

      {/* 文案：商店卡片 / 详情描述 */}
      <div className="space-y-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">商店卡片文案（shop_card_text）</label>
          <Input
            value={shopCardText}
            onChange={e => setShopCardText(e.target.value)}
            placeholder="如：体力消耗-20%"
            maxLength={50}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">详情文案（detail_text）</label>
          <Textarea
            value={detailText}
            onChange={e => setDetailText(e.target.value)}
            placeholder="详情页展示的特质说明文案"
            rows={2}
            maxLength={200}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving} size="sm">
          <Save className="w-4 h-4" /> 保存
        </Button>
      </div>
    </Card>
  );
}

// 数字输入框 + 标签的复用组件
function FieldNumber({
  label, value, onChange, min, step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <Input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function PetTraitManagePage() {
  const navigate = useNavigate();
  const toast = useToastStore();
  const [traits, setTraits] = useState<PetTrait[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setTraits(await fetchPetTraits());
    } catch (e: any) {
      toast.error(e?.message ?? '加载特质失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdated = (updated: PetTrait) => {
    setTraits(prev => prev.map(t => (t.id === updated.id ? updated : t)));
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* 顶部标题栏 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-purple-500" />
          宠物特质配置
        </h1>
      </div>

      <p className="text-sm text-slate-500 mb-4 leading-relaxed">
        共 {traits.length} 条预置特质。修改后保存即时生效，所有展示端（商店卡片、宠物详情、图鉴、抽卡）将自动读取最新文案。
      </p>

      {loading ? (
        <Loading />
      ) : traits.length === 0 ? (
        <EmptyState
          icon="🌟"
          title="暂无特质配置"
          description="请先在数据库 pet_traits 表中预置 7 条特质"
        />
      ) : (
        <div className="space-y-4">
          {traits.map(t => (
            <TraitCard key={t.id} trait={t} onUpdated={handleUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}
