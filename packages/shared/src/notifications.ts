/**
 * FR-044 stage alerts. The FRD leaves channels, templates and recipients open
 * (open point 12); these defaults follow the Booklet §9 illustrative matrix and
 * are editable in Settings.
 */
export const CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Recipient tokens resolved per project. */
export const RECIPIENTS = [
  "RESPONSIBLE",
  "SALES_OWNER",
  "CUSTOMER",
  "SITE_SUPERVISOR",
  "OFFICE_EXECUTIVE",
  "PROJECT_ENGINEER",
  "LOAN_OFFICER",
  "DISCOM_OFFICER",
  "ACCOUNTS",
] as const;
export type Recipient = (typeof RECIPIENTS)[number];

export const NOTIFICATION_EVENTS = {
  STAGE_OPENED: "A stage is now waiting on you",
  VISIT_SCHEDULED: "Site visit scheduled",
  PAYMENT_VERIFIED: "Payment verified",
  PAYMENT_REJECTED: "Payment rejected",
  LOAN_UPDATED: "Loan approved or amount updated",
  DISCOM_UPDATED: "DISCOM status changed",
  MATERIAL_DISPATCHED: "Material dispatched",
  MATERIAL_RECEIVED: "Material received at site",
  INSTALLATION_COMPLETED: "Installation completed",
  FINAL_DISCOM_APPROVED: "Final DISCOM approval",
  PROJECT_DELAYED: "Project delay flagged (SLA breached)",
} as const;
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

/** Booklet §9 matrix. Customers get SMS/WhatsApp/email; staff get in-app plus email. */
export const DEFAULT_MATRIX: { event: NotificationEvent; recipients: Recipient[]; channels: Channel[] }[] = [
  { event: "STAGE_OPENED", recipients: ["RESPONSIBLE"], channels: ["IN_APP"] },
  { event: "VISIT_SCHEDULED", recipients: ["CUSTOMER", "SITE_SUPERVISOR"], channels: ["IN_APP", "SMS", "WHATSAPP"] },
  { event: "PAYMENT_VERIFIED", recipients: ["SALES_OWNER", "CUSTOMER"], channels: ["IN_APP", "WHATSAPP", "EMAIL"] },
  { event: "PAYMENT_REJECTED", recipients: ["SALES_OWNER", "CUSTOMER"], channels: ["IN_APP", "WHATSAPP", "EMAIL"] },
  { event: "LOAN_UPDATED", recipients: ["CUSTOMER", "SALES_OWNER"], channels: ["IN_APP", "WHATSAPP", "EMAIL"] },
  { event: "DISCOM_UPDATED", recipients: ["SALES_OWNER", "CUSTOMER"], channels: ["IN_APP", "SMS"] },
  { event: "MATERIAL_DISPATCHED", recipients: ["SITE_SUPERVISOR", "PROJECT_ENGINEER"], channels: ["IN_APP", "SMS"] },
  { event: "MATERIAL_RECEIVED", recipients: ["SITE_SUPERVISOR", "PROJECT_ENGINEER"], channels: ["IN_APP", "SMS"] },
  { event: "INSTALLATION_COMPLETED", recipients: ["CUSTOMER", "OFFICE_EXECUTIVE"], channels: ["IN_APP", "WHATSAPP", "EMAIL"] },
  { event: "FINAL_DISCOM_APPROVED", recipients: ["CUSTOMER", "SALES_OWNER"], channels: ["IN_APP", "WHATSAPP", "EMAIL"] },
  { event: "PROJECT_DELAYED", recipients: ["PROJECT_ENGINEER", "SALES_OWNER"], channels: ["IN_APP", "EMAIL"] },
];

/** Plain-language message. Customer text never includes internal notes or amounts beyond what they paid. */
export function messageFor(event: NotificationEvent, ctx: { customer: string; code: string; detail?: string }, toCustomer: boolean): { title: string; body: string } {
  const d = ctx.detail ? ` ${ctx.detail}` : "";
  if (toCustomer) {
    const text: Record<NotificationEvent, string> = {
      STAGE_OPENED: "",
      VISIT_SCHEDULED: `Your site visit is scheduled.${d}`,
      PAYMENT_VERIFIED: `We have received and verified your payment.${d}`,
      PAYMENT_REJECTED: "We could not verify your payment. Our team will contact you.",
      LOAN_UPDATED: `There is an update on your solar loan.${d}`,
      DISCOM_UPDATED: `Your DISCOM application status has changed.${d}`,
      MATERIAL_DISPATCHED: "",
      MATERIAL_RECEIVED: "",
      INSTALLATION_COMPLETED: "Your solar installation is complete. Thank you!",
      FINAL_DISCOM_APPROVED: "Your DISCOM final approval is confirmed.",
      PROJECT_DELAYED: "",
    };
    return { title: `Solar project ${ctx.code}`, body: `Hello ${ctx.customer}, ${text[event]}` };
  }
  return { title: `${NOTIFICATION_EVENTS[event]} · ${ctx.code}`, body: `${ctx.customer}.${d}` };
}
