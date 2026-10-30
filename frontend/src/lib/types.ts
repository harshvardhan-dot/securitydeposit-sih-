export type Role =
  | 'institution'
  | 'scrutiny_officer'
  | 'verification_officer'
  | 'competent_authority'
  | 'admin'
  | 'auditor'

export interface User {
  id: number
  email: string
  name: string
  role: Role
  institution_id: number | null
  institution: string | null
  language: 'en' | 'hi'
  mfa_enabled: boolean
  last_login_at: string | null
  key_id: string | null
}

export interface LoginResponse {
  access_token?: string
  token_type?: string
  user?: User
  mfa_required?: boolean
  challenge_token?: string
  demo_hint?: { code: string; note: string }
}

export interface InstrumentBrief {
  id: number
  reference: string
  institution_id: number
  institution: string | null
  institution_state: string | null
  bank: string
  branch: string | null
  fdr_number: string
  amount: number
  issue_date: string | null
  maturity_date: string | null
  days_to_maturity: number | null
  status: string
  status_label: string
  status_tone: string
  trust_score: number
  trust_breakdown: {
    score?: number
    band?: string
    breakdown?: { label: string; points: number; possible: number; note: string }[]
  }
  is_flagged: boolean
  flag_reason: string | null
  parent_instrument_id: number | null
  created_at: string | null
  verified_at: string | null
  released_at: string | null
}

export interface ExtractedField {
  value: string | number | null
  confidence: number
  method?: string
  bert_alignment?: number
}

export interface DocumentRecord {
  id: number
  instrument_id: number | null
  original_name: string
  mime: string
  size_bytes: number
  sha256: string
  version: number
  anomaly_score: number
  overall_confidence: number
  quality: Record<string, unknown> & { score?: number; engine?: string; issues?: string[] }
  uploaded_at: string | null
  engine?: { ocr?: string; bert?: string; ner?: string }
  embedding_model?: string
  anomaly_reasons: string[]
  duplicates: { instrument_id?: number; reference: string; similarity?: number }[]
  warnings: string[]
  text_length: number
  text_preview?: string
  fields?: Record<string, ExtractedField>
}

export interface VerificationRecord {
  id: number
  source: string
  result: string
  detail: Record<string, unknown>
  officer_id: number | null
  created_at: string | null
}

export interface ObservationRecord {
  id: number
  remark: string
  clarification_requested: boolean
  resolved: boolean
  officer: string | null
  created_at: string | null
}

export interface ReminderRecord {
  id: number
  instrument_id: number
  reference: string | null
  stage: number
  channel: string
  recipient_role: string
  sent_at: string | null
  acknowledged: boolean
  acknowledged_at: string | null
  payload: Record<string, unknown>
}

export interface RequestStep {
  step: string
  status: string
  owner_id: number | null
  note: string | null
  acted_at: string | null
}

export interface ChecklistItem {
  key: string
  label: string
  passed: boolean
  detail: string
  fix: string
}

export interface RequestRecord {
  id: number
  instrument_id: number
  reference: string | null
  bank: string | null
  institution: string | null
  amount: number
  type: 'release' | 'refund'
  status: string
  reason: string
  checklist: ChecklistItem[]
  decision: string | null
  decision_reason: string | null
  signed_by: number | null
  signature: string | null
  created_at: string | null
  updated_at: string | null
  decided_at: string | null
  closed_at: string | null
  steps?: RequestStep[]
}

export interface InstrumentDetail extends InstrumentBrief {
  documents: DocumentRecord[]
  verifications: VerificationRecord[]
  observations: ObservationRecord[]
  reminders: ReminderRecord[]
  institution_detail: {
    id: number
    name: string
    aicte_id: string
    state: string
    city: string | null
    contact_email: string | null
    contact_phone: string | null
  } | null
  extracted_fields: Record<string, ExtractedField>
  mismatches: {
    field: string
    label: string
    submitted: string | number
    extracted: string | number
    confidence?: number
  }[]
  bank_verification: {
    result: string
    detail: Record<string, unknown>
    created_at: string | null
  } | null
  requests: { id: number; type: string; status: string; created_at: string | null }[]
  child_instruments: InstrumentBrief[]
}

export interface TimelineEvent {
  type: 'ledger' | 'document' | 'reminder' | 'observation' | 'renewal'
  at: string
  title: string
  detail: Record<string, unknown>
  actor: string | null
  ledger_index?: number
  hash?: string
}

export interface LedgerBlock {
  idx: number
  action: string
  actor_id: number | null
  actor_name: string
  actor_role: string
  instrument_id: number | null
  document_hash: string | null
  payload: Record<string, unknown>
  prev_hash: string
  hash: string
  signature: string | null
  signer_pubkey: string | null
  key_id: string | null
  algo: string
  created_at: string
}

export interface ChainStatus {
  valid: boolean
  blocks: number
  broken_at: number | null
  reason: string | null
  signature_failures: number[]
  head_hash: string
  head_index: number
  checked_at: string
}

export interface DashboardTile {
  key: string
  count: number
  value: number
}

