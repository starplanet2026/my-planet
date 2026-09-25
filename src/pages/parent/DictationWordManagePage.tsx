import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { Plus, Trash2, ArrowLeft, Upload, Download, Edit, CheckSquare, Square, BookOpen } from 'lucide-react';
import {
  listWords, createWord, updateWord, deleteWords, importWords,
  listWordTextbooks, listWordUnits,
} from '../../api/dictation';
import type { DictationWord, DictationSubject } from '../../api/types';

const ENGLISH_COLUMNS = ['课本名称', '单元序号', '单元名字', '页码', '中文释义', '词性', '英文答案'];
const CHINESE_COLUMNS = ['课本名称', '单元序号', '单元名字', '拼音', '汉字答案'];

export function DictationWordManagePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const currentChildId = useModeStore(s => s.currentChildId);
  const toast = useToastStore();

  const [subject, setSubject] = useState<DictationSubject>('english');
  const [words, setWords] = useState<DictationWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 筛选
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [units, setUnits] = useState<number[]>([]);
  const [filterBook, setFilterBook] = useState('');
  const [filterUnit, setFilterUnit] = useState<number | ''>('');

  // 新增/编辑
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DictationWord | null>(null);
  const [form, setForm] = useState({
    textbook_name: '', unit_no: 0, unit_name: '',
    page_no: '' as string, chinese_meaning: '', part_of_speech: '', pinyin: '', answer: '',
  });

  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!family) return;
    setLoading(true);
    try {
      const list = await listWords(family.id, subject);
      setWords(list);
      const books = await listWordTextbooks(family.id, subject);
      setTextbooks(books);
    } catch (e: any) {
      toast.error('加载失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [subject, family?.id]);

  useEffect(() => {
    if (filterBook) {
      listWordUnits(family!.id, subject, filterBook).then(setUnits).catch(() => setUnits([]));
    } else {
      setUnits([]);
    }
  }, [filterBook, subject, family?.id]);

  const filtered = useMemo(() => {
    return words.filter(w => {
      if (filterBook && w.textbook_name !== filterBook) return false;
      if (filterUnit !== '' && w.unit_no !== filterUnit) return false;
      return true;
    });
  }, [words, filterBook, filterUnit]);

  const resetForm = () => setForm({
    textbook_name: '', unit_no: 0, unit_name: '',
    page_no: '', chinese_meaning: '', part_of_speech: '', pinyin: '', answer: '',
  });

  const openCreate = () => { setEditing(null); resetForm(); setShowModal(true); };
  const openEdit = (w: DictationWord) => {
    setEditing(w);
    setForm({
      textbook_name: w.textbook_name, unit_no: w.unit_no, unit_name: w.unit_name,
      page_no: w.page_no != null ? String(w.page_no) : '',
      chinese_meaning: w.chinese_meaning ?? '', part_of_speech: w.part_of_speech ?? '',
      pinyin: w.pinyin ?? '', answer: w.answer,
    });
    setShowModal(true);
  };

  const submit = async () => {
    if (!family) return;
    if (!form.answer.trim()) { toast.error('请填写答案'); return; }
    const payload = {
      subject,
      textbook_name: form.textbook_name,
      unit_no: Number(form.unit_no) || 0,
      unit_name: form.unit_name,
      page_no: form.page_no ? Number(form.page_no) : null,
      chinese_meaning: subject === 'english' ? form.chinese_meaning || null : null,
      part_of_speech: subject === 'english' ? form.part_of_speech || null : null,
      pinyin: subject === 'chinese' ? form.pinyin || null : null,
      answer: form.answer.trim(),
    };
    try {
      if (editing) {
        await updateWord(editing.id, payload);
        toast.success('已更新');
      } else {
        await createWord(family.id, payload);
        toast.success('已添加');
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      toast.error('保存失败：' + e.message);
    }
  };

  const handleDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      await deleteWords(ids);
      toast.success(`已删除 ${ids.length} 条`);
      setSelected(new Set());
      load();
    } catch (e: any) {
      toast.error('删除失败：' + e.message);
    }
  };

  const downloadTemplate = () => {
    const cols = subject === 'english' ? ENGLISH_COLUMNS : CHINESE_COLUMNS;
    const ws = XLSX.utils.aoa_to_sheet([cols]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, subject === 'english' ? '英语词条' : '语文词条');
    XLSX.writeFile(wb, `${subject === 'english' ? '英语' : '语文'}家默词条模板.xlsx`);
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !family) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
      const cols = subject === 'english' ? ENGLISH_COLUMNS : CHINESE_COLUMNS;
      // 校验列名
      const firstRow = rows[0] || {};
      const hasAll = cols.every(c => Object.keys(firstRow).includes(c));
      if (!hasAll) {
        toast.error(`模板列名错误，应为：${cols.join('、')}`);
        return;
      }
      const payload = rows.map(r => ({
        subject,
        textbook_name: String(r['课本名称'] ?? ''),
        unit_no: Number(r['单元序号']) || 0,
        unit_name: String(r['单元名字'] ?? ''),
        page_no: subject === 'english' ? (r['页码'] ? Number(r['页码']) : null) : null,
        chinese_meaning: subject === 'english' ? String(r['中文释义'] ?? '') || null : null,
        part_of_speech: subject === 'english' ? String(r['词性'] ?? '') || null : null,
        pinyin: subject === 'chinese' ? String(r['拼音'] ?? '') || null : null,
        answer: subject === 'english' ? String(r['英文答案'] ?? '') : String(r['汉字答案'] ?? ''),
      })).filter(r => r.answer);
      const result = await importWords(family.id, subject, payload);
      toast.success(`导入完成：成功 ${result.success}，重复 ${result.duplicate}，失败 ${result.failed}`);
      load();
    } catch (err: any) {
      toast.error('导入失败：' + err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every(w => selected.has(w.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(w => w.id)));
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="max-w-6xl mx-auto py-4 px-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2"><BookOpen className="w-6 h-6 text-emerald-500" />家默词条库管理</h1>
      </div>

      {/* 学科切换 */}
      <div className="flex gap-2 mb-4">
        {(['english', 'chinese'] as DictationSubject[]).map(s => (
          <button
            key={s}
            onClick={() => { setSubject(s); setFilterBook(''); setFilterUnit(''); setSelected(new Set()); }}
            className={cn(
              'px-4 py-2 rounded-lg font-medium transition-colors',
              subject === s ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {s === 'english' ? '英语' : '语文'}
          </button>
        ))}
      </div>

      {/* 操作栏 */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={openCreate}><Plus className="w-4 h-4" />新增词条</Button>
          <Button variant="secondary" onClick={downloadTemplate}><Download className="w-4 h-4" />下载模板</Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" />导入Excel</Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFileChange} className="hidden" />
          {selected.size > 0 && (
            <Button variant="danger" onClick={() => handleDelete([...selected])}>
              <Trash2 className="w-4 h-4" />删除选中({selected.size})
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Select value={filterBook} onChange={e => { setFilterBook(e.target.value); setFilterUnit(''); }} className="w-36">
              <option value="">全部课本</option>
              {textbooks.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
            <Select value={filterUnit} onChange={e => setFilterUnit(e.target.value ? Number(e.target.value) : '')} className="w-28">
              <option value="">全部单元</option>
              {units.map(u => <option key={u} value={u}>第{u}单元</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {/* 列表 */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon="📚" title="暂无词条" description="点击「新增词条」或「导入Excel」添加" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-2 w-10">
                    <button onClick={toggleAll}>
                      {allSelected ? <CheckSquare className="w-4 h-4 text-emerald-500" /> : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="p-2 text-left">课本</th>
                  <th className="p-2 text-left">单元</th>
                  {subject === 'english' && <th className="p-2 text-left">页码</th>}
                  {subject === 'english' && <th className="p-2 text-left">中文释义</th>}
                  {subject === 'english' && <th className="p-2 text-left">词性</th>}
                  {subject === 'chinese' && <th className="p-2 text-left">拼音</th>}
                  <th className="p-2 text-left">答案</th>
                  <th className="p-2 w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(w => (
                  <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2">
                      <button onClick={() => toggleSelect(w.id)}>
                        {selected.has(w.id) ? <CheckSquare className="w-4 h-4 text-emerald-500" /> : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="p-2">{w.textbook_name}</td>
                    <td className="p-2">第{w.unit_no}单元 {w.unit_name}</td>
                    {subject === 'english' && <td className="p-2">{w.page_no ?? '-'}</td>}
                    {subject === 'english' && <td className="p-2">{w.chinese_meaning ?? '-'}</td>}
                    {subject === 'english' && <td className="p-2">{w.part_of_speech ?? '-'}</td>}
                    {subject === 'chinese' && <td className="p-2">{w.pinyin ?? '-'}</td>}
                    <td className="p-2 font-medium">{w.answer}</td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(w)} className="p-1 hover:bg-slate-200 rounded"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete([w.id])} className="p-1 hover:bg-red-100 rounded text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? '编辑词条' : '新增词条'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">课本名称</label>
              <Input value={form.textbook_name} onChange={e => setForm({ ...form, textbook_name: e.target.value })} placeholder="如：人教版三年级上册" />
            </div>
            <div>
              <label className="text-xs text-slate-500">单元序号</label>
              <Input type="number" value={form.unit_no} onChange={e => setForm({ ...form, unit_no: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">单元名字</label>
            <Input value={form.unit_name} onChange={e => setForm({ ...form, unit_name: e.target.value })} placeholder="如：第一单元" />
          </div>
          {subject === 'english' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-500">页码</label>
                <Input type="number" value={form.page_no} onChange={e => setForm({ ...form, page_no: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">词性</label>
                <Input value={form.part_of_speech} onChange={e => setForm({ ...form, part_of_speech: e.target.value })} placeholder="n./v./adj." />
              </div>
              <div>
                <label className="text-xs text-slate-500">英文答案</label>
                <Input value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} placeholder="apple" />
              </div>
            </div>
          )}
          {subject === 'english' && (
            <div>
              <label className="text-xs text-slate-500">中文释义</label>
              <Input value={form.chinese_meaning} onChange={e => setForm({ ...form, chinese_meaning: e.target.value })} placeholder="苹果" />
            </div>
          )}
          {subject === 'chinese' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">拼音</label>
                <Input value={form.pinyin} onChange={e => setForm({ ...form, pinyin: e.target.value })} placeholder="píng guǒ" />
              </div>
              <div>
                <label className="text-xs text-slate-500">汉字答案</label>
                <Input value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} placeholder="苹果" />
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={submit}>{editing ? '保存' : '添加'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
