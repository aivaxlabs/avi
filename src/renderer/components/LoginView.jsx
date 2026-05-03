import { LockKeyhole, Sparkles } from 'lucide-react';
import { useState } from 'react';

export function LoginView({ onLogin, error, setError }) {
  const [loginKey, setLoginKey] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const normalized = loginKey.replace(/[^a-z0-9]/gi, '');
    if (normalized.length !== 14) {
      setError('Informe a senha com 14 caracteres alfanuméricos.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onLogin(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-view">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark">
          <Sparkles size={20} />
        </div>
        <h1>AIVAX</h1>
        <p>Entre com sua senha de acesso para continuar.</p>
        <label className="login-input">
          <LockKeyhole size={18} />
          <input
            value={loginKey}
            onChange={(event) => setLoginKey(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 14))}
            inputMode="text"
            autoFocus
            placeholder="A1B2C3D4E5F6G7"
            aria-label="Senha de 14 caracteres alfanuméricos"
          />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
        {error && <div className="inline-error">{error}</div>}
      </form>
    </main>
  );
}
