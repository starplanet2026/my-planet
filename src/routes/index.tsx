import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { RequireParentMode } from '../auth/RequireParentMode';
import { InitSetupPage } from '../pages/setup/InitSetupPage';
import { TasksPage } from '../pages/child/TasksPage';
import { ShopPage } from '../pages/child/ShopPage';
import { ProfilePage } from '../pages/child/ProfilePage';
import { ChallengePage } from '../pages/child/ChallengePage';
import { PetPage } from '../pages/child/pet/PetPage';
import { ParentDashboardPage } from '../pages/parent/ParentDashboardPage';
import { TaskManagePage } from '../pages/parent/TaskManagePage';
import { VerificationPage } from '../pages/parent/VerificationPage';
import { ShopManagePage } from '../pages/parent/ShopManagePage';
import { PurchaseRedeemPage } from '../pages/parent/PurchaseRedeemPage';
import { ChallengeManagePage } from '../pages/parent/ChallengeManagePage';
import { PetManagePage } from '../pages/parent/PetManagePage';
import { ROUTES } from '../lib/constants';

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
        <Route path="pet" element={<PetPage />} />

        {/* 家长端 */}
        <Route path="parent" element={<ParentLayout />}>
          <Route index element={<Navigate to={ROUTES.PARENT_DASHBOARD} replace />} />
          <Route path="dashboard" element={<ParentDashboardPage />} />
          <Route path="tasks" element={<TaskManagePage />} />
          <Route path="verification" element={<VerificationPage />} />
          <Route path="shop" element={<ShopManagePage />} />
          <Route path="redeem" element={<PurchaseRedeemPage />} />
          <Route path="challenges" element={<ChallengeManagePage />} />
          <Route path="pets" element={<PetManagePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
