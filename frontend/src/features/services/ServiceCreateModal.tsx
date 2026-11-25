import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Service, type ServiceInput } from '../../api/client';
import { usePermissions } from '../permissions/usePermissions';
import { ServiceForm, type ServiceMunicipalCode } from './ServiceForm';

export function ServiceCreateModal({ companyId, onClose, onCreated }: {
  companyId: string;
  onClose: () => void;
  onCreated: (service: Service, municipalCodeSaved: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const access = usePermissions(companyId);
  const create = useMutation({
    mutationFn: async ({ input, municipalCode }: { input: ServiceInput; municipalCode: ServiceMunicipalCode | null }) => {
      const service = await api.createService(companyId, input);
      let municipalCodeSaved = true;
      if (municipalCode?.changed && municipalCode.code) {
        try {
          await api.upsertMunicipalTaxCode(companyId, service.id, municipalCode.municipalityIbgeCode, municipalCode.code);
        } catch {
          municipalCodeSaved = false;
        }
      }
      return { service, municipalCodeSaved };
    },
    onSuccess: ({ service, municipalCodeSaved }) => {
      void queryClient.invalidateQueries({ queryKey: ['crm-services', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['services', companyId] });
      onCreated(service, municipalCodeSaved);
    },
  });

  return <ServiceForm
    companyId={companyId}
    canEditPrice={access.can('services.edit_price')}
    onClose={() => { if (!create.isPending) onClose(); }}
    onSave={async (input, municipalCode) => { await create.mutateAsync({ input, municipalCode }); }}
    saving={create.isPending}
    saveError={create.error}
  />;
}
