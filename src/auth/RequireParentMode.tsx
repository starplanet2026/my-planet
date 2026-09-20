import { useState, useEffect, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useModeStore } from '../store/modeStore';
import { PinGate } from '../components/parent/PinGate';
import { ROUTES } from '../lib/constants';

export function RequireParentMode({ children }: { children: ReactNode }) {
  const unlocked = useModeStore(s => s.parentUnlocked);
  const [showPin, setShowPin] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!unlocked) setShowPin(true);
  }, [unlocked]);

  if (!unlocked) {
    return <PinGate open={showPin} onClose={() => navigate(ROUTES.HOME)} />;
  }

  return <>{children}</>;
}
