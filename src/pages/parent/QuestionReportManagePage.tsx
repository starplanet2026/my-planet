import { useState, useEffect, useCallback } from 'react';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { useToastStore } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { Flag, Trash2, Edit, Check } from 'lucide-react';
import {
  fetchQuestionReports,
  deleteQuestionReport,
  updateQuestion,
  QuestionReport,
} from '../../api/challenges';
import type { Question } from '../../api/types';

export function QuestionReportManagePage() {
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
  const [explanation, setExplanation] = useState('');

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
        setExplanation(q.explanation ?? '');
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
        options: options.length > 0 ? options : null,
        correct_answer: correctAnswer || null,
        explanation: explanation || null,
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

  const toggleCorrect = (letter: string) => {
    if (question?.type === 'multi_choice') {
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
    <Modal open onClose={onClose} title="编辑题目（全局生效）" size="md">
      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400">加载中...</div>
      ) : question ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 font-medium">题干</label>
            <Input value={questionText} onChange={e => setQuestionText(e.target.value)} placeholder="题目内容" />
          </div>

          {question.type !== 'math' && (
            <div>
              <label className="text-xs text-slate-500 font-medium">选项（点击字母标记正确答案）</label>
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
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {question.type === 'multi_choice' ? '多选题：点击多个字母标记正确答案' : '单选题：点击字母标记正确答案'}
              </p>
            </div>
          )}

          {question.type === 'math' && (
            <div>
              <label className="text-xs text-slate-500 font-medium">正确答案</label>
              <Input value={correctAnswer} onChange={e => setCorrectAnswer(e.target.value)} placeholder="如：42" />
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 font-medium">解析（选填）</label>
            <Input value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="解题思路" />
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
