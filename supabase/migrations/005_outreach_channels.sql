ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_channels jsonb DEFAULT '{}';
