import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { Button, Input } from '@mama-babi/ui';
import { useAuthStore } from '../stores/authStore';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, loginError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    const ok = await login(username.trim(), password);
    if (ok) {
      setPassword('');
      navigate('/');
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-surface-muted px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950">
            <ShoppingCart className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mama Babi POS</h1>
          <p className="mt-1 text-sm text-slate-500">Enterprise point of sale</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            disabled={loading}
            placeholder="Enter username"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
            placeholder="Enter password"
          />
          <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!username.trim() || !password}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {loginError && <p className="mt-4 text-center text-sm text-danger-600">{loginError}</p>}
        <p className="mt-6 text-center text-xs text-slate-400">
          First login: admin / admin123 (change password in Settings)
        </p>
      </div>
    </div>
  );
}
