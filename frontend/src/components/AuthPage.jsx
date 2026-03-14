import { useState } from 'react';
import { toast } from 'react-hot-toast';

export default function AuthPage({ onLoginSuccess, tr }) {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [registrationCode, setRegistrationCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);

        const endpoint = isLogin ? `/api/auth/login` : `/api/auth/signup`;
        const body = isLogin
            ? { email, password }
            : { email, password, registrationCode };

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();

            if (res.ok) {
                if (isLogin) {
                    toast.success('Successfully logged in!');
                    onLoginSuccess(data.token, data.user);
                } else {
                    toast.success('Registration successful! Please log in.');
                    setIsLogin(true);
                }
            } else {
                toast.error(data.error || 'Something went wrong');
            }
        } catch (error) {
            console.error('Auth error:', error);
            toast.error('Network error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container content-fade">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="logo auth-logo">IG BOT</div>
                    <h1>{isLogin ? tr('login_title') || 'Welcome Back' : tr('register_title') || 'Create Account'}</h1>
                    <p>{isLogin ? tr('login_subtitle') || 'Enter your credentials to access your dashboard' : tr('register_subtitle') || 'Join our community with an invitation code'}</p>
                </div>

                <form onSubmit={handleSubmit} className="auth-form">
                    <div className="input-group">
                        <label>{tr('email') || 'Email'}</label>
                        <input
                            type="email"
                            className="select-input"
                            placeholder="name@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <label>{tr('password') || 'Password'}</label>
                        <input
                            type="password"
                            className="select-input"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {!isLogin && (
                        <div className="input-group content-fade">
                            <label>{tr('invite_code') || 'Invitation Code'}</label>
                            <input
                                type="text"
                                className="select-input"
                                placeholder="ABCD-1234"
                                value={registrationCode}
                                onChange={(e) => setRegistrationCode(e.target.value)}
                                required
                            />
                        </div>
                    )}

                    <button type="submit" className="btn-primary auth-submit" disabled={isLoading}>
                        {isLoading ? (
                            <div className="loader-mini"></div>
                        ) : (
                            isLogin ? tr('btn_login') || 'Sign In' : tr('btn_register') || 'Sign Up'
                        )}
                    </button>
                </form>

                <div className="auth-footer">
                    <span>{isLogin ? tr('no_account') || "Don't have an account?" : tr('has_account') || "Already have an account?"}</span>
                    <button className="auth-toggle" onClick={() => setIsLogin(!isLogin)}>
                        {isLogin ? tr('register_link') || 'Register now' : tr('login_link') || 'Back to login'}
                    </button>
                </div>
            </div>
        </div>
    );
}
