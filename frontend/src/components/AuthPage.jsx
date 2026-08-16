import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { API_BASE } from '../config';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGISTRATION_CODE_PATTERN = /^[A-Z0-9-]{6,64}$/;

function validateFields({ isLogin, email, password, registrationCode }) {
  const errors = {};
  const normalizedEmail = email.trim();
  if (!normalizedEmail) errors.email = 'Введите email.';
  else if (normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)) {
    errors.email = 'Введите корректный email, например name@example.com.';
  }

  if (!password) errors.password = 'Введите пароль.';
  else if (!isLogin && password.length < 6) {
    errors.password = 'Пароль должен содержать минимум 6 символов.';
  } else if (!isLogin && password.length > 128) {
    errors.password = 'Пароль не должен превышать 128 символов.';
  }

  if (!isLogin) {
    const normalizedCode = registrationCode.trim().toUpperCase();
    if (!normalizedCode) errors.registrationCode = 'Введите код регистрации.';
    else if (!REGISTRATION_CODE_PATTERN.test(normalizedCode)) {
      errors.registrationCode = 'Код должен содержать 6–64 латинских букв, цифр или дефисов.';
    }
  }
  return errors;
}

function mapServerError(response, data, isLogin) {
  if (data?.fieldErrors && typeof data.fieldErrors === 'object') {
    return Object.values(data.fieldErrors)[0] || 'Проверьте данные формы.';
  }
  if (response.status === 429) return 'Слишком много попыток. Попробуйте позже.';
  if (response.status >= 500) return 'Сервис временно недоступен. Попробуйте позже.';

  const message = String(data?.error || '');
  if (!isLogin && /invalid.*registration code|registration code.*(invalid|used)/i.test(message)) {
    return 'Код регистрации неверный или уже использован.';
  }
  if (!isLogin && /unable to create account/i.test(message)) {
    return 'Аккаунт с таким email уже существует.';
  }
  if (!isLogin && /valid email.*password.*registration code/i.test(message)) {
    return 'Проверьте email, пароль и код регистрации.';
  }
  if (/invalid credentials/i.test(message)) return 'Неверный email или пароль.';
  if (/account is blocked/i.test(message)) return 'Аккаунт заблокирован.';
  return isLogin ? 'Не удалось войти. Попробуйте ещё раз.' : 'Не удалось зарегистрироваться.';
}

export default function AuthPage({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registrationCode, setRegistrationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const switchMode = (loginMode) => {
    setIsLogin(loginMode);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const clientErrors = validateFields({ isLogin, email, password, registrationCode });
    if (Object.keys(clientErrors).length > 0) {
      toast.error(Object.values(clientErrors)[0]);
      return;
    }

    setIsLoading(true);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
    const normalizedEmail = email.trim().toLowerCase();
    const body = isLogin
      ? { email: normalizedEmail, password }
      : {
          email: normalizedEmail,
          password,
          registrationCode: registrationCode.trim().toUpperCase(),
        };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        if (isLogin) {
          toast.success('Вход выполнен');
          onLoginSuccess(data.token, data.user);
        } else {
          toast.success('Аккаунт создан. Войдите.');
          setPassword('');
          setRegistrationCode('');
          setIsLogin(true);
        }
      } else {
        toast.error(mapServerError(res, data, isLogin));
      }
    } catch (error) {
      console.error('Auth error:', error);
      toast.error('Не удалось соединиться с сервером. Попробуйте позже.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-page-glow auth-page-glow--left" aria-hidden="true" />
      <div className="auth-page-glow auth-page-glow--right" aria-hidden="true" />

      <div className="modal-card fade-in-up auth-card">
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={isLogin}
            className={`auth-tab${isLogin ? ' active' : ''}`}
            onClick={() => switchMode(true)}
          >
            Вход
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isLogin}
            className={`auth-tab${!isLogin ? ' active' : ''}`}
            onClick={() => switchMode(false)}
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="input-group">
            <label className="label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              className="text-input"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="input-group">
            <label className="label" htmlFor="auth-password">
              Пароль
            </label>
            <input
              id="auth-password"
              type="password"
              className="text-input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          {!isLogin && (
            <div className="input-group fade-in-up">
              <label className="label" htmlFor="auth-code">
                Код регистрации
              </label>
              <input
                id="auth-code"
                type="text"
                className="text-input"
                placeholder="ABC123"
                value={registrationCode}
                onChange={(e) => setRegistrationCode(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
          )}

          <button type="submit" className="btn btn-primary auth-submit" disabled={isLoading}>
            {isLoading ? (
              <span className="loading-spinner-mini" />
            ) : isLogin ? (
              'Войти'
            ) : (
              'Зарегистрироваться'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
