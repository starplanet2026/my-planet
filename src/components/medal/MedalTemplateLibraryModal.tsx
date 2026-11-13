import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Copy, Upload } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Card } from '../common/Card';
import { Input, Select } from '../common/Input';
import { EmptyState } from '../common/EmptyState';
import { useToastStore } from '../../store/toastStore';
import { uploadImageToStorage } from '../../lib/storage';
import { parseMedalExcel } from '../../lib/medalExcel';
import {
  listMedalTemplates, createMedalTemplate, updateMedalTemplate, deleteMedalTemplate,
  copyTemplateToFamily, MEDAL_SERIES_LABELS,
  type MedalInput, type MedalSeries, type MedalTemplate,
} from '../../api/medals';

interface Props {
  open: boolean;
  onClose: () => void;
  familyId: string;
  createdBy: string;
  canManage: boolean;
  isSuperAdmin: boolean;
  onCopied: () => void;
}

const SERIES_OPTIONS: MedalSeries[] = ['streak', 'collect', 'daily'];
const SUBCATEGORY_OPTIONS = ['好习惯', '好健康', '好努力', '好成绩'];

const emptyForm = {
  code: '', name: '', series: 'streak' as MedalSeries, threshold: '1', subcategory: '好习惯',
  tier: '', condition_text: '', description: '', icon: '',
  reward_stars: '0', reward_card_name: '', reward_card_count: '1', is_active: true, priority: '0',
};

