import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input, Textarea, Select } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { ROUTES } from '../../lib/constants';
import { Flag, Trash2, Edit, Check, ArrowLeft } from 'lucide-react';
import {
  fetchQuestionReports,
  deleteQuestionReport,
  updateQuestion,
  QuestionReport,
} from '../../api/challenges';
import type { Question } from '../../api/types';

export function QuestionReportManagePage() {
  const navigate = useNavigate();
  const toast = useToastStore();
  const [reports, setReports] = useState<QuestionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingReport, setEditingReport] = useState<QuestionReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await fetchQuestionReports());
    } catch (e: any) {
      toast.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此报错记录？')) return;
    try {
      await deleteQuestionReport(id);
      toast.success('已删除');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? '删除失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(ROUTES.PARENT_DASHBOARD)}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Flag className="w-5 h-5 text-red-400" />
        <h2 className="text-lg font-bold text-slate-800">题目报错</h2>
        <span className="text-xs text-slate-400">{reports.length} 条</span>
      </div>

      {loading ? (
        <Loading />
      ) : reports.length === 0 ? (
        <EmptyState icon="✅" title="暂无报错记录" description="用户举报的错题会显示在这里" />
      ) : (
        <div className="space-y-2">
          {reports.map(r => (
            <Card key={r.id} className="p-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                  <Flag className="w-4 h-4 text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 break-words">
                    {r.question_text_snapshot || '（无题干快照）'}
                  </p>
                  {r.reason && (
                    <p className="text-xs text-amber-600 mt-1">反馈：{r.reason}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-400">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                      {r.question_id.slice(0, 8)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditingReport(r)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                    title="在线编辑题目"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="删除报错记录"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editingReport && (
        <EditReportedQuestionModal
          report={editingReport}
          onClose={() => setEditingReport(null)}
          onSaved={() => { setEditingReport(null); toast.success('题目已更新，全局生效'); }}
        />
      )}
    </div>
  );
}

// ====== 在线编辑被举报的题目 ======
function EditReportedQuestionModal({
  report,
  onClose,
  onSaved,
}: {
  report: QuestionReport;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToastStore();
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 编辑表单
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [answer2, setAnswer2] = useState('');
  const [explanation, setExplanation] = useState('');
  const [qType, setQType] = useState<Question['type']>('choice');
  const [difficulty, setDifficulty] = useState<Question['difficulty']>('medium');

  useEffect(() => {
    (async () => {
      try {
        // 直接查表获取题目
        const { supabase } = await import('../../api/client');
        const { data, error } = await supabase
          .from('questions')
          .select('*')
          .eq('id', report.question_id)
          .single();
        if (error) throw error;
        const q = data as Question;
        setQuestion(q);
        setQuestionText(q.question_text);
        setOptions(q.options ?? []);
        setCorrectAnswer(q.correct_answer ?? '');
        setAnswer2(q.answer2 ?? '');
        setExplanation(q.explanation ?? '');
        setQType(q.type);
        setDifficulty(q.difficulty);
      } catch (e: any) {
        toast.error(e?.message ?? '加载题目失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [report.question_id]);

  const handleSave = async () => {
    if (!question) return;
    if (!questionText.trim()) {
      toast.warning('请填写题干');
      return;
    }
    setSaving(true);
    try {
      await updateQuestion(question.id, {
        question_text: questionText.trim(),
        options: (qType === 'choice' || qType === 'multi_choice') && options.length > 0 ? options : null,
        correct_answer: correctAnswer || null,
        answer2: qType === 'fill_blank' && answer2 ? answer2 : null,
        explanation: explanation || null,
        type: qType,
        difficulty,
      });
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const updateOption = (idx: number, val: string) => {
    setOptions(prev => prev.map((o, i) => i === idx ? val : o));
  };

  const addOption = () => {
    if (options.length >= 8) {
      toast.warning('最多 8 个选项');
      return;
    }
    setOptions(prev => [...prev, '']);
  };

  const removeOption = (idx: number) => {
    const letter = String.fromCharCode(65 + idx);
    setOptions(prev => prev.filter((_, i) => i !== idx));
    setCorrectAnswer(prev => prev.replace(new RegExp(letter, 'g'), ''));
  };

  const toggleCorrect = (letter: string) => {
    if (qType === 'multi_choice') {
      setCorrectAnswer(prev => {
        if (prev.includes(letter)) {
          return prev.replace(new RegExp(letter, 'g'), '');
        }
        return prev + letter;
      });
    } else {
      setCorrectAnswer(letter);
    }
  };

  return (
    <Modal open onClose={onClose} title="编辑题目（全局生效）" size="lg">
      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400">加载中...</div>
      ) : question ? (
        <div className="space-y-4">
          {/* 题型 + 难度 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium">题型</label>
              <Select value={qType} onChange={e => setQType(e.target.value as Question['type'])}>
                <option value="choice">单选题</option>
                <option value="multi_choice">多选题</option>
                <option value="fill_blank">填空题</option>
                <option value="math">数学计算</option>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">难度</label>
              <Select value={difficulty} onChange={e => setDifficulty(e.target.value as Question['difficulty'])}>
                <option value="easy">简单</option>
                <option value="medium">中等</option>
                <option value="hard">困难</option>
              </Select>
            </div>
          </div>

          {/* 题干 */}
          <div>
            <label className="text-xs text-slate-500 font-medium">题干</label>
            <Textarea value={questionText} onChange={e => setQuestionText(e.target.value)} placeholder="题目内容（支持多行）" rows={3} />
          </div>

          {/* 选项：仅选择类题型 */}
          {(qType === 'choice' || qType === 'multi_choice') && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-500 font-medium">选项（点击字母标记正确答案）</label>
                <button onClick={addOption} className="text-xs text-star-500 hover:text-star-600">+ 添加选项</button>
              </div>
              <div className="space-y-2">
                {options.map((opt, i) => {
                  const letter = String.fromCharCode(65 + i);
                  const isCorrect = correctAnswer.includes(letter);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <button
                        onClick={() => toggleCorrect(letter)}
                        className={cn('w-7 h-7 rounded-lg text-xs font-bold flex-shrink-0',
                          isCorrect ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400')}
                      >
                        {letter}
                      </button>
                      <Input
                        value={opt}
                        onChange={e => updateOption(i, e.target.value)}
                        placeholder={`选项 ${letter}`}
                        className="flex-1"
                      />
                      <button onClick={() => removeOption(i)} className="text-slate-300 hover:text-red-500 p-1" title="删除选项">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
                {options.length === 0 && (
                  <p className="text-xs text-slate-400">暂无选项，点击「添加选项」</p>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {qType === 'multi_choice' ? '多选题：可点击多个字母标记正确答案' : '单选题：点击字母标记唯一正确答案'}
              </p>
            </div>
          )}

          {/* 正确答案：填空题 / 数学题直接填写 */}
          {(qType === 'fill_blank' || qType === 'math') && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-500 font-medium">
                  正确答案{qType === 'fill_blank' ? '（第一空）' : ''}
                </label>
                <Input
                  value={correctAnswer}
                  onChange={e => setCorrectAnswer(e.target.value)}
                  placeholder={qType === 'math' ? '如：42' : '如：天空'}
                />
              </div>
              {qType === 'fill_blank' && (
                <div>
                  <label className="text-xs text-slate-500 font-medium">正确答案2（第二空，选填）</label>
                  <Input
                    value={answer2}
                    onChange={e => setAnswer2(e.target.value)}
                    placeholder="双空填空题的第二空答案，单空题留空"
                  />
                </div>
              )}
            </div>
          )}

          {/* 解析 */}
          <div>
            <label className="text-xs text-slate-500 font-medium">解析（选填）</label>
            <Textarea value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="解题思路或答案解释" rows={2} />
          </div>

          {/* 题目预览卡片 */}
          <div>
            <label className="text-xs text-slate-500 font-medium">题目预览</label>
            <Card className="p-3 bg-slate-50">
              <div className="flex items-center gap-2 mb-2">
                <span className={cn('text-xs px-1.5 py-0.5 rounded',
                  difficulty === 'easy' ? 'bg-emerald-100 text-emerald-600' :
                  difficulty === 'hard' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600')}>
                  {difficulty === 'easy' ? '简单' : difficulty === 'hard' ? '困难' : '中等'}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600">
                  {qType === 'multi_choice' ? '多选题' : qType === 'fill_blank' ? '填空题' : qType === 'math' ? '数学计算' : '单选题'}
                </span>
              </div>
              <p className="text-sm text-slate-800 break-words mb-2">{questionText || '（题干）'}</p>
              {(qType === 'choice' || qType === 'multi_choice') && options.length > 0 && (
                <div className="space-y-1">
                  {options.map((opt, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const isCorrect = correctAnswer.includes(letter);
                    return (
                      <div key={i} className={cn('flex items-center gap-2 text-sm', isCorrect ? 'text-emerald-600 font-medium' : 'text-slate-600')}>
                        <span className="w-5 text-center">{letter}.</span>
                        <span className="flex-1 break-words">{opt || `（选项${letter}）`}</span>
                        {isCorrect && <span className="text-xs">✓ 正确答案</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {(qType === 'fill_blank' || qType === 'math') && correctAnswer && (
                <p className="text-sm text-emerald-600">
                  正确答案：{correctAnswer}{answer2 ? ` / ${answer2}` : ''}
                </p>
              )}
              {explanation && (
                <p className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-200">解析：{explanation}</p>
              )}
            </Card>
          </div>

          {report.reason && (
            <div className="bg-amber-50 rounded-lg p-2">
              <p className="text-xs text-amber-600">用户反馈：{report.reason}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={onClose}>取消</Button>
            <Button className="flex-1" loading={saving} onClick={handleSave}>
              <Check className="w-4 h-4" /> 保存
            </Button>
          </div>
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-red-500">题目未找到</div>
      )}
    </Modal>
  );
}
