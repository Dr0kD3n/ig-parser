import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { API_BASE } from '../config';

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
            const res = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();

            if (res.ok) {
                if (isLogin) {
                    toast.success('Access Granted');
                    onLoginSuccess(data.token, data.user);
                } else {
                    toast.success('Account Created. Please Login.');
                    setIsLogin(true);
                }
            } else {
                toast.error(data.error || 'Authentication Failed');
            }
        } catch (error) {
            console.error('Auth error:', error);
            toast.error('Connection Error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div className="modal-card fade-in-up" style={{ width: '100%', maxWidth: '440px', padding: '48px' }}>
                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                    <div className="logo-container" style={{ margin: '0 auto 24px', width: '64px', height: '64px', fontSize: '28px' }}>IG</div>
                    <h1 style={{ fontFamily: 'Space Grotesk', fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>
                        {isLogin ? 'WELCOME BACK' : 'ESTABLISH LINK'}
                    </h1>
                    <p style={{ fontSize: '14px', color: 'var(--text-dim)', maxWidth: '280px', margin: '0 auto' }}>
                        {isLogin
                            ? 'Securely access your automation dashboard.'
                            : 'Enter your exclusive invitation credentials.'}
                    </p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="input-group">
                        <label className="label">SECURE EMAIL</label>
                        <input
                            type="email"
                            className="text-input"
                            placeholder="operator@nexus.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <label className="label">ENCRYPTED KEY</label>
                        <input
                            type="password"
                            className="text-input"
                            placeholder="••••••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {!isLogin && (
                        <div className="input-group fade-in-up">
                            <label className="label">AUTH CODE</label>
                            <input
                                type="text"
                                className="text-input"
                                placeholder="X-77"
                                value={registrationCode}
                                onChange={(e) => setRegistrationCode(e.target.value)}
                                required
                            />
                        </div>
                    )}

                    <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '16px', fontSize: '16px', marginTop: '8px' }} disabled={isLoading}>
                        {isLoading ? (
                            <span className="loading-spinner-mini"></span>
                        ) : (
                            isLogin ? 'INITIALIZE SESSION' : 'ESTABLISH ACCOUNT'
                        )}
                    </button>
                </form>

                <div style={{ textAlign: 'center', marginTop: '32px', fontSize: '13px', color: 'var(--text-dim)' }}>
                    <span>{isLogin ? 'No credentials?' : 'Already linked?'}</span>
                    <button
                        style={{ border: 'none', background: 'none', color: 'hsl(var(--primary))', fontWeight: '600', marginLeft: '8px', cursor: 'pointer' }}
                        onClick={() => setIsLogin(!isLogin)}
                    >
                        {isLogin ? 'Register now' : 'Back to login'}
                    </button>
                </div>
            </div>
        </div>
    );
}
