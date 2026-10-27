import { useEffect, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input, Textarea } from '../common/Input';
import { Card } from '../common/Card';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useToastStore } from '../../store/toastStore';
import { useAppContextStore } from '../../store/appContextStore';
import { TASK_ICONS, getTaskIconUrl, getCategoryMeta } from '../../lib/constants';
import { createTask } from '../../api/tasks';
import { createItem } from '../../api/items';
import { uploadImageToStorage } from '../../lib/storage';
import {
  listAchievementTemplates, createAchievementTemplate, updateAchievementTemplate,
  deleteAchievementTemplate, type AchievementTemplate,
} from '../../api/templates';
import {
  listPrivilegeTemplates, createPrivilegeTemplate, updatePrivilegeTemplate,
  deletePrivilegeTemplate, type PrivilegeTemplate,
} from '../../api/templates';
import { Plus, Edit2, Trash2, Copy, Upload, X } from 'lucide-react';
import type { TaskCategory, TaskCategoryItem } from '../../api/types';

// 公共模板库只对「超级管理员」或「已应用全局」的用户开放，入口处已做判断，此处再加一层兜底
function useCanUseTemplateLibrary() {
  return useAppContextStore(s => s.isSuperAdmin || s.features.template_library === true);
}

// ============================================================
// 成就卡公共模板库
// ============================================================
export function AchievementTemplateModal({
  open, onClose, familyId, createdBy, targetMemberId, categories, onCopied,
}: {
  open: boolean;
  onClose: () => void;
  familyId: string;
  createdBy: string;
  targetMemberId: string | null;
  categories: TaskCategoryItem[];
  onCopied: () => void;
}) {
  const toast = useToastStore();
  const isSuperAdmin = useAppContextStore(s => s.isSuperAdmin);
  const canUse = useCanUseTemplateLibrary();
  const fileRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<AchievementTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AchievementTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AchievementTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: '', description: '', category: 'daily', reward_coins: '1', icon: '', priority: '0',
  });

  const reload = () => {
    if (!canUse) { setTemplates([]); return; }
    setLoading(true);
    listAchievementTemplates()
      .then(setTemplates)
      .catch(e => toast.error(e?.message ?? '模板加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (open) reload(); }, [open, canUse]);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', description: '', category: 'daily', reward_coins: '1', icon: '', priority: '0' });
    setShowForm(true);
  };

  const openEdit = (t: AchievementTemplate) => {
    setEditing(t);
    setForm({
      title: t.title,
      description: t.description ?? '',
      category: t.category,
      reward_coins: String(t.reward_coins),
      icon: t.icon ?? '',
      priority: String(t.priority ?? 0),
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('请输入成就标题'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        reward_coins: Number(form.reward_coins) || 0,
        icon: form.icon.trim() || null,
        priority: Number(form.priority) || 0,
      };
      if (editing) {
        await updateAchievementTemplate(editing.id, payload);
        toast.success('模板已更新');
      } else {
        await createAchievementTemplate(payload);
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
      await deleteAchievementTemplate(deleteTarget.id);
      toast.success('模板已删除');
      setDeleteTarget(null);
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  // 调取 = 复制一份到自己的成就库（独立副本，后续编辑不影响模板）
  const handleCopy = async (t: AchievementTemplate) => {
    if (!familyId) return;
    setCopyingId(t.id);
    try {
      const validKeys = new Set<string>(['daily', 'stage', 'super', 'black', ...categories.map(c => c.key)]);
      const category = (validKeys.has(t.category) ? t.category : 'daily') as TaskCategory;
      await createTask({
        family_id: familyId,
        member_id: targetMemberId,
        title: t.title,
        description: t.description,
        category,
        reward_coins: t.reward_coins,
        deadline: null,
        created_by: createdBy,
        icon: t.icon ?? null,
        repeat_days: t.repeat_days ?? [],
      });
      toast.success(`已复制「${t.title}」到我的成就库`);
      onCopied();
    } catch (e: any) {
      toast.error(e?.message ?? '调取失败');
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="公共模板库 · 成就卡" size="xl">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              调取后会复制一份到你的成就库，可自由编辑，不会改动公共模板
            </p>
            {isSuperAdmin && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="w-4 h-4" /> 新增模板
              </Button>
            )}
          </div>

          {loading && templates.length === 0 ? (
            <EmptyState icon="⏳" title="加载中..." />
          ) : templates.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title="模板库暂无内容"
              description={isSuperAdmin ? '新增成就模板后所有用户都能调取' : '管理员还没有发布模板'}
            />
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {templates.map(t => (
                <Card key={t.id} className="p-3">
                  <div className="flex items-start gap-3">
                    {getTaskIconUrl(t.icon) ? (
                      <img src={getTaskIconUrl(t.icon)!} alt={t.title}
                        className="w-10 h-10 object-contain rounded-xl bg-star-50 flex-shrink-0" />
                    ) : (
                      <span className="text-2xl flex-shrink-0">{getCategoryMeta(t.category as TaskCategory, categories).emoji}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{t.title}</h4>
                      {t.description && <p className="text-xs text-slate-400 line-clamp-2">{t.description}</p>}
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                        <span>{getCategoryMeta(t.category as TaskCategory, categories).label}</span>
                        <span className="font-bold text-emerald-500">{t.reward_coins >= 0 ? '+' : ''}{t.reward_coins} ⭐</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button size="sm" variant="secondary" loading={copyingId === t.id} onClick={() => handleCopy(t)}>
                        <Copy className="w-3.5 h-3.5" /> 调取
                      </Button>
                      {isSuperAdmin && (
                        <>
                          <button onClick={() => openEdit(t)} className="p-2 text-slate-400 hover:text-blue-500">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteTarget(t)} className="p-2 text-slate-400 hover:text-red-500">
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
      </Modal>

      {/* 新增 / 编辑模板 */}
      <Modal open={showForm} onClose={() => !saving && setShowForm(false)}
        title={editing ? '编辑成就模板' : '新增成就模板'}>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">模板图标</label>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-star-50 flex items-center justify-center overflow-hidden">
                {getTaskIconUrl(form.icon) ? (
                  <img src={getTaskIconUrl(form.icon)!} alt="图标" className="w-10 h-10 object-contain" />
                ) : (
                  <span className="text-2xl">❓</span>
                )}
              </div>
              <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-600 flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" /> 上传图片
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 200 * 1024) { toast.error('图片需小于 200KB'); return; }
                    const reader = new FileReader();
                    reader.onload = () => setForm(p => ({ ...p, icon: reader.result as string }));
                    reader.onerror = () => toast.error('读取失败');
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {form.icon && (
                <button type="button" onClick={() => setForm(p => ({ ...p, icon: '' }))}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-500">
                  <X className="w-3 h-3" /> 清除
                </button>
              )}
            </div>
            <div className="max-h-28 overflow-y-auto rounded-xl bg-slate-50 p-2 space-y-1">
              {TASK_ICONS.map(group => (
                <div key={group.label}>
                  <div className="grid grid-cols-8 gap-1">
                    {group.icons.map(item => (
                      <button key={item.name} type="button" onClick={() => setForm(p => ({ ...p, icon: item.name }))}
                        className={`aspect-square rounded-lg overflow-hidden bg-white ${form.icon === item.name ? 'ring-2 ring-star-400' : 'hover:bg-star-50'}`}>
                        <img src={item.url} alt={item.name} className="w-full h-full object-contain" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Input label="成就标题" required placeholder="如：背单词 20 个"
            value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
          <Textarea label="描述" placeholder="成就说明（可选）"
            value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">分类</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-star-400">
                {categories.map(c => (
                  <option key={c.key} value={c.key}>{c.name}</option>
                ))}
              </select>
            </div>
            <Input label="奖励星光值" type="number" value={form.reward_coins}
              onChange={e => setForm(p => ({ ...p, reward_coins: e.target.value }))} />
            <Input label="优先级" type="number" value={form.priority}
              onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" fullWidth onClick={() => setShowForm(false)} disabled={saving}>取消</Button>
            <Button fullWidth loading={saving} onClick={handleSave}>{editing ? '保存' : '新增'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除公共模板？"
        message={`确认删除「${deleteTarget?.title ?? ''}」？删除后所有用户将无法再调取该模板（已调取的副本不受影响）。`}
        confirmText="删除"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}

// ============================================================
// 特权卡公共模板库
// ============================================================
const PRIVILEGE_CATEGORIES = ['美食', '放松', '玩乐', '稀有'];

async function compressImageToBlob(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 400;
        const scale = img.width > maxW ? maxW / img.width : 1;
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('压缩失败')), 'image/jpeg', 0.75);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export function PrivilegeTemplateModal({
  open, onClose, familyId, createdBy, onCopied,
}: {
  open: boolean;
  onClose: () => void;
  familyId: string;
  createdBy: string;
  onCopied: () => void;
}) {
  const toast = useToastStore();
  const isSuperAdmin = useAppContextStore(s => s.isSuperAdmin);
  const canUse = useCanUseTemplateLibrary();
  const fileRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<PrivilegeTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PrivilegeTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PrivilegeTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '', description: '', price: '', category: '', weekly_limit: '', stock: '', image_url: null as string | null,
  });

  const reload = () => {
    if (!canUse) { setTemplates([]); return; }
    setLoading(true);
    listPrivilegeTemplates()
      .then(setTemplates)
      .catch(e => toast.error(e?.message ?? '模板加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (open) reload(); }, [open, canUse]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', price: '', category: '', weekly_limit: '', stock: '', image_url: null });
    setShowForm(true);
  };

  const openEdit = (t: PrivilegeTemplate) => {
    setEditing(t);
    setForm({
      name: t.name,
      description: t.description ?? '',
      price: String(t.price),
      category: t.category ?? '',
      weekly_limit: t.weekly_limit ? String(t.weekly_limit) : '',
      stock: t.stock !== null ? String(t.stock) : '',
      image_url: t.image_url,
    });
    setShowForm(true);
  };

  const handleUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error('图片不能超过 5MB'); return; }
    setUploading(true);
    try {
      const blob = await compressImageToBlob(file);
      const url = await uploadImageToStorage(blob, familyId, 'shop');
      setForm(p => ({ ...p, image_url: url }));
    } catch (e: any) {
      toast.error(e?.message ?? '图片处理失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('请输入特权名称'); return; }
    if (!form.price || Number(form.price) <= 0) { toast.error('价格必须大于 0'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        image_url: form.image_url,
        category: form.category.trim() || null,
        weekly_limit: form.weekly_limit ? Number(form.weekly_limit) : null,
        stock: form.stock ? Number(form.stock) : null,
      };
      if (editing) {
        await updatePrivilegeTemplate(editing.id, payload);
        toast.success('模板已更新');
      } else {
        await createPrivilegeTemplate(payload);
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
      await deletePrivilegeTemplate(deleteTarget.id);
      toast.success('模板已删除');
      setDeleteTarget(null);
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  // 调取 = 复制一份到自己的特权库（独立副本，后续编辑不影响模板）
  const handleCopy = async (t: PrivilegeTemplate) => {
    if (!familyId) return;
    setCopyingId(t.id);
    try {
      await createItem({
        family_id: familyId,
        name: t.name,
        description: t.description,
        price: t.price,
        image_url: t.image_url,
        expires_at: null,
        voucher_validity_days: null,
        weekly_limit: t.weekly_limit,
        stock: t.stock,
        created_by: createdBy,
        category: t.category,
      });
      toast.success(`已复制「${t.name}」到我的特权库`);
      onCopied();
    } catch (e: any) {
      toast.error(e?.message ?? '调取失败');
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="公共模板库 · 特权卡" size="xl">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              调取后会复制一份到你的特权库，可自由编辑，不会改动公共模板
            </p>
            {isSuperAdmin && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="w-4 h-4" /> 新增模板
              </Button>
            )}
          </div>

          {loading && templates.length === 0 ? (
            <EmptyState icon="⏳" title="加载中..." />
          ) : templates.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title="模板库暂无内容"
              description={isSuperAdmin ? '新增特权模板后所有用户都能调取' : '管理员还没有发布模板'}
            />
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {templates.map(t => (
                <Card key={t.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-star-50 flex items-center justify-center flex-shrink-0">
                      {t.image_url
                        ? <img src={t.image_url} alt={t.name} className="w-full h-full object-cover" />
                        : <span className="text-2xl">🎁</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{t.name}</h4>
                      {t.description && <p className="text-xs text-slate-400 line-clamp-2">{t.description}</p>}
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                        <span className="font-bold text-amber-600">{t.price} 金币</span>
                        {t.category && <span>{t.category}</span>}
                        {t.weekly_limit ? <span>每周 {t.weekly_limit}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button size="sm" variant="secondary" loading={copyingId === t.id} onClick={() => handleCopy(t)}>
                        <Copy className="w-3.5 h-3.5" /> 调取
                      </Button>
                      {isSuperAdmin && (
                        <>
                          <button onClick={() => openEdit(t)} className="p-2 text-slate-400 hover:text-blue-500">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteTarget(t)} className="p-2 text-slate-400 hover:text-red-500">
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
      </Modal>

      <Modal open={showForm} onClose={() => !saving && setShowForm(false)}
        title={editing ? '编辑特权模板' : '新增特权模板'}>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">卡片图片</label>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-xl overflow-hidden bg-star-50 border-2 border-dashed border-star-200 flex items-center justify-center">
                {form.image_url
                  ? <img src={form.image_url} alt="预览" className="w-full h-full object-cover" />
                  : <Upload className="w-6 h-6 text-star-300" />}
              </div>
              <div className="space-y-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
                <Button type="button" size="sm" variant="secondary" loading={uploading}
                  onClick={() => fileRef.current?.click()}>
                  <Upload className="w-3.5 h-3.5" /> 上传图片
                </Button>
                {form.image_url && (
                  <button type="button" onClick={() => setForm(p => ({ ...p, image_url: null }))}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-500">
                    <X className="w-3 h-3" /> 移除
                  </button>
                )}
              </div>
            </div>
          </div>

          <Input label="特权名称" required placeholder="如：免默写券"
            value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          <Textarea label="描述" placeholder="特权说明（可选）"
            value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          <Input label="价格（金币）" type="number" required placeholder="如：30"
            value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="使用上限/周（可选）" type="number" placeholder="如：1"
              value={form.weekly_limit} onChange={e => setForm(p => ({ ...p, weekly_limit: e.target.value }))} />
            <Input label="库存（可选，留空=无限）" type="number" placeholder="如：5"
              value={form.stock} onChange={e => setForm(p => ({ ...p, stock: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">分类</label>
            <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-star-400">
              <option value="">不选</option>
              {PRIVILEGE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" fullWidth onClick={() => setShowForm(false)} disabled={saving}>取消</Button>
            <Button fullWidth loading={saving} onClick={handleSave}>{editing ? '保存' : '新增'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除公共模板？"
        message={`确认删除「${deleteTarget?.name ?? ''}」？删除后所有用户将无法再调取该模板（已调取的副本不受影响）。`}
        confirmText="删除"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
