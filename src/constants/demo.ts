/**
 * Centralized demo user constants
 * Used across the application for demo mode detection and behavior
 */

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
export const DEMO_USER_EMAIL = 'demo@leadora.com';

/**
 * Check if a user is the demo user
 */
export function isDemoUser(userId?: string | null, userEmail?: string | null): boolean {
  return userId === DEMO_USER_ID || 
         userId === 'demo-user' || 
         userEmail === DEMO_USER_EMAIL;
}

/**
 * Demo user profile data
 */
export const DEMO_USER_PROFILE = {
  id: 'demo-user',
  email: DEMO_USER_EMAIL,
  full_name: 'Demo User',
  company: 'Demo Company Inc.',
  country: 'United States',
  phone: '+1 (555) 123-4567',
  role: 'user' as const,
  onboarding: {},
  preferences: {},
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z'
};