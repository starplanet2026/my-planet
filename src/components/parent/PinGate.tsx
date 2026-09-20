import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Lock } from 'lucide-react';
import { useModeStore } from '../../store/modeStore';
import { useToastStore } from '../../store/toastStore';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../lib/constants';

interface PinGateProps {
  open: boolean;
  onClose: () => void;
}

export function PinGate({ open, onClose }: PinGateProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const navigate = useNavigate();

  const { unlockParent, setupParentPin, checkPinConfigured, pinConfigured, isUnlocking, unlockError } = useModeStore();
  const toast = useToastStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // 首次打开时检查是否已设置 PIN
  useEffect(() => {
    if (open && pinConfigured === null) {
      checkPinConfigured();
    }
  }, [open, pinConfigured, checkPinConfigured]);

  // 首次设置 PIN
  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) { toast.error('PIN 码至少 4 位'); return; }
    if (pin !== confirmPin) { toast.error('两次 PIN 码不一致'); return; }
    const ok = await setupParentPin(pin);
    if (ok) {
      toast.success('PIN 码设置成功，已进入家长模式');
      onClose();
      setPin('');
      setConfirmPin('');
      navigate(ROUTES.PARENT_DASHBOARD);
    } else {
      toast.error(unlockError || '设置失败');
      setPin('');
      setConfirmPin('');
      inputRef.current?.focus();
    }
  };

  // 验证已有 PIN
  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await unlockParent(pin);
    if (ok) {
      toast.success('已进入家长模式');
      onClose();
      setPin('');
      navigate(ROUTES.PARENT_DASHBOARD);
    } else {
      toast.error(unlockError || 'PIN 码错误');
      setPin('');
      inputRef.current?.focus();
    }
  };

  // 加载中
  if (pinConfigured === null) {
    return (
      <Modal open={open} onClose={onClose} title="家长模式" size="sm">
        <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
          检查中...
        </div>
      </Modal>
    );
  }

  // 首次设置 PIN
  if (pinConfigured === false) {
    return (
      <Modal open={open} onClose={onClose} title="设置家长 PIN 码" size="sm">
        <form onSubmit={handleSetup} className="space-y-4">
          <div className="flex flex-col items-center py-4">
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-3">
              <Lock className="w-8 h-8 text-blue-500" />
            </div>
            <p className="text-sm text-slate-500 text-center">首次进入，请设置家长 PIN 码</p>
          </div>
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="4-6 位数字"
            value={pin}
            onChange={e => setPin(e.target.value)}
            autoFocus
          />
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="确认 PIN 码"
            value={confirmPin}
            onChange={e => setConfirmPin(e.target.value)}
            error={unlockError ?? undefined}
          />
          <Button type="submit" fullWidth loading={isUnlocking} disabled={pin.length < 4 || pin !== confirmPin}>
            设置并进入
          </Button>
        </form>
      </Modal>
    );
  }

  // 验证已有 PIN
  return (
    <Modal open={open} onClose={onClose} title="家长模式" size="sm">
      <form onSubmit={handleVerify} className="space-y-4">
        <div className="flex flex-col items-center py-4">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-3">
            <Lock className="w-8 h-8 text-blue-500" />
          </div>
          <p className="text-sm text-slate-500 text-center">请输入家长 PIN 码</p>
        </div>
        <Input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="4-6 位数字"
          value={pin}
          onChange={e => setPin(e.target.value)}
          error={unlockError ?? undefined}
          autoFocus
        />
        <Button type="submit" fullWidth loading={isUnlocking} disabled={pin.length < 4}>
          进入家长模式
        </Button>
      </form>
    </Modal>
  );
}
