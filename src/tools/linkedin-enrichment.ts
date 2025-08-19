import { serperSearch } from './serper';
import { fetchWithTimeoutRetry } from './util';
import logger from '../lib/logger';

export interface LinkedInProfile {
  profileUrl: string;
  fullName: string;
  headline?: string;
  company?: string;
  location?: string;
  profilePicture?: string;
  summary?: string;
  experience?: LinkedInExperience[];
  education?: LinkedInEducation[];
  skills?: string[];
  connections?: number;
  verified: boolean;
  confidence: number;
  source: string;
  lastUpdated: string;
}

export interface LinkedInExperience {
  title: string;
  company: string;
  location?: string;
  duration?: string;
  description?: string;
  current: boolean;
}

export interface LinkedInEducation {
  institution: string;
  degree?: string;
  field?: string;
  duration?: string;
}

export interface LinkedInEnrichmentResult {
  profile: LinkedInProfile | null;
  alternativeProfiles: LinkedInProfile[];
  confidence: number;
  searchQueries: string[];
  sources: string[];
}

class LinkedInEnricher {
  private maxAlternatives = 5;
  private searchTimeout = 8000;
  private searchRetries = 2;

  async enrichProfile(
    name: string,
    company: string,
    additionalContext?: {
      title?: string;
      location?: string;
      education?: string;
      email?: string;
    }
  ): Promise<LinkedInEnrichmentResult> {
    logger.info('Starting LinkedIn enrichment', { name, company });

    try {
      const searchQueries = this.buildSearchQueries(name, company, additionalContext);
      const profiles: LinkedInProfile[] = [];
      const sources: string[] = [];

      for (const query of searchQueries) {
        try {
          const searchResult = await serperSearch(query, 'us', 10);
          
          if (searchResult.success && searchResult.items.length > 0) {
            for (const item of searchResult.items) {
              if (item.link && item.link.includes('linkedin.com/in/')) {
                const profile = await this.extractProfileFromSearchResult(item, name, company);
                if (profile && !profiles.find(p => p.profileUrl === profile.profileUrl)) {
                  profiles.push(profile);
                  sources.push(query);
                }
              }
            }
          }
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error: any) {
          logger.warn('LinkedIn search query failed', { query, error: error.message });
        }
      }

      // Sort profiles by confidence
      profiles.sort((a, b) => b.confidence - a.confidence);

      const bestProfile = profiles.length > 0 ? profiles[0] : null;
      const alternativeProfiles = profiles.slice(1, this.maxAlternatives + 1);

      // If we found a high-confidence profile, try to enrich it with additional data
      if (bestProfile && bestProfile.confidence > 80) {
        await this.enrichProfileDetails(bestProfile);
      }

      const result: LinkedInEnrichmentResult = {
        profile: bestProfile,
        alternativeProfiles,
        confidence: bestProfile ? bestProfile.confidence : 0,
        searchQueries,
        sources: Array.from(new Set(sources))
      };

      logger.info('LinkedIn enrichment completed', {
        name,
        company,
        profileFound: !!bestProfile,
        confidence: result.confidence,
        alternativesFound: alternativeProfiles.length
      });

      return result;

    } catch (error: any) {
      logger.error('LinkedIn enrichment failed', { name, company, error: error.message });
      return {
        profile: null,
        alternativeProfiles: [],
        confidence: 0,
        searchQueries: [],
        sources: []
      };
    }
  }

  private buildSearchQueries(
    name: string,
    company: string,
    context?: {
      title?: string;
      location?: string;
      education?: string;
      email?: string;
    }
  ): string[] {
    const queries: string[] = [
      // Basic name + company
      `"${name}" "${company}" site:linkedin.com/in`,
      `"${name}" ${company} site:linkedin.com/in`,
      
      // With title if available
      ...(context?.title ? [
        `"${name}" "${context.title}" "${company}" site:linkedin.com/in`,
        `"${name}" "${context.title}" ${company} site:linkedin.com/in`
      ] : []),
      
      // With location if available  
      ...(context?.location ? [
        `"${name}" "${company}" "${context.location}" site:linkedin.com/in`
      ] : []),
      
      // Variations without quotes for broader match
      `${name} ${company} linkedin profile`,
      `${name.split(' ')[0]} ${name.split(' ').slice(1).join('')} ${company} linkedin`,
      
      // Education-based search if available
      ...(context?.education ? [
        `"${name}" "${context.education}" ${company} site:linkedin.com/in`
      ] : [])
    ];

    return queries.slice(0, 8); // Limit to 8 queries to avoid rate limiting
  }

