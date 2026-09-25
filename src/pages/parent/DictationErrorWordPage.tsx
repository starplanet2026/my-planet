import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
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
import { Plus, ArrowLeft, Upload, Download, AlertCircle } from 'lucide-react';
import { listErrorWords, createErrorWord, importErrorWords } from '../../api/dictation';
import type { DictationErrorWord, DictationSubject } from '../../api/types';

const NODE_LABEL: Record<number, string> = { 1: '第1天', 2: '第2天', 4: '第4天', 7: '第7天', 15: '第15天' };

export function DictationErrorWordPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const currentChildId = useModeStore(s => s.currentChildId);
  const childId = currentChildId ?? '';
  const toast = useToastStore();

  const [subject, setSubject] = useState<DictationSubject | ''>('');
  const [words, setWords] = useState<DictationErrorWord[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    textbook_name: '', unit_no: 0, unit_name: '', pinyin: '', answer: '',
    chinese_meaning: '', part_of_speech: '',
  });

  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!childId) return;
    setLoading(true);
    try {
      const list = await listErrorWords(childId, subject || undefined);
      setWords(list);
    } catch (e: any) {
      toast.error('加载失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [subject, childId]);

  const submit = async () => {
    if (!childId) return;
    if (!form.answer.trim()) { toast.error('请填写答案'); return; }
    if (!subject) { toast.error('请选择学科'); return; }
    try {
      await createErrorWord(childId, {
        subject,
        textbook_name: form.textbook_name,
        unit_no: form.unit_no,
        unit_name: form.unit_name,
        chinese_meaning: subject === 'english' ? form.chinese_meaning || null : null,
        part_of_speech: subject === 'english' ? form.part_of_speech || null : null,
        pinyin: subject === 'chinese' ? form.pinyin || null : null,
        answer: form.answer.trim(),
      });
      toast.success('已添加到错词库');
      setShowModal(false);
      setForm({ textbook_name: '', unit_no: 0, unit_name: '', pinyin: '', answer: '', chinese_meaning: '', part_of_speech: '' });
      load();
    } catch (e: any) {
      toast.error('失败：' + e.message);
    }
  };

  const downloadTemplate = () => {
    const cols = subject === 'english'
      ? ['课本名称', '单元序号', '单元名字', '中文释义', '词性', '英文答案']
      : ['课本名称', '单元序号', '单元名字', '拼音', '汉字答案'];
    const ws = XLSX.utils.aoa_to_sheet([cols]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '错词');
    XLSX.writeFile(wb, `错词库模板-${subject === 'english' ? '英语' : '语文'}.xlsx`);
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !childId || !subject) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const payload = rows.map(r => ({
        subject,
        textbook_name: String(r['课本名称'] ?? ''),
        unit_no: Number(r['单元序号']) || 0,
        unit_name: String(r['单元名字'] ?? ''),
        chinese_meaning: subject === 'english' ? String(r['中文释义'] ?? '') || null : null,
        part_of_speech: subject === 'english' ? String(r['词性'] ?? '') || null : null,
        pinyin: subject === 'chinese' ? String(r['拼音'] ?? '') || null : null,
        answer: subject === 'english' ? String(r['英文答案'] ?? '') : String(r['汉字答案'] ?? ''),
      })).filter(r => r.answer);
      const result = await importErrorWords(childId, subject, payload);
      toast.success(`导入完成：成功 ${result.success}，重复 ${result.duplicate}，失败 ${result.failed}`);
      load();
    } catch (err: any) {
      toast.error('导入失败：' + err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
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
          <h1 className="text-xl font-bold flex items-center gap-2"><AlertCircle className="w-6 h-6 text-rose-500" />家默错词库</h1>
        </div>
      )}

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={subject} onChange={e => setSubject(e.target.value as DictationSubject | '')}>
            <option value="">全部学科</option>
            <option value="english">英语</option>
            <option value="chinese">语文</option>
          </Select>
          <Button onClick={() => setShowModal(true)}><Plus className="w-4 h-4" />手动添加错词</Button>
          {subject && (
            <>
              <Button variant="secondary" onClick={downloadTemplate}><Download className="w-4 h-4" />下载模板</Button>
              <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" />批量导入</Button>
            </>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFileChange} className="hidden" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {words.length === 0 ? (
          <EmptyState icon="📝" title="暂无错词" description="批改时标记错误的词条会自动进入错词库" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-2 text-left">学科</th>
                  <th className="p-2 text-left">答案</th>
                  {subject !== 'chinese' && <th className="p-2 text-left">中文释义</th>}
                  {subject !== 'english' && <th className="p-2 text-left">拼音</th>}
                  <th className="p-2 text-left">当前节点</th>
                  <th className="p-2 text-left">下次家默日</th>
                  <th className="p-2 text-left">状态</th>
                </tr>
              </thead>
              <tbody>
                {words.map(w => (
                  <tr key={w.id} className="border-t border-slate-100">
                    <td className="p-2">{w.subject === 'english' ? '英语' : '语文'}</td>
                    <td className="p-2 font-medium">{w.answer}</td>
                    {subject !== 'chinese' && <td className="p-2">{w.chinese_meaning ?? '-'}</td>}
                    {subject !== 'english' && <td className="p-2">{w.pinyin ?? '-'}</td>}
                    <td className="p-2">{NODE_LABEL[w.current_node] ?? `第${w.current_node}天`}</td>
                    <td className="p-2">{w.next_review_date}</td>
                    <td className="p-2">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs',
                        w.status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                        {w.status === 'in_progress' ? '进行中' : '已完成'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="手动添加错词">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500">学科</label>
            <Select value={subject} onChange={e => setSubject(e.target.value as DictationSubject | '')}>
              <option value="">请选择</option>
              <option value="english">英语</option>
              <option value="chinese">语文</option>
            </Select>
          </div>
          {subject && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">课本名称</label>
                  <Input value={form.textbook_name} onChange={e => setForm({ ...form, textbook_name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">单元序号</label>
                  <Input type="number" value={form.unit_no} onChange={e => setForm({ ...form, unit_no: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500">单元名字</label>
                <Input value={form.unit_name} onChange={e => setForm({ ...form, unit_name: e.target.value })} />
              </div>
              {subject === 'english' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500">中文释义</label>
                      <Input value={form.chinese_meaning} onChange={e => setForm({ ...form, chinese_meaning: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">词性</label>
                      <Input value={form.part_of_speech} onChange={e => setForm({ ...form, part_of_speech: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">英文答案</label>
                    <Input value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} />
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">拼音</label>
                    <Input value={form.pinyin} onChange={e => setForm({ ...form, pinyin: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">汉字答案</label>
                    <Input value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })} />
                  </div>
                </div>
              )}
            </>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={submit}>添加</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
