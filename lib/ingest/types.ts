// TODO(types): ingest-internal shape. Ask Miranda whether it belongs in lib/types.ts.
export type Source = 'greenhouse' | 'lever';

export interface CompanyRef {
  id?: string;
  name: string;
  source: Source;
  slug: string;
}

export interface RawPosting {
  source: Source;
  external_id: string; // String(id) from the API
  company: string; // display name
  company_id?: string; // DB id when known
  title: string;
  location: string | null;
  url: string;
  description: string; // plain text, HTML stripped, capped at 20,000 chars
  posted_at: string | null; // ISO 8601
}
