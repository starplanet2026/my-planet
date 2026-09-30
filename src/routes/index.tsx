import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
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
import { ROUTES } from '../lib/constants';

// 按需加载：智慧星战、萌宠星球两大管理页面分包，首页不加载其代码
const ChallengeManagePage = lazy(() => import('../pages/parent/ChallengeManagePage').then(m => ({ default: m.ChallengeManagePage })));
const PetManagePage = lazy(() => import('../pages/parent/PetManagePage').then(m => ({ default: m.PetManagePage })));

function PageFallback() {
  return (
    <div className="py-16 flex justify-center">
      <Loading text="加载中..." />
    </div>
  );
}

function ParentLayout() {
  return (
    <RequireParentMode>
      <Outlet />
    </RequireParentMode>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<InitSetupPage />} />

      <Route path="/" element={<AppShell />}>
        {/* 孩子端 */}
        <Route index element={<Navigate to="/pet" replace />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="shop" element={<ShopPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="challenge" element={<ChallengePage />} />
        <Route path="challenge/dictation/:subject" element={<DictationPlayPage />} />
        <Route path="challenge/dictation/:subject/grade" element={<DictationGradePage />} />
        <Route path="challenge/recitation/:instanceId" element={<RecitationTaskPage />} />
        <Route path="pet" element={<PetPage />} />

        {/* 家长端 */}
        <Route path="parent" element={<ParentLayout />}>
          <Route index element={<Navigate to={ROUTES.PARENT_DASHBOARD} replace />} />
          <Route path="dashboard" element={<ParentDashboardPage />} />
          <Route path="tasks" element={<TaskManagePage />} />
          <Route path="verification" element={<VerificationPage />} />
          <Route path="shop" element={<ShopManagePage />} />
          <Route path="challenges" element={<Suspense fallback={<PageFallback />}><ChallengeManagePage /></Suspense>} />
          <Route path="pets" element={<Suspense fallback={<PageFallback />}><PetManagePage /></Suspense>} />
          <Route path="word-challenge" element={<WordChallengeManagePage />} />
          <Route path="question-reports" element={<QuestionReportManagePage />} />
          <Route path="dictation" element={<DictationManagePage />} />
          <Route path="recitation" element={<RecitationManagePage />} />
          <Route path="study-tasks" element={<StudyTaskManagePage />} />
          <Route path="study-review" element={<StudyReviewPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