  private async extractProfileFromSearchResult(
    searchItem: any,
    targetName: string,
    targetCompany: string
  ): Promise<LinkedInProfile | null> {
    try {
      const url = searchItem.link;
      const title = searchItem.title || '';
      const snippet = searchItem.snippet || '';
      
      // Extract profile data from search result metadata
      const profile: LinkedInProfile = {
        profileUrl: url,
        fullName: this.extractNameFromSearchResult(title, snippet, targetName),
        headline: this.extractHeadlineFromSearchResult(title, snippet),
        company: this.extractCompanyFromSearchResult(title, snippet, targetCompany),
        location: this.extractLocationFromSearchResult(snippet),
        verified: false,
        confidence: this.calculateProfileConfidence(title, snippet, targetName, targetCompany),
        source: 'serper_search',
        lastUpdated: new Date().toISOString()
      };

      // Only return if confidence is reasonable
      return profile.confidence > 30 ? profile : null;

    } catch (error: any) {
      logger.warn('Failed to extract LinkedIn profile from search result', { error: error.message });
      return null;
    }
  }

  private extractNameFromSearchResult(title: string, snippet: string, targetName: string): string {
    // Try to extract name from title (LinkedIn profiles usually have name first)
    const titleMatch = title.match(/^([^-|]+)/);
    if (titleMatch) {
      const extractedName = titleMatch[1].trim();
      if (extractedName.length > 2 && extractedName.length < 50) {
        return extractedName;
      }
    }
    
    // Fallback to target name
    return targetName;
  }

  private extractHeadlineFromSearchResult(title: string, snippet: string): string | undefined {
    // LinkedIn titles are often formatted as "Name - Headline at Company"
    const headlineMatch = title.match(/- (.+?) at /);
    if (headlineMatch) {
      return headlineMatch[1].trim();
    }
    
    // Try to extract from snippet
    const lines = snippet.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length > 1) {
      return lines[1]; // Second line often contains headline
    }
    
