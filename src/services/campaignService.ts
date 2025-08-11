import { supabase } from '../lib/supabase';
import type { EmailCampaign, CampaignRecipient } from '../lib/supabase';

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
    try {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error: any) {
      // Fallback to proxy if direct Supabase call fails (CORS issues)
      if (error.message?.includes('Load failed') || error.message?.includes('access control')) {
        console.log('CORS issue detected for campaigns, falling back to proxy...');
        try {
          const response = await fetch(`/.netlify/functions/user-data-proxy?table=email_campaigns&user_id=${userId}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          });
          if (!response.ok) throw new Error(`Proxy request failed: ${response.status}`);
          return await response.json();
        } catch {
          console.log('Proxy also failed for campaigns, returning empty array...');
          return []; // Return empty array as final fallback
        }
      }
      throw error;
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
        console.log('CORS issue detected for campaign_recipients, falling back to proxy...');
        try {
          const response = await fetch(`/.netlify/functions/user-data-proxy?table=campaign_recipients&campaign_id=${campaignId}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          if (!response.ok) throw new Error(`Proxy request failed: ${response.status}`);
          return await response.json();
        } catch {
          console.log('Proxy also failed for campaign_recipients, returning empty array...');
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

  // Send campaign (update status and sent_date)
  static async sendCampaign(campaignId: string): Promise<EmailCampaign> {
    const { data, error } = await supabase
      .from('email_campaigns')
      .update({ 
        status: 'sent',
        sent_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Delete campaign
  static async deleteCampaign(campaignId: string): Promise<void> {
    const { error } = await supabase
      .from('email_campaigns')
      .delete()
      .eq('id', campaignId);

    if (error) throw error;
  }
}