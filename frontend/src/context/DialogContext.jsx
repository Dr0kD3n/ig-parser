import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const DialogContext = createContext(null);

function normalizeOptions(options) {
  if (typeof options === 'string') {
    return { message: options, title: '' };
  }
  return options || {};
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  const close = useCallback((result) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setDialog(null);
  }, []);

  const confirm = useCallback((options) => {
    const opts = normalizeOptions(options);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({
        type: 'confirm',
        title: opts.title || 'Подтверждение',
        message: opts.message || '',
        confirmText: opts.confirmText || 'Подтвердить',
        cancelText: opts.cancelText || 'Отмена',
        variant: opts.variant || 'default',
      });
    });
  }, []);

  const prompt = useCallback((options) => {
    const opts = normalizeOptions(options);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({
        type: 'prompt',
        title: opts.title || opts.message || 'Ввод',
        message: opts.message && opts.title ? opts.message : '',
        placeholder: opts.placeholder || '',
        defaultValue: opts.defaultValue || '',
        confirmText: opts.confirmText || 'Сохранить',
        cancelText: opts.cancelText || 'Отмена',
      });
    });
  }, []);

  const alert = useCallback((options) => {
    const opts = normalizeOptions(options);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({
        type: 'alert',
        title: opts.title || 'Уведомление',
        message: opts.message || '',
        confirmText: opts.confirmText || 'OK',
        variant: opts.variant || 'default',
      });
    });
  }, []);

  const choose = useCallback((options) => {
    const opts = normalizeOptions(options);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({
        type: 'choose',
        title: opts.title || 'Выберите действие',
        message: opts.message || '',
        cancelText: opts.cancelText || 'Отмена',
        choices: opts.choices || [],
      });
    });
  }, []);

  return (
    <DialogContext.Provider value={{ confirm, prompt, alert, choose }}>
      {children}
      {dialog && <AppDialog dialog={dialog} onClose={close} />}
    </DialogContext.Provider>
  );
}

function AppDialog({ dialog, onClose }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState(dialog.defaultValue || '');

  useEffect(() => {
    setValue(dialog.defaultValue || '');
  }, [dialog]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose(dialog.type === 'alert' ? undefined : null);
      if (e.key === 'Enter' && dialog.type !== 'prompt') {
        if (dialog.type === 'confirm') onClose(true);
        if (dialog.type === 'alert') onClose(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  useEffect(() => {
    if (dialog.type === 'prompt') {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [dialog.type]);

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose(dialog.type === 'alert' ? undefined : null);
  };

  const handleConfirm = () => {
    if (dialog.type === 'prompt') {
      const trimmed = value.trim();
      if (!trimmed) return;
      onClose(trimmed);
      return;
    }
    onClose(dialog.type === 'confirm' ? true : true);
  };

  const isDanger = dialog.variant === 'danger';

  return (
    <div className="app-dialog-backdrop" onClick={handleBackdrop} role="presentation">
      <div
        className="app-dialog modal-card fade-in-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
      >
        <div className={`app-dialog-icon ${isDanger ? 'app-dialog-icon-danger' : ''}`}>
          {dialog.type === 'prompt' ? '✏️' : dialog.type === 'choose' ? '🔁' : isDanger ? '🗑️' : dialog.type === 'alert' ? 'ℹ️' : '❓'}
        </div>
        <h3 id="app-dialog-title" className="app-dialog-title">
          {dialog.title}
        </h3>
        {dialog.message && <p className="app-dialog-message">{dialog.message}</p>}

        {dialog.type === 'prompt' && (
          <input
            ref={inputRef}
            type="text"
            className="text-input app-dialog-input"
            placeholder={dialog.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) onClose(value.trim());
            }}
          />
        )}

        <div className="app-dialog-actions">
          {dialog.type === 'choose' ? (
            <>
              <button type="button" className="btn-primary btn-ghost btn-sm" onClick={() => onClose(null)}>
                {dialog.cancelText}
              </button>
              {dialog.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={`btn-primary btn-sm ${choice.variant === 'danger' ? 'btn-danger' : ''}`}
                  onClick={() => onClose(choice.id)}
                >
                  {choice.label}
                </button>
              ))}
            </>
          ) : (
            <>
              {dialog.type !== 'alert' && (
                <button type="button" className="btn-primary btn-ghost btn-sm" onClick={() => onClose(null)}>
                  {dialog.cancelText}
                </button>
              )}
              <button
                type="button"
                className={`btn-primary btn-sm ${isDanger ? 'btn-danger' : ''}`}
                onClick={handleConfirm}
                disabled={dialog.type === 'prompt' && !value.trim()}
              >
                {dialog.confirmText}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}
