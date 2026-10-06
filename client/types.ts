export type Kind = "boss" | "swarm" | "pheno";
export type Region = "kanto" | "johto" | "hoenn" | "sinnoh" | "unova";
export type User = {
  id: number;
  username: string;
  nickname: string;
  role: "user" | "admin";
  disabled: boolean;
};
export type Session = { user: User | null; csrfToken: string };
export type List<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type Event = {
  id: number;
  kind: Kind;
  pokemon: string;
  pokemonOriginal?: string;
  region: Region;
  location: string;
  locationZh?: string;
  observedAt: string;
  expiresAt: string;
  lastConfirmedAt: string;
  status: "active" | "ended" | "corrected";
  source: "player" | "external" | "demo";
  sourceUrl: string | null;
  note: string;
  contributors: { nickname: string }[];
  correctionReason: string | null;
};
export type Report = {
  id: number;
  kind: Kind;
  pokemon: string;
  region: Region;
  location: string;
  locationZh?: string;
  observedAt: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  eventId: number | null;
  source: Event["source"];
  sourceUrl: string | null;
  createdAt: string;
  reporter: { nickname: string };
};
export type CatalogEntry = {
  id:number;kind:Exclude<Kind,"pheno">;pokemon:string;pokemonOriginal:string;region:Region;location:string;locationZh?:string;locationNote:string;
  tier:number|null;nationalDex:number|null;hms:string[];moveset:string[];movesetOriginal:string[];valuable:boolean;source:string;sourceUrl:string;syncedAt:string;
};
export const regions: Record<Region, string> = {
  kanto: "关都",
  johto: "城都",
  hoenn: "丰缘",
  sinnoh: "神奥",
  unova: "合众",
};
export const kinds: Record<Kind, string> = { boss: "头目", swarm: "群聚", pheno: "奇遇" };
export const statuses: Record<Event["status"], string> = {
  active: "有效情报",
  ended: "已结束",
  corrected: "已纠错",
};
export const reportStatuses: Record<Report["status"], string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};
