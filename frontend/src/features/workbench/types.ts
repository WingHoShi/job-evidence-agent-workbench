export type Source = {
  id: number;
  kind: string;
  label: string;
  relative_path: string;
};

export type Claim = {
  id: number;
  text: string;
  resume_locator: string;
  capability_tags: string[];
  status: string;
};

export type Assessment = {
  claim_id: number;
  links: number[];
  verdict: "strong" | "partial" | "none" | "conflict";
  rationale: string;
};

export type Gate = {
  eligible: boolean;
  requires_review: boolean;
  reason: string;
};

export type TaskSnapshot = {
  id: number;
  name: string;
  status: string;
  sources: Source[];
  claims: Claim[];
  assessments: Record<string, Assessment>;
  gates: Record<string, Gate>;
  report_ready: boolean;
  audit: { status: string; claim_id: number | null; events: string[]; recoverable: boolean };
};
