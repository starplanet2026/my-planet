import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { RequireParentMode } from '../auth/RequireParentMode';
import { InitSetupPage } from '../pages/setup/InitSetupPage';
import { TasksPage } from '../pages/child/TasksPage';
import { ShopPage } from '../pages/child/ShopPage';
import { ProfilePage } from '../pages/child/ProfilePage';
import { ChallengePage } from '../pages/child/ChallengePage';
import { PetPage } from '../pages/child/pet/PetPage';
import { DictationPlayPage } from '../pages/child/DictationPlayPage';
import { DictationGradePage } from '../pages/child/DictationGradePage';
import { ParentDashboardPage } from '../pages/parent/ParentDashboardPage';
import { TaskManagePage } from '../pages/parent/TaskManagePage';
import { VerificationPage } from '../pages/parent/VerificationPage';
import { ShopManagePage } from '../pages/parent/ShopManagePage';
import { WordChallengeManagePage } from '../pages/parent/WordChallengeManagePage';
import { QuestionReportManagePage } from '../pages/parent/QuestionReportManagePage';
import { DictationManagePage } from '../pages/parent/DictationManagePage';
import { RecitationManagePage } from '../pages/parent/RecitationManagePage';
import { StudyTaskManagePage } from '../pages/parent/StudyTaskManagePage';
import { StudyReviewPage } from '../pages/parent/StudyReviewPage';
import { RecitationTaskPage } from '../pages/child/RecitationTaskPage';
import { Loading } from '../components/common/Loading';
import { KeepAlive } from '../components/common/KeepAlive';
import { ROUTES } from '../lib/constants';

// 按需加载：智慧星战、萌宠星球两大管理页面分包，首页不加载其代码
const ChallengeManagePage = lazy(() => import('../pages/parent/ChallengeManagePage').then(m => ({ default: m.ChallengeManagePage })));
const PetManagePage = lazy(() => import('../pages/parent/PetManagePage').then(m => ({ default: m.PetManagePage })));
const PetTraitManagePage = lazy(() => import('../pages/parent/PetTraitManagePage').then(m => ({ default: m.PetTraitManagePage })));

function PageFallback() {
  return (
    <div className="py-16 flex justify-center">
      <Loading text="加载中..." />
    </div>
  );
}

/** 懒加载页面的 KeepAlive 包装：首次激活时才加载分包 */
function LazyKeepAlive({ when, children }: { when: (p: string) => boolean; children: ReactNode }) {
  return (
    <KeepAlive when={when}>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </KeepAlive>
  );
}

/**
 * 路径匹配工具
 * exact(p)  → 完全相等
 * prefix(p) → 以 p 开头（用于含动态段的路由，如 /parent/dictation）
 */
const exact = (p: string) => (pathname: string) => pathname === p;
const prefix = (p: string) => (pathname: string) => pathname === p || pathname.startsWith(p + '/');

// 孩子端静态路由（始终可用，进入 AppShell 后即参与 KeepAlive 缓存）
// 注：含动态参数的路由（dictation/:subject, recitation/:instanceId）不缓存，
// 避免参数变化时复用旧实例导致数据错乱
function ChildKeepAliveRoutes() {
  return (
    <>
      <KeepAlive when={exact(ROUTES.TASKS)}><TasksPage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.SHOP)}><ShopPage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.PROFILE)}><ProfilePage /></KeepAlive>
      <KeepAlive when={(p) => p === ROUTES.CHALLENGE}><ChallengePage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.PET)}><PetPage /></KeepAlive>
    </>
  );
}

// 家长端路由（RequireParentMode 解锁后才挂载，内部各自 KeepAlive）
function ParentKeepAliveRoutes() {
  return (
    <RequireParentMode>
      <KeepAlive when={exact(ROUTES.PARENT_DASHBOARD)}><ParentDashboardPage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.PARENT_TASKS)}><TaskManagePage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.PARENT_VERIFICATION)}><VerificationPage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.PARENT_SHOP)}><ShopManagePage /></KeepAlive>
      <LazyKeepAlive when={exact(ROUTES.PARENT_CHALLENGES)}><ChallengeManagePage /></LazyKeepAlive>
      <LazyKeepAlive when={exact(ROUTES.PARENT_PETS)}><PetManagePage /></LazyKeepAlive>
      <LazyKeepAlive when={exact(ROUTES.PARENT_PET_TRAITS)}><PetTraitManagePage /></LazyKeepAlive>
      <KeepAlive when={exact(ROUTES.PARENT_WORD_CHALLENGE)}><WordChallengeManagePage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.PARENT_QUESTION_REPORTS)}><QuestionReportManagePage /></KeepAlive>
      <KeepAlive when={prefix(ROUTES.PARENT_DICTATION)}><DictationManagePage /></KeepAlive>
      <KeepAlive when={prefix(ROUTES.PARENT_RECITATION)}><RecitationManagePage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.PARENT_STUDY_TASKS)}><StudyTaskManagePage /></KeepAlive>
      <KeepAlive when={exact(ROUTES.PARENT_STUDY_REVIEW)}><StudyReviewPage /></KeepAlive>
    </RequireParentMode>
  );
}

/**
 * AppShell 内容区：同时渲染孩子端与家长端的 KeepAlive 页面集合。
 * 静态页面首次进入时挂载并永久缓存，切换仅切换 display，不卸载、不重建。
 * 动态参数页面（dictation/:subject, recitation/:instanceId）不缓存，正常挂载/卸载。
 */
function AppShellContent() {
  const { pathname } = useLocation();

  // 根路径 / 重定向到 /pet（孩子端默认页）
  if (pathname === '/') {
    return <Navigate to={ROUTES.PET} replace />;
  }

  // 动态参数页面：不缓存，按需渲染
  const isDictationPlay = pathname.startsWith('/challenge/dictation/') && !pathname.endsWith('/grade');
  const isDictationGrade = pathname.startsWith('/challenge/dictation/') && pathname.endsWith('/grade');
  const isRecitation = pathname.startsWith('/challenge/recitation/');

  // 未知路径回退首页
  const isChild = ['/tasks', '/shop', '/profile', '/challenge', '/pet'].some(
    p => pathname === p || pathname.startsWith(p + '/')
  );
  const isParent = pathname.startsWith('/parent');
  if (!isChild && !isParent) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      {/* 静态页面：KeepAlive 缓存 */}
      <ChildKeepAliveRoutes />
      <ParentKeepAliveRoutes />
      {/* 动态参数页面：不缓存，每次进入重新挂载 */}
      {isDictationPlay && <DictationPlayPage />}
      {isDictationGrade && <DictationGradePage />}
      {isRecitation && <RecitationTaskPage />}
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<InitSetupPage />} />

      <Route path="/" element={<AppShell />}>
        {/* 用单一路由承载 KeepAlive 渲染，避免 React Router 卸载切换 */}
        <Route path="*" element={<AppShellContent />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
