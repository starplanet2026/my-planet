import { useState, useEffect, useCallback } from 'react';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { Plus, Trash2, Edit, Eye, EyeOff, Layers, Save, Upload } from 'lucide-react';
import {
  fetchGlobalLevels, createChallengeLevel, updateChallengeLevel, deleteChallengeLevel,
  uploadKnowledgeImage,
} from '../../api/challenges';
import { supabase } from '../../api/client';
import type { ChallengeLevel, ChallengeSubject, LevelTargetSection } from '../../api/types';

const DEFAULT_SUBJECTS: string[] = ['语文', '数学', '英语'];
const SECTIONS: LevelTargetSection[] = ['today_review', 'gap_check', 'advance'];

const SECTION_LABEL: Record<LevelTargetSection, string> = {
  today_review: '今日复习',
  gap_check: '疑难杂症',
  advance: '超前拓展',
};

const CUSTOM_SUBJECTS_KEY = 'challenge_custom_subjects';

function loadCustomSubjects(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SUBJECTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s: unknown) => typeof s === 'string') : [];
  } catch { return []; }
}

function saveCustomSubjects(list: string[]) {
  try { localStorage.setItem(CUSTOM_SUBJECTS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function LevelManageTab({ onSelectLevel }: { onSelectLevel?: (lv: ChallengeLevel) => void }) {
  const toast = useToastStore();
  const [levels, setLevels] = useState<ChallengeLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSubject, setFilterSubject] = useState<string>(''); // '' = 全部
  const [customSubjects, setCustomSubjects] = useState<string[]>(loadCustomSubjects());
  const [newSubjectName, setNewSubjectName] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingLevel, setEditingLevel] = useState<ChallengeLevel | null>(null);
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<ChallengeLevel | null>(null);
  const [showBatchImport, setShowBatchImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGlobalLevels(filterSubject || undefined);
      setLevels(data);
      if (data.length > 0) {
        const counts: Record<string, number> = {};
        const { data: qData } = await supabase
          .from('questions')
          .select('level_id')
          .in('level_id', data.map(l => l.id))
          .eq('is_active', true);
        if (qData) {
          for (const q of qData as { level_id: string }[]) {
            counts[q.level_id] = (counts[q.level_id] ?? 0) + 1;
          }
        }
        setQuestionCounts(counts);
      }
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filterSubject, toast]);

  useEffect(() => { load(); }, [load]);

  const handleTogglePublish = async (lv: ChallengeLevel) => {
    try {
      await updateChallengeLevel(lv.id, { published: !lv.published });
      toast.success(lv.published ? '已下线' : '已发布');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '操作失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteChallengeLevel(deleteConfirm.id);
      toast.success('关卡已删除');
      setDeleteConfirm(null);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  const handleAddCustomSubject = () => {
    const name = newSubjectName.trim();
    if (!name) { toast.error('请输入学科名称'); return; }
    if (DEFAULT_SUBJECTS.includes(name) || customSubjects.includes(name)) {
      toast.error('该学科已存在');
      return;
    }
    const next = [...customSubjects, name];
    setCustomSubjects(next);
    saveCustomSubjects(next);
    setNewSubjectName('');
    toast.success(`已添加学科"${name}"`);
  };

  const allSubjects = [...DEFAULT_SUBJECTS, ...customSubjects];

  return (
    <div>
      {/* 学科筛选栏：横向快捷按钮 + 自定义学科输入 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setFilterSubject('')}
          className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            filterSubject === '' ? 'bg-star-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
        >
          全部
        </button>
        {allSubjects.map(s => (
          <button
            key={s}
            onClick={() => setFilterSubject(s)}
            className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              filterSubject === s ? 'bg-star-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
          >
            {s}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <Input
            value={newSubjectName}
            onChange={e => setNewSubjectName(e.target.value)}
            placeholder="新建学科"
            className="w-28"
            onKeyDown={e => { if (e.key === 'Enter') handleAddCustomSubject(); }}
          />
          <Button variant="ghost" size="sm" onClick={handleAddCustomSubject}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-slate-400">{filterSubject ? `学科：${filterSubject}` : '全部学科'}（共 ${levels.length} 关）</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowBatchImport(true)}>
            <Upload className="w-4 h-4" /> 批量导入Excel
          </Button>
          <Button onClick={() => { setEditingLevel(null); setShowModal(true); }}>
            <Plus className="w-4 h-4" /> 新建关卡
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">加载中...</p>
      ) : levels.length === 0 ? (
        <EmptyState icon="📋" title="暂无关卡" description="新建关卡后可在题集中引用或独立发布到板块" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {levels.map(lv => {
            const qCount = questionCounts[lv.id] ?? 0;
            return (
              <Card key={lv.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-400 to-indigo-500 flex items-center justify-center text-white flex-shrink-0">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800">{lv.title || `关卡 ${lv.level_no}`}</h3>
                    {lv.description && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{lv.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{lv.subject ?? '未分类'}</span>
                      <span className="text-xs text-slate-400">{qCount} 题</span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full',
                        lv.target_section ? 'bg-sky-50 text-sky-600' : 'bg-slate-50 text-slate-400')}>
                        {lv.target_section ? SECTION_LABEL[lv.target_section] : '未设板块'}
                      </span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                        lv.published ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400')}>
                        {lv.published ? '已发布' : '未发布'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="ghost" size="sm" onClick={() => onSelectLevel?.(lv)}>
                    <Layers className="w-4 h-4" /> 管理题目
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleTogglePublish(lv)}
                    title={lv.published ? '下线' : '发布'}>
                    {lv.published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {lv.published ? '下线' : '发布'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setEditingLevel(lv); setShowModal(true); }}>
                    <Edit className="w-4 h-4" /> 编辑
                  </Button>
                  <Button variant="ghost" size="sm" danger onClick={() => setDeleteConfirm(lv)}>
                    <Trash2 className="w-4 h-4" /> 删除
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showModal && (
        <LevelEditModal
          level={editingLevel}
          customSubjects={customSubjects}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}

      {showBatchImport && (
        <BatchImportLevelsModal
          subjects={allSubjects}
          onClose={() => setShowBatchImport(false)}
          onImported={() => { setShowBatchImport(false); load(); }}
        />
      )}

      {deleteConfirm && (
        <Modal open onClose={() => setDeleteConfirm(null)} title="确认删除关卡" size="sm">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {(questionCounts[deleteConfirm.id] ?? 0) > 0
                ? `该关卡下存在 ${questionCounts[deleteConfirm.id]} 道题目，删除关卡将同步删除关卡以及全部关联题目，是否确认删除？`
                : `确认删除关卡"${deleteConfirm.title || deleteConfirm.level_no}"？删除后将清除所有题集对该关卡的引用记录。`}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setDeleteConfirm(null)}>取消</Button>
              <Button className="flex-1" onClick={handleDelete}>确认删除</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ====== 关卡编辑弹窗 ======
function LevelEditModal({ level, customSubjects, onClose, onSaved }: {
  level: ChallengeLevel | null;
  customSubjects: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToastStore();
  const isEdit = !!level;
  const [title, setTitle] = useState(level?.title ?? '');
  const [description, setDescription] = useState(level?.description ?? '');
  const [passReward, setPassReward] = useState(level?.pass_reward ?? 3);
  const [subject, setSubject] = useState<string>(level?.subject ?? '');
  const [targetSection, setTargetSection] = useState<LevelTargetSection | ''>(level?.target_section ?? '');
  const [published, setPublished] = useState(level?.published ?? false);
  const [kpText, setKpText] = useState(level?.knowledge_points ?? '');
  const [kpImages, setKpImages] = useState<string[]>(level?.knowledge_points_images ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const allSubjects = [...DEFAULT_SUBJECTS, ...customSubjects];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        const url = await uploadKnowledgeImage(f);
        urls.push(url);
      }
      setKpImages(prev => [...prev, ...urls]);
      toast.success('图片上传成功');
    } catch (e: any) {
      toast.error(e?.message ?? '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (passReward < 0) { toast.error('通关奖励不能为负数'); return; }
    setSaving(true);
    try {
      const payload = {
        level_no: level?.level_no ?? 1,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        pass_reward: passReward,
        subject: (subject || null) as ChallengeSubject | null,
        target_section: (targetSection || null) as LevelTargetSection | null,
        published,
        knowledge_points: kpText.trim() || null,
        knowledge_points_images: kpImages.length > 0 ? kpImages : null,
      };
      if (isEdit && level) {
        await updateChallengeLevel(level.id, payload);
        toast.success('关卡已更新');
      } else {
        await createChallengeLevel(payload);
        toast.success('关卡已创建');
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? '编辑关卡' : '新建关卡'} size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">关卡标题</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="如：第一单元练习" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">关卡描述</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="描述本关卡的学习目标、知识点范围等"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-star-400 resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">学科</label>
          <Select value={subject} onChange={e => setSubject(e.target.value)}>
            <option value="">未分类</option>
            {allSubjects.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">目标板块（发布后在此板块显示独立卡片）</label>
          <Select value={targetSection} onChange={e => setTargetSection(e.target.value as LevelTargetSection | '')}>
            <option value="">未设置（不生成独立卡片）</option>
            {SECTIONS.map(s => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">通关奖励星光值</label>
          <Input type="number" min={0} value={passReward} onChange={e => setPassReward(Number(e.target.value))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">发布状态</label>
          <div className="flex gap-2">
            <button onClick={() => setPublished(true)}
              className={cn('flex-1 py-2 rounded-lg text-sm', published ? 'bg-green-50 text-green-600 font-medium' : 'bg-slate-100 text-slate-500')}>
              <Eye className="w-4 h-4 inline-block mr-1" /> 已发布
            </button>
            <button onClick={() => setPublished(false)}
              className={cn('flex-1 py-2 rounded-lg text-sm', !published ? 'bg-slate-100 text-slate-500 font-medium' : 'bg-slate-100 text-slate-500')}>
              <EyeOff className="w-4 h-4 inline-block mr-1" /> 未发布
            </button>
          </div>
        </div>
        {/* 知识点 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">知识点（文字）</label>
          <textarea
            value={kpText}
            onChange={e => setKpText(e.target.value)}
            placeholder="每行一个知识点，答题前自动弹出，答题中可随时查看"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-star-400 resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">知识点（图片）</label>
          {kpImages.length > 0 && (
            <div className="space-y-2 mb-2">
              {kpImages.map((url, i) => (
                <div key={i} className="relative group">
                  <img src={url} alt={`知识点图 ${i + 1}`} className="w-full rounded-lg border border-slate-200" />
                  <button
                    onClick={() => setKpImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 p-1 rounded-full bg-red-500 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          <label className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 cursor-pointer">
            <Upload className="w-4 h-4" /> 上传图片
            <input type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">
            <Save className="w-4 h-4" /> {isEdit ? '保存' : '创建'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ====== 关卡+题目 批量导入弹窗（按关卡名称分组） ======
interface ParsedLevelItem {
  levelName: string;
  questionText: string;
  answer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  type: 'choice' | 'multi_choice' | 'math';
  options: string[];
}

function BatchImportLevelsModal({ subjects, onClose, onImported }: {
  subjects: string[];
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToastStore();
  const [parsed, setParsed] = useState<ParsedLevelItem[]>([]);
  const [fileName, setFileName] = useState('');
  const [importSubject, setImportSubject] = useState<string>(subjects[0] ?? '');
  const [importing, setImporting] = useState(false);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const mod = await import('xlsx');
      const XLSX = (mod as any).default ?? mod;
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[];

      // 识别解析列（含"解析"二字）
      let explKey: string | null = null;
      if (rows.length > 0) {
        explKey = Object.keys(rows[0]).find(k => k.includes('解析')) ?? null;
      }

      const items: ParsedLevelItem[] = [];
      let lastLevelName = '';
      for (const row of rows) {
        const levelName = String(row['关卡名称'] ?? row['关卡'] ?? '').trim();
        // 关卡名称为空时沿用上一行的关卡名称（同关卡题目）
        const effectiveLevel = levelName || lastLevelName;
        if (!effectiveLevel) continue; // 既无本关关名也无上级关名，跳过
        lastLevelName = effectiveLevel;

        const qText = String(row['题目'] ?? row['题干'] ?? '').trim();
        if (!qText) continue;

        const rawType = String(row['题型'] ?? row['类型'] ?? '单选').trim();
        const type: 'choice' | 'multi_choice' | 'math' =
          /多选/.test(rawType) ? 'multi_choice' :
          /数学|计算|math/i.test(rawType) ? 'math' : 'choice';

        const rawDiff = String(row['难度'] ?? '中等').trim();
        const difficulty: 'easy' | 'medium' | 'hard' =
          /简单|易|easy/i.test(rawDiff) ? 'easy' :
          /困难|难|hard/i.test(rawDiff) ? 'hard' : 'medium';

        const answer = String(row['正确答案'] ?? row['答案'] ?? '').trim();
        const expl = explKey ? String(row[explKey] ?? '').trim() : '';

        // 解析选项（选项A、选项B... 或 选项列用换行/分号分隔）
        let options: string[] = [];
        const optKeys = Object.keys(row).filter(k => /^选项[A-Z]?$/i.test(k) || k.startsWith('选项'));
        if (optKeys.length > 0) {
          options = optKeys
            .sort()
            .map(k => String(row[k] ?? '').trim())
            .filter(Boolean);
        } else {
          const optStr = String(row['选项'] ?? '').trim();
          if (optStr) {
            options = optStr.split(/[;\n；]/).map(s => s.trim()).filter(Boolean);
          }
        }

        items.push({ levelName: effectiveLevel, questionText: qText, answer, explanation: expl, difficulty, type, options });
      }

      setParsed(items);
      if (items.length === 0) {
        toast.error('未解析到有效题目，请检查Excel列名（需含"关卡名称"和"题目"列）');
      } else {
        toast.success(`已解析 ${items.length} 道题目，共 ${new Set(items.map(i => i.levelName)).size} 个关卡`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? '解析失败');
    }
  };

  const handleImport = async () => {
    if (parsed.length === 0) { toast.error('请先选择Excel文件'); return; }
    setImporting(true);
    try {
      // 按连续相同关卡名称分组（关卡名变化即新建关卡）
      const groups: { levelName: string; questions: ParsedLevelItem[] }[] = [];
      for (const item of parsed) {
        const last = groups[groups.length - 1];
        if (last && last.levelName === item.levelName) {
          last.questions.push(item);
        } else {
          groups.push({ levelName: item.levelName, questions: [item] });
        }
      }

      for (const group of groups) {
        // 创建关卡
        const { data: level, error: lvErr } = await supabase
          .from('challenge_levels')
          .insert({
            level_no: 1,
            title: group.levelName,
            subject: importSubject || null,
            published: false,
            status: 'active',
          })
          .select('id')
          .single();
        if (lvErr || !level) throw new Error(`创建关卡"${group.levelName}"失败：${lvErr?.message ?? '未知错误'}`);

        // 批量创建题目，绑定到该关卡
        const questionRows = group.questions.map((q, i) => ({
          challenge_set_id: null,
          level_id: level.id,
          type: q.type,
          question_text: q.questionText,
          options: q.options.length > 0 ? q.options : null,
          correct_answer: q.answer,
          explanation: q.explanation || null,
          difficulty: q.difficulty,
          display_order: i + 1,
          is_active: true,
        }));
        const { error: qErr } = await supabase.from('questions').insert(questionRows);
        if (qErr) throw new Error(`关卡"${group.levelName}"题目导入失败：${qErr.message}`);
      }

      toast.success(`成功导入 ${groups.length} 个关卡、${parsed.length} 道题目`);
      onImported();
    } catch (e: any) {
      toast.error(e?.message ?? '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="批量导入关卡+题目（Excel）" size="lg">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">本次导入关卡的学科</label>
          <Select value={importSubject} onChange={e => setImportSubject(e.target.value)}>
            <option value="">未分类</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <p className="text-xs text-slate-400 mt-1">所有导入的关卡将统一设置为此学科</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Excel 文件</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="text-sm"
          />
          {fileName && <p className="text-xs text-slate-400 mt-1">已选择：{fileName}</p>}
          <p className="text-xs text-slate-400 mt-1">
            列名要求：<span className="text-slate-600">关卡名称</span>（相同名称的连续行归入同一关卡）、
            <span className="text-slate-600">题目</span>、<span className="text-slate-600">正确答案</span>、
            可选：<span className="text-slate-600">解析</span>、<span className="text-slate-600">难度</span>、
            <span className="text-slate-600">题型</span>、<span className="text-slate-600">选项A</span>~<span className="text-slate-600">选项H</span>
          </p>
        </div>

        {parsed.length > 0 && (
          <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="p-2 text-left">关卡</th>
                  <th className="p-2 text-left">题目</th>
                  <th className="p-2 text-left">答案</th>
                  <th className="p-2 text-left">题型</th>
                  <th className="p-2 text-left">难度</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 max-w-[100px] truncate" title={p.levelName}>{p.levelName}</td>
                    <td className="p-2 max-w-[200px] truncate" title={p.questionText}>{p.questionText}</td>
                    <td className="p-2 max-w-[80px] truncate">{p.answer}</td>
                    <td className="p-2">{p.type === 'math' ? '数学' : p.type === 'multi_choice' ? '多选' : '单选'}</td>
                    <td className="p-2">{p.difficulty === 'easy' ? '简单' : p.difficulty === 'hard' ? '困难' : '中等'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">取消</Button>
          <Button onClick={handleImport} loading={importing} disabled={parsed.length === 0} className="flex-1">
            <Upload className="w-4 h-4" /> 确认导入
          </Button>
        </div>
      </div>
    </Modal>
  );
}