export interface DashboardSummary {
  role: Role
  generated_at: string
  tiles: DashboardTile[]
  totals: {
    instruments: number
    value: number
    institutions: number
    documents: number
    open_clarifications: number
    value_at_risk: number
  }
  trust: { green: number; amber: number; red: number }
  forecast: { month: string; iso: string; count: number; value: number }[]
  states: { state: string; count: number; value: number; flagged: number; expiring: number }[]
  late_institutions: { institution_id: number; name: string; state: string | null; count: number }[]
  todo: {
    kind: string
    title: string
    detail: string
    instrument_id?: number
    urgency: string
  }[]
  recent_activity: LedgerBlock[]
  chain: ChainStatus
  notifications_unread: number
  reminders_pending: number
  reminder_ladder: number[]
  ai: {
    bert: {
      enabled: boolean
      available: boolean
      model_id: string
      dim: number | null
      device: string
      load_seconds: number | null
      ner_model: string
      error: string | null
    }
    ocr: string
  }
}

export interface NotificationRecord {
  id: number
  title: string
  body: string
  kind: string
  link: string | null
  read: boolean
  created_at: string
}

export interface ReportSummary {
  key: string
  label: string
  count: number
}

export interface ReportPreview {
  report: string
  label: string
  headers: string[]
  rows: (string | number)[][]
  total: number
}

export interface InstitutionRecord {
  id: number
  name: string
  aicte_id: string
  state: string
  city: string | null
  contact_email: string | null
  contact_phone: string | null
  instruments: number
  active: number
  flagged: number
  value: number
}

export interface SecurityPosture {
  environment: string
  encryption: {
    at_rest: string
    field_level: string[]
    file_storage: string
    key_management: string
    in_transit: {
      scheme: string
      hsts: boolean
      minimum_version: string
      note: string
    }
  }
  integrity: {
    algorithm: string
    blocks: number
    chain_valid: boolean
    broken_at: number | null
    head_hash: string
  }
  authenticity: {
    algorithm: string
    signed_blocks: number
    keys_issued: number
    note: string
  }
  access: {
    jwt_algorithm: string
    token_ttl_minutes: number
    idle_timeout_minutes: number
    mfa_required_roles: string[]
    mfa_enabled_officers: number
    officers: number
    rbac: Record<string, string[]>
  }
  accountability: {
    audit_entries: number
    failed_attempts: number
    last_chain_check: string
  }
}

export interface AuditEntry {
  id: number
  user: string | null
  action: string
  target: string
  detail: string
  ip: string | null
  allowed: boolean
  at: string | null
}

export interface DatabaseStatus {
  provider: 'sqlite' | 'supabase' | 'postgresql' | string
  is_supabase_db: boolean
  has_api_credentials: boolean
  supabase_url: string | null
  api_client_ready: boolean
  api_connected: boolean
  api_error: string | null
  database_url_configured: boolean
}

export interface VaultBox {
  id: number
  reference: string
  bank: string
  status: string
  tone: 'red' | 'amber' | 'grey' | 'green'
  trust_score: number
  amount: number
  days_to_maturity: number | null
  institution: string | null
}

export interface PublicTrack {
  reference: string
  status: string
  status_label: string
  bank: string
  fdr_number_masked: string
  maturity_date: string | null
  stages: { key: string; label: string; done: boolean; at: string | null }[]
  last_update: string | null
  events: { at: string; action: string }[]
  note: string
}

export interface RequestDetail extends RequestRecord {
  steps_order?: string[]
}

export interface Paginated<T> {
  items: T[]
  total: number
  page?: number
  size?: number
  pages?: number
}

export interface AdminSettings {
  reminder_ladder: number[]
  trust_weights: Record<string, number>
  escalation: { verification_overdue_days: number; clarification_overdue_days: number }
  raw: Record<string, unknown>
}

export interface AiStatus {
  ocr: { engine: string; available: boolean; image_cleanup: string }
  bert: DashboardSummary['ai']['bert']
  ner: { pipeline: string; banks_in_lexicon: number; field_prototypes: string[] }
  duplicates: string
  anomaly: string
}

export interface LedgerStats {
  blocks?: number
  head_hash?: string
  head_index?: number
  valid?: boolean
  broken_at?: number | null
  signature_failures?: number[]
  checked_at?: string
  counts?: {
    instruments: number
    documents: number
    verifications: number
    requests: number
  }
}

export interface InstitutionSummary {
  institution: {
    id: number
    name: string
    aicte_id: string
    state: string
    city: string | null
    contact_email: string | null
    contact_phone: string | null
  }
  summary: {
    instruments: number
    value: number
    expiring?: number
    matured?: number
    flagged: number
    renewal_punctuality?: number
  }
  instruments?: InstrumentBrief[]
}

export interface SchedulerResult {
  ran_at: string
  instruments_checked: number
  reminders_created: number
  status_changes: number
  escalations: number
  ladder: number[]
}

export interface ChecklistSummary {
  items: ChecklistItem[]
  passed: number
  total: number
  all_passed: boolean
}


export interface SampleDocument {
  name: string
  kind: 'pdf' | 'png'
  bank: string
  amount: number
  size_bytes: number
  url: string
}

export interface UploadResult {
  document_id: number
  document: DocumentRecord
  extraction: {
    fields: Record<string, ExtractedField>
    confidence: number
    missing_fields: string[]
    needs_manual_review: boolean
    anomaly_reasons: string[]
    warnings: string[]
    engine: { ocr: string; bert: string; ner: string }
    embedding_model: string
    text_preview: string
  }
  quality: Record<string, unknown> & { score?: number; issues?: string[] }
  anomaly_score: number
  bank_pattern: { score: number; similarity: number | null; samples: number; note: string }
  duplicates: { reference: string; similarity?: number; institution?: string }[]
}
