import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/space-grotesk';
import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { api, ApiError } from './api/client';
import { Brand } from './components/Brand';
import { AuthScreen } from './features/auth/AuthScreen';
import './styles.css';

const CustomersPage = lazy(() => import('./features/customers/CustomersPage').then((module) => ({ default: module.CustomersPage })));
const ServicesPage = lazy(() => import('./features/services/ServicesPage').then((module) => ({ default: module.ServicesPage })));
const CompanyPage = lazy(() => import('./features/companies/CompanyPage').then((module) => ({ default: module.CompanyPage })));
const SalesPage = lazy(() => import('./features/sales/SalesPage').then((module) => ({ default: module.SalesPage })));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: false } } });

function SessionGate({ page }: { page: 'customers' | 'services' | 'company' | 'sales' }) {
  useEffect(() => { document.title = `GestãoNF · ${page === 'services' ? 'Serviços' : page === 'company' ? 'Empresa' : page === 'sales' ? 'Portal de Serviços' : 'Clientes'}`; }, [page]);
  const session = useQuery({ queryKey: ['me'], queryFn: api.me });
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies, enabled: session.isSuccess });
  if (session.isPending) return <div className="startup"><Brand /><div className="loading-line" /><p>Carregando sua área de trabalho...</p></div>;
  if (session.error instanceof ApiError && session.error.status === 401) return <AuthScreen />;
  if (session.isError) return <div className="startup"><Brand /><p>{session.error instanceof Error ? session.error.message : 'Não foi possível carregar o sistema.'}</p><button className="button button--primary" onClick={() => session.refetch()}><RefreshCw size={16} /> Tentar novamente</button></div>;
  if (companies.isPending) return <div className="startup"><Brand /><div className="loading-line" /><p>Carregando suas empresas...</p></div>;
  if (companies.isError) return <div className="startup"><Brand /><p>Não foi possível carregar suas empresas.</p><button className="button button--primary" onClick={() => companies.refetch()}><RefreshCw size={16} /> Tentar novamente</button></div>;
  if (page !== 'company' && companies.data.length === 0) return <Navigate to="/empresa" replace />;
  return <Suspense fallback={<div className="startup"><Brand /><div className="loading-line" /><p>Carregando sua área de trabalho...</p></div>}>
    {page === 'services' ? <ServicesPage user={session.data} /> : page === 'company' ? <CompanyPage user={session.data} /> : page === 'sales' ? <SalesPage user={session.data} /> : <CustomersPage user={session.data} />}
  </Suspense>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/Clientes" element={<SessionGate page="customers" />} />
          <Route path="/serviço" element={<SessionGate page="services" />} />
          <Route path="/servicos" element={<SessionGate page="services" />} />
          <Route path="/Servicos" element={<SessionGate page="services" />} />
          <Route path="/empresa" element={<SessionGate page="company" />} />
          <Route path="/portal-de-servicos" element={<SessionGate page="sales" />} />
          <Route path="*" element={<Navigate to="/Clientes" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
