import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { HelpArticleView } from '../support/SupportHelp';
import { NO_ACCESS_PATH, landingPath } from './screens';
import { permissionView } from './usePermissions';
import './no-access.css';

/** Spec 8.6: membro sem nenhuma área na empresa ativa. Trocar para uma empresa com acesso sai daqui. */
export function NoAccessPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign(NO_ACCESS_PATH); } });
  const effectiveId = companies.data?.some((item) => item.id === companyId) ? companyId : companies.data?.[0]?.id ?? '';
  useEffect(() => { if (effectiveId) sessionStorage.setItem('gestaonf.companyId', effectiveId); }, [effectiveId]);
  const landing = landingPath(permissionView(companies.data, effectiveId).viewer);
  if (companies.data && landing !== NO_ACCESS_PATH) return <Navigate to={landing} replace />;
  return <WorkspaceLayout user={user} companies={companies.data} companyId={effectiveId} onCompanyChange={setCompanyId} onLogout={() => logout.mutate()} loggingOut={logout.isPending}>
    <main id="workspace-main" className="no-access-main">
      <section className="no-access-card" aria-labelledby="no-access-title">
        <h1 id="no-access-title">Você ainda não tem acesso a nenhuma área</h1>
        <p>Fale com o responsável pela conta para liberar o que você precisa.</p>
        <button ref={helpButton} type="button" className="button button--secondary" aria-expanded={helpOpen} aria-controls="no-access-help" onClick={() => setHelpOpen((open) => !open)}>
          Entenda como funciona o acesso
        </button>
        <div id="no-access-help" className="no-access-help">
          {helpOpen && effectiveId && <HelpArticleView companyId={effectiveId} id="permissoes-e-acesso" onBack={() => { setHelpOpen(false); helpButton.current?.focus(); }} />}
        </div>
      </section>
    </main>
  </WorkspaceLayout>;
}
