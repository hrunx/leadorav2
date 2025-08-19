-- Enhanced schema for Leadora B2B lead generation platform
-- This includes all necessary tables and relationships with proper user_id tracking

-- Search caching table to improve dashboard performance
-- This table stores cached search results to avoid re-triggering agents for completed searches

CREATE TABLE IF NOT EXISTS search_cache (
    search_id UUID PRIMARY KEY REFERENCES user_searches(id) ON DELETE CASCADE,
    businesses JSONB DEFAULT '[]'::jsonb,
    business_personas JSONB DEFAULT '[]'::jsonb,
    dm_personas JSONB DEFAULT '[]'::jsonb,
    decision_makers JSONB DEFAULT '[]'::jsonb,
    market_insights JSONB DEFAULT '[]'::jsonb,
    progress JSONB DEFAULT '{}'::jsonb,
    is_complete BOOLEAN DEFAULT false,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_search_cache_updated_at ON search_cache(updated_at);
CREATE INDEX IF NOT EXISTS idx_search_cache_is_complete ON search_cache(is_complete);
CREATE INDEX IF NOT EXISTS idx_search_cache_last_updated ON search_cache(last_updated);

-- Email delivery logs table for comprehensive email tracking
-- This table stores detailed logs of all email delivery attempts

CREATE TABLE IF NOT EXISTS email_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
    recipient_emails TEXT[] NOT NULL,
    provider_used TEXT NOT NULL,
    message_id TEXT,
    delivery_status TEXT CHECK (delivery_status IN ('sent', 'queued', 'failed', 'bounced', 'delivered')),
    status_code INTEGER,
    error_message TEXT,
    webhook_data JSONB,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for email delivery logs
CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_campaign_id ON email_delivery_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_message_id ON email_delivery_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_delivery_status ON email_delivery_logs(delivery_status);
CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_created_at ON email_delivery_logs(created_at);

-- Contact enrichment cache table for LinkedIn and email data
-- This table caches contact enrichment results to avoid repeated API calls

CREATE TABLE IF NOT EXISTS contact_enrichment_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    enrichment_data JSONB NOT NULL,
    confidence_score INTEGER DEFAULT 0,
    sources TEXT[] DEFAULT ARRAY[]::TEXT[],
    linkedin_profile_url TEXT,
    emails JSONB DEFAULT '[]'::jsonb,
    last_enriched TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(person_name, company_name)
);

-- Indexes for contact enrichment cache
CREATE INDEX IF NOT EXISTS idx_contact_enrichment_cache_person_company ON contact_enrichment_cache(person_name, company_name);
CREATE INDEX IF NOT EXISTS idx_contact_enrichment_cache_confidence ON contact_enrichment_cache(confidence_score);
CREATE INDEX IF NOT EXISTS idx_contact_enrichment_cache_last_enriched ON contact_enrichment_cache(last_enriched);

-- Update existing decision_makers table to include enrichment data
-- Add columns for comprehensive contact information

DO $$ 
BEGIN
    -- Add LinkedIn profile data if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'decision_makers' AND column_name = 'linkedin_profile_data') THEN
        ALTER TABLE decision_makers ADD COLUMN linkedin_profile_data JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- Add email enrichment data if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'decision_makers' AND column_name = 'email_enrichment_data') THEN
        ALTER TABLE decision_makers ADD COLUMN email_enrichment_data JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- Add contact enrichment metadata if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'decision_makers' AND column_name = 'enrichment_metadata') THEN
        ALTER TABLE decision_makers ADD COLUMN enrichment_metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- Add enrichment confidence score if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'decision_makers' AND column_name = 'enrichment_confidence') THEN
        ALTER TABLE decision_makers ADD COLUMN enrichment_confidence INTEGER DEFAULT 0;
    END IF;
    
    -- Add last enriched timestamp if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'decision_makers' AND column_name = 'last_enriched') THEN
        ALTER TABLE decision_makers ADD COLUMN last_enriched TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Indexes for enhanced decision makers table
CREATE INDEX IF NOT EXISTS idx_decision_makers_enrichment_confidence ON decision_makers(enrichment_confidence);
CREATE INDEX IF NOT EXISTS idx_decision_makers_last_enriched ON decision_makers(last_enriched);

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for automatic timestamp updates
DROP TRIGGER IF EXISTS update_search_cache_updated_at ON search_cache;
CREATE TRIGGER update_search_cache_updated_at 
    BEFORE UPDATE ON search_cache 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_delivery_logs_updated_at ON email_delivery_logs;
CREATE TRIGGER update_email_delivery_logs_updated_at 
    BEFORE UPDATE ON email_delivery_logs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contact_enrichment_cache_updated_at ON contact_enrichment_cache;
CREATE TRIGGER update_contact_enrichment_cache_updated_at 
    BEFORE UPDATE ON contact_enrichment_cache 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security) policies for the new tables
-- These ensure users can only access their own data

