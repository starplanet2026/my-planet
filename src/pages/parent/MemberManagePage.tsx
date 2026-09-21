import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { useCoinRecords } from '../../hooks/useCoinRecords';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Input, Textarea, Select } from '../../components/common/Input';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { Avatar } from '../../components/common/Avatar';
import { useToastStore } from '../../store/toastStore';
import { addChild, updateMember, deleteMember, resetCoins } from '../../api/members';
import { formatCoins, formatSignedCoins } from '../../lib/utils';
import { CHILD_EMOJIS, ROUTES } from '../../lib/constants';
import { Plus, Edit2, Trash2, Coins, RotateCcw, ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Member } from '../../api/types';

export function MemberManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const refreshMembers = useFamilyStore(s => s.refreshMembers);
  const parentMember = members.find(m => m.role === 'parent');
  const childMembers = members.filter(m => m.role === 'child');
  const { adjustCoins } = useCoinRecords();
  const toast = useToastStore();

  const [showAdd, setShowAdd] = useState(false);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [adjustMember, setAdjustMember] = useState<Member | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [saving, setSaving] = useState(false);

  const [addForm, setAddForm] = useState({ name: '', emoji: '🦁' });
  const [editForm, setEditForm] = useState({ name: '', emoji: '🦁' });
  const [adjustForm, setAdjustForm] = useState({
    amount: '', reason: '', direction: 'add' as 'add' | 'subtract'
  });

  const handleAdd = async () => {
    if (!family) return;
    if (!addForm.name.trim()) { toast.error('请输入孩子名字'); return; }
    setSaving(true);
    try {
      await addChild(family.id, addForm.name.trim(), addForm.emoji);
      toast.success('孩子已添加');
      setShowAdd(false);
      setAddForm({ name: '', emoji: '🦁' });
    } catch (e: any) {
      toast.error(e?.message ?? '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editMember) return;
    if (!editForm.name.trim()) { toast.error('请输入名字'); return; }
    setSaving(true);
    try {
      await updateMember(editMember.id, {
        name: editForm.name.trim(),
        avatar_emoji: editForm.emoji,
      });
      toast.success('已更新');
      setEditMember(null);
    } catch (e: any) {
      toast.error(e?.message ?? '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAdjust = async () => {
    if (!adjustMember || !parentMember) return;
    const amount = Number(adjustForm.amount);
    if (!amount || amount <= 0) { toast.error('请输入有效金额'); return; }
    const signedAmount = adjustForm.direction === 'add' ? amount : -amount;

    setSaving(true);
    try {
      const result = await adjustCoins(adjustMember.id, signedAmount, adjustForm.reason, parentMember.id);
      toast.success(`${formatSignedCoins(signedAmount)} 金币，当前余额 ${result.new_balance}`);
      setAdjustMember(null);
      setAdjustForm({ amount: '', reason: '', direction: 'add' });
    } catch (e: any) {
      toast.error(e?.message ?? '调整失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!deleteTarget || !parentMember) return;
    try {
      await resetCoins(deleteTarget.id, parentMember.id);
      toast.success('金币已重置');
    } catch (e: any) {
      toast.error(e?.message ?? '重置失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMember(deleteTarget.id);
      toast.success('成员已删除');
      await refreshMembers();
      setDeleteTarget(null);
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

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
          <h1 className="text-xl font-bold">成员管理</h1>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> 添加孩子
        </Button>
      </div>

      <div className="space-y-2">
        {childMembers.map(child => (
          <Card key={child.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar emoji={child.avatar_emoji} size="lg" />
                <div>
                  <div className="font-medium">{child.name}</div>
                  <div className="flex items-center gap-1 text-coin-600 font-bold">
                    <Coins className="w-4 h-4" />
                    <span className="tabular-nums">{formatCoins(child.coin_balance)}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    setAdjustMember(child);
                    setAdjustForm({ amount: '', reason: '', direction: 'add' });
                  }}
                  className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
                  title="调整金币"
                >
                  <Coins className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setEditMember(child);
                    setEditForm({ name: child.name, emoji: child.avatar_emoji });
                  }}
                  className="p-2 text-slate-400 hover:text-blue-500 rounded-lg"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeleteTarget(child)}
                  className="p-2 text-slate-400 hover:text-red-500 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* 添加孩子 */}
      <Modal open={showAdd} onClose={() => !saving && setShowAdd(false)} title="添加孩子">
        <div className="space-y-4">
          <Input
            label="名字"
            required
            placeholder="如：小明"
            value={addForm.name}
            onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
          />
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">选择头像</label>
            <div className="grid grid-cols-6 gap-2">
              {CHILD_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAddForm(p => ({ ...p, emoji }))}
                  className={cn(
                    'h-12 rounded-xl flex items-center justify-center text-2xl transition-all',
                    addForm.emoji === emoji ? 'bg-blue-100 ring-2 ring-blue-500 scale-110' : 'bg-slate-50 hover:bg-slate-100'
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setShowAdd(false)} disabled={saving}>取消</Button>
            <Button fullWidth loading={saving} onClick={handleAdd}>添加</Button>
          </div>
        </div>
      </Modal>

      {/* 编辑成员 */}
      <Modal open={!!editMember} onClose={() => !saving && setEditMember(null)} title="编辑成员">
        <div className="space-y-4">
          <Input
            label="名字"
            value={editForm.name}
            onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
          />
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">选择头像</label>
            <div className="grid grid-cols-6 gap-2">
              {CHILD_EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setEditForm(p => ({ ...p, emoji }))}
                  className={cn(
                    'h-12 rounded-xl flex items-center justify-center text-2xl transition-all',
                    editForm.emoji === emoji ? 'bg-blue-100 ring-2 ring-blue-500 scale-110' : 'bg-slate-50 hover:bg-slate-100'
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setEditMember(null)} disabled={saving}>取消</Button>
            <Button fullWidth loading={saving} onClick={handleEdit}>保存</Button>
          </div>
        </div>
      </Modal>

      {/* 调整金币 */}
      <Modal open={!!adjustMember} onClose={() => !saving && setAdjustMember(null)} title={`调整金币 - ${adjustMember?.name ?? ''}`}>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
            <span className="text-sm text-slate-500">当前余额</span>
            <span className="font-bold text-coin-600 tabular-nums">
              {adjustMember ? formatCoins(adjustMember.coin_balance) : 0}
            </span>
          </div>
          <Select
            label="操作"
            value={adjustForm.direction}
            onChange={e => setAdjustForm(p => ({ ...p, direction: e.target.value as 'add' | 'subtract' }))}
          >
            <option value="add">增加金币</option>
            <option value="subtract">扣除金币</option>
          </Select>
          <Input
            label="金额"
            type="number"
            required
            placeholder="如：10"
            value={adjustForm.amount}
            onChange={e => setAdjustForm(p => ({ ...p, amount: e.target.value }))}
          />
          <Textarea
            label="原因"
            placeholder="如：表现优异额外奖励"
            value={adjustForm.reason}
            onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))}
          />
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setAdjustMember(null)} disabled={saving}>取消</Button>
            <Button
              fullWidth
              loading={saving}
              variant={adjustForm.direction === 'add' ? 'success' : 'danger'}
              onClick={handleAdjust}
            >
              {adjustForm.direction === 'add' ? '增加' : '扣除'}金币
            </Button>
          </div>
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除成员？"
        message={`确认删除「${deleteTarget?.name ?? ''}」？该成员的所有金币和记录将被删除，无法恢复。`}
        confirmText="删除"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
