import { useState, useRef } from 'react';
import { useFamilyStore } from '../../store/familyStore';
import { useItems } from '../../hooks/useItems';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Input, Textarea } from '../../components/common/Input';
import { EmptyState } from '../../components/common/EmptyState';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useToastStore } from '../../store/toastStore';
import { formatCoins, formatDate, isExpired } from '../../lib/utils';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../lib/constants';
import { Plus, Edit2, Trash2, Coins, ArrowLeft, Upload, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Item } from '../../api/types';
import { uploadImageToStorage } from '../../lib/storage';

interface ItemFormData {
  name: string;
  description: string;
  price: string;
  expires_at: string;
  weekly_limit: string;
  stock: string;
  category: string;
  image_url: string | null;
}

// 压缩图片为 Blob（限制 400px 宽度），用于上传到 Storage
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
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('压缩失败')),
          'image/jpeg',
          0.75,
        );
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export function ShopManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const parentMember = members.find(m => m.role === 'parent');

  const { items, loading, createItem, updateItem, deleteItem } = useItems();
  const toast = useToastStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState<ItemFormData>({
    name: '', description: '', price: '', expires_at: '',
    weekly_limit: '', stock: '', category: '', image_url: null,
  });

  const update = (k: keyof ItemFormData, v: string) => setForm(p => ({ ...p, [k]: v }));

  const openCreate = () => {
    setEditingItem(null);
    setForm({ name: '', description: '', price: '', expires_at: '', weekly_limit: '', stock: '', category: '', image_url: null });
    setShowForm(true);
  };

  const openEdit = (item: Item) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      description: item.description ?? '',
      price: String(item.price),
      expires_at: item.expires_at ? item.expires_at.slice(0, 16) : '',
      weekly_limit: item.weekly_limit ? String(item.weekly_limit) : '',
      stock: item.stock !== null ? String(item.stock) : '',
      category: item.category ?? '',
      image_url: item.image_url,
    });
    setShowForm(true);
  };

  const handleImageUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片不能超过 5MB');
      return;
    }
    setUploading(true);
    try {
      const blob = await compressImageToBlob(file);
      const url = await uploadImageToStorage(blob, family!.id, 'shop');
      setForm(p => ({ ...p, image_url: url }));
    } catch (e: any) {
      toast.error(e?.message ?? '图片处理失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!family || !parentMember) return;
    if (!form.name.trim()) { toast.error('请输入商品名称'); return; }
    if (!form.price || Number(form.price) <= 0) { toast.error('价格必须大于 0'); return; }

    setSaving(true);
    try {
      const data = {
        family_id: family.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        image_url: form.image_url,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        voucher_validity_days: null,
        weekly_limit: form.weekly_limit ? Number(form.weekly_limit) : null,
        stock: form.stock ? Number(form.stock) : null,
        category: form.category.trim() || null,
        created_by: parentMember.id,
      };

      if (editingItem) {
        await updateItem(editingItem.id, data);
        toast.success('特权已更新');
      } else {
        await createItem(data);
        toast.success('特权已创建');
      }
      setShowForm(false);
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteItem(deleteTarget.id);
      toast.success('特权已下架');
    } catch (e: any) {
      toast.error(e?.message ?? '下架失败');
    }
  };

  const validItems = items.filter(i => i.status !== 'deleted');

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(ROUTES.PARENT)}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">特权管理</h1>
        </div>
        <Button size="sm" onClick={openCreate} className="bg-star-400 hover:bg-star-500 text-white">
          <Plus className="w-4 h-4" /> 上架特权
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <EmptyState icon="🎴" title="加载中..." />
      ) : validItems.length === 0 ? (
        <EmptyState
          icon="🎴"
          title="还没有特权"
          description="上架特权让孩子用金币兑换奖励"
          action={<Button onClick={openCreate} className="bg-star-400 hover:bg-star-500 text-white"><Plus className="w-4 h-4" /> 上架特权</Button>}
        />
      ) : (
        <div className="space-y-2">
          {validItems.map(item => {
            const expired = item.expires_at && isExpired(item.expires_at);
            return (
              <Card key={item.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3 flex-1 min-w-0">
                    {/* 缩略图 */}
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-star-50 flex-shrink-0 flex items-center justify-center">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">🎁</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{item.name}</h3>
                        {item.status === 'active' && !expired && (
                          <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">在售</span>
                        )}
                        {expired && (
                          <span className="text-xs px-2 py-0.5 bg-red-50 text-red-500 rounded-full">已过期</span>
                        )}
                        {item.stock !== null && item.stock <= 5 && (
                          <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full">剩 {item.stock}</span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-sm text-slate-500 mb-1 line-clamp-1">{item.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                        {item.category && <span className="px-1.5 py-0.5 rounded bg-star-50 text-star-600 font-medium">{item.category}</span>}
                        {item.weekly_limit && <span>使用上限 {item.weekly_limit}/周</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="flex items-center gap-1 font-bold text-amber-600">
                      <Coins className="w-4 h-4" />{formatCoins(item.price)}
                    </span>
                    <button onClick={() => openEdit(item)} className="p-2 text-slate-400 hover:text-blue-500">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteTarget(item)} className="p-2 text-slate-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 特权表单 */}
      <Modal
        open={showForm}
        onClose={() => !saving && setShowForm(false)}
        title={editingItem ? '编辑特权' : '上架特权'}
      >
        <div className="space-y-4">
          {/* 图片上传 */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">商品图片</label>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-xl overflow-hidden bg-star-50 border-2 border-dashed border-star-200 flex items-center justify-center">
                {form.image_url ? (
                  <img src={form.image_url} alt="预览" className="w-full h-full object-cover" />
                ) : (
                  <Upload className="w-6 h-6 text-star-300" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleImageUpload(f);
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5" /> 上传图片
                </Button>
                {form.image_url && (
                  <button
                    type="button"
                    onClick={() => setForm(p => ({ ...p, image_url: null }))}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-500"
                  >
                    <X className="w-3 h-3" /> 移除
                  </button>
                )}
              </div>
            </div>
          </div>

          <Input
            label="特权名称"
            required
            placeholder="如：免默写券"
            value={form.name}
            onChange={e => update('name', e.target.value)}
          />
          <Textarea
            label="描述"
            placeholder="特权说明（可选）"
            value={form.description}
            onChange={e => update('description', e.target.value)}
          />
          <Input
            label="价格（金币）"
            type="number"
            required
            placeholder="如：30"
            value={form.price}
            onChange={e => update('price', e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="使用上限/周（可选）"
              type="number"
              placeholder="如：1"
              value={form.weekly_limit}
              onChange={e => update('weekly_limit', e.target.value)}
            />
            <Input
              label="库存（可选，留空=无限）"
              type="number"
              placeholder="如：5"
              value={form.stock}
              onChange={e => update('stock', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">分类</label>
            <select
              value={form.category}
              onChange={e => update('category', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-star-400"
            >
              <option value="">不选</option>
              <option value="美食">美食</option>
              <option value="放松">放松</option>
              <option value="玩乐">玩乐</option>
              <option value="稀有">稀有</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" fullWidth onClick={() => setShowForm(false)} disabled={saving}>
              取消
            </Button>
            <Button fullWidth loading={saving} onClick={handleSave}
              className="bg-star-400 hover:bg-star-500 text-white">
              {editingItem ? '保存' : '上架'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="下架特权？"
        message={`确认下架「${deleteTarget?.name ?? ''}」？`}
        confirmText="下架"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
