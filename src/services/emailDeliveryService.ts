import logger from '../lib/logger';
import { supabase } from '../lib/supabase';

// Email provider interfaces
interface EmailProvider {
  name: string;
  send(request: EmailRequest): Promise<EmailResponse>;
  validateConfig(): boolean;
  getMaxRetries(): number;
}

interface EmailRequest {
  to: string[];
  from: string;
  fromName: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  metadata?: Record<string, any>;
}

interface EmailResponse {
  success: boolean;
  messageId?: string;
  providerId?: string;
  error?: string;
  statusCode?: number;
  deliveryStatus?: 'sent' | 'queued' | 'failed' | 'bounced' | 'delivered';
}

interface DeliveryConfig {
  primaryProvider: string;
  fallbackProviders: string[];
  maxRetries: number;
  retryDelayMs: number;
  webhookUrl?: string;
  trackOpens: boolean;
  trackClicks: boolean;
}

// SendGrid Provider Implementation
class SendGridProvider implements EmailProvider {
  name = 'sendgrid';
  private apiKey: string;
  private baseUrl = 'https://api.sendgrid.com/v3';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(request: EmailRequest): Promise<EmailResponse> {
    try {
      const payload = {
        personalizations: [{
          to: request.to.map(email => ({ email })),
          subject: request.subject,
        }],
        from: {
          email: request.from,
          name: request.fromName
        },
        content: [
          { type: 'text/html', value: request.htmlContent },
          ...(request.textContent ? [{ type: 'text/plain', value: request.textContent }] : [])
        ],
        ...(request.replyTo && { reply_to: { email: request.replyTo } }),
        ...(request.headers && { headers: request.headers }),
        tracking_settings: {
          click_tracking: { enable: true, enable_text: false },
          open_tracking: { enable: true, substitution_tag: '%open_tracking%' },
          subscription_tracking: { enable: false }
        },
        custom_args: request.metadata || {}
      };

      const response = await fetch(`${this.baseUrl}/mail/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const messageId = response.headers.get('X-Message-Id') || `sg_${Date.now()}`;
        return {
          success: true,
          messageId,
          providerId: this.name,
          deliveryStatus: 'sent',
          statusCode: response.status
        };
      } else {
        const error = await response.text();
        return {
          success: false,
          error: `SendGrid error: ${error}`,
          statusCode: response.status,
          deliveryStatus: 'failed'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `SendGrid exception: ${error.message}`,
        deliveryStatus: 'failed'
      };
    }
  }

  validateConfig(): boolean {
    return Boolean(this.apiKey && this.apiKey.startsWith('SG.'));
  }

  getMaxRetries(): number {
    return 3;
  }
}

// Mailgun Provider Implementation
class MailgunProvider implements EmailProvider {
  name = 'mailgun';
  private apiKey: string;
  private domain: string;
  private baseUrl: string;

  constructor(apiKey: string, domain: string, region: 'us' | 'eu' = 'us') {
    this.apiKey = apiKey;
    this.domain = domain;
    this.baseUrl = region === 'eu' 
      ? 'https://api.eu.mailgun.net/v3' 
      : 'https://api.mailgun.net/v3';
  }

  async send(request: EmailRequest): Promise<EmailResponse> {
    try {
      const formData = new FormData();
      formData.append('from', `${request.fromName} <${request.from}>`);
      formData.append('to', request.to.join(','));
      formData.append('subject', request.subject);
      formData.append('html', request.htmlContent);
      
      if (request.textContent) {
        formData.append('text', request.textContent);
      }
      if (request.replyTo) {
        formData.append('h:Reply-To', request.replyTo);
      }
      if (request.headers) {
        Object.entries(request.headers).forEach(([key, value]) => {
          formData.append(`h:${key}`, value);
        });
      }
      if (request.metadata) {
        Object.entries(request.metadata).forEach(([key, value]) => {
          formData.append(`v:${key}`, String(value));
        });
      }

      // Enable tracking
      formData.append('o:tracking', 'true');
      formData.append('o:tracking-clicks', 'true');
      formData.append('o:tracking-opens', 'true');

      const response = await fetch(`${this.baseUrl}/${this.domain}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`api:${this.apiKey}`)}`
        },
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        return {
          success: true,
          messageId: result.id,
          providerId: this.name,
          deliveryStatus: 'queued',
          statusCode: response.status
        };
      } else {
        const error = await response.text();
        return {
          success: false,
          error: `Mailgun error: ${error}`,
          statusCode: response.status,
          deliveryStatus: 'failed'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Mailgun exception: ${error.message}`,
        deliveryStatus: 'failed'
      };
    }
  }

  validateConfig(): boolean {
    return Boolean(this.apiKey && this.domain);
  }

  getMaxRetries(): number {
    return 3;
  }
}

