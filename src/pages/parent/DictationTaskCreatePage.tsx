import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { useModeStore } from '../../store/modeStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { ArrowLeft, Plus, Trash2, CheckSquare, Square, Sparkles } from 'lucide-react';
import {
  listWords, listWordTextbooks, listWordUnits, createWord,
  listDueErrorWords, createTask, addTaskWords,
} from '../../api/dictation';
import type { DictationSubject, DictationWord, DictationErrorWord } from '../../api/types';

interface AddedWord {
  key: string;
  word_id?: string | null;
  error_word_id?: string | null;
  textbook_name: string;
  unit_no: number;
  unit_name: string;
  page_no?: number | null;
  chinese_meaning?: string | null;
  part_of_speech?: string | null;
  pinyin?: string | null;
  answer: string;
  is_temporary: boolean;
  save_to_library: boolean;
}

export function DictationTaskCreatePage() {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';
  const toast = useToastStore();

  const [subject, setSubject] = useState<DictationSubject>('english');
  const [title, setTitle] = useState('英语家默');
  const [starPerWord, setStarPerWord] = useState(1);

  // 词条库筛选
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [units, setUnits] = useState<number[]>([]);
  const [filterBook, setFilterBook] = useState('');
  const [filterUnit, setFilterUnit] = useState<number | ''>('');
  const [libraryWords, setLibraryWords] = useState<DictationWord[]>([]);
  const [libSelected, setLibSelected] = useState<Set<string>>(new Set());

  // 错词候选
  const [dueErrors, setDueErrors] = useState<DictationErrorWord[]>([]);
  const [errSelected, setErrSelected] = useState<Set<string>>(new Set());

  // 已加入
  const [added, setAdded] = useState<AddedWord[]>([]);

  // 临时词条弹窗
  const [showTemp, setShowTemp] = useState(false);
  const [tempForm, setTempForm] = useState({
    textbook_name: '', unit_no: 0, unit_name: '', pinyin: '', answer: '',
    chinese_meaning: '', part_of_speech: '', save_to_library: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!family) return;
    setLoading(true);
    Promise.all([
      listWordTextbooks(family.id, subject).then(setTextbooks),
      listDueErrorWords(childId, subject).then(setDueErrors),
    ]).finally(() => setLoading(false));
  }, [subject, family?.id, childId]);

  useEffect(() => {
    if (!family) return;
    listWords(family.id, subject, {
      textbook_name: filterBook || undefined,
      unit_no: filterUnit === '' ? undefined : filterUnit,
    }).then(setLibraryWords);
  }, [subject, filterBook, filterUnit, family?.id]);

  useEffect(() => {
    if (filterBook && family) {
      listWordUnits(family.id, subject, filterBook).then(setUnits);
    } else {
      setUnits([]);
    }
  }, [filterBook, subject, family?.id]);

  const onSubjectChange = (s: DictationSubject) => {
    setSubject(s);
    setTitle(s === 'english' ? '英语家默' : '语文家默');
    setLibSelected(new Set());
    setErrSelected(new Set());
    setAdded([]);
    setFilterBook('');
    setFilterUnit('');
  };

  const addFromLibrary = () => {
    libSelected.forEach(id => {
      const w = libraryWords.find(x => x.id === id);
      if (!w) return;
      if (added.some(a => a.key === `lib-${w.id}`)) return;
      setAdded(prev => [...prev, {
        key: `lib-${w.id}`, word_id: w.id, error_word_id: null,
        textbook_name: w.textbook_name, unit_no: w.unit_no, unit_name: w.unit_name,
        page_no: w.page_no, chinese_meaning: w.chinese_meaning, part_of_speech: w.part_of_speech,
        pinyin: w.pinyin, answer: w.answer, is_temporary: false, save_to_library: false,
      }]);
    });
    setLibSelected(new Set());
    toast.success(`已加入 ${libSelected.size} 条`);
  };

  const addFromErrors = () => {
    errSelected.forEach(id => {
      const w = dueErrors.find(x => x.id === id);
      if (!w) return;
      if (added.some(a => a.key === `err-${w.id}`)) return;
      setAdded(prev => [...prev, {
        key: `err-${w.id}`, word_id: null, error_word_id: w.id,
        textbook_name: w.textbook_name, unit_no: w.unit_no, unit_name: w.unit_name,
        page_no: w.page_no, chinese_meaning: w.chinese_meaning, part_of_speech: w.part_of_speech,
        pinyin: w.pinyin, answer: w.answer, is_temporary: false, save_to_library: false,
      }]);
    });
    setErrSelected(new Set());
    toast.success(`已加入 ${errSelected.size} 条错词`);
  };

  const addTemp = async () => {
    if (!tempForm.answer.trim()) { toast.error('请填写答案'); return; }
    const newWord: AddedWord = {
      key: `temp-${Date.now()}`, word_id: null, error_word_id: null,
      textbook_name: tempForm.textbook_name, unit_no: tempForm.unit_no, unit_name: tempForm.unit_name,
      page_no: null, chinese_meaning: subject === 'english' ? tempForm.chinese_meaning || null : null,
      part_of_speech: subject === 'english' ? tempForm.part_of_speech || null : null,
      pinyin: subject === 'chinese' ? tempForm.pinyin || null : null,
      answer: tempForm.answer.trim(), is_temporary: true, save_to_library: tempForm.save_to_library,
    };
    // 若选择保存到长期词条库，先创建词条
    if (tempForm.save_to_library && family) {
      try {
        const created = await createWord(family.id, {
          subject, textbook_name: tempForm.textbook_name, unit_no: tempForm.unit_no,
          unit_name: tempForm.unit_name, page_no: null,
          chinese_meaning: subject === 'english' ? tempForm.chinese_meaning || null : null,
          part_of_speech: subject === 'english' ? tempForm.part_of_speech || null : null,
          pinyin: subject === 'chinese' ? tempForm.pinyin || null : null,
          answer: tempForm.answer.trim(),
        });
        newWord.word_id = created.id;
        newWord.is_temporary = false;
      } catch (e: any) {
        toast.error('保存到词条库失败：' + e.message);
        return;
      }
    }
    setAdded(prev => [...prev, newWord]);
    setShowTemp(false);
    setTempForm({ textbook_name: '', unit_no: 0, unit_name: '', pinyin: '', answer: '', chinese_meaning: '', part_of_speech: '', save_to_library: false });
    toast.success('已添加');
  };

  const removeAdded = (key: string) => setAdded(prev => prev.filter(a => a.key !== key));

  const publish = async () => {
    if (!family || !childId) return;
    if (added.length === 0) { toast.error('请至少加入一条词条'); return; }
    setSubmitting(true);
    try {
      const task = await createTask({
        family_id: family.id, member_id: childId, subject, title,
        star_per_word: starPerWord,
      });
      await addTaskWords(task.id, added.map(a => ({
        word_id: a.word_id ?? null, error_word_id: a.error_word_id ?? null,
        textbook_name: a.textbook_name, unit_no: a.unit_no, unit_name: a.unit_name,
        page_no: a.page_no ?? null, chinese_meaning: a.chinese_meaning ?? null,
        part_of_speech: a.part_of_speech ?? null, pinyin: a.pinyin ?? null,
        answer: a.answer, is_temporary: a.is_temporary, save_to_library: a.save_to_library,
      })));
      toast.success('任务已发布');
      navigate(ROUTES.PARENT_DASHBOARD);
    } catch (e: any) {
      toast.error('发布失败：' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="max-w-6xl mx-auto py-4 px-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-amber-500" />新建家默任务</h1>
      </div>

      {/* 基础配置 */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-500">学科</label>
            <Select value={subject} onChange={e => onSubjectChange(e.target.value as DictationSubject)}>
              <option value="english">英语</option>
              <option value="chinese">语文</option>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-500">任务标题</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500">单条答对星光值</label>
            <Input type="number" min={1} value={starPerWord} onChange={e => setStarPerWord(Math.max(1, Number(e.target.value)))} />
          </div>
        </div>
      </Card>

      {/* 三栏来源 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* 词条库 */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm">从词条库选择</h3>
            {libSelected.size > 0 && (
              <Button size="sm" onClick={addFromLibrary}>加入({libSelected.size})</Button>
            )}
          </div>
          <div className="flex gap-1 mb-2">
            <Select value={filterBook} onChange={e => { setFilterBook(e.target.value); setFilterUnit(''); }} className="flex-1 text-xs">
              <option value="">全部课本</option>
              {textbooks.map(b => <option key={b} value={b}>{b}</option>)}
            </Select>
            <Select value={filterUnit} onChange={e => setFilterUnit(e.target.value ? Number(e.target.value) : '')} className="w-20 text-xs">
              <option value="">单元</option>
              {units.map(u => <option key={u} value={u}>第{u}</option>)}
            </Select>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {libraryWords.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">暂无词条</p>}
            {libraryWords.map(w => (
              <label key={w.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                <button onClick={() => setLibSelected(p => { const n = new Set(p); n.has(w.id) ? n.delete(w.id) : n.add(w.id); return n; })}>
                  {libSelected.has(w.id) ? <CheckSquare className="w-4 h-4 text-emerald-500" /> : <Square className="w-4 h-4" />}
                </button>
                <div className="text-xs">
                  <div className="font-medium">{w.answer}</div>
                  <div className="text-slate-400">{subject === 'english' ? w.chinese_meaning : w.pinyin}</div>
                </div>
              </label>
            ))}
          </div>
        </Card>

        {/* 错词候选 */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm">到期错词复习</h3>
            {errSelected.size > 0 && (
              <Button size="sm" onClick={addFromErrors}>加入({errSelected.size})</Button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {dueErrors.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">暂无到期错词</p>}
            {dueErrors.map(w => (
              <label key={w.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
                <button onClick={() => setErrSelected(p => { const n = new Set(p); n.has(w.id) ? n.delete(w.id) : n.add(w.id); return n; })}>
                  {errSelected.has(w.id) ? <CheckSquare className="w-4 h-4 text-emerald-500" /> : <Square className="w-4 h-4" />}
                </button>
                <div className="text-xs">
                  <div className="font-medium">{w.answer}</div>
                  <div className="text-slate-400">下次：{w.next_review_date}</div>
                </div>
              </label>
            ))}
          </div>
        </Card>

        {/* 临时新增 */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm">临时新增词条</h3>
            <Button size="sm" onClick={() => setShowTemp(true)}><Plus className="w-3 h-3" />新增</Button>
          </div>
          <p className="text-xs text-slate-400">可添加本次任务专用的临时词条，可选择保存到长期词条库。</p>
        </Card>
      </div>

      {/* 已加入列表 */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">已加入本次任务（{added.length} 条）</h3>
          <Button onClick={publish} disabled={submitting || added.length === 0}>
            {submitting ? '发布中...' : '发布任务'}
          </Button>
        </div>
        {added.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">还没有加入任何词条</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {added.map(a => (
              <div key={a.key} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                <div className="text-xs min-w-0">
                  <div className="font-medium truncate">{a.answer}</div>
                  <div className="text-slate-400 truncate">{subject === 'english' ? a.chinese_meaning : a.pinyin}</div>
                </div>
                <button onClick={() => removeAdded(a.key)} className="p-1 text-red-400 hover:text-red-600 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 临时词条弹窗 */}
      <Modal open={showTemp} onClose={() => setShowTemp(false)} title="新增临时词条">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">课本名称</label>
              <Input value={tempForm.textbook_name} onChange={e => setTempForm({ ...tempForm, textbook_name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-slate-500">单元序号</label>
              <Input type="number" value={tempForm.unit_no} onChange={e => setTempForm({ ...tempForm, unit_no: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">单元名字</label>
            <Input value={tempForm.unit_name} onChange={e => setTempForm({ ...tempForm, unit_name: e.target.value })} />
          </div>
          {subject === 'english' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">中文释义</label>
                  <Input value={tempForm.chinese_meaning} onChange={e => setTempForm({ ...tempForm, chinese_meaning: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">词性</label>
                  <Input value={tempForm.part_of_speech} onChange={e => setTempForm({ ...tempForm, part_of_speech: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500">英文答案</label>
                <Input value={tempForm.answer} onChange={e => setTempForm({ ...tempForm, answer: e.target.value })} />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">拼音</label>
                <Input value={tempForm.pinyin} onChange={e => setTempForm({ ...tempForm, pinyin: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-500">汉字答案</label>
                <Input value={tempForm.answer} onChange={e => setTempForm({ ...tempForm, answer: e.target.value })} />
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={tempForm.save_to_library} onChange={e => setTempForm({ ...tempForm, save_to_library: e.target.checked })} />
            同时保存到长期词条库
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowTemp(false)}>取消</Button>
            <Button onClick={addTemp}>添加</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
