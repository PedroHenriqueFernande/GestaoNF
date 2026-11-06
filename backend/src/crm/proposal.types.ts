export interface ProposalSnapshot {
  templateVersion: 1; proposalId: string; proposalCode: string; title: string; currency: 'BRL'; issuedAt: string;
  issuer: { name: string; legalName: string | null; taxId: string | null };
  recipient: { customerId: string; name: string; kind: string; organization: string | null; email: string | null; taxId: string | null };
  commercialDescription: string | null; paymentTerms: string | null; notes: string | null; terms: string | null; validUntil: string | null;
  subtotalAmount: string; discountAmount: string; totalAmount: string;
  items: Array<{ serviceId: string; serviceNameSnapshot: string; descriptionSnapshot: string | null; unitLabelSnapshot: string;
    nationalTaxCodeSnapshot: string | null; nbsCodeSnapshot: string | null; quantity: string; unitPrice: string;
    grossAmount: string; discountType: string; discountInput: string; discountAmount: string; totalAmount: string }>;
}
