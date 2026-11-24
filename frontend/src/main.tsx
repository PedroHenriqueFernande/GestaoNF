import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/space-grotesk';
import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { canOpenScreen, type ScreenId } from '@gestaonf/permissions';
import { api, ApiError } from './api/client';
import { Brand } from './components/Brand';
import { AuthScreen } from './features/auth/AuthScreen';
import { landingPath } from './features/permissions/screens';
import { permissionView, salesReviewTarget, storedCompanyId } from './features/permissions/usePermissions';
import './styles.css';

const CustomersPage = lazy(() => import('./features/customers/CustomersPage').then((module) => ({ default: module.CustomersPage })));
const ServicesPage = lazy(() => import('./features/services/ServicesPage').then((module) => ({ default: module.ServicesPage })));
const CompanyPage = lazy(() => import('./features/companies/CompanyPage').then((module) => ({ default: module.CompanyPage })));
const SalesPage = lazy(() => import('./features/sales/SalesPage').then((module) => ({ default: module.SalesPage })));
const FinancePage = lazy(() => import('./features/finance/FinancePage').then((module) => ({ default: module.FinancePage })));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const FiscalPage = lazy(() => import('./features/fiscal/FiscalPage').then((module) => ({ default: module.FiscalPage })));
const CrmPage = lazy(() => import('./features/crm/CrmPage').then((module) => ({ default: module.CrmPage })));
const AgendaPage = lazy(() => import('./features/crm/AgendaPage').then((module) => ({ default: module.AgendaPage })));
const ProposalsPage = lazy(() => import('./features/crm/ProposalsPage').then((module) => ({ default: module.ProposalsPage })));
const NiloPage = lazy(() => import('./features/nilo/NiloPage').then((module) => ({ default: module.NiloPage })));
const NoAccessPage = lazy(() => import('./features/permissions/NoAccessPage').then((module) => ({ default: module.NoAccessPage })));
const UsersPage = lazy(() => import('./features/users/UsersPage').then((module) => ({ default: module.UsersPage })));
const ProfilePage = lazy(() => import('./features/profile/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const AcceptInvitationPage = lazy(() => import('./features/users/AcceptInvitationPage').then((module) => ({ default: module.AcceptInvitationPage })));

/** Spec 8.3: negação de acesso recarrega as permissões efetivas; a tela se reajusta pelo SessionGate/WorkspaceLayout. */
let accessRefresh: Promise<void> | undefined;
const refreshAccess = (error: unknown) => {
  if (accessRefresh || !(error instanceof ApiError) || (error.code !== 'PERMISSION_DENIED' && error.code !== 'ACCOUNT_OWNER_REQUIRED')) return;
  // Substitui consultas iniciadas antes da negação e agrupa os 403 até a recarga terminar.
  accessRefresh = queryClient.invalidateQueries({ queryKey: ['companies'] }).finally(() => { accessRefresh = undefined; });
};
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: refreshAccess }),
  mutationCache: new MutationCache({ onError: refreshAccess }),
  defaultOptions: { queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: false } },
});
queryClient.setQueryDefaults(['companies'], { refetchOnWindowFocus: true });

type GatePage = ScreenId | 'no-access' | 'home';

