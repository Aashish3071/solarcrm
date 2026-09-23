import type { Role } from "./roles";

/** FRD §7 "Documents / Attachments", plus supporting documents for external steps. */
export const DOCUMENT_TYPES = [
  "SITE_PHOTO",
  "DESIGN",
  "INSTALLATION_PLAN",
  "INSTALLATION_PHOTO",
  "COMPLETION_CERTIFICATE",
  "TRAINING_CERTIFICATE",
  "GOV_DOCUMENT",
  "LOAN_DOCUMENT",
  "DISCOM_DOCUMENT",
  "OTHER",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  SITE_PHOTO: "Site photo",
  DESIGN: "Final site design",
  INSTALLATION_PLAN: "Installation plan",
  INSTALLATION_PHOTO: "Installation photo",
  COMPLETION_CERTIFICATE: "Signed completion certificate",
  TRAINING_CERTIFICATE: "Client signed training certificate",
  GOV_DOCUMENT: "Government registration document",
  LOAN_DOCUMENT: "Loan document",
  DISCOM_DOCUMENT: "DISCOM document",
  OTHER: "Other",
};

/** Who uploads each document (FRD §7 "Uploaded / Provided By"). ADMIN may upload any. */
export const DOCUMENT_UPLOADERS: Record<DocumentType, readonly Role[]> = {
  SITE_PHOTO: ["SITE_SUPERVISOR"],
  DESIGN: ["SITE_SUPERVISOR"],
  INSTALLATION_PLAN: ["SITE_SUPERVISOR"],
  INSTALLATION_PHOTO: ["SITE_SUPERVISOR", "PROJECT_ENGINEER"],
  COMPLETION_CERTIFICATE: ["PROJECT_ENGINEER", "OFFICE_EXECUTIVE"],
  TRAINING_CERTIFICATE: ["PROJECT_ENGINEER", "OFFICE_EXECUTIVE", "SITE_SUPERVISOR"],
  GOV_DOCUMENT: ["OFFICE_EXECUTIVE"],
  LOAN_DOCUMENT: ["LOAN_OFFICER", "OFFICE_EXECUTIVE"],
  DISCOM_DOCUMENT: ["DISCOM_OFFICER"],
  OTHER: ["SALES", "SITE_SUPERVISOR", "OFFICE_EXECUTIVE", "LOAN_OFFICER", "DISCOM_OFFICER", "PROJECT_ENGINEER"],
};

export function canUpload(role: Role, type: DocumentType): boolean {
  return role === "ADMIN" || DOCUMENT_UPLOADERS[type].includes(role);
}

/** Booklet §6.6: validate file type and size at upload. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

/** Status lists for manual external steps. Placeholders until the client supplies masters (open points 4–6). */
export const GOV_STATUSES = ["NOT_STARTED", "SUBMITTED", "REGISTERED"] as const;
export const LOAN_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
export const DISCOM_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "RETURNED", "METER_APPROVED", "METER_INSTALLED", "FINAL_APPROVED"] as const;

export const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  SUBMITTED: "Submitted",
  REGISTERED: "Registered",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned for correction",
  METER_APPROVED: "Meter approved",
  METER_INSTALLED: "Meter installed",
  FINAL_APPROVED: "Final approval",
};
