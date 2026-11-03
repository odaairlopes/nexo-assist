import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client.ts';
import { Dot, NexoMark, Spinner } from '../../components/ui.tsx';
import { useSession } from '../../session/SessionProvider.tsx';
import s from './LoginPage.module.css';

const DEMO_ACCOUNTS = [
  { email: 'ana.souza@nexo.com.br', label: 'Ana Souza · funcionária' },
  { email: 'diego.ramos@nexo.com.br', label: 'Diego Ramos · funcionário' },
  { email: 'rafael.lima@nexo.com.br', label: 'Rafael Lima · analista N2' },
];

export function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Informe o e-mail corporativo e a senha.');
      return;
    }
    setSubmitting(true);
    try {
      const user = await login({ email, password, remember });
      navigate(user.role === 'analyst' ? '/console' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar agora.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={s.page}>
      <section className={s.showcase} aria-label="Apresentação do Nexo Assist">
        <div className={s.brand}>
          <NexoMark size={24} light />
          <span>Nexo Assist</span>
        </div>

        <div className={s.story}>
          <div className={s.headline}>
            <p className={s.eyebrow}>Service desk de TI da Nexo</p>
            <h1>Seu problema de TI, resolvido em uma conversa.</h1>
            <p className={s.lead}>
              Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central de ajuda e chama um analista quando
              precisa.
            </p>
          </div>

          <div className={s.previewWrap} aria-hidden="true">
            <div className={s.preview}>
              <div className={s.userRow}>
                <span className={s.userBubble}>Meu notebook não conecta na VPN. Erro 809.</span>
              </div>
              <div className={s.agentBlock}>
                <div className={s.who}>
                  <strong>Nexo Assist</strong>
                  <span>consultou seus chamados · criou um chamado</span>
                </div>
                <span className={s.agentBubble}>Pronto: abri o chamado com prioridade alta. Um analista fala com você em até 4 h úteis.</span>
                <span className={s.chip}>
                  <Dot tone="warning" size={7} />
                  <strong>INC-20517</strong>
                  <span>Rede e VPN · Alta · em até 4 h</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <dl className={s.stats}>
          <div>
            <dt>8 s</dt>
            <dd>primeira resposta, em média</dd>
          </div>
          <div>
            <dt>72%</dt>
            <dd>resolvidos sem fila</dd>
          </div>
          <div>
            <dt>
              6 <Dot tone="success" size={8} />
            </dt>
            <dd>analistas online agora</dd>
          </div>
        </dl>
      </section>

      <section className={s.signIn}>
        <p className={s.help}>
          Problema para entrar? <strong>Ligue no ramal 4000</strong>
        </p>

        <form className={s.form} onSubmit={onSubmit} noValidate>
          <div className={s.heading}>
            <h2>Entrar</h2>
            <p>Use seu e-mail corporativo e a senha da rede Nexo.</p>
          </div>

          <div className={s.fields}>
            <label className={s.field}>
              <span className={s.label}>E-mail corporativo</span>
              <span className={s.input}>
                <Mail size={16} aria-hidden="true" />
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="nome.sobrenome@nexo.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(error)}
                  required
                  autoFocus
                />
              </span>
            </label>

            <label className={s.field}>
              <span className={s.labelRow}>
                <span className={s.label}>Senha</span>
                <span className={s.forgot} title="No desafio, qualquer senha é aceita">
                  Esqueci minha senha
                </span>
              </span>
              <span className={s.input}>
                <LockKeyhole size={16} aria-hidden="true" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className={s.toggle}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            <label className={s.remember}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className={s.checkbox} aria-hidden="true">
                {remember && <Check size={12} strokeWidth={3} />}
              </span>
              Manter conectado neste computador
            </label>
          </div>

          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}

          <button type="submit" className={s.submit} disabled={submitting}>
            {submitting ? <Spinner size={14} /> : null}
            Entrar
            {!submitting && <ArrowRight size={16} aria-hidden="true" />}
          </button>

          <div className={s.note}>
            <span>Contas de demonstração (qualquer senha):</span>
            <div className={s.demo}>
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.email} type="button" onClick={() => setEmail(a.email)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </form>

        <footer className={s.footer}>
          <span>© 2026 Nexo · Service desk de TI</span>
          <span>Privacidade e uso de dados</span>
        </footer>
      </section>
    </div>
  );
}
