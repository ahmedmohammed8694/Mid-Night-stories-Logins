-- Migration 008: Employee Documents Vault & Compliance Agreements Schema Extension

ALTER TABLE employee_users ADD COLUMN supervisor TEXT;
ALTER TABLE employee_users ADD COLUMN work_shift TEXT;
ALTER TABLE employee_users ADD COLUMN license_seat TEXT;
ALTER TABLE employee_users ADD COLUMN enforce_mfa INTEGER DEFAULT 1;
ALTER TABLE employee_users ADD COLUMN enforce_rotation INTEGER DEFAULT 1;
ALTER TABLE employee_users ADD COLUMN hardware_asset_tag TEXT;
ALTER TABLE employee_users ADD COLUMN documents_json TEXT;
ALTER TABLE employee_users ADD COLUMN compliance_json TEXT;

CREATE TABLE IF NOT EXISTS employee_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employee_users(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL CHECK(doc_type IN ('resume','gov_id','experience','offer_letter','salary_slip','policy_agreement','other')),
  file_name    TEXT NOT NULL,
  file_size    INTEGER DEFAULT 0,
  file_type    TEXT,
  storage_url  TEXT,
  uploaded_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