    return undefined;
  }

  private extractCompanyFromSearchResult(title: string, snippet: string, targetCompany: string): string | undefined {
    // Try to extract company from title
    const companyMatch = title.match(/at (.+?)(\s*[-|]|$)/);
    if (companyMatch) {
      return companyMatch[1].trim();
    }
    
    // Look for target company in snippet
    if (snippet.toLowerCase().includes(targetCompany.toLowerCase())) {
      return targetCompany;
    }
    
    return undefined;
  }

  private extractLocationFromSearchResult(snippet: string): string | undefined {
    // Common location patterns in LinkedIn snippets
    const locationPatterns = [
      /Location[:\s]*([^•\n]+)/i,
      /Based in[:\s]*([^•\n]+)/i,
      /([A-Z][a-z]+,\s*[A-Z]{2})/,  // City, State
      /([A-Z][a-z]+\s+[A-Z][a-z]+,\s*[A-Z]{2})/  // City City, State
    ];
    
    for (const pattern of locationPatterns) {
      const match = snippet.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return undefined;
  }

  private calculateProfileConfidence(
    title: string,
    snippet: string,
    targetName: string,
    targetCompany: string
  ): number {
    let confidence = 40; // Base confidence for LinkedIn URL match
    
    const titleLower = title.toLowerCase();
    const snippetLower = snippet.toLowerCase();
    const nameParts = targetName.toLowerCase().split(' ');
    const companyLower = targetCompany.toLowerCase();
    
    // Name matching
    const nameMatches = nameParts.filter(part => 
      part.length > 2 && (titleLower.includes(part) || snippetLower.includes(part))
    );
    confidence += (nameMatches.length / nameParts.length) * 30;
    
    // Company matching
    if (titleLower.includes(companyLower) || snippetLower.includes(companyLower)) {
      confidence += 25;
    }
    
    // Professional context indicators
    const professionalKeywords = ['ceo', 'director', 'manager', 'engineer', 'analyst', 'specialist', 'lead'];
    if (professionalKeywords.some(keyword => titleLower.includes(keyword) || snippetLower.includes(keyword))) {
      confidence += 10;
    }
    
    // Current employment indicator
    if (snippet.includes('Current:') || snippet.includes('currently')) {
      confidence += 5;
    }
    
    return Math.min(confidence, 95);
  }

  private async enrichProfileDetails(profile: LinkedInProfile): Promise<void> {
    try {
      // Try to get additional details through targeted searches
      const profileId = this.extractProfileIdFromUrl(profile.profileUrl);
      if (!profileId) return;

      // Search for more detailed information about this specific profile
      const detailQueries = [
        `"${profile.fullName}" ${profile.company} experience skills`,
        `"${profile.fullName}" ${profile.company} education background`,
        `"${profile.fullName}" ${profile.company} about summary`
      ];

      for (const query of detailQueries) {
        try {
          const searchResult = await serperSearch(query, 'us', 5);
          
          if (searchResult.success && searchResult.items.length > 0) {
            for (const item of searchResult.items) {
              if (item.snippet && item.snippet.length > 100) {
                // Extract additional context from search results
                if (!profile.summary && item.snippet.includes('About:')) {
                  profile.summary = this.extractSummaryFromText(item.snippet);
                }
                
                // Extract skills if mentioned
                if (!profile.skills) {
                  profile.skills = this.extractSkillsFromText(item.snippet);
                }
              }
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (error: any) {
          logger.warn('Failed to enrich profile details', { query, error: error.message });
        }
      }

    } catch (error: any) {
      logger.warn('Profile enrichment failed', { profileUrl: profile.profileUrl, error: error.message });
    }
  }

  private extractProfileIdFromUrl(url: string): string | null {
    const match = url.match(/linkedin\.com\/in\/([^/?]+)/);
    return match ? match[1] : null;
  }

  private extractSummaryFromText(text: string): string | undefined {
    const aboutMatch = text.match(/About[:\s]*([^•\n]{50,200})/i);
    if (aboutMatch) {
      return aboutMatch[1].trim();
    }
    return undefined;
  }

  private extractSkillsFromText(text: string): string[] | undefined {
    const skillsSection = text.match(/Skills?[:\s]*([^•\n]{20,100})/i);
    if (skillsSection) {
      const skills = skillsSection[1]
        .split(/[,•·]/)
        .map(skill => skill.trim())
        .filter(skill => skill.length > 2 && skill.length < 30)
        .slice(0, 10); // Limit to 10 skills
      
      return skills.length > 0 ? skills : undefined;
    }
    return undefined;
  }

  async validateProfile(profileUrl: string): Promise<boolean> {
    try {
      // Basic URL validation
      if (!profileUrl.includes('linkedin.com/in/')) {
        return false;
      }

      // Check if profile appears to be public/accessible
      // Note: This is a simplified check - full validation would require LinkedIn API
      const response = await fetchWithTimeoutRetry(
        profileUrl,
        { 
          method: 'HEAD',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkedInBot/1.0)' }
        },
        5000,
        1
      );

      return response.status !== 404;

    } catch (error: any) {
      logger.warn('LinkedIn profile validation failed', { profileUrl, error: error.message });
      return false;
    }
  }
}

// Export singleton instance
export const linkedInEnricher = new LinkedInEnricher();

// Convenience function for direct use
export async function enrichLinkedInProfile(
  name: string,
  company: string,
  context?: {
    title?: string;
    location?: string;
    education?: string;
    email?: string;
  }
): Promise<LinkedInEnrichmentResult> {
  return linkedInEnricher.enrichProfile(name, company, context);
}
