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
  serperMaxQueries?: number;
}

const defaultConfig: EmailHarvestingConfig = {
  maxResultsPerQuery: 10,
  timeout: 8000,
  retries: 2,
  enableVerification: true,
  enableHunter: true,
  enableSerperSearch: true,
  enableDomainGuessing: true,
  serperMaxQueries: 4
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
        const isLikelyCompany = this.isLikelyCompanyName(name);
        const looksLikePerson = (!!additionalContext?.title) || (!isLikelyCompany && this.isLikelyPersonName(name));
        if (looksLikePerson) {
          logger.info('Hunter finder start', { name, company });
          const hunterEmails = await this.harvestFromHunter(name, company, additionalContext?.website);
          for (const email of hunterEmails) {
            if (!seenEmails.has(email.email)) {
              seenEmails.add(email.email);
              results.push(email);
            }
          }
        } else if (additionalContext?.website) {
          logger.info('Hunter domain search start', { company, website: additionalContext.website });
          const hunterDomainEmails = await this.harvestFromHunterDomain(company, additionalContext.website);
          for (const email of hunterDomainEmails) {
            if (!seenEmails.has(email.email)) {
              seenEmails.add(email.email);
              results.push(email);
            }
          }
        } else {
          // Attempt to resolve a domain for the company and then run Hunter domain search
          const derived = await this.resolveCompanyDomain(company);
          if (derived) {
            logger.info('Hunter derived domain search start', { company, domain: derived });
            const hunterDomainEmails = await this.harvestFromHunterDomain(company, `https://${derived}`);
            for (const email of hunterDomainEmails) {
              if (!seenEmails.has(email.email)) {
                seenEmails.add(email.email);
                results.push(email);
              }
            }
          } else {
            logger.info('Hunter skip: no website and unable to resolve domain', { name, company });
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

  private async harvestFromHunter(name: string, company: string, website?: string): Promise<EmailHarvestResult[]> {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) {
      logger.info('Hunter skip: API key missing');
      return [];
    }

    try {
      // Prefer domain when available for higher accuracy
      let url = `https://api.hunter.io/v2/email-finder?full_name=${encodeURIComponent(name)}&api_key=${apiKey}`;
      const domain = this.extractDomainFromWebsite(website);
      if (domain) {
        url += `&domain=${encodeURIComponent(domain)}`;
      } else {
        url += `&company=${encodeURIComponent(company)}`;
      }
      
      const response = await fetchWithTimeoutRetry(url, { method: 'GET' }, this.config.timeout, this.config.retries);
      
      if (!response.ok) {
        throw new Error(`Hunter API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data?.data?.email) {
        const emailStr: string = String(data.data.email).toLowerCase();
        const emailDomain = emailStr.split('@')[1]?.toLowerCase();
        const websiteDomain = this.extractDomainFromWebsite(website);
        const relevant = (
          (websiteDomain ? (emailDomain === websiteDomain) : this.isRelevantEmail(emailStr, name, company)) &&
          (!emailDomain || !this.isBlockedDomain(emailDomain))
        );
        if (!relevant) return [];
        const verified = await this.verifyWithHunter(emailStr).catch(() => null);
        return [{
          email: emailStr,
          confidence: data.data.score || 70,
          source: 'hunter',
          verification: verified || {
            status: this.mapHunterVerificationStatus(data.data.verification?.status),
            score: data.data.score || 50,
            deliverable: data.data.verification?.status === 'valid'
          },
          metadata: {
            domain: emailDomain,
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

  private async harvestFromHunterDomain(company: string, website?: string): Promise<EmailHarvestResult[]> {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) return [];
    const domain = this.extractDomainFromWebsite(website);
    if (!domain) return [];
    try {
      const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}&limit=${Math.max(1, Math.min(10, this.config.maxResultsPerQuery))}`;
      const response = await fetchWithTimeoutRetry(url, { method: 'GET' }, this.config.timeout, this.config.retries);
      if (!response.ok) throw new Error(`Hunter domain-search error: ${response.status}`);
      const data = await response.json();
      let arr: EmailHarvestResult[] = [];
      const emails = Array.isArray(data?.data?.emails) ? data.data.emails : [];
      for (const e of emails) {
        const email = String(e?.value || '').toLowerCase();
        if (!this.isValidEmailFormat(email)) continue;
        const verified = await this.verifyWithHunter(email).catch(() => null);
        arr.push({
          email,
          confidence: Number(e?.confidence || e?.score || 70),
          source: 'hunter',
          verification: verified || { status: 'unknown', score: Number(e?.confidence || 50), deliverable: false },
          metadata: {
            domain: email.split('@')[1],
            type: 'work',
            foundAt: 'hunter.io'
          }
        });
      }
      // Relevance filter: require domain to match provided website or be relevant to company, and not be blocked
      const websiteDomain = this.extractDomainFromWebsite(website);
      arr = arr.filter(item => {
        const d = (item.metadata.domain || '').toLowerCase();
        if (!d) return false;
        if (websiteDomain) return d === websiteDomain;
        if (this.isBlockedDomain(d)) return false;
        return this.isRelevantEmail(item.email, company, company);
      });
      return arr;
    } catch (error: any) {
      logger.warn('Hunter domain harvesting failed', { error: error.message });
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

      const maxQ = Math.max(1, Number(this.config.serperMaxQueries || 4));
      for (const query of queries.slice(0, maxQ)) {
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
      // Prefer Hunter verification when available
      if (process.env.HUNTER_API_KEY) {
        const hunter = await this.verifyWithHunter(email);
        if (hunter) return hunter;
      }
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

  private async verifyWithHunter(email: string): Promise<EmailHarvestResult['verification'] | null> {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey) return null;
    try {
      const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`;
      const response = await fetchWithTimeoutRetry(url, { method: 'GET' }, this.config.timeout, this.config.retries);
      if (!response.ok) return null;
      const data = await response.json();
      const statusRaw: string = String(data?.data?.result || data?.data?.status || 'unknown');
      const score = Number(data?.data?.score || 0);
      let status: 'valid' | 'invalid' | 'risky' | 'unknown' = 'unknown';
      switch (statusRaw) {
        case 'deliverable':
        case 'valid':
          status = 'valid';
          break;
        case 'undeliverable':
        case 'invalid':
          status = 'invalid';
          break;
        case 'risky':
        case 'accept_all':
        case 'webmail':
          status = 'risky';
          break;
        default:
          status = 'unknown';
      }
      return { status, score: Number.isFinite(score) ? score : 0, deliverable: status === 'valid' };
    } catch {
      return null;
    }
  }

  private extractDomainFromWebsite(website?: string): string | null {
    try {
      if (!website) return null;
      const host = new URL(website).hostname.toLowerCase();
      return host.startsWith('www.') ? host.slice(4) : host;
    } catch {
      return null;
    }
  }

  private async resolveCompanyDomain(company: string): Promise<string | null> {
    try {
      // Only attempt derivation when company has Latin characters to reduce false positives
      if (!/[A-Za-z]/.test(company)) return null;
      const queries = [
        `"${company}" website`,
        `${company} official site`,
        `${company} homepage`
      ];
      const badHosts = ['linkedin.com','facebook.com','twitter.com','instagram.com','wikipedia.org','youtube.com','medium.com','tiktok.com','google.com','apple.com','microsoft.com'];
      for (const q of queries) {
        const r = await serperSearch(q, 'us', 3);
        if (r.success && Array.isArray(r.items)) {
          for (const item of r.items) {
            try {
              const u = new URL(item.link);
              const host = (u.hostname || '').toLowerCase();
              if (!host) continue;
              if (badHosts.some(b => host.includes(b))) continue;
              return host.startsWith('www.') ? host.slice(4) : host;
            } catch {}
          }
        }
        await new Promise(res => setTimeout(res, 120));
      }
      return null;
    } catch {
      return null;
    }
  }

  private isBlockedDomain(domain: string): boolean {
    const d = (domain || '').toLowerCase();
    const blocked = new Set([
      'tiktok.com','facebook.com','instagram.com','twitter.com','x.com','google.com','gmail.com','youtube.com','apple.com','microsoft.com','amazon.com','aws.amazon.com','cloudflare.com','wikipedia.org','medium.com'
    ]);
    return blocked.has(d);
  }

  // duplicate removed

  // Heuristics
  private isLikelyPersonName(name: string): boolean {
    if (!name) return false;
    const parts = name.trim().split(/[\s]+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) return false;
    // Each part looks like alphabetic and not all uppercase words like company acronyms
    const ok = parts.every(p => /[A-Za-z]/.test(p) && !/[^A-Za-z'\-]/.test(p) && p.toLowerCase() !== p.toUpperCase());
    if (!ok) return false;
    // First and last should start with letters
    return /^[A-Za-z]/.test(parts[0]) && /^[A-Za-z]/.test(parts[parts.length - 1]);
  }

  private isLikelyCompanyName(name: string): boolean {
    if (!name) return false;
    const s = name.toLowerCase();
    const tokens = [' inc', ' llc', ' ltd', ' co', ' company', ' corporation', ' corp', ' group', ' holdings', ' solutions', ' technologies', ' systems', ' services', ' manufacturing', ' industrial', ' industry', ' energy', ' renewables', ' global'];
    return tokens.some(t => s.includes(t)) || /\b(co\.|ltd\.|inc\.|corp\.)\b/i.test(name);
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
