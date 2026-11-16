import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { api, type CompanyLogoAccess } from '../api/client';
import { initials } from '../utils/format';

export const COMPANY_LOGOS_KEY = ['company-logos-access'] as const;
type LogoOwner = { id: string; name: string; logoId?: string | null };
const MARGIN_MS = 5_000;
const AFTER_ERROR_MS = 60_000;
type LogosState = { data?: { items: CompanyLogoAccess[] }; dataUpdatedAt: number; errorUpdatedAt: number };

/** Por quanto tempo os links valem depois de recebidos. Só usa o relógio do cliente; expiresAt (relógio do servidor) nunca é comparado com Date.now() (Spec D13). */
function usableFor(items: CompanyLogoAccess[] | undefined) {
  return items?.length ? Math.min(...items.map(item => item.expiresInSeconds)) * 1000 - MARGIN_MS : 0;
}

/** Espera até a próxima renovação; false sem links. Depois de uma falha, espera AFTER_ERROR_MS em vez de repetir em seguida. */
function refreshIn(state: LogosState) {
  if (!state.data?.items.length) return false as const;
  const due = state.errorUpdatedAt > state.dataUpdatedAt ? state.errorUpdatedAt + AFTER_ERROR_MS : state.dataUpdatedAt + usableFor(state.data.items);
  return Math.max(1_000, due - Date.now());
}

export function useCompanyLogoUrl(company: LogoOwner | undefined) {
  const client = useQueryClient();
  const logoId = company?.logoId ?? null;
  // Uma consulta compartilhada por todas as instâncias; a renovação vem do refetchInterval (sem timers próprios).
  const access = useQuery({
    queryKey: COMPANY_LOGOS_KEY, queryFn: api.companyLogosAccess, enabled: Boolean(logoId), retry: false,
    staleTime: query => usableFor(query.state.data?.items),
    refetchInterval: query => refreshIn(query.state),
  });
  const item = access.data?.items.find(entry => entry.companyId === company?.id);
  const url = logoId && item?.logoId === logoId ? item.url : null;
  // Orçamento de UMA renovação extra por logoId: lista desatualizada ou falha ao carregar a imagem.
  const [renewedFor, setRenewedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ logoId: string; urls: string[] } | null>(null);
  const failedUrls = failed?.logoId === logoId ? failed.urls : [];
  const renew = () => { if (!logoId || renewedFor === logoId) return; setRenewedFor(logoId); void client.invalidateQueries({ queryKey: COMPANY_LOGOS_KEY }, { cancelRefetch: false }); };
  useEffect(() => {
    // Sincroniza com dado externo: a lista de links ainda não conhece o logoId exibido.
    if (logoId && access.isSuccess && item?.logoId !== logoId) renew();
  });
  const visible = url && failedUrls.length < 2 && !failedUrls.includes(url) ? url : null;
  function onError() {
    if (!logoId || !url) return;
    const urls = [...failedUrls, url];
    setFailed({ logoId, urls });
    if (urls.length === 1) renew();
  }
  return { url: visible, onError };
}

export function CompanyLogo({ company, className }: { company: LogoOwner | undefined; className: string }) {
  const logo = useCompanyLogoUrl(company);
  return <span className={logo.url ? `${className} is-image` : className} aria-hidden="true">
    {logo.url ? <img src={logo.url} alt="" width={128} height={128} decoding="async" onError={logo.onError} />
      : company ? initials(company.name) : <Building2 size={16} strokeWidth={2} />}
  </span>;
}
