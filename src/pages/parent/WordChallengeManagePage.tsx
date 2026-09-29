import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../../store/familyStore';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { Avatar } from '../../components/common/Avatar';
import { useToastStore } from '../../store/toastStore';
import { ROUTES } from '../../lib/constants';
import {
  ArrowLeft, Plus, Trash2, BookOpen, Upload, Pencil, GripVertical,
} from 'lucide-react';
import {
  fetchPetWords, createPetWord, createPetWordsBatch, deletePetWord, updatePetWord,
  batchDeletePetWords,
  fetchWordBooks, createWordBook, deleteWordBook,
  reorderWordBooks, reorderWordsInBook,
  fetchGameWordStats,
} from '../../api/pets';
import type { PetWord, PetWordBook, GameWordStat } from '../../api/types';

export function WordChallengeManagePage() {
  const navigate = useNavigate();
  const toast = useToastStore();
  const members = useFamilyStore(s => s.members);
  const children = members.filter(m => m.role === 'child');

  // 词书列表 + 选中词书
  const [books, setBooks] = useState<PetWordBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<PetWordBook | null>(null);
  const [words, setWords] = useState<PetWord[]>([]);
  const [loading, setLoading] = useState(true);

  // 新建词书
  const [newBookTitle, setNewBookTitle] = useState('');
  const [creatingBook, setCreatingBook] = useState(false);

  // 新增单词（词书详情内）
  const [en, setEn] = useState('');
  const [cnVal, setCnVal] = useState('');
  const [pos, setPos] = useState('');
  const [pos2, setPos2] = useState('');
  const [adding, setAdding] = useState(false);

  // 编辑单词
  const [editingWord, setEditingWord] = useState<PetWord | null>(null);
  const [editEn, setEditEn] = useState('');
  const [editCn, setEditCn] = useState('');
  const [editPos, setEditPos] = useState('');
  const [editPos2, setEditPos2] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Excel 导入
  const [excelImporting, setExcelImporting] = useState(false);
  const excelFileRef = useRef<HTMLInputElement>(null);

  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  // 用户数据-单词挑战统计
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [wordStats, setWordStats] = useState<Record<string, GameWordStat>>({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [wrongFilter, setWrongFilter] = useState<number>(0);

  // 拖拽排序
  const [draggedBookIdx, setDraggedBookIdx] = useState<number | null>(null);
  const [draggedWordIdx, setDraggedWordIdx] = useState<number | null>(null);

  const loadBooks = async () => {
    try {
      setLoading(true);
      setBooks(await fetchWordBooks());
    } catch (e: any) {
      toast.error(e?.message ?? '加载词书失败');
    } finally {
      setLoading(false);
    }
  };

  const loadWords = async (bookId: string) => {
    try {
      setWords(await fetchPetWords(bookId));
    } catch (e: any) {
      toast.error(e?.message ?? '加载单词失败');
    }
  };

  useEffect(() => {
    loadBooks();
  }, []);

  useEffect(() => {
    if (selectedBook) {
      loadWords(selectedBook.id);
      setSelectedIds(new Set());
    } else {
      setWords([]);
    }
  }, [selectedBook?.id]);

  useEffect(() => {
    if (!selectedChildId) {
      if (children.length > 0) setSelectedChildId(children[0].id);
      return;
    }
    setStatsLoading(true);
    fetchGameWordStats(selectedChildId)
      .then(arr => {
        const map: Record<string, GameWordStat> = {};
        for (const s of arr) map[s.word_id] = s;
        setWordStats(map);
      })
      .catch(e => toast.error(e?.message ?? '加载单词统计失败'))
      .finally(() => setStatsLoading(false));
  }, [selectedChildId, children.length]);

  const handleCreateBook = async () => {
    if (!newBookTitle.trim()) {
      toast.warning('请输入词书名称');
      return;
    }
    setCreatingBook(true);
    try {
      await createWordBook(newBookTitle.trim());
      toast.success('词书已创建');
      setNewBookTitle('');
      loadBooks();
    } catch (e: any) {
      toast.error(e?.message ?? '创建失败');
    } finally {
      setCreatingBook(false);
    }
  };

  const handleDeleteBook = async (book: PetWordBook) => {
    if (!confirm(`确定删除词书「${book.title}」吗？词书内的单词将一并删除。`)) return;
    try {
      await deleteWordBook(book.id);
      toast.success('词书已删除');
      loadBooks();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  const handleBookDragStart = (idx: number) => setDraggedBookIdx(idx);
  const handleBookDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedBookIdx === null || draggedBookIdx === idx) return;
    const next = [...books];
    const [moved] = next.splice(draggedBookIdx, 1);
    next.splice(idx, 0, moved);
    setBooks(next);
    setDraggedBookIdx(idx);
  };
  const handleBookDragEnd = async () => {
    if (draggedBookIdx !== null) {
      try {
        await reorderWordBooks(books.map(b => b.id));
      } catch (e: any) {
        toast.error(e?.message ?? '排序保存失败');
        loadBooks();
      }
    }
    setDraggedBookIdx(null);
  };

  const handleAddWord = async () => {
    if (!selectedBook) return;
    if (!en.trim() || !cnVal.trim()) {
      toast.warning('请填写英文和中文');
      return;
    }
    setAdding(true);
    try {
      await createPetWord(
        selectedBook.id, en.trim(), cnVal.trim(),
        pos.trim() || undefined, pos2.trim() || undefined,
      );
      toast.success('已添加');
      setEn(''); setCnVal(''); setPos(''); setPos2('');
      loadWords(selectedBook.id);
    } catch (e: any) {
      toast.error(e?.message ?? '添加失败');
    } finally {
      setAdding(false);
    }
  };

  const openEditWord = (w: PetWord) => {
    setEditingWord(w);
    setEditEn(w.word_en);
    setEditCn(w.word_cn);
    setEditPos(w.part_of_speech ?? '');
    setEditPos2(w.part_of_speech_2 ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editingWord) return;
    if (!editEn.trim() || !editCn.trim()) {
      toast.warning('请填写英文和中文');
      return;
    }
    setEditSaving(true);
    try {
      await updatePetWord(editingWord.id, {
        word_en: editEn.trim(),
        word_cn: editCn.trim(),
        part_of_speech: editPos.trim() || null,
        part_of_speech_2: editPos2.trim() || null,
      });
      toast.success('已保存');
      setEditingWord(null);
      if (selectedBook) loadWords(selectedBook.id);
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteWord = async (id: string) => {
    if (!selectedBook) return;
    try {
      await deletePetWord(id);
      toast.success('已删除');
      loadWords(selectedBook.id);
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBook) return;
    setExcelImporting(true);
    try {
      const mod = await import('xlsx');
      const XLSX = (mod as any).default ?? mod;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error('Excel 中未找到工作表');
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length === 0) throw new Error('Excel 中无数据');

      const firstRow = rows[0].map(c => String(c).toLowerCase().trim());
      const hasHeader = firstRow.some(c =>
        c.includes('英文') || c.includes('english') || c.includes('词性') || c.includes('pos') || c.includes('中文') || c.includes('chinese')
      );
      const dataRows = hasHeader ? rows.slice(1) : rows;

      const parsed: { en: string; cn: string; pos?: string; pos2?: string }[] = [];
      for (const row of dataRows) {
        const en = String(row[0] ?? '').trim();
        const pos = String(row[1] ?? '').trim();
        const pos2 = String(row[2] ?? '').trim();
        const cn = String(row[3] ?? '').trim();
        if (en && cn) {
          parsed.push({ en, cn, pos: pos || undefined, pos2: pos2 || undefined });
        }
      }

      if (parsed.length === 0) {
        toast.warning('未解析到有效单词，Excel 格式：英文 | 词性 | 词性2 | 中文');
        return;
      }

      await createPetWordsBatch(selectedBook.id, parsed);
      toast.success(`Excel 导入成功：${parsed.length} 个单词`);
      loadWords(selectedBook.id);
    } catch (e: any) {
      toast.error(e?.message ?? 'Excel 导入失败');
    } finally {
      setExcelImporting(false);
      if (excelFileRef.current) excelFileRef.current.value = '';
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredWords = wrongFilter > 0
    ? words.filter(w => (wordStats[w.id]?.wrong_count ?? 0) >= wrongFilter)
    : words;

  const toggleSelectAll = () => {
    if (filteredWords.length > 0 && filteredWords.every(w => selectedIds.has(w.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredWords.map(w => w.id)));
    }
  };

  const handleBatchDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || !selectedBook) return;
    setBatchLoading(true);
    try {
      await batchDeletePetWords(ids);
      toast.success(`已删除 ${ids.length} 个单词`);
      setSelectedIds(new Set());
      loadWords(selectedBook.id);
    } catch (e: any) {
      toast.error(e?.message ?? '批量删除失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const handleWordDragStart = (idx: number) => setDraggedWordIdx(idx);
  const handleWordDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedWordIdx === null || draggedWordIdx === idx) return;
    const next = [...words];
    const [moved] = next.splice(draggedWordIdx, 1);
    next.splice(idx, 0, moved);
    setWords(next);
    setDraggedWordIdx(idx);
  };
  const handleWordDragEnd = async () => {
    if (draggedWordIdx !== null) {
      try {
        await reorderWordsInBook(words.map(w => w.id));
      } catch (e: any) {
        toast.error(e?.message ?? '排序保存失败');
        if (selectedBook) loadWords(selectedBook.id);
      }
    }
    setDraggedWordIdx(null);
  };

  // ===== 渲染：词书详情 =====
  if (selectedBook) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedBook(null)} className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold text-slate-800">{selectedBook.title}</h2>
          <span className="text-xs text-slate-400">{words.length} 词</span>
        </div>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">新增单词</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={en} onChange={e => setEn(e.target.value)} placeholder="英文，如 apple" className="flex-1" />
            <Input value={pos} onChange={e => setPos(e.target.value)} placeholder="词性，如 n." className="sm:w-24" />
            <Input value={pos2} onChange={e => setPos2(e.target.value)} placeholder="词性2，如 v." className="sm:w-24" />
            <Input value={cnVal} onChange={e => setCnVal(e.target.value)} placeholder="中文，如 苹果" className="flex-1" />
            <Button onClick={handleAddWord} loading={adding} className="sm:w-auto">
              <Plus className="w-4 h-4" /> 添加
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-slate-700">Excel 导入</h3>
            <input ref={excelFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} className="hidden" />
            <Button onClick={() => excelFileRef.current?.click()} loading={excelImporting} size="sm" variant="secondary">
              <Upload className="w-4 h-4" /> 选择 Excel 文件
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            格式：第1列英文 | 第2列词性 | 第3列词性2 | 第4列中文（支持表头行自动跳过；无词性的列留空）
          </p>
        </Card>

        {children.length > 0 && (
          <Card className="p-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium flex-shrink-0">选择用户</span>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {children.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedChildId(c.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                        selectedChildId === c.id
                          ? 'bg-purple-400 text-white shadow-sm'
                          : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                      }`}
                    >
                      <Avatar emoji={c.avatar_emoji} size="sm" /> {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium flex-shrink-0">错误次数 ≥</span>
                <Input
                  type="number"
                  min={0}
                  value={wrongFilter || ''}
                  onChange={e => setWrongFilter(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="0"
                  className="w-20"
                />
                {wrongFilter > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setWrongFilter(0)}>
                    清除筛选
                  </Button>
                )}
                {statsLoading && <span className="text-xs text-slate-400">加载中...</span>}
              </div>
            </div>
          </Card>
        )}

        <div>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filteredWords.length > 0 && filteredWords.every(w => selectedIds.has(w.id))}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                />
                <span className="text-sm font-semibold text-slate-700">
                  单词列表（{filteredWords.length}{wrongFilter > 0 ? `/${words.length}` : ''}）
                </span>
                {selectedIds.size > 0 && (
                  <span className="text-xs text-amber-600">已选 {selectedIds.size}</span>
                )}
              </label>
            </div>
            {selectedIds.size > 0 && (
              <div className={`flex items-center gap-2 flex-wrap ${batchLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Button variant="ghost" size="sm" danger onClick={handleBatchDelete} disabled={batchLoading}>
                  <Trash2 className="w-4 h-4" /> 删除({selectedIds.size})
                </Button>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-400 mb-2">提示：拖动单词卡片可调整顺序</p>
          {filteredWords.length === 0 ? (
            <EmptyState icon="📚" title={wrongFilter > 0 ? "无符合条件的单词" : "暂无单词"} description={wrongFilter > 0 ? "尝试降低错误次数筛选值" : "新增或批量导入单词"} />
          ) : (
            <div className="space-y-2">
              {filteredWords.map((w, idx) => {
                const checked = selectedIds.has(w.id);
                const stat = selectedChildId ? wordStats[w.id] : undefined;
                return (
                  <div
                    key={w.id}
                    draggable
                    onDragStart={() => handleWordDragStart(idx)}
                    onDragOver={(e: React.DragEvent) => handleWordDragOver(e, idx)}
                    onDragEnd={handleWordDragEnd}
                    className={`bg-white rounded-cute shadow-sm border p-3 transition-colors cursor-move ${checked ? 'border-amber-400 bg-amber-50/50' : 'border-star-100'} ${draggedWordIdx === idx ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(w.id)}
                          className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400 flex-shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-400 font-mono flex-shrink-0" title="排序编号">
                              #{w.display_order ?? 0}
                            </span>
                            <span className="font-medium text-slate-800 truncate">{w.word_en}</span>
                            {w.part_of_speech && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-purple-100 text-purple-600 flex-shrink-0">
                                {w.part_of_speech}
                              </span>
                            )}
                            {w.part_of_speech_2 && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-600 flex-shrink-0">
                                {w.part_of_speech_2}
                              </span>
                            )}
                            {w.needs_review && (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0" title="待复习">
                                复习
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 truncate">{w.word_cn}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {stat && (
                          <div className="flex items-center gap-1 text-[10px]">
                            <span className="text-slate-400">挑战{stat.challenge_count}</span>
                            {stat.wrong_count > 0 && (
                              <span className="text-red-500 font-medium">错{stat.wrong_count}</span>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => openEditWord(w)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors flex-shrink-0"
                          aria-label="编辑"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteWord(w.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
                          aria-label="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Modal open={!!editingWord} onClose={() => setEditingWord(null)} title="编辑单词">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 font-medium">英文</label>
              <Input value={editEn} onChange={e => setEditEn(e.target.value)} placeholder="英文" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-slate-500 font-medium">词性</label>
                <Input value={editPos} onChange={e => setEditPos(e.target.value)} placeholder="词性，如 n.（无则留空）" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-500 font-medium">词性2</label>
                <Input value={editPos2} onChange={e => setEditPos2(e.target.value)} placeholder="词性2，如 v.（无则留空）" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">中文</label>
              <Input value={editCn} onChange={e => setEditCn(e.target.value)} placeholder="中文" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditingWord(null)} className="flex-1">取消</Button>
              <Button onClick={handleSaveEdit} loading={editSaving} className="flex-1">保存</Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // ===== 渲染：词书列表 =====
  if (loading) return <Loading />;
  return (
    <div className="space-y-4">
      {/* 新建词书 */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">新建词书</h3>
        <div className="flex gap-2">
          <Input
            value={newBookTitle}
            onChange={e => setNewBookTitle(e.target.value)}
            placeholder="词书名称，如：五年级下册书后词表"
            className="flex-1"
            onKeyDown={e => { if (e.key === 'Enter') handleCreateBook(); }}
          />
          <Button onClick={handleCreateBook} loading={creatingBook} className="sm:w-auto">
            <Plus className="w-4 h-4" /> 新建
          </Button>
        </div>
        <p className="text-xs text-slate-400 mt-2">新增词书默认追加在列表末尾</p>
      </Card>

      {/* 词书列表 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-700">词书列表（{books.length}）</h3>
          <span className="text-xs text-slate-400">拖拽调整先后顺序</span>
        </div>
        {books.length === 0 ? (
          <EmptyState icon="📖" title="暂无词书" description="新建第一本词书开始管理单词" />
        ) : (
          <div className="space-y-2">
            {books.map((book, idx) => (
              <div
                key={book.id}
                draggable
                onDragStart={() => handleBookDragStart(idx)}
                onDragOver={(e: React.DragEvent) => handleBookDragOver(e, idx)}
                onDragEnd={handleBookDragEnd}
                className={`bg-white rounded-cute shadow-sm border border-star-100 p-4 transition-colors cursor-move ${draggedBookIdx === idx ? 'opacity-40' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="w-5 h-5 text-slate-300 flex-shrink-0" />
                  <button onClick={() => setSelectedBook(book)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white flex-shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 truncate">{book.title}</span>
                        <span className="text-xs text-slate-400 flex-shrink-0">第 {idx + 1} 本</span>
                      </div>
                      <p className="text-xs text-slate-500">点击进入单词管理</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDeleteBook(book)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
                    aria-label="删除词书"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
