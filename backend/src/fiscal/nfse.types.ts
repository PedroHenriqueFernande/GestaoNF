export type NfseIssue = { code: string; message: string; field: string; target: 'company' | 'customer' | 'service' | 'sale' | 'series' | 'integration'; severity: 'ERROR' | 'WARNING' };
export type NfseParty = { name: string; taxId: string | null; email: string | null; street: string | null; number: string | null; district: string | null; cityName: string | null; cityIbgeCode: string | null; postalCode: string | null; stateCode: string | null; municipalRegistration: string | null };
export type NfseGroup = {
  key: string; competence: string; municipalityIbgeCode: string | null; nationalTaxCode: string | null; nbsCode: string | null; municipalTaxCode: string | null;
  description: string; grossAmount: string; discountAmount: string; totalAmount: string;
  ruleName: string | null; issWithholding: boolean; issRatePercent: string | null;
  items: Array<{ id: string; serviceId: string; name: string; quantity: string; unitPrice: string; grossAmount: string; discountAmount: string; totalAmount: string }>;
};
export type NfseSnapshot = {
  schemaVersion: 1; saleId: string; saleVersion: number; orderCode: string; generatedAt: string; contractVersion: string;
  environment: 'HOMOLOGATION' | 'PRODUCTION' | null;
  series: { id: string; number: number; nextNumber: string; version: number } | null;
  issuer: NfseParty; customer: NfseParty; customerId: string;
  simplesOption: string | null; simplesTaxationRegime: string | null; specialTaxRegime: string | null;
  groups: NfseGroup[]; totalAmount: string; issues: NfseIssue[]; input: { competence?: string; municipalityIbgeCode?: string; simplesTotalTaxPercent?: string };
  certificate: { id: string; status: string; trusted: boolean; expiresAt: string } | null;
  substitution?: NfseSubstitution;
};
export type NfseSubstitution = { documentId: string; accessKey: string; reasonCode: string; reasonText: string | null };
export type NfsePreview = NfseSnapshot & { id: string; hash: string; stale: boolean; emissionIssues: NfseIssue[]; canEmit: boolean };
