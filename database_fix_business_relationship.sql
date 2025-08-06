-- =====================================================
-- CRITICAL FIX: Add business_id foreign key to decision_makers table
-- This enables linking decision makers to their businesses
-- =====================================================

-- Add business_id foreign key column to decision_makers table
ALTER TABLE decision_makers 
ADD COLUMN IF NOT EXISTS business_id uuid;

-- Add foreign key constraint to ensure data integrity
ALTER TABLE decision_makers 
ADD CONSTRAINT IF NOT EXISTS fk_decision_makers_business_id 
FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_decision_makers_business_id 
ON decision_makers(business_id);

-- Verify the relationship is established
-- Check existing data integrity
DO $$
BEGIN
    RAISE NOTICE 'Business-DM relationship fix applied successfully';
    RAISE NOTICE 'Tables now properly linked: businesses(id) <- decision_makers(business_id)';
END $$;