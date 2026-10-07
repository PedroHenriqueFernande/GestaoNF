import '@fontsource-variable/ibm-plex-sans';
import '@fontsource-variable/space-grotesk';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { api, ApiError } from './api/client';
import { Brand } from './components/Brand';
import { AuthScreen } from './features/auth/AuthScreen';
import { CustomersPage } from './features/customers/CustomersPage';
import { ServicesPage } from './features/services/ServicesPage';
import { CompanyPage } from './features/companies/CompanyPage';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000, refetchOnWindowFocus: false } } });

function SessionGate({ page }: { page: 'customers' | 'services' | 'company' }) {
  useEffect(() => { document.title = `GestãoNF · ${page === 'services' ? 'Serviços' : page === 'company' ? 'Empresa' : 'Clientes'}`; }, [page]);
  const session = useQuery({ queryKey: ['me'], queryFn: api.me });
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies, enabled: session.isSuccess });
  if (session.isPending) return <div className="startup"><Brand /><div className="loading-line" /><p>Carregando sua área de trabalho...</p></div>;
  if (session.error instanceof ApiError && session.error.status === 401) return <AuthScreen />;
  if (session.isError) return <div className="startup"><Brand /><p>{session.error instanceof Error ? session.error.message : 'Não foi possível carregar o sistema.'}</p><button className="button button--primary" onClick={() => session.refetch()}><RefreshCw size={16} /> Tentar novamente</button></div>;
  if (companies.isPending) return <div className="startup"><Brand /><div className="loading-line" /><p>Carregando suas empresas...</p></div>;
  if (companies.isError) return <div className="startup"><Brand /><p>Não foi possível carregar suas empresas.</p><button className="button button--primary" onClick={() => companies.refetch()}><RefreshCw size={16} /> Tentar novamente</button></div>;
  if (page !== 'company' && companies.data.length === 0) return <Navigate to="/empresa" replace />;
  return page === 'services' ? <ServicesPage user={session.data} /> : page === 'company' ? <CompanyPage user={session.data} /> : <CustomersPage user={session.data} />;
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
          <Route path="*" element={<Navigate to="/Clientes" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
