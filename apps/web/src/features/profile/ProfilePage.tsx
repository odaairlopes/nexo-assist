import { useState } from 'react';
import { Info, KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui.tsx';
import { useSession } from '../../session/SessionProvider.tsx';
import { EmployeeShell } from '../shell/EmployeeShell.tsx';
import s from './ProfilePage.module.css';

export function ProfilePage() {
  const { user } = useSession();
  const [sent, setSent] = useState(false);
  if (!user) return null;

  return (
    <EmployeeShell title="Meu perfil">
      <div className={s.page}>
        <div className={s.content}>
          <div className={s.heading}>
            <h1>Meu perfil</h1>
            <p>Seus dados de acesso ao service desk de TI.</p>
          </div>

          <section className={s.card} aria-label="Dados">
            <div className={s.row}>
              <span className={s.label}>Nome</span>
              <span className={s.value}>{user.name}</span>
            </div>
            <div className={s.row}>
              <span className={s.label}>Área</span>
              <span className={s.value}>{user.department}</span>
            </div>
            <div className={s.row}>
              <span className={s.label}>E-mail corporativo</span>
              <span className={s.value}>{user.email}</span>
              <span className={s.note}>
                <ShieldCheck size={13} aria-hidden="true" /> Gerenciado pela TI
              </span>
            </div>
          </section>

          <section className={s.card} aria-label="Senha">
            <div className={s.passwordRow}>
              <span className={s.iconWrap}>
                <KeyRound size={18} aria-hidden="true" />
              </span>
              <div className={s.passwordText}>
                <strong>Senha</strong>
                <span>Senha da rede Nexo (vale para e-mail, VPN e Wi-Fi)</span>
              </div>
              <Button icon={<KeyRound size={15} />} onClick={() => setSent(true)} disabled={sent}>
                {sent ? 'Link enviado' : 'Redefinir senha'}
              </Button>
            </div>
            <div className={s.helper}>
              <Info size={14} aria-hidden="true" />
              {sent
                ? `Enviamos o link de redefinição para ${user.email} (simulado neste desafio).`
                : `Enviaremos um link de redefinição para ${user.email}.`}
            </div>
          </section>
        </div>
      </div>
    </EmployeeShell>
  );
}
