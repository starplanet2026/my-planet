import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, Upload, Download, Award, Library, ArrowLeft } from 'lucide-react';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { MedalTemplateLibraryModal } from '../../components/medal/MedalTemplateLibraryModal';
import { useFamilyStore } from '../../store/familyStore';
import { ROUTES } from '../../lib/constants';
import { supabase } from '../../api/client';
import { useAppContextStore } from '../../store/appContextStore';
import { useToastStore } from '../../store/toastStore';
import { uploadImageToStorage } from '../../lib/storage';
import { parseMedalExcel, exportMedalsExcel } from '../../lib/medalExcel';
import {
  listFamilyMedals, createMedal, updateMedal, deleteMedal, MEDAL_SERIES_LABELS,
  type Medal, type MedalInput, type MedalSeries,
} from '../../api/medals';

const SUBCATEGORIES = ['好习惯', '好健康', '好努力', '好成绩'];

const emptyForm = {
  code: '', name: '', series: 'streak' as MedalSeries, threshold: '1', subcategory: '好习惯',
  tier: '', condition_text: '', description: '', icon: '',
  reward_stars: '0', reward_card_name: '', reward_card_count: '1', reward_item_id: '',
  is_active: true, priority: '0',
};

export function MedalManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const toast = useToastStore();
  const isSuperAdmin = useAppContextStore(s => s.isSuperAdmin);
  const parentMember = members.find(m => m.role === 'parent');

  const [medals, setMedals] = useState<Medal[]>([]);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTemplateLib, setShowTemplateLib] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Medal | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Medal | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    if (!family) return;
    setLoading(true);
    listFamilyMedals(family.id)
      .then(setMedals)
      .catch(e => toast.error(e?.message ?? '勋章库加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, [family?.id]);

  useEffect(() => {
    if (!family?.id) return;
    supabaseItems(family.id).then(setItems).catch(() => setItems([]));
  }, [family?.id]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, priority: String(medals.length + 1) });
    setShowForm(true);
  };

  const openEdit = (m: Medal) => {
    setEditing(m);
    setForm({
      code: m.code ?? '',
      name: m.name,
      series: m.series,
      threshold: String(m.threshold),
      subcategory: m.subcategory ?? '好习惯',
      tier: m.tier ?? '',
      condition_text: m.condition_text ?? '',
      description: m.description ?? '',
      icon: m.icon ?? '',
      reward_stars: String(m.reward_stars ?? 0),
      reward_card_name: m.reward_card_name ?? '',
      reward_card_count: String(m.reward_card_count ?? 1),
      reward_item_id: m.reward_item_id ?? '',
      is_active: m.is_active,
      priority: String(m.priority ?? 0),
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!family || !parentMember) { toast.error('家庭信息缺失'); return; }
    if (!form.name.trim()) { toast.error('请填写勋章名称'); return; }
    const threshold = Number(form.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) { toast.error('阈值必须为大于 0 的数字'); return; }
    const payload: MedalInput = {
      code: form.code.trim() || null,
      name: form.name.trim(),
      series: form.series,
      threshold,
      subcategory: form.series === 'collect' ? (form.subcategory.trim() || null) : null,
      tier: form.tier.trim() || null,
      condition_text: form.condition_text.trim() || null,
      description: form.description.trim() || null,
      icon: form.icon || null,
      reward_stars: Number(form.reward_stars) || 0,
      reward_card_name: form.reward_card_name.trim() || null,
      reward_card_count: Number(form.reward_card_count) || 0,
      reward_item_id: form.reward_item_id || null,
      is_active: form.is_active,
      priority: Number(form.priority) || 0,
    };
    setSaving(true);
    try {
      if (editing) {
        await updateMedal(editing.id, payload);
        toast.success('勋章已更新');
      } else {
        await createMedal(family.id, parentMember.id, payload);
        toast.success('勋章已新增');
      }
      setShowForm(false);
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: Medal) => {
    try {
      await updateMedal(m.id, { is_active: !m.is_active });
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMedal(deleteTarget.id);
      toast.success('勋章已删除');
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    } finally {
      setDeleteTarget(null);
      reload();
    }
  };

  const handleImportExcel = async (file: File) => {
    if (!family || !parentMember) return;
    setImporting(true);
    try {
      const { rows, errors } = parseMedalExcel(await file.arrayBuffer());
      if (rows.length === 0) {
        toast.error(errors[0] ?? '未解析到有效勋章，请使用标准勋章清单模板');
        return;
      }
      const existingCodes = new Set(medals.map(m => m.code).filter(Boolean) as string[]);
      let success = 0, skip = 0, failed = 0;
      for (const row of rows) {
        if (row.code && existingCodes.has(row.code)) { skip++; continue; }
        try {
          const { rowNumber, ...payload } = row;
          await createMedal(family.id, parentMember.id, payload);
          success++;
        } catch { failed++; }
      }
      reload();
      const parts = [`新增 ${success}`];
      if (skip) parts.push(`编号重复跳过 ${skip}`);
      if (failed) parts.push(`失败 ${failed}`);
      toast.success(`导入完成：${parts.join('，')}`);
      if (errors.length > 0) toast.error(errors.slice(0, 3).join('；'));
    } catch (e: any) {
      toast.error(e?.message ?? 'Excel 解析失败');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleExport = () => {
    if (medals.length === 0) { toast.error('勋章库为空，无需导出'); return; }
    const blob = exportMedalsExcel(medals);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `我的勋章库_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!family) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(ROUTES.PARENT_DASHBOARD)}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            title="返回家长工作台"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-500" /> 我的勋章库
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">勋章满足条件自动发放给孩子；停用后不再发放，已获得的保留</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImportExcel(f); }} />
          <Button size="sm" variant="ghost" loading={importing} onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> 导入
          </Button>
          <Button size="sm" variant="ghost" onClick={handleExport}>
            <Download className="w-4 h-4" /> 导出
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowTemplateLib(true)}>
            <Library className="w-4 h-4" /> 公共模板库
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4" /> 新增勋章
          </Button>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : medals.length === 0 ? (
        <EmptyState icon="🏅" title="勋章库暂无内容" description="新增勋章或从公共模板库引用" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {medals.map(m => (
            <Card key={m.id} className={`p-3 ${m.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-3">
                {m.icon ? (
                  <img src={m.icon} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-2xl flex-shrink-0">🏅</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-800 truncate">{m.name}</span>
                    {m.code && <span className="text-xs text-slate-400">#{m.code}</span>}
                    {!m.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">已停用</span>}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {MEDAL_SERIES_LABELS[m.series]}
                    {m.series === 'collect' && m.subcategory ? ` · ${m.subcategory}` : ''}
                    {' · '}
                    {m.series === 'daily' ? `单日≥${m.threshold}条` : m.series === 'streak' ? `连续 ${m.threshold} 个周期` : `阈值 ${m.threshold}`}
                  </div>
                  {(m.reward_card_name || m.reward_stars > 0) && (
                    <div className="text-xs text-emerald-500 mt-0.5">
                      奖励：{[m.reward_card_name && `${m.reward_card_name}${m.reward_card_count > 1 ? `×${m.reward_card_count}` : ''}`,
                        m.reward_stars > 0 && `${m.reward_stars} 星光值`].filter(Boolean).join(' + ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(m)} className="p-1 text-slate-400 hover:text-slate-600">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteTarget(m)} className="p-1 text-slate-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => toggleActive(m)}
                    className={`text-[10px] px-1.5 py-0.5 rounded ${m.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {m.is_active ? '已启用' : '已停用'}
                  </button>
                </div>
              </div>
              {m.condition_text && <p className="text-xs text-slate-400 mt-2 line-clamp-2">{m.condition_text}</p>}
            </Card>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? '编辑勋章' : '新增勋章'}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Input label="编号" placeholder="如 01" value={form.code}
              onChange={e => setForm(p => ({ ...p, code: e.target.value }))} />
            <Input label="勋章名称" value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <Select label="勋章系列" value={form.series}
              onChange={e => setForm(p => ({ ...p, series: e.target.value as MedalSeries }))}>
              {(Object.keys(MEDAL_SERIES_LABELS) as MedalSeries[]).map(s =>
                <option key={s} value={s}>{MEDAL_SERIES_LABELS[s]}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {form.series === 'collect' ? (
              <Select label="成就分类" value={form.subcategory}
                onChange={e => setForm(p => ({ ...p, subcategory: e.target.value }))}>
                {SUBCATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            ) : <div />}
            <Input label={form.series === 'daily' ? '阈值（当日条数）' : form.series === 'collect' ? '阈值（数量）' : '阈值（连续周期数）'}
              type="number" value={form.threshold}
              onChange={e => setForm(p => ({ ...p, threshold: e.target.value }))} />
            <Input label="档位文案" value={form.tier}
              onChange={e => setForm(p => ({ ...p, tier: e.target.value }))} />
          </div>
          <Input label="达成条件" placeholder="如 按任务配置的打卡周期，1个完整周期内应打卡日全部完成" value={form.condition_text}
            onChange={e => setForm(p => ({ ...p, condition_text: e.target.value }))} />
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">勋章简介</label>
            <textarea rows={2} value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-star-400" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="奖励星光值" type="number" value={form.reward_stars}
              onChange={e => setForm(p => ({ ...p, reward_stars: e.target.value }))} />
            <Select label="绑定特权卡（可选）" value={form.reward_item_id}
              onChange={e => {
                const item = items.find(i => i.id === e.target.value);
                setForm(p => ({ ...p, reward_item_id: e.target.value, reward_card_name: item?.name ?? p.reward_card_name }));
              }}>
              <option value="">不绑定</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
            <Input label="特权卡张数" type="number" value={form.reward_card_count}
              onChange={e => setForm(p => ({ ...p, reward_card_count: e.target.value }))} />
          </div>
          <Input label="奖励特权卡名称（文案）" value={form.reward_card_name}
            onChange={e => setForm(p => ({ ...p, reward_card_name: e.target.value }))} />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} /> 启用
            </label>
            <label className="cursor-pointer text-sm text-slate-500">
              <input type="file" accept="image/*" className="hidden"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const url = await uploadImageToStorage(f, family.id, 'shop');
                    setForm(p => ({ ...p, icon: url }));
                  } catch { toast.error('图标上传失败'); }
                  e.currentTarget.value = '';
                }} />
              <span className="inline-flex items-center gap-1"><Upload className="w-4 h-4" /> 上传图标（可空，默认 🏅）</span>
            </label>
          </div>
          {form.icon && (
            <div className="flex items-center gap-2">
              <img src={form.icon} alt="" className="w-10 h-10 rounded-full object-cover" />
              <button onClick={() => setForm(p => ({ ...p, icon: '' }))} className="text-xs text-slate-400">移除图标</button>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
            <Button loading={saving} onClick={handleSave}>保存</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="删除勋章">
        <p className="text-sm text-slate-600">确定删除「{deleteTarget?.name}」？已发放给孩子的勋章记录会一并移除。</p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button variant="danger" onClick={handleDelete}>删除</Button>
        </div>
      </Modal>

      {family && parentMember && (
        <MedalTemplateLibraryModal
          open={showTemplateLib}
          onClose={() => setShowTemplateLib(false)}
          familyId={family.id}
          createdBy={parentMember.id}
          canManage={isSuperAdmin}
          isSuperAdmin={isSuperAdmin}
          onCopied={reload}
        />
      )}
    </div>
  );
}

async function supabaseItems(familyId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('items')
    .select('id,name')
    .eq('family_id', familyId)
    .eq('status', 'active');
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}