-- Search cache RLS
ALTER TABLE search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own search cache" ON search_cache
    FOR SELECT USING (
        search_id IN (
            SELECT id FROM user_searches WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own search cache" ON search_cache
    FOR ALL USING (
        search_id IN (
            SELECT id FROM user_searches WHERE user_id = auth.uid()
        )
    );

-- Email delivery logs RLS
ALTER TABLE email_delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own email logs" ON email_delivery_logs
    FOR SELECT USING (
        campaign_id IN (
            SELECT id FROM email_campaigns WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "System can manage email logs" ON email_delivery_logs
    FOR ALL USING (true);

-- Contact enrichment cache RLS
ALTER TABLE contact_enrichment_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read contact enrichment cache" ON contact_enrichment_cache
    FOR SELECT USING (true);

CREATE POLICY "System can manage contact enrichment cache" ON contact_enrichment_cache
    FOR ALL USING (true);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON search_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_delivery_logs TO authenticated;
GRANT SELECT ON contact_enrichment_cache TO authenticated;
GRANT ALL ON contact_enrichment_cache TO service_role;

-- Comments for documentation
COMMENT ON TABLE search_cache IS 'Caches completed search results to improve dashboard performance and avoid re-triggering agents';
COMMENT ON TABLE email_delivery_logs IS 'Comprehensive tracking of email delivery status across multiple providers';
COMMENT ON TABLE contact_enrichment_cache IS 'Caches LinkedIn and email enrichment data to avoid repeated API calls';

COMMENT ON COLUMN search_cache.is_complete IS 'Whether the search has completed all agent processing';
COMMENT ON COLUMN email_delivery_logs.provider_used IS 'Email provider that handled the delivery (sendgrid, mailgun, aws_ses)';
COMMENT ON COLUMN contact_enrichment_cache.confidence_score IS 'Overall confidence score (0-100) for the enrichment data';
COMMENT ON COLUMN decision_makers.linkedin_profile_data IS 'Full LinkedIn profile data including experience, education, skills';
COMMENT ON COLUMN decision_makers.email_enrichment_data IS 'Multiple email addresses found with verification status';
COMMENT ON COLUMN decision_makers.enrichment_confidence IS 'Overall confidence score for all enrichment data';

-- Additional indexes for better performance and data integrity
-- These indexes ensure fast lookups for user-specific data

-- User-based indexes for all main tables
CREATE INDEX IF NOT EXISTS idx_user_searches_user_id ON user_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_business_personas_user_id ON business_personas(user_id);
CREATE INDEX IF NOT EXISTS idx_businesses_user_id ON businesses(user_id);
CREATE INDEX IF NOT EXISTS idx_decision_maker_personas_user_id ON decision_maker_personas(user_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_user_id ON decision_makers(user_id);
CREATE INDEX IF NOT EXISTS idx_market_insights_user_id ON market_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_user_id ON email_campaigns(user_id);

-- Foreign key relationship indexes
CREATE INDEX IF NOT EXISTS idx_businesses_search_id ON businesses(search_id);
CREATE INDEX IF NOT EXISTS idx_businesses_persona_id ON businesses(persona_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_search_id ON decision_makers(search_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_persona_id ON decision_makers(persona_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_business_id ON decision_makers(business_id);

-- Search performance indexes
CREATE INDEX IF NOT EXISTS idx_user_searches_created_at ON user_searches(created_at);
CREATE INDEX IF NOT EXISTS idx_user_searches_status ON user_searches(status);
CREATE INDEX IF NOT EXISTS idx_user_searches_search_type ON user_searches(search_type);

-- Campaign performance indexes
CREATE INDEX IF NOT EXISTS idx_email_campaigns_search_id ON email_campaigns(search_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_campaign_type ON email_campaigns(campaign_type);

-- Views for easy data access with proper joins

-- View for businesses with their personas
CREATE OR REPLACE VIEW businesses_with_personas AS
SELECT 
    b.*,
    bp.title as persona_title,
    bp.rank as persona_rank,
    bp.demographics as persona_demographics
FROM businesses b
LEFT JOIN business_personas bp ON b.persona_id = bp.id;

-- View for decision makers with their personas and businesses
CREATE OR REPLACE VIEW decision_makers_with_context AS
SELECT 
    dm.*,
    dmp.title as persona_title,
    dmp.rank as persona_rank,
    dmp.demographics as persona_demographics,
    b.name as business_name,
    b.industry as business_industry,
    b.country as business_country
FROM decision_makers dm
LEFT JOIN decision_maker_personas dmp ON dm.persona_id = dmp.id
LEFT JOIN businesses b ON dm.business_id = b.id;

-- View for complete search results summary
CREATE OR REPLACE VIEW search_results_summary AS
SELECT 
    us.id as search_id,
    us.user_id,
    us.search_type,
    us.product_service,
    us.industries,
    us.countries,
    us.status,
    us.created_at,
    COUNT(DISTINCT bp.id) as business_personas_count,
    COUNT(DISTINCT dmp.id) as dm_personas_count,
    COUNT(DISTINCT b.id) as businesses_count,
    COUNT(DISTINCT dm.id) as decision_makers_count,
    COUNT(DISTINCT mi.id) as market_insights_count
FROM user_searches us
LEFT JOIN business_personas bp ON us.id = bp.search_id
LEFT JOIN decision_maker_personas dmp ON us.id = dmp.search_id
LEFT JOIN businesses b ON us.id = b.search_id
LEFT JOIN decision_makers dm ON us.id = dm.search_id
LEFT JOIN market_insights mi ON us.id = mi.search_id
GROUP BY us.id, us.user_id, us.search_type, us.product_service, 
         us.industries, us.countries, us.status, us.created_at;