export function MedalTemplateLibraryModal({ open, onClose, familyId, createdBy, canManage, isSuperAdmin, onCopied }: Props) {
  const toast = useToastStore();
  const [templates, setTemplates] = useState<MedalTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [excelImporting, setExcelImporting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MedalTemplate | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [deleteTarget, setDeleteTarget] = useState<MedalTemplate | null>(null);

  const reload = () => {
    setLoading(true);
    listMedalTemplates()
      .then(setTemplates)
      .catch(e => toast.error(e?.message ?? '模板加载失败'))
      .finally(() => setLoading(false));
  };

  // 打开时加载
  useEffect(() => {
    if (open) reload();
  }, [open]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, priority: String(templates.length + 1) });
    setShowForm(true);
  };

  const openEdit = (t: MedalTemplate) => {
    setEditing(t);
    setForm({
      code: t.code ?? '',
      name: t.name,
      series: t.series,
      threshold: String(t.threshold),
      subcategory: t.subcategory ?? '好习惯',
      tier: t.tier ?? '',
      condition_text: t.condition_text ?? '',
      description: t.description ?? '',
      icon: t.icon ?? '',
      reward_stars: String(t.reward_stars ?? 0),
      reward_card_name: t.reward_card_name ?? '',
      reward_card_count: String(t.reward_card_count ?? 1),
      is_active: t.is_active,
      priority: String(t.priority ?? 0),
    });
    setShowForm(true);
  };

  const handleSave = async () => {
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
      is_active: form.is_active,
      priority: Number(form.priority) || 0,
    };
    setSaving(true);
    try {
      if (editing) {
        await updateMedalTemplate(editing.id, payload);
        toast.success('模板已更新');
      } else {
        await createMedalTemplate(payload);
        toast.success('模板已新增');
      }
      setShowForm(false);
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMedalTemplate(deleteTarget.id);
      toast.success('模板已删除');
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    } finally {
      setDeleteTarget(null);
      reload();
    }
  };

  // 引用 = 复制副本到本家庭勋章库，模板源数据不变
  const handleCopy = async (t: MedalTemplate) => {
    setCopyingId(t.id);
    try {
      await copyTemplateToFamily(familyId, createdBy, t);
      toast.success(`已引用「${t.name}」到我的勋章库`);
      onCopied();
    } catch (e: any) {
      toast.error(e?.message ?? '引用失败（编号可能已存在于个人库）');
    } finally {
      setCopyingId(null);
    }
  };

  const handleImportExcel = async (file: File) => {
    setExcelImporting(true);
    try {
      const { rows, errors } = parseMedalExcel(await file.arrayBuffer());
      if (rows.length === 0) {
        toast.error(errors[0] ?? '未解析到有效勋章，请使用标准勋章清单模板');
        return;
      }
      const existingCodes = new Set(templates.map(t => t.code).filter(Boolean) as string[]);
      let success = 0, skip = 0, failed = 0;
      for (const row of rows) {
        if (row.code && existingCodes.has(row.code)) { skip++; continue; }
        try {
          const { rowNumber, ...payload } = row;
          await createMedalTemplate(payload);
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
      setExcelImporting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="公共勋章模板库" size="lg">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            引用后会复制一份到你的勋章库，可自由修改阈值与奖励，不会改动公共模板
          </p>
          {canManage && (
            <div className="flex items-center gap-2">
              <label className="cursor-pointer">
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImportExcel(f); e.currentTarget.value = ''; }} />
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
                  <Upload className="w-4 h-4" /> {excelImporting ? '导入中…' : 'Excel 批量导入'}
                </span>
              </label>
              <Button size="sm" onClick={openCreate}>
                <Plus className="w-4 h-4" /> 新增模板
              </Button>
            </div>
          )}
        </div>

        {loading && templates.length === 0 ? (
          <EmptyState icon="⏳" title="加载中..." />
        ) : templates.length === 0 ? (
          <EmptyState icon="🏅" title="模板库暂无内容"
            description={isSuperAdmin ? '新增或批量导入勋章模板后所有用户都能引用' : '管理员还没有发布勋章模板'} />
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {templates.map(t => (
              <Card key={t.id} className="p-3">
                <div className="flex items-start gap-3">
                  {t.icon ? (
                    <img src={t.icon} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-2xl flex-shrink-0">🏅</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 truncate">{t.name}</span>
                      {t.code && <span className="text-xs text-slate-400">#{t.code}</span>}
                      {!t.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">已停用</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {MEDAL_SERIES_LABELS[t.series]} · {t.series === 'collect' ? `${t.subcategory ?? ''} ` : ''}
                      {t.series === 'daily' ? `单日≥${t.threshold}条` : t.series === 'streak' ? `连续 ${t.threshold} 天` : `阈值 ${t.threshold}`}
                      {t.tier ? ` · ${t.tier}` : ''}
                    </div>
                    {t.condition_text && <p className="text-xs text-slate-500 mt-0.5">{t.condition_text}</p>}
                    {(t.reward_card_name || t.reward_stars > 0) && (
                      <p className="text-xs text-emerald-500 mt-0.5">
                        奖励：{[t.reward_card_name && `${t.reward_card_name}${t.reward_card_count > 1 ? `×${t.reward_card_count}` : ''}`,
                          t.reward_stars > 0 && `${t.reward_stars} 星光值`].filter(Boolean).join(' + ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="sm" variant="ghost" loading={copyingId === t.id} onClick={() => handleCopy(t)}>
                      <Copy className="w-3.5 h-3.5" /> 引用
                    </Button>
                    {canManage && (
                      <>
                        <button onClick={() => openEdit(t)} className="p-1.5 text-slate-400 hover:text-slate-600">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(t)} className="p-1.5 text-slate-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 新增/编辑模板 */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? '编辑勋章模板' : '新增勋章模板'}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Input label="编号" placeholder="如 01" value={form.code}
              onChange={e => setForm(p => ({ ...p, code: e.target.value }))} />
            <Input label="勋章名称" value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            <Select label="勋章系列" value={form.series}
              onChange={e => setForm(p => ({ ...p, series: e.target.value as MedalSeries }))}>
              {SERIES_OPTIONS.map(s => <option key={s} value={s}>{MEDAL_SERIES_LABELS[s]}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {form.series === 'collect' ? (
              <Select label="成就分类" value={form.subcategory}
                onChange={e => setForm(p => ({ ...p, subcategory: e.target.value }))}>
                {SUBCATEGORY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            ) : (
              <div />
            )}
            <Input label={form.series === 'daily' ? '阈值（当日条数）' : form.series === 'collect' ? '阈值（数量）' : '阈值（连续应打卡天数）'}
              type="number" value={form.threshold}
              onChange={e => setForm(p => ({ ...p, threshold: e.target.value }))} />
            <Input label="档位文案" placeholder="如 7天 / 20枚" value={form.tier}
              onChange={e => setForm(p => ({ ...p, tier: e.target.value }))} />
          </div>
          <Input label="达成条件" placeholder="如 连续7天完成所有应打卡日（未配置的星期自动跳过）" value={form.condition_text}
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
            <Input label="奖励特权卡名称" value={form.reward_card_name}
              onChange={e => setForm(p => ({ ...p, reward_card_name: e.target.value }))} />
            <Input label="特权卡张数" type="number" value={form.reward_card_count}
              onChange={e => setForm(p => ({ ...p, reward_card_count: e.target.value }))} />
          </div>
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
                    const url = await uploadImageToStorage(f, familyId, 'shop');
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

      {/* 删除确认 */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="删除模板">
        <p className="text-sm text-slate-600">确定删除模板「{deleteTarget?.name}」？已引用到家庭库的副本不受影响。</p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button variant="danger" onClick={handleDelete}>删除</Button>
        </div>
      </Modal>
    </Modal>
  );
}
