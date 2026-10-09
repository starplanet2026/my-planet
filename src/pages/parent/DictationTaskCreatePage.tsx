import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { ArrowLeft, Plus, Trash2, CheckSquare, Square, Sparkles, Upload, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  listWords, listWordTextbooks, listWordUnits, createWord,
  listDueErrorWords, createTask, addTaskWords, deleteTask,
} from '../../api/dictation';
import type { DictationSubject, DictationWord, DictationErrorWord, DictationTaskMode } from '../../api/types';

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

export function DictationTaskCreatePage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const family = useFamilyStore(s => s.family);
  const members = useFamilyStore(s => s.members);
  const toast = useToastStore();

  const childMembers = useMemo(() => members.filter(m => m.role === 'child'), [members]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const childId = selectedChildId;

  const [subject, setSubject] = useState<DictationSubject>('english');
  const [title, setTitle] = useState('英语家默');
  const [starPerWord, setStarPerWord] = useState(1);
  const [mode, setMode] = useState<DictationTaskMode>('dictation');

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
  // 临时新增词条（独立列表，非本次任务）
  const [tempWords, setTempWords] = useState<AddedWord[]>([]);
  const [tempSelected, setTempSelected] = useState<Set<string>>(new Set());

  // 临时词条弹窗
  const [showTemp, setShowTemp] = useState(false);
  const [tempForm, setTempForm] = useState({
    textbook_name: '', unit_no: 0, unit_name: '', pinyin: '', answer: '',
    chinese_meaning: '', part_of_speech: '', save_to_library: false,
  });
  const tempFileRef = useRef<HTMLInputElement>(null);

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
    setTempWords([]);
    setTempSelected(new Set());
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
      answer: tempForm.answer.trim(), is_temporary: true, save_to_library: false,
    };
    setTempWords(prev => [...prev, newWord]);
    setShowTemp(false);
    setTempForm({ textbook_name: '', unit_no: 0, unit_name: '', pinyin: '', answer: '', chinese_meaning: '', part_of_speech: '', save_to_library: false });
    toast.success('已添加到临时词条');
  };

  const removeAdded = (key: string) => setAdded(prev => prev.filter(a => a.key !== key));

  // 临时词条操作
  const removeTempWord = (key: string) => {
    setTempWords(prev => prev.filter(a => a.key !== key));
    setTempSelected(prev => { const n = new Set(prev); n.delete(key); return n; });
  };

  // 切换勾选
  const toggleTempSelect = (key: string) => {
    setTempSelected(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  // 全选/取消全选当前临时词条
  const toggleTempSelectAll = () => {
    if (tempSelected.size === tempWords.length) {
      setTempSelected(new Set());
    } else {
      setTempSelected(new Set(tempWords.map(w => w.key)));
    }
  };

  // 批量加入本次任务
  const batchMoveTempToTask = () => {
    if (tempSelected.size === 0) return;
    const selected = tempWords.filter(w => tempSelected.has(w.key));
    const moved: AddedWord[] = [];
    let skip = 0;
    selected.forEach(w => {
      if (added.some(a => a.answer === w.answer)) { skip++; return; }
      moved.push(w);
    });
    if (moved.length > 0) {
      setAdded(prev => [...prev, ...moved]);
      const movedKeys = new Set(moved.map(w => w.key));
      setTempWords(prev => prev.filter(w => !movedKeys.has(w.key)));
    }
    setTempSelected(new Set());
    toast.success(`已加入 ${moved.length} 条到本次任务${skip > 0 ? `，${skip} 条已在任务中跳过` : ''}`);
  };

  // 批量存入词条库
  const batchSaveTempToLibrary = async () => {
    if (tempSelected.size === 0 || !family) return;
    const selected = tempWords.filter(w => tempSelected.has(w.key));
    let success = 0, failed = 0;
    for (const w of selected) {
      try {
        await createWord(family.id, {
          subject, textbook_name: w.textbook_name, unit_no: w.unit_no,
          unit_name: w.unit_name, page_no: w.page_no ?? null,
          chinese_meaning: w.chinese_meaning ?? null, part_of_speech: w.part_of_speech ?? null,
          pinyin: w.pinyin ?? null, answer: w.answer,
        });
        success++;
      } catch {
        failed++;
      }
    }
    // 从临时列表移除已处理的词条
    const processedKeys = new Set(selected.map(w => w.key));
    setTempWords(prev => prev.filter(w => !processedKeys.has(w.key)));
    setTempSelected(new Set());
    toast.success(`已保存 ${success} 条到词条库${failed > 0 ? `，${failed} 条失败` : ''}`);
  };

  // 下载临时词条导入模板（同家默词条库模板）
  const downloadTempTemplate = () => {
    const cols = subject === 'english'
      ? ['课本名称', '单元序号', '单元名字', '页码', '中文释义', '词性', '英文答案']
      : ['课本名称', '单元序号', '单元名字', '拼音', '汉字答案'];
    const ws = XLSX.utils.aoa_to_sheet([cols]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '临时词条');
    XLSX.writeFile(wb, `临时词条模板-${subject === 'english' ? '英语' : '语文'}.xlsx`);
  };

  // Excel 批量导入临时词条（进入临时词条框，非本次任务）
  const onTempFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const newWords: AddedWord[] = [];
      let dupCount = 0;
      for (const r of rows) {
        const answer = subject === 'english' ? String(r['英文答案'] ?? '') : String(r['汉字答案'] ?? '');
        if (!answer.trim()) continue;
        const key = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // 去重：临时词条列表中同答案的跳过
        if (tempWords.some(a => a.answer === answer.trim())) { dupCount++; continue; }
        newWords.push({
          key,
          word_id: null, error_word_id: null,
          textbook_name: String(r['课本名称'] ?? ''),
          unit_no: Number(r['单元序号']) || 0,
          unit_name: String(r['单元名字'] ?? ''),
          page_no: subject === 'english' ? (r['页码'] ? Number(r['页码']) : null) : null,
          chinese_meaning: subject === 'english' ? String(r['中文释义'] ?? '') || null : null,
          part_of_speech: subject === 'english' ? String(r['词性'] ?? '') || null : null,
          pinyin: subject === 'chinese' ? String(r['拼音'] ?? '') || null : null,
          answer: answer.trim(),
          is_temporary: true, save_to_library: false,
        });
      }
      if (newWords.length > 0) {
        setTempWords(prev => [...prev, ...newWords]);
      }
      toast.success(`导入完成：新增 ${newWords.length} 条${dupCount > 0 ? `，重复跳过 ${dupCount} 条` : ''}`);
    } catch (err: any) {
      toast.error('导入失败：' + err.message);
    } finally {
      if (tempFileRef.current) tempFileRef.current.value = '';
    }
  };

  const publish = async () => {
    if (!family || !childId) { toast.error('请选择用户'); return; }
    if (added.length === 0) { toast.error('请至少加入一条词条'); return; }
    setSubmitting(true);
    try {
      const task = await createTask({
        family_id: family.id, member_id: childId, subject, title,
        star_per_word: starPerWord, mode,
      });
      try {
        await addTaskWords(task.id, added.map(a => ({
          word_id: a.word_id ?? null, error_word_id: a.error_word_id ?? null,
          textbook_name: a.textbook_name, unit_no: a.unit_no, unit_name: a.unit_name,
          page_no: a.page_no ?? null, chinese_meaning: a.chinese_meaning ?? null,
          part_of_speech: a.part_of_speech ?? null, pinyin: a.pinyin ?? null,
          answer: a.answer, is_temporary: a.is_temporary, save_to_library: a.save_to_library,
        })));
      } catch (err) {
        // 词条关联失败时清理已创建的空任务
        await deleteTask(task.id);
        throw err;
      }
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
      {!embedded && (
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-amber-500" />新建家默任务</h1>
        </div>
      )}

      {/* 基础配置 */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          <div>
            <label className="text-xs text-slate-500">选择用户</label>
            <Select value={selectedChildId} onChange={e => setSelectedChildId(e.target.value)}>
              <option value="">请选择孩子</option>
              {childMembers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-500">学科</label>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                onClick={() => onSubjectChange('english')}
                className={cn('flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  subject === 'english' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              >
                英语
              </button>
              <button
                onClick={() => onSubjectChange('chinese')}
                className={cn('flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  subject === 'chinese' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              >
                语文
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">任务模式</label>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                onClick={() => setMode('dictation')}
                className={cn('flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  mode === 'dictation' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              >
                默写模式
              </button>
              <button
                onClick={() => setMode('quick_review')}
                className={cn('flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  mode === 'quick_review' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              >
                快速复习
              </button>
            </div>
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
        {mode === 'quick_review' && (
          <p className="text-xs text-amber-600 mt-2">⚡ 快速复习模式：孩子点击卡片看答案后自判对错，即时生效，无需批改。</p>
        )}
      </Card>

      {/* 三栏来源 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* 词条库 */}
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm">从词条库选择</h3>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => {
                // 全选当前页 / 取消全选
                if (libSelected.size === libraryWords.length) {
                  setLibSelected(new Set());
                } else {
                  setLibSelected(new Set(libraryWords.map(w => w.id)));
                }
              }}>
                {libSelected.size === libraryWords.length && libraryWords.length > 0 ? '取消全选' : '全选'}
              </Button>
              {libSelected.size > 0 && (
                <Button size="sm" onClick={addFromLibrary}>加入({libSelected.size})</Button>
              )}
            </div>
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
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => {
                // 全选当前页 / 取消全选
                if (errSelected.size === dueErrors.length) {
                  setErrSelected(new Set());
                } else {
                  setErrSelected(new Set(dueErrors.map(w => w.id)));
                }
              }}>
                {errSelected.size === dueErrors.length && dueErrors.length > 0 ? '取消全选' : '全选'}
              </Button>
              {errSelected.size > 0 && (
                <Button size="sm" onClick={addFromErrors}>加入({errSelected.size})</Button>
              )}
            </div>
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
            <h3 className="font-medium text-sm">临时新增词条（{tempWords.length}）</h3>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={downloadTempTemplate}><Download className="w-3 h-3" />模板</Button>
              <Button size="sm" variant="secondary" onClick={() => tempFileRef.current?.click()}><Upload className="w-3 h-3" />导入</Button>
              <Button size="sm" onClick={() => setShowTemp(true)}><Plus className="w-3 h-3" />新增</Button>
            </div>
          </div>
          <p className="text-xs text-slate-400 mb-2">可添加临时词条，支持Excel批量导入。勾选后可批量加入任务或存入词条库。</p>
          <input ref={tempFileRef} type="file" accept=".xlsx,.xls" onChange={onTempFileChange} className="hidden" />
          {tempWords.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-1 px-1">
                <button onClick={toggleTempSelectAll} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                  {tempSelected.size === tempWords.length && tempWords.length > 0
                    ? <CheckSquare className="w-3.5 h-3.5 text-emerald-500" />
                    : <Square className="w-3.5 h-3.5" />}
                  {tempSelected.size === tempWords.length && tempWords.length > 0 ? '取消全选' : '全选'}
                </button>
                <span className="text-xs text-slate-400">已选 {tempSelected.size}/{tempWords.length}</span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {tempWords.map(w => (
                  <div key={w.key} className="flex items-center gap-2 p-1.5 bg-white rounded-lg border border-slate-100">
                    <button onClick={() => toggleTempSelect(w.key)} className="shrink-0">
                      {tempSelected.has(w.key)
                        ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                        : <Square className="w-4 h-4 text-slate-300" />}
                    </button>
                    <div className="text-xs min-w-0 flex-1">
                      <div className="font-medium truncate">{w.answer}</div>
                      <div className="text-slate-400 truncate">
                        {subject === 'english' ? w.chinese_meaning : w.pinyin}
                      </div>
                    </div>
                    <button onClick={() => removeTempWord(w.key)} className="p-1 text-red-400 hover:text-red-600 shrink-0">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              {/* 底部批量操作按钮 */}
              <div className="flex gap-2 mt-2 pt-2 border-t border-slate-100">
                <Button
                  size="sm"
                  variant="success"
                  onClick={batchMoveTempToTask}
                  disabled={tempSelected.size === 0}
                  className="flex-1"
                >
                  加入本次任务（{tempSelected.size}）
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={batchSaveTempToLibrary}
                  disabled={tempSelected.size === 0}
                  className="flex-1"
                >
                  存入词条库（{tempSelected.size}）
                </Button>
              </div>
            </>
          )}
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
              <label className="text-xs text-slate-500">课本名称（选填）</label>
              <Input value={tempForm.textbook_name} onChange={e => setTempForm({ ...tempForm, textbook_name: e.target.value })} placeholder="可不填" />
            </div>
            <div>
              <label className="text-xs text-slate-500">单元序号（选填）</label>
              <Input type="number" value={tempForm.unit_no === 0 ? '' : tempForm.unit_no} onChange={e => setTempForm({ ...tempForm, unit_no: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="可不填" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">单元名称（选填）</label>
            <Input value={tempForm.unit_name} onChange={e => setTempForm({ ...tempForm, unit_name: e.target.value })} placeholder="可不填" />
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
          <p className="text-xs text-slate-400">词条添加后可选择加入本次任务或保存到词条库</p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowTemp(false)}>取消</Button>
            <Button onClick={addTemp}>添加</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
