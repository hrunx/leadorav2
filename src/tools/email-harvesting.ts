import { fetchWithTimeoutRetry } from './util';
import { serperSearch } from './serper';
import logger from '../lib/logger';

export interface EmailHarvestResult {
  email: string;
  confidence: number;
  source: string;
  verification: {
    status: 'valid' | 'invalid' | 'risky' | 'unknown';
    score: number;
    deliverable: boolean;
  };
  metadata: {
    domain: string;
    type: 'work' | 'personal' | 'unknown';
    foundAt?: string;
  };
}

export interface EmailHarvestingConfig {
  maxResultsPerQuery: number;
  timeout: number;
  retries: number;
  enableVerification: boolean;
  enableHunter: boolean;
  enableSerperSearch: boolean;
  enableDomainGuessing: boolean;
}

const defaultConfig: EmailHarvestingConfig = {
  maxResultsPerQuery: 10,
  timeout: 8000,
  retries: 2,
  enableVerification: true,
  enableHunter: true,
  enableSerperSearch: true,
  enableDomainGuessing: true
};

class EmailHarvester {
  private config: EmailHarvestingConfig;

  constructor(config: Partial<EmailHarvestingConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  async harvestEmails(
    name: string, 
    company: string, 
    additionalContext?: {
      title?: string;
      department?: string;
      linkedin?: string;
      website?: string;
    }
  ): Promise<EmailHarvestResult[]> {
    logger.info('Starting comprehensive email harvesting', { name, company });
    
    const results: EmailHarvestResult[] = [];
    const seenEmails = new Set<string>();

    try {
      // Method 1: Hunter.io API
      if (this.config.enableHunter) {
        const hunterEmails = await this.harvestFromHunter(name, company);
        for (const email of hunterEmails) {
          if (!seenEmails.has(email.email)) {
            seenEmails.add(email.email);
            results.push(email);
          }
        }
      }

      // Method 2: Serper Search
      if (this.config.enableSerperSearch) {
        const serperEmails = await this.harvestFromSerper(name, company, additionalContext);
        for (const email of serperEmails) {
          if (!seenEmails.has(email.email)) {
            seenEmails.add(email.email);
            results.push(email);
          }
        }
      }

      // Method 3: Domain-based guessing (educated patterns)
      if (this.config.enableDomainGuessing && additionalContext?.website) {
        const guessedEmails = await this.generateEmailGuesses(name, company, additionalContext.website);
        for (const email of guessedEmails) {
          if (!seenEmails.has(email.email)) {
            seenEmails.add(email.email);
            results.push(email);
          }
        }
      }

      // Sort by confidence score
      results.sort((a, b) => b.confidence - a.confidence);
      
      logger.info('Email harvesting completed', { 
        name, 
        company, 
        totalFound: results.length,
        verified: results.filter(r => r.verification.status === 'valid').length
      });

      return results.slice(0, 10); // Return top 10 results
      
    } catch (error: any) {
      logger.error('Email harvesting failed', { name, company, error: error.message });
      return [];
    }
  }

  private async harvestFromHunter(name: string, company: string): Promise<EmailHarvestResult[]> {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) {
      logger.warn('Hunter API key not configured');
      return [];
    }

    try {
      const url = `https://api.hunter.io/v2/email-finder?full_name=${encodeURIComponent(name)}&company=${encodeURIComponent(company)}&api_key=${apiKey}`;
      
      const response = await fetchWithTimeoutRetry(url, { method: 'GET' }, this.config.timeout, this.config.retries);
      
      if (!response.ok) {
        throw new Error(`Hunter API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data?.data?.email) {
        return [{
          email: data.data.email,
          confidence: data.data.score || 70,
          source: 'hunter',
          verification: {
            status: this.mapHunterVerificationStatus(data.data.verification?.status),
            score: data.data.score || 50,
            deliverable: data.data.verification?.status === 'valid'
          },
          metadata: {
            domain: data.data.email.split('@')[1],
            type: 'work' as const,
            foundAt: 'hunter.io'
          }
        }];
      }

      return [];
      
    } catch (error: any) {
      logger.warn('Hunter email harvesting failed', { error: error.message });
      return [];
    }
  }

  private async harvestFromSerper(
    name: string, 
    company: string, 
    context?: { title?: string; linkedin?: string; website?: string }
  ): Promise<EmailHarvestResult[]> {
    try {
      const queries = [
        `"${name}" "${company}" email`,
        `"${name}" ${company} contact email`,
        `"${name}" "${company}" @ email address`,
        ...(context?.title ? [`"${name}" "${context.title}" "${company}" email`] : []),
        ...(context?.linkedin ? [`"${name}" linkedin "${company}" email contact`] : [])
      ];

      const results: EmailHarvestResult[] = [];

      for (const query of queries) {
        const searchResult = await serperSearch(query, 'us', 8);
        
        if (searchResult.success && searchResult.items.length > 0) {
          for (const item of searchResult.items) {
            const text = `${item.title} ${item.snippet}`.toLowerCase();
            const emails = this.extractEmailsFromText(text);
            
            for (const email of emails) {
              if (this.isRelevantEmail(email, name, company)) {
                results.push({
                  email,
                  confidence: this.calculateEmailConfidence(email, name, company, text),
                  source: 'serper',
                  verification: await this.verifyEmail(email),
                  metadata: {
                    domain: email.split('@')[1],
                    type: this.classifyEmailType(email),
                    foundAt: item.link
                  }
                });
              }
            }
          }
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      return results;
      
    } catch (error: any) {
      logger.warn('Serper email harvesting failed', { error: error.message });
      return [];
    }
  }

  private async generateEmailGuesses(name: string, _company: string, website: string): Promise<EmailHarvestResult[]> {
    try {
      const domain = new URL(website).hostname.replace('www.', '');
      const firstName = name.split(' ')[0].toLowerCase();
      const lastName = name.split(' ').slice(1).join('').toLowerCase();
      const fullName = name.toLowerCase().replace(/\s+/g, '');

      const patterns = [
        `${firstName}.${lastName}@${domain}`,
        `${firstName}${lastName}@${domain}`,
        `${firstName}@${domain}`,
        `${firstName.charAt(0)}.${lastName}@${domain}`,
        `${firstName.charAt(0)}${lastName}@${domain}`,
        `${firstName}_${lastName}@${domain}`,
        `${firstName}-${lastName}@${domain}`,
        `${lastName}.${firstName}@${domain}`,
        `${fullName}@${domain}`
      ];

      const results: EmailHarvestResult[] = [];

      for (const email of patterns) {
        if (this.isValidEmailFormat(email)) {
          const verification = this.config.enableVerification ? 
            await this.verifyEmail(email) : 
            { status: 'unknown' as const, score: 50, deliverable: false };

          results.push({
            email,
            confidence: verification.status === 'valid' ? 90 : 
                       verification.status === 'risky' ? 60 : 30,
            source: 'pattern',
            verification,
            metadata: {
              domain,
              type: 'work',
              foundAt: 'pattern_generation'
            }
          });
        }
      }

      return results;
      
    } catch (error: any) {
      logger.warn('Email pattern generation failed', { error: error.message });
      return [];
    }
  }

  private extractEmailsFromText(text: string): string[] {
    const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
    const matches = text.match(emailRegex) || [];
    
    return matches
      .map(email => email.toLowerCase())
      .filter(email => this.isValidEmailFormat(email))
      .filter((email, index, arr) => arr.indexOf(email) === index); // Remove duplicates
  }

  private isValidEmailFormat(email: string): boolean {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email) && !email.includes('..');
  }

  private isRelevantEmail(email: string, name: string, company: string): boolean {
    const emailLocal = email.split('@')[0].toLowerCase();
    const nameParts = name.toLowerCase().split(' ');
    const companyName = company.toLowerCase();

    // Check if email contains name parts
    const containsName = nameParts.some(part => 
      part.length > 2 && emailLocal.includes(part)
    );

    // Check if domain relates to company
    const domain = email.split('@')[1].toLowerCase();
    const containsCompany = domain.includes(companyName.replace(/\s+/g, '')) ||
                           companyName.replace(/\s+/g, '').includes(domain.split('.')[0]);

    return containsName || containsCompany;
  }

  private calculateEmailConfidence(email: string, name: string, company: string, context: string): number {
    let confidence = 50;
    
    const emailLocal = email.split('@')[0].toLowerCase();
    const nameParts = name.toLowerCase().split(' ');
    
    // Boost confidence if email contains full name
    if (nameParts.every(part => part.length > 2 && emailLocal.includes(part))) {
      confidence += 30;
    }
    
    // Boost if found in professional context
    if (context.includes('contact') || context.includes('email') || context.includes('reach')) {
      confidence += 20;
    }
    
    // Boost if domain matches company
    const domain = email.split('@')[1];
    if (company.toLowerCase().includes(domain.split('.')[0])) {
      confidence += 25;
    }
    
    return Math.min(confidence, 95);
  }

  private classifyEmailType(email: string): 'work' | 'personal' | 'unknown' {
    const domain = email.split('@')[1].toLowerCase();
    const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
    
    if (personalDomains.includes(domain)) {
      return 'personal';
    }
    
    return 'work';
  }

  private async verifyEmail(email: string): Promise<EmailHarvestResult['verification']> {
    if (!this.config.enableVerification) {
      return { status: 'unknown', score: 50, deliverable: false };
    }

    try {
      // Basic format validation
      if (!this.isValidEmailFormat(email)) {
        return { status: 'invalid', score: 0, deliverable: false };
      }

      // Domain validation
      const domain = email.split('@')[1];
      
      // Check if domain has MX record (simplified check)
      // In production, you'd use a proper email verification service
      const isValidDomain = await this.checkDomainMX(domain);
      
      if (!isValidDomain) {
        return { status: 'invalid', score: 10, deliverable: false };
      }

      // For production, integrate with services like:
      // - ZeroBounce
      // - EmailListVerify
      // - Hunter verification
      // - NeverBounce
      
      return { status: 'unknown', score: 70, deliverable: true };
      
    } catch (error: any) {
      logger.warn('Email verification failed', { email, error: error.message });
      return { status: 'unknown', score: 50, deliverable: false };
    }
  }

  private async checkDomainMX(domain: string): Promise<boolean> {
    try {
      // This is a simplified check - in production use proper DNS resolution
      const response = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`, {
        timeout: 3000
      } as any);
      
      if (response.ok) {
        const data = await response.json();
        return data.Answer && data.Answer.length > 0;
      }
      
      return true; // Assume valid if we can't check
    } catch {
      return true; // Assume valid if we can't check
    }
  }

  private mapHunterVerificationStatus(status?: string): 'valid' | 'invalid' | 'risky' | 'unknown' {
    switch (status) {
      case 'valid': return 'valid';
      case 'invalid': return 'invalid';
      case 'accept_all':
      case 'webmail': return 'risky';
      default: return 'unknown';
    }
  }
}

// Export singleton instance
export const emailHarvester = new EmailHarvester();

// Convenience function for direct use
export async function harvestContactEmails(
  name: string,
  company: string,
  context?: {
    title?: string;
    department?: string;
    linkedin?: string;
    website?: string;
  }
): Promise<EmailHarvestResult[]> {
  return emailHarvester.harvestEmails(name, company, context);
}
