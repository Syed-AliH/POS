import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-slate-100">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-pink-700">Mama Babi</h1>
          <p className="text-slate-500 mt-1">Point of Sale System</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
              className="w-full px-4 py-3 border rounded-lg text-lg"
              placeholder="Enter username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
              className="w-full px-4 py-3 border rounded-lg text-lg"
              placeholder="Enter password"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full min-h-[52px] rounded-lg text-lg font-semibold bg-pink-600 hover:bg-pink-700 text-white disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        {loginError && <p className="text-red-600 text-center mt-4 text-sm">{loginError}</p>}
        <p className="text-xs text-slate-400 text-center mt-6">
          First login: admin / admin123 (change password in Settings)
        </p>
      </div>
    </div>
  );
}
