import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open, title, message,
  confirmText = '确认', cancelText = '取消',
  variant = 'primary', onConfirm, onClose
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-slate-600 mb-6">{message}</p>
      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={onClose}>{cancelText}</Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          fullWidth
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
