import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DictationWordManagePage } from './DictationWordManagePage';
import { DictationErrorWordPage } from './DictationErrorWordPage';
import { DictationTaskCreatePage } from './DictationTaskCreatePage';
import { DictationTaskManagePage } from './DictationTaskManagePage';
import { ROUTES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { ArrowLeft, BookOpen, AlertCircle, Sparkles, Plus, ListChecks } from 'lucide-react';

type Tab = 'words' | 'errors' | 'tasks';
type TaskSubTab = 'publish' | 'manage';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'tasks', label: '家默任务', icon: <Sparkles className="w-4 h-4" /> },
  { key: 'words', label: '家默词条库', icon: <BookOpen className="w-4 h-4" /> },
  { key: 'errors', label: '家默错词库', icon: <AlertCircle className="w-4 h-4" /> },
];

export function DictationManagePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('tasks');
  const [taskSubTab, setTaskSubTab] = useState<TaskSubTab>('publish');

  return (
    <div className="max-w-6xl mx-auto py-4 px-4">
      {/* 一级板块标题 + 返回 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(ROUTES.PARENT_DASHBOARD)} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold flex items-center gap-2">📚 家默管理</h1>
      </div>

      {/* 内部 Tab */}
      <div className="flex gap-1 mb-4 p-1 bg-slate-100 rounded-xl">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === t.key ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === 'words' && <DictationWordManagePage embedded />}
      {tab === 'errors' && <DictationErrorWordPage embedded />}
      {tab === 'tasks' && (
        <div className="space-y-3">
          {/* 任务子 Tab：发布 / 管理 */}
          <div className="flex gap-1 p-1 bg-slate-50 rounded-lg">
            <button
              onClick={() => setTaskSubTab('publish')}
              className={cn(
                'flex items-center gap-1.5 flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                taskSubTab === 'publish' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <Plus className="w-4 h-4" />发布新任务
            </button>
            <button
              onClick={() => setTaskSubTab('manage')}
              className={cn(
                'flex items-center gap-1.5 flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                taskSubTab === 'manage' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <ListChecks className="w-4 h-4" />管理已发布任务
            </button>
          </div>

          {taskSubTab === 'publish' ? <DictationTaskCreatePage embedded /> : <DictationTaskManagePage />}
        </div>
      )}
    </div>
  );
}
