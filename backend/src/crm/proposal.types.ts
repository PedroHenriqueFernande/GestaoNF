export interface ProposalSnapshot {
  templateVersion: 1 | 2; proposalId: string; proposalCode: string; currency: 'BRL'; issuedAt: string;
  issuer: { name: string; legalName: string | null; taxId: string | null };
  recipient: { customerId: string; name: string; kind: string | null; organization: string | null; email: string | null; taxId: string | null };
  subtotalAmount: string; discountAmount: string; totalAmount: string;
  items: Array<{ serviceId: string; serviceNameSnapshot: string; descriptionSnapshot: string | null; unitLabelSnapshot: string;
    nationalTaxCodeSnapshot: string | null; nbsCodeSnapshot: string | null; quantity: string; unitPrice: string;
    grossAmount: string; discountType: string; discountInput: string; discountAmount: string; totalAmount: string }>;
}
