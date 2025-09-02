import { supabase } from '../lib/supabase';
import logger from '../lib/logger';
import { DEMO_USER_ID } from '../constants/demo';
import type { EmailCampaign, CampaignRecipient } from '../lib/supabase';
import { emailDeliveryService, type EmailRequest } from './emailDeliveryService';
import { getNetlifyFunctionsBaseUrl } from '../utils/baseUrl';

export class CampaignService {
  // Create a new email campaign
  static async createCampaign(userId: string, campaignData: {
    search_id?: string;
    name: string;
    campaign_type: 'customer' | 'supplier';
    template_id?: string;
    subject: string;
    content: string;
    scheduled_date?: string;
  }): Promise<EmailCampaign> {
    const { data, error } = await supabase
      .from('email_campaigns')
      .insert({
        user_id: userId,
        ...campaignData
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Get user's campaigns
  static async getUserCampaigns(userId: string): Promise<EmailCampaign[]> {
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
    const queryUserId = (userId === 'demo-user' || !isUuid(userId)) ? DEMO_USER_ID : userId;
    try {
      // Proxy-first for browser to avoid CORS/RLS
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch(`${import.meta.env.MODE === 'development' ? 'http://localhost:8888' : window.location.origin}/.netlify/functions/user-data-proxy?table=email_campaigns&user_id=${queryUserId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        credentials: 'omit'
      });
      if (response.ok) {
        return await response.json();
      }
      // Fallback to direct Supabase in case proxy is blocked in dev
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .eq('user_id', queryUserId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as any;
    } catch (e: any) {
      logger.error('getUserCampaigns error', { error: e?.message || e });
      return [];
    }
  }

  // Update campaign
  static async updateCampaign(campaignId: string, updates: Partial<EmailCampaign>): Promise<EmailCampaign> {
    const { data, error } = await supabase
      .from('email_campaigns')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Add recipients to campaign
  static async addCampaignRecipients(campaignId: string, userId: string, recipients: {
    recipient_type: 'business' | 'decision_maker';
    recipient_id: string;
    recipient_name: string;
    recipient_email: string;
  }[]): Promise<CampaignRecipient[]> {
    const recipientsToInsert = recipients.map(recipient => ({
      campaign_id: campaignId,
      user_id: userId,
      ...recipient
    }));

    const { data, error } = await supabase
      .from('campaign_recipients')
      .insert(recipientsToInsert)
      .select();

    if (error) throw error;
    return data;
  }

  // Get campaign recipients
  static async getCampaignRecipients(campaignId: string): Promise<CampaignRecipient[]> {
    try {
      const { data, error } = await supabase
        .from('campaign_recipients')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at');
      if (error) throw error;
      return data || [];
    } catch (error: any) {
      if (error.message?.includes('Load failed') || error.message?.includes('access control')) {
        logger.warn('CORS issue detected for campaign_recipients, falling back to proxy...');
        try {
          const response = await fetch(`${import.meta.env.MODE === 'development' ? 'http://localhost:8888' : window.location.origin}/.netlify/functions/user-data-proxy?table=campaign_recipients&campaign_id=${campaignId}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          if (!response.ok) throw new Error(`Proxy request failed: ${response.status}`);
          return await response.json();
        } catch {
          logger.warn('Proxy also failed for campaign_recipients, returning empty array...');
          return [];
        }
      }
      throw error;
    }
  }

  // Update campaign stats
  static async updateCampaignStats(campaignId: string, stats: {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
  }): Promise<void> {
    const { error } = await supabase
      .from('email_campaigns')
      .update({ 
        stats,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId);

    if (error) throw error;
  }

  // Send campaign with robust email delivery
  static async sendCampaign(campaignId: string): Promise<EmailCampaign> {
    try {
      // Get campaign details
      const { data: campaign, error: campaignError } = await supabase
        .from('email_campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();

      if (campaignError || !campaign) {
        throw new Error('Campaign not found');
      }

      // Get recipients
      const recipients = await this.getCampaignRecipients(campaignId);
      if (recipients.length === 0) {
        throw new Error('No recipients found for campaign');
      }

      // Prepare email requests
      const emailRequests: EmailRequest[] = recipients.map(recipient => ({
        to: [recipient.recipient_email],
        from: 'noreply@leadora.com', // Configure from environment
        fromName: 'Leadora Team',
        subject: campaign.subject,
        htmlContent: campaign.content,
        textContent: this.stripHtml(campaign.content),
        metadata: {
          campaignId,
          recipientId: recipient.id,
          recipientType: recipient.recipient_type
        }
      }));

      // Send emails in bulk
      const deliveryResults = await emailDeliveryService.sendBulkEmails(emailRequests, campaignId);
      
      // Update campaign status and stats
      const stats = {
        sent: deliveryResults.sent,
        opened: 0,
        clicked: 0,
        replied: 0
      };

      const { data, error } = await supabase
        .from('email_campaigns')
        .update({ 
          status: 'sent',
          sent_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          stats
        })
        .eq('id', campaignId)
        .select()
        .single();

      if (error) throw error;
      
      logger.info('Campaign sent successfully', {
        campaignId,
        totalRecipients: recipients.length,
        sent: deliveryResults.sent,
        failed: deliveryResults.failed
      });
      
      return data;
    } catch (error: any) {
      logger.error('Failed to send campaign', { campaignId, error: error.message });
      
      // Update campaign status to failed
      await supabase
        .from('email_campaigns')
        .update({ 
          status: 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId);
        
      throw error;
    }
  }

  // Delete campaign
  static async deleteCampaign(campaignId: string): Promise<void> {
    const { error } = await supabase
      .from('email_campaigns')
      .delete()
      .eq('id', campaignId);
 
    if (error) throw error;
  }

  // Enrich company contacts for a search via Netlify function
  static async enrichBusinessContacts(searchId: string): Promise<{ enriched: number }> {
    try {
      const base = getNetlifyFunctionsBaseUrl();
      const response = await fetch(`${base}/.netlify/functions/enrich-business-contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_id: searchId })
      });
      if (!response.ok) return { enriched: 0 };
      const j = await response.json();
      return { enriched: Number(j?.enriched || 0) };
    } catch {
      return { enriched: 0 };
    }
  }

  // Get delivery statistics for a campaign
  static async getCampaignDeliveryStats(campaignId: string): Promise<{
    sent: number;
    delivered: number;
    bounced: number;
    failed: number;
    opened: number;
    clicked: number;
  }> {
    return await emailDeliveryService.getDeliveryStats(campaignId);
  }

  // Send test email
  static async sendTestEmail(campaignId: string, testEmail: string): Promise<boolean> {
    try {
      const { data: campaign, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();

      if (error || !campaign) return false;

      const emailRequest: EmailRequest = {
        to: [testEmail],
        from: 'noreply@leadora.com',
        fromName: 'Leadora Team',
        subject: `[TEST] ${campaign.subject}`,
        htmlContent: campaign.content,
        textContent: this.stripHtml(campaign.content),
        metadata: { 
          campaignId, 
          isTest: true 
        }
      };

      const result = await emailDeliveryService.sendEmail(emailRequest, campaignId);
      return result.success;
    } catch (error: any) {
      logger.error('Failed to send test email', { campaignId, testEmail, error: error.message });
      return false;
    }
  }

  // Utility method to strip HTML tags for text content
  private static stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }
}