function SessionGate({ page }: { page: GatePage }) {
  const [params] = useSearchParams();
  useEffect(() => { document.title = `GestãoNF · ${page === 'profile' ? 'Meu perfil' : page === 'fiscal-series' ? 'Séries fiscais' : page === 'fiscal-tax' ? 'Tributação' : page === 'services' ? 'Serviços' : page === 'company' ? 'Empresa' : page === 'sales' ? 'Portal de Serviços' : page === 'finance' ? 'Financeiro' : page === 'reports' ? 'Relatórios' : page === 'crm' ? 'CRM' : page === 'agenda' ? 'Agenda' : page === 'proposals' ? 'Propostas' : page === 'nero' ? 'Nero' : page === 'no-access' ? 'Sem acesso' : page === 'users' ? 'Usuários' : 'Clientes'}`; }, [page]);
  const session = useQuery({ queryKey: ['me'], queryFn: api.me });
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies, enabled: session.isSuccess });
  if (session.isPending) return <div className="startup"><Brand /><div className="loading-line" /><p>Carregando sua área de trabalho...</p></div>;
  if (session.error instanceof ApiError && session.error.status === 401) return <AuthScreen />;
  if (session.isError) return <div className="startup"><Brand /><p>{session.error instanceof Error ? session.error.message : 'Não foi possível carregar o sistema.'}</p><button className="button button--primary" onClick={() => session.refetch()}><RefreshCw size={16} /> Tentar novamente</button></div>;
  if (page === 'profile') return <Suspense fallback={<div className="startup"><Brand /><div className="loading-line" /></div>}><ProfilePage user={session.data} companies={companies.data} /></Suspense>;
  if (companies.isPending) return <div className="startup"><Brand /><div className="loading-line" /><p>Carregando suas empresas...</p></div>;
  if (companies.isError) return <div className="startup"><Brand /><p>Não foi possível carregar suas empresas.</p><button className="button button--primary" onClick={() => companies.refetch()}><RefreshCw size={16} /> Tentar novamente</button></div>;
  if (page !== 'company' && companies.data.length === 0) return <Navigate to="/empresa" replace />;
  if (companies.data.length > 0 && page !== 'no-access') {
    const review = page === 'sales' ? salesReviewTarget(params, companies.data) : null;
    const viewer = permissionView(companies.data, review?.companyId ?? storedCompanyId(companies.data)).viewer;
    if (page === 'home' || !canOpenScreen(viewer, page)) return <Navigate to={landingPath(viewer)} replace />;
  }
  return <Suspense fallback={<div className="startup"><Brand /><div className="loading-line" /><p>Carregando sua área de trabalho...</p></div>}>
    {page === 'fiscal-series' || page === 'fiscal-tax' ? <FiscalPage user={session.data} mode={page === 'fiscal-series' ? 'series' : 'tax'} /> : page === 'services' ? <ServicesPage user={session.data} /> : page === 'company' ? <CompanyPage user={session.data} /> : page === 'sales' ? <SalesPage user={session.data} /> : page === 'finance' ? <FinancePage user={session.data} /> : page === 'reports' ? <ReportsPage user={session.data} /> : page === 'crm' ? <CrmPage user={session.data} /> : page === 'agenda' ? <AgendaPage user={session.data} /> : page === 'proposals' ? <ProposalsPage user={session.data} /> : page === 'no-access' ? <NoAccessPage user={session.data} /> : page === 'nero' ? <NiloPage user={session.data} /> : page === 'users' ? <UsersPage user={session.data} /> : <CustomersPage user={session.data} />}
  </Suspense>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/meu-perfil" element={<SessionGate page="profile" />} />
          <Route path="/Clientes" element={<SessionGate page="customers" />} />
          <Route path="/serviço" element={<SessionGate page="services" />} />
          <Route path="/servicos" element={<SessionGate page="services" />} />
          <Route path="/Servicos" element={<SessionGate page="services" />} />
          <Route path="/empresa" element={<SessionGate page="company" />} />
          <Route path="/portal-de-servicos" element={<SessionGate page="sales" />} />
          <Route path="/financeiro" element={<SessionGate page="finance" />} />
          <Route path="/relatorios" element={<SessionGate page="reports" />} />
          <Route path="/relatorios/:type" element={<SessionGate page="reports" />} />
          <Route path="/fiscal" element={<Navigate to="/fiscal/series" replace />} />
          <Route path="/fiscal/series" element={<SessionGate page="fiscal-series" />} />
          <Route path="/fiscal/tributacao" element={<SessionGate page="fiscal-tax" />} />
          <Route path="/crm" element={<SessionGate page="crm" />} />
          <Route path="/agenda" element={<SessionGate page="agenda" />} />
          <Route path="/propostas" element={<SessionGate page="proposals" />} />
          <Route path="/sem-acesso" element={<SessionGate page="no-access" />} />
          <Route path="/nero" element={<SessionGate page="nero" />} />
          <Route path="/usuarios" element={<SessionGate page="users" />} />
          <Route path="/aceitar-convite" element={<Suspense fallback={<div className="startup"><Brand /><div className="loading-line" /></div>}><AcceptInvitationPage /></Suspense>} />
          <Route path="/nilo" element={<Navigate to="/nero" replace />} />
          <Route path="*" element={<SessionGate page="home" />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
