export const PROFILE_SECTIONS = [
  { id: "Overview", label: "Overview", domains: [] },
  { id: "Economy", label: "Economy", domains: ["economy"] },
  { id: "PublicFinance", label: "Public finance", domains: ["public_finance"] },
  { id: "Work", label: "Work", domains: ["work"] },
  { id: "Education", label: "Education", domains: ["education"] },
  { id: "Health", label: "Health", domains: ["health"] },
  { id: "Equality", label: "Equality", domains: ["equality"] },
  { id: "Institutions", label: "Institutions", domains: ["institutions"] },
  { id: "Democracy", label: "Democracy", domains: ["democracy"] },
  { id: "RightsSafety", label: "Rights & safety", domains: ["rights", "safety"] },
  { id: "Services", label: "Services", domains: ["services"] },
  { id: "Planet", label: "Planet", domains: ["planet"] },
] as const;

export const DOMAIN_LABELS: Record<string, string> = {
  economy: "Economy",
  public_finance: "Public finance & spending",
  work: "Work & livelihoods",
  education: "Education",
  health: "Health",
  equality: "Equality & human development",
  institutions: "Institutions",
  democracy: "Democracy",
  rights: "Rights",
  safety: "Safety",
  services: "Essential services",
  planet: "Planet",
};