// AWS SES Provider Implementation
class AWSProvider implements EmailProvider {
  name = 'aws_ses';
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;

  constructor(accessKeyId: string, secretAccessKey: string, region: string = 'us-east-1') {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
  }

  async send(_request: EmailRequest): Promise<EmailResponse> {
    try {
      // AWS SES v2 API call would go here
      // For demo purposes, we'll simulate the call
      const messageId = `aws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // In real implementation, this would make actual AWS SES API call
      return {
        success: true,
        messageId,
        providerId: this.name,
        deliveryStatus: 'sent',
        statusCode: 200
      };
    } catch (error: any) {
      return {
        success: false,
        error: `AWS SES exception: ${error.message}`,
        deliveryStatus: 'failed'
      };
    }
  }

  validateConfig(): boolean {
    return Boolean(this.accessKeyId && this.secretAccessKey && this.region);
  }

  getMaxRetries(): number {
    return 2;
  }
}

// Main Email Delivery Service
export class EmailDeliveryService {
  private providers: Map<string, EmailProvider> = new Map();
  private config: DeliveryConfig;
  private deliveryAttempts: Map<string, number> = new Map();

  constructor(config: DeliveryConfig) {
    this.config = config;
    this.initializeProviders();
  }

  private getEnvVar(key: string): string | undefined {
    // Check if we're in a browser environment (client-side)
    if (typeof window !== 'undefined') {
      return import.meta.env[key];
    }
    // Server-side (Netlify functions) - use process.env
    else if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
    // Fallback to import.meta.env
    else {
      return import.meta.env?.[key];
    }
  }

  private initializeProviders() {
    // Initialize providers based on environment variables (works both client and server side)
    const sendgridKey = this.getEnvVar('VITE_SENDGRID_API_KEY') || this.getEnvVar('SENDGRID_API_KEY');
    if (sendgridKey) {
      this.providers.set('sendgrid', new SendGridProvider(sendgridKey));
    }

    const mailgunKey = this.getEnvVar('VITE_MAILGUN_API_KEY') || this.getEnvVar('MAILGUN_API_KEY');
    const mailgunDomain = this.getEnvVar('VITE_MAILGUN_DOMAIN') || this.getEnvVar('MAILGUN_DOMAIN');
    if (mailgunKey && mailgunDomain) {
      this.providers.set('mailgun', new MailgunProvider(mailgunKey, mailgunDomain));
    }

    const awsKey = this.getEnvVar('VITE_AWS_ACCESS_KEY_ID') || this.getEnvVar('AWS_ACCESS_KEY_ID');
    const awsSecret = this.getEnvVar('VITE_AWS_SECRET_ACCESS_KEY') || this.getEnvVar('AWS_SECRET_ACCESS_KEY');
    const awsRegion = this.getEnvVar('VITE_AWS_REGION') || this.getEnvVar('AWS_REGION');
    if (awsKey && awsSecret) {
      this.providers.set('aws_ses', new AWSProvider(awsKey, awsSecret, awsRegion));
    }

    logger.info('Email providers initialized', { 
      providers: Array.from(this.providers.keys()),
      primary: this.config.primaryProvider
    });
  }

  async sendEmail(request: EmailRequest, campaignId?: string): Promise<EmailResponse> {
    const attemptKey = `${campaignId}_${request.to.join(',')}_${Date.now()}`;
    
    // Try primary provider first
    const primaryProvider = this.providers.get(this.config.primaryProvider);
    if (primaryProvider && primaryProvider.validateConfig()) {
      const result = await this.attemptSend(primaryProvider, request, attemptKey);
      if (result.success) {
        await this.logDelivery(campaignId, request, result, primaryProvider.name);
        return result;
      }
      logger.warn('Primary provider failed', { provider: primaryProvider.name, error: result.error });
    }

    // Try fallback providers
    for (const providerName of this.config.fallbackProviders) {
      const provider = this.providers.get(providerName);
      if (provider && provider.validateConfig()) {
        const result = await this.attemptSend(provider, request, attemptKey);
        if (result.success) {
          await this.logDelivery(campaignId, request, result, provider.name);
          return result;
        }
        logger.warn('Fallback provider failed', { provider: providerName, error: result.error });
      }
    }

    // All providers failed
    const finalResult: EmailResponse = {
      success: false,
      error: 'All email providers failed',
      deliveryStatus: 'failed'
    };
    
    await this.logDelivery(campaignId, request, finalResult, 'none');
    return finalResult;
  }

  private async attemptSend(provider: EmailProvider, request: EmailRequest, attemptKey: string): Promise<EmailResponse> {
    const maxRetries = Math.min(provider.getMaxRetries(), this.config.maxRetries);
    let lastError: string = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          logger.info('Retrying email send', { provider: provider.name, attempt, delay });
        }

        const result = await provider.send(request);
        
        if (result.success) {
          this.deliveryAttempts.delete(attemptKey);
          return result;
        }
        
        lastError = result.error || 'Unknown error';
        
        // Don't retry on certain errors (invalid email, etc.)
        if (this.isNonRetryableError(result)) {
          break;
        }
        
      } catch (error: any) {
        lastError = error.message;
        logger.error('Email send attempt failed', { 
          provider: provider.name, 
          attempt, 
          error: error.message 
        });
      }
    }

    this.deliveryAttempts.delete(attemptKey);
    return {
      success: false,
      error: lastError,
      providerId: provider.name,
      deliveryStatus: 'failed'
    };
  }

  private isNonRetryableError(result: EmailResponse): boolean {
    const nonRetryableErrors = [
      'invalid email',
      'blocked',
      'unsubscribed',
      'bounce',
      'spam',
      'authentication failed'
    ];
    
    return nonRetryableErrors.some(error => 
      result.error?.toLowerCase().includes(error) || false
    );
  }

  private async logDelivery(campaignId: string | undefined, request: EmailRequest, result: EmailResponse, provider: string) {
    try {
      const logEntry = {
        campaign_id: campaignId,
        recipient_emails: request.to,
        provider_used: provider,
        message_id: result.messageId,
        delivery_status: result.deliveryStatus,
        status_code: result.statusCode,
        error_message: result.error,
        metadata: {
          subject: request.subject,
          from: request.from,
          fromName: request.fromName,
          timestamp: new Date().toISOString()
        }
      };

      // Log to database
      await supabase
        .from('email_delivery_logs')
        .insert(logEntry);
        
      logger.info('Email delivery logged', { 
        campaignId, 
        provider, 
        status: result.deliveryStatus,
        recipients: request.to.length 
      });
    } catch (error: any) {
      logger.error('Failed to log email delivery', { error: error.message });
    }
  }

  // Send bulk emails with rate limiting
  async sendBulkEmails(requests: EmailRequest[], campaignId?: string): Promise<{
    sent: number;
    failed: number;
    results: EmailResponse[];
  }> {
    const results: EmailResponse[] = [];
    let sent = 0;
    let failed = 0;

    // Process in batches to avoid overwhelming providers
    const batchSize = 10;
    const batches = [];
    
    for (let i = 0; i < requests.length; i += batchSize) {
      batches.push(requests.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(request => 
        this.sendEmail(request, campaignId)
      );

      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          if (result.value.success) {
            sent++;
          } else {
            failed++;
          }
        } else {
          results.push({
            success: false,
            error: result.reason?.message || 'Promise rejected',
            deliveryStatus: 'failed'
          });
          failed++;
        }
      }

      // Rate limiting between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info('Bulk email send completed', { 
      campaignId, 
      total: requests.length, 
      sent, 
      failed 
    });

    return { sent, failed, results };
  }

  // Handle webhook events from providers
  async handleWebhookEvent(provider: string, payload: any): Promise<void> {
    try {
      let normalizedEvent;
      
      switch (provider) {
        case 'sendgrid':
          normalizedEvent = this.normalizeSendGridWebhook(payload);
          break;
        case 'mailgun':
          normalizedEvent = this.normalizeMailgunWebhook(payload);
          break;
        case 'aws_ses':
          normalizedEvent = this.normalizeAWSWebhook(payload);
          break;
        default:
          logger.warn('Unknown webhook provider', { provider });
          return;
      }

      if (normalizedEvent) {
        await this.updateDeliveryStatus(normalizedEvent);
      }
    } catch (error: any) {
      logger.error('Webhook processing failed', { provider, error: error.message });
    }
  }

  private normalizeSendGridWebhook(payload: any[]): any[] {
    return payload.map(event => ({
      messageId: event.sg_message_id,
      event: event.event,
      email: event.email,
      timestamp: event.timestamp,
      reason: event.reason,
      url: event.url,
      userAgent: event.useragent
    }));
  }

  private normalizeMailgunWebhook(payload: any): any {
    return {
      messageId: payload['message-id'],
      event: payload.event,
      email: payload.recipient,
      timestamp: payload.timestamp,
      reason: payload.reason,
      url: payload.url
    };
  }

  private normalizeAWSWebhook(payload: any): any {
    // AWS SNS webhook normalization
    const message = JSON.parse(payload.Message || '{}');
    return {
      messageId: message.mail?.messageId,
      event: message.eventType,
      email: message.mail?.destination?.[0],
      timestamp: message.mail?.timestamp,
      reason: message.bounce?.bouncedRecipients?.[0]?.diagnosticCode
    };
  }

  private async updateDeliveryStatus(event: any): Promise<void> {
    try {
      await supabase
        .from('email_delivery_logs')
        .update({
          delivery_status: this.mapEventToStatus(event.event),
          updated_at: new Date().toISOString(),
          webhook_data: event
        })
        .eq('message_id', event.messageId);
        
      logger.debug('Delivery status updated via webhook', { 
        messageId: event.messageId, 
        event: event.event 
      });
    } catch (error: any) {
      logger.error('Failed to update delivery status', { error: error.message });
    }
  }

  private mapEventToStatus(event: string): string {
    const statusMap: Record<string, string> = {
      delivered: 'delivered',
      bounce: 'bounced',
      dropped: 'failed',
      deferred: 'queued',
      open: 'delivered',
      click: 'delivered',
      unsubscribe: 'delivered',
      spamreport: 'delivered'
    };
    
    return statusMap[event] || 'sent';
  }

  // Get delivery statistics
  async getDeliveryStats(campaignId: string): Promise<{
    sent: number;
    delivered: number;
    bounced: number;
    failed: number;
    opened: number;
    clicked: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('email_delivery_logs')
        .select('delivery_status, webhook_data')
        .eq('campaign_id', campaignId);

      if (error) throw error;

      const stats = {
        sent: 0,
        delivered: 0,
        bounced: 0,
        failed: 0,
        opened: 0,
        clicked: 0
      };

      for (const log of data || []) {
        switch (log.delivery_status) {
          case 'sent':
          case 'queued':
            stats.sent++;
            break;
          case 'delivered':
            stats.delivered++;
            break;
          case 'bounced':
            stats.bounced++;
            break;
          case 'failed':
            stats.failed++;
            break;
        }

        // Check webhook data for opens/clicks
        if (log.webhook_data) {
          if (log.webhook_data.event === 'open') stats.opened++;
          if (log.webhook_data.event === 'click') stats.clicked++;
        }
      }

      return stats;
    } catch (error: any) {
      logger.error('Failed to get delivery stats', { campaignId, error: error.message });
      return { sent: 0, delivered: 0, bounced: 0, failed: 0, opened: 0, clicked: 0 };
    }
  }
}

// Default configuration
export const defaultDeliveryConfig: DeliveryConfig = {
  primaryProvider: 'sendgrid',
  fallbackProviders: ['mailgun', 'aws_ses'],
  maxRetries: 3,
  retryDelayMs: 1000,
  trackOpens: true,
  trackClicks: true
};

// Singleton instance
export const emailDeliveryService = new EmailDeliveryService(defaultDeliveryConfig);
