import React, { useState, useEffect } from 'react';
import { Mail, Users, Building, Filter, Send, Eye, Edit, Trash2, Plus, Target, UserCheck, CheckCircle, Circle, Search, Calendar, BarChart3, Upload, Image, Paperclip, Monitor } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import { SearchService } from '../../services/searchService';
import { useDemoMode } from '../../hooks/useDemoMode';

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_USER_EMAIL = 'demo@leadora.com';

interface EmailTemplate {
  id: string;
  name: string;
  type: 'customer' | 'supplier';
  subject: string;
  content: string;
  category: 'introduction' | 'follow-up' | 'proposal' | 'meeting-request';
}

interface Campaign {
  id: string;
  name: string;
  type: 'customer' | 'supplier';
  status: 'draft' | 'scheduled' | 'sent' | 'active';
  templateId: string;
  recipients: {
    businesses: string[];
    decisionMakers: string[];
  };
  scheduledDate?: string;
  sentDate?: string;
  stats: {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
  };
}

export default function CampaignManagement() {
  const { state } = useAppContext();
  const { getCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  // Simple demo user detection
  const isDemoUser = (userId?: string | null, userEmail?: string | null) => {
    return userId === DEMO_USER_ID || userId === 'demo-user' || userEmail === DEMO_USER_EMAIL;
  };
  const [activeTab, setActiveTab] = useState('create');
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [selectedBusinesses, setSelectedBusinesses] = useState<string[]>([]);
  const [selectedDecisionMakers, setSelectedDecisionMakers] = useState<string[]>([]);
  const [filterPersona, setFilterPersona] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [customContent, setCustomContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [decisionMakers, setDecisionMakers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSearch, setHasSearch] = useState(false);

  // Load data on component mount
  useEffect(() => {
    loadCampaignData();
  }, []);

  const loadCampaignData = async () => {
    setIsLoading(true);
    try {
      const currentSearch = getCurrentSearch();
      const isDemo = isDemoUser(authState.user?.id, authState.user?.email);
      
      if (isDemo) {
        setBusinesses(getStaticBusinesses());
        setDecisionMakers(getStaticDecisionMakers());
        setHasSearch(true);
      } else if (!currentSearch) {
        setBusinesses([]);
        setDecisionMakers([]);
        setHasSearch(false);
      } else {
        // Load real data from database
        const [businessData, dmData] = await Promise.all([
          SearchService.generateBusinesses(currentSearch.id, authState.user?.id || '', false),
          SearchService.generateDecisionMakers(currentSearch.id, authState.user?.id || '', false)
        ]);
        
        // Transform business data
        const transformedBusinesses = businessData.map(business => ({
          id: business.id,
          name: business.name,
          persona: business.persona_type || 'Business',
          email: business.email || `contact@${business.name.toLowerCase().replace(/\s+/g, '')}.com`
        }));

        // Transform decision maker data
        const transformedDMs = dmData.map(dm => ({
          id: dm.id,
          name: dm.name,
          title: dm.title,
          company: dm.company,
          persona: dm.persona_type || dm.title,
          level: dm.level,
          email: dm.email || `${dm.name.toLowerCase().replace(/\s+/g, '.')}@${dm.company.toLowerCase().replace(/\s+/g, '')}.com`
        }));

        setBusinesses(transformedBusinesses);
        setDecisionMakers(transformedDMs);
        setHasSearch(true);
      }
    } catch (error) {
      console.error('Error loading campaign data:', error);
      setBusinesses([]);
      setDecisionMakers([]);
      setHasSearch(false);
    } finally {
      setIsLoading(false);
    }
  };

  const getStaticBusinesses = () => [
    { id: '1', name: 'TechCorp Solutions', persona: 'Enterprise Technology Leader', email: 'contact@techcorp.com' },
    { id: '2', name: 'InnovateTech Inc', persona: 'Mid-Market Innovation Driver', email: 'hello@innovatetech.com' },
    { id: '3', name: 'HealthTech Innovations', persona: 'Healthcare Digital Transformer', email: 'info@healthtech.com' },
    { id: '4', name: 'Global Manufacturing Corp', persona: 'Manufacturing Efficiency Expert', email: 'contact@globalmanuf.com' },
    { id: '5', name: 'Financial Services Group', persona: 'Financial Services Innovator', email: 'business@finservices.com' }
  ];

  const getStaticDecisionMakers = () => [
    { id: '1', name: 'Sarah Johnson', title: 'Chief Technology Officer', company: 'TechCorp Solutions', persona: 'Chief Technology Officer', level: 'executive', email: 'sarah.johnson@techcorp.com' },
    { id: '2', name: 'Michael Chen', title: 'VP of Engineering', company: 'InnovateTech Inc', persona: 'VP of Engineering', level: 'director', email: 'michael.chen@innovatetech.com' },
    { id: '3', name: 'Dr. Amanda Lee', title: 'Chief Data Officer', company: 'HealthTech Innovations', persona: 'Chief Data Officer', level: 'executive', email: 'amanda.lee@healthtech.com' },
    { id: '4', name: 'Kevin Brown', title: 'Director of IT', company: 'Global Manufacturing Corp', persona: 'Director of IT', level: 'director', email: 'kevin.brown@globalmanuf.com' },
    { id: '5', name: 'Michelle Rodriguez', title: 'Head of Digital Transformation', company: 'Financial Services Group', persona: 'Head of Digital Transformation', level: 'director', email: 'michelle.rodriguez@finservices.com' }
  ];

  // Sample email templates
  const [emailTemplates] = useState<EmailTemplate[]>([
    {
      id: '1',
      name: 'Customer Introduction - Technology Solutions',
      type: 'customer',
      category: 'introduction',
      subject: 'Transform Your {{COMPANY_NAME}} Operations with {{PRODUCT_SERVICE}}',
      content: `Hi {{FIRST_NAME}},

I hope this email finds you well. I'm reaching out because I noticed that {{COMPANY_NAME}} is focused on {{COMPANY_PRIORITY}}, and I believe our {{PRODUCT_SERVICE}} could significantly help you achieve your goals.

Based on my research, I understand that {{COMPANY_NAME}} is currently facing challenges with {{PAIN_POINT}}. Our solution has helped similar companies in the {{INDUSTRY}} industry:

• {{BENEFIT_1}}
• {{BENEFIT_2}}
• {{BENEFIT_3}}

I'd love to show you how we've helped companies like {{SIMILAR_COMPANY}} achieve {{SPECIFIC_RESULT}}.

Would you be open to a brief 15-minute call next week to discuss how this could benefit {{COMPANY_NAME}}?

Best regards,
{{SENDER_NAME}}
{{SENDER_TITLE}}
{{SENDER_COMPANY}}`
    },
    {
      id: '2',
      name: 'Supplier Partnership Inquiry',
      type: 'supplier',
      category: 'introduction',
      subject: 'Partnership Opportunity: {{PRODUCT_SERVICE}} for {{COMPANY_NAME}}',
      content: `Dear {{FIRST_NAME}},

I hope you're doing well. I'm reaching out to explore a potential partnership opportunity between our companies.

We're currently looking for a reliable supplier of {{PRODUCT_SERVICE}} and came across {{COMPANY_NAME}} through our research. Your expertise in {{COMPANY_SPECIALTY}} and track record with {{INDUSTRY}} companies makes you an ideal potential partner.

Our requirements include:
• {{REQUIREMENT_1}}
• {{REQUIREMENT_2}}
• {{REQUIREMENT_3}}

We're particularly interested in your {{SPECIFIC_OFFERING}} and would love to learn more about:
- Your capacity and capabilities
- Pricing structure and terms
- Quality assurance processes
- Timeline for implementation

Would you be available for a call this week to discuss this opportunity further?

Looking forward to hearing from you.

Best regards,
{{SENDER_NAME}}
{{SENDER_TITLE}}
{{SENDER_COMPANY}}`
    },
    {
      id: '3',
      name: 'Customer Follow-up - Meeting Request',
      type: 'customer',
      category: 'meeting-request',
      subject: 'Quick Question About {{COMPANY_NAME}}\'s {{PAIN_POINT}} Challenges',
      content: `Hi {{FIRST_NAME}},

I was just thinking about our previous conversation regarding {{COMPANY_NAME}}'s goals around {{COMPANY_PRIORITY}}.

I came across an interesting case study where we helped {{SIMILAR_COMPANY}} overcome similar {{PAIN_POINT}} challenges, resulting in {{SPECIFIC_RESULT}}. I thought this might be relevant to your current situation.

Would you have 20 minutes this week for a quick call? I'd love to:
• Share the specific approach we used
• Understand your current priorities better
• Explore if there's a fit for {{COMPANY_NAME}}

I have availability on:
• {{DAY_1}} at {{TIME_1}}
• {{DAY_2}} at {{TIME_2}}
• {{DAY_3}} at {{TIME_3}}

Let me know what works best for you!

Best,
{{SENDER_NAME}}`
    },
    {
      id: '4',
      name: 'Supplier Proposal Request',
      type: 'supplier',
      category: 'proposal',
      subject: 'RFP: {{PRODUCT_SERVICE}} Partnership with {{SENDER_COMPANY}}',
      content: `Dear {{FIRST_NAME}},

Thank you for your initial response regarding our {{PRODUCT_SERVICE}} requirements. We're impressed with {{COMPANY_NAME}}'s capabilities and would like to move forward with a formal proposal request.

Project Details:
• Scope: {{PROJECT_SCOPE}}
• Timeline: {{PROJECT_TIMELINE}}
• Budget Range: {{BUDGET_RANGE}}
• Key Requirements: {{KEY_REQUIREMENTS}}

We would appreciate a detailed proposal including:
1. Technical specifications and approach
2. Project timeline and milestones
3. Pricing structure and payment terms
4. Quality assurance and support processes
5. References from similar projects

Please submit your proposal by {{DEADLINE_DATE}}. We plan to make our decision by {{DECISION_DATE}} and begin implementation on {{START_DATE}}.

If you have any questions or need clarification on any requirements, please don't hesitate to reach out.

Thank you for your time and consideration.

Best regards,
{{SENDER_NAME}}
{{SENDER_TITLE}}
{{SENDER_COMPANY}}`
    }
  ]);

  // Sample campaigns
  const [campaigns, setCampaigns] = useState<Campaign[]>([
    {
      id: '1',
      name: 'Q1 Technology Leaders Outreach',
      type: 'customer',
      status: 'sent',
      templateId: '1',
      recipients: {
        businesses: ['1', '2', '3'],
        decisionMakers: ['1', '2', '3', '4', '5']
      },
      sentDate: '2024-01-15',
      stats: {
        sent: 8,
        opened: 6,
        clicked: 3,
        replied: 2
      }
    },
    {
      id: '2',
      name: 'Supplier Partnership Q1',
      type: 'supplier',
      status: 'active',
      templateId: '2',
      recipients: {
        businesses: ['4', '5'],
        decisionMakers: ['6', '7', '8']
      },
      scheduledDate: '2024-01-20',
      stats: {
        sent: 5,
        opened: 4,
        clicked: 2,
        replied: 1
      }
    }
  ]);

  // Dynamic data loaded from database or static demo data

  const businessPersonas = [...new Set(businesses.map(b => b.persona))];
  const decisionMakerPersonas = [...new Set(decisionMakers.map(dm => dm.persona))];
  const levels = [...new Set(decisionMakers.map(dm => dm.level))];

  const filteredBusinesses = businesses.filter(business => 
    !filterPersona || business.persona === filterPersona
  );

  const filteredDecisionMakers = decisionMakers.filter(dm => 
    (!filterPersona || dm.persona === filterPersona) &&
    (!filterLevel || dm.level === filterLevel)
  );

  const handleBusinessToggle = (businessId: string) => {
    setSelectedBusinesses(prev => 
      prev.includes(businessId) 
        ? prev.filter(id => id !== businessId)
        : [...prev, businessId]
    );
  };

  const handleDecisionMakerToggle = (dmId: string) => {
    setSelectedDecisionMakers(prev => 
      prev.includes(dmId) 
        ? prev.filter(id => id !== dmId)
        : [...prev, dmId]
    );
  };

  const handleSelectAllBusinesses = () => {
    if (selectedBusinesses.length === filteredBusinesses.length) {
      setSelectedBusinesses([]);
    } else {
      setSelectedBusinesses(filteredBusinesses.map(b => b.id));
    }
  };

  const handleSelectAllDecisionMakers = () => {
    if (selectedDecisionMakers.length === filteredDecisionMakers.length) {
      setSelectedDecisionMakers([]);
    } else {
      setSelectedDecisionMakers(filteredDecisionMakers.map(dm => dm.id));
    }
  };

  const handleTemplateSelect = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setCustomSubject(template.subject);
    setCustomContent(template.content);
    setShowPreview(true);
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedLogo(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAttachmentUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setAttachments(prev => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const generateEmailHTML = () => {
    // Replace template variables with safe placeholders to prevent JavaScript evaluation
    const safeContent = customContent.replace(/\{\{([^}]+)\}\}/g, '[$1]');
    
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${customSubject}</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #f0f0f0; margin-bottom: 30px; }
            .logo { max-width: 200px; height: auto; }
            .content { padding: 20px 0; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666; }
            .highlight { background-color: #f8f9fa; padding: 15px; border-left: 4px solid #007bff; margin: 20px 0; }
            ul { padding-left: 20px; }
            li { margin-bottom: 8px; }
          </style>
        </head>
        <body>
          <div class="header">
            ${uploadedLogo ? `<img src="${uploadedLogo}" alt="Company Logo" class="logo">` : '<h2>{{SENDER_COMPANY}}</h2>'}
          </div>
          <div class="content">
            ${safeContent.split('\n').map(line => {
              if (line.startsWith('•')) {
                return `<li>${line.substring(1).trim()}</li>`;
              } else if (line.trim() === '') {
                return '<br>';
              } else {
                return `<p>${line}</p>`;
              }
            }).join('')}
          </div>
          <div class="footer">
            <p>This email was sent by [SENDER_COMPANY]. If you no longer wish to receive these emails, you can unsubscribe.</p>
          </div>
        </body>
      </html>
    `;
  };

  const handleCreateCampaign = () => {
    if (!campaignName || !selectedTemplate || (selectedBusinesses.length === 0 && selectedDecisionMakers.length === 0)) {
      alert('Please fill in all required fields and select recipients');
      return;
    }

    const newCampaign: Campaign = {
      id: Date.now().toString(),
      name: campaignName,
      type: state.searchData?.type || 'customer',
      status: scheduledDate ? 'scheduled' : 'draft',
      templateId: selectedTemplate.id,
      recipients: {
        businesses: selectedBusinesses,
        decisionMakers: selectedDecisionMakers
      },
      scheduledDate: scheduledDate || undefined,
      stats: {
        sent: 0,
        opened: 0,
        clicked: 0,
        replied: 0
      }
    };

    setCampaigns(prev => [newCampaign, ...prev]);
    
    // Reset form
    setCampaignName('');
    setSelectedTemplate(null);
    setSelectedBusinesses([]);
    setSelectedDecisionMakers([]);
    setScheduledDate('');
    setCustomSubject('');
    setCustomContent('');
    
    alert('Campaign created successfully!');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      case 'sent': return 'bg-green-100 text-green-800';
      case 'active': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const tabs = [
    { id: 'create', label: 'Create Campaign', icon: Plus },
    { id: 'campaigns', label: 'My Campaigns', icon: Mail },
    { id: 'templates', label: 'Email Templates', icon: Edit }
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900">Loading campaign data...</h3>
          <p className="text-gray-600">Gathering businesses and decision makers for your campaigns</p>
        </div>
      </div>
    );
  }

  // Always show the campaign interface - users can explore email templates and design features
  // Real contact data will be loaded when available from searches

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Campaign Management</h1>
        <p className="text-gray-600 mt-2">Create and manage email campaigns for your generated leads</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 border-b-2 font-medium transition-colors ${
                    isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'create' && (
            <div className="space-y-8">
              {/* Campaign Details */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Campaign Details</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Name</label>
                        <input
                          type="text"
                          value={campaignName}
                          onChange={(e) => setCampaignName(e.target.value)}
                          placeholder="Enter campaign name"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Schedule Date (Optional)</label>
                        <input
                          type="datetime-local"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Email Template Selection */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Email Template</h3>
                    <div className="space-y-3">
                      {emailTemplates
                        .filter(template => template.type === (state.searchData?.type || 'customer'))
                        .map((template) => (
                        <div
                          key={template.id}
                          onClick={() => handleTemplateSelect(template)}
                          className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                            selectedTemplate?.id === template.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-medium text-gray-900">{template.name}</h4>
                              <p className="text-sm text-gray-600 mt-1">{template.subject}</p>
                              <span className={`inline-block px-2 py-1 text-xs rounded-full mt-2 ${
                                template.category === 'introduction' ? 'bg-green-100 text-green-800' :
                                template.category === 'follow-up' ? 'bg-blue-100 text-blue-800' :
                                template.category === 'proposal' ? 'bg-purple-100 text-purple-800' :
                                'bg-orange-100 text-orange-800'
                              }`}>
                                {template.category}
                              </span>
                            </div>
                            {selectedTemplate?.id === template.id && (
                              <CheckCircle className="w-5 h-5 text-blue-600" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Email Preview */}
                <div className="lg:col-span-2 space-y-6">
                  {selectedTemplate && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Preview & Customization</h3>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Email Editor */}
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Subject Line</label>
                            <input
                              type="text"
                              value={customSubject}
                              onChange={(e) => setCustomSubject(e.target.value)}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                          
                          {/* Logo Upload */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Company Logo</label>
                            <div className="flex items-center space-x-4">
                              <label className="flex items-center space-x-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors">
                                <Image className="w-4 h-4" />
                                <span>Upload Logo</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={handleLogoUpload}
                                  className="hidden"
                                />
                              </label>
                              {uploadedLogo && (
                                <div className="flex items-center space-x-2">
                                  <img src={uploadedLogo} alt="Logo preview" className="w-8 h-8 object-contain" />
                                  <button
                                    onClick={() => setUploadedLogo(null)}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Attachments */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Attachments</label>
                            <div className="space-y-2">
                              <label className="flex items-center space-x-2 px-4 py-2 bg-gray-50 text-gray-600 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                                <Paperclip className="w-4 h-4" />
                                <span>Add Attachments</span>
                                <input
                                  type="file"
                                  multiple
                                  onChange={handleAttachmentUpload}
                                  className="hidden"
                                />
                              </label>
                              {attachments.length > 0 && (
                                <div className="space-y-1">
                                  {attachments.map((file, index) => (
                                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                      <span className="text-sm text-gray-700">{file.name}</span>
                                      <button
                                        onClick={() => removeAttachment(index)}
                                        className="text-red-600 hover:text-red-700 text-sm"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Email Content</label>
                            <textarea
                              value={customContent}
                              onChange={(e) => setCustomContent(e.target.value)}
                              rows={8}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                            />
                          </div>
                          
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h4 className="font-medium text-blue-900 mb-2">Available Variables:</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm text-blue-800">
                              <span>[FIRST_NAME]</span>
                              <span>[COMPANY_NAME]</span>
                              <span>[PRODUCT_SERVICE]</span>
                              <span>[PAIN_POINT]</span>
                              <span>[INDUSTRY]</span>
                              <span>[COMPANY_PRIORITY]</span>
                            </div>
                          </div>
                        </div>

                        {/* Email Preview */}
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium text-gray-900">Email Preview</h4>
                            <button
                              onClick={() => setShowPreview(!showPreview)}
                              className="flex items-center space-x-2 px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              <Monitor className="w-4 h-4" />
                              <span>{showPreview ? 'Hide' : 'Show'} Preview</span>
                            </button>
                          </div>
                          
                          {showPreview && (
                            <div className="border border-gray-300 rounded-lg overflow-hidden">
                              <div className="bg-gray-100 px-4 py-2 border-b border-gray-300">
                                <div className="flex items-center space-x-2 text-sm text-gray-600">
                                  <span className="font-medium">Subject:</span>
                                  <span>{customSubject}</span>
                                </div>
                                {attachments.length > 0 && (
                                  <div className="flex items-center space-x-2 text-sm text-gray-600 mt-1">
                                    <Paperclip className="w-3 h-3" />
                                    <span>{attachments.length} attachment{attachments.length > 1 ? 's' : ''}</span>
                                  </div>
                                )}
                              </div>
                              <div className="bg-white max-h-96 overflow-y-auto">
                                <iframe
                                  srcDoc={generateEmailHTML()}
                                  className="w-full h-96 border-none"
                                  title="Email Preview"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Recipient Selection */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Select Recipients</h3>
                  <div className="text-sm text-gray-600">
                    {selectedBusinesses.length + selectedDecisionMakers.length} recipients selected
                  </div>
                </div>

                {/* Filters */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center space-x-4">
                    <Filter className="w-5 h-5 text-gray-400" />
                    <div className="flex space-x-4 flex-1">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Filter by Persona</label>
                        <select
                          value={filterPersona}
                          onChange={(e) => setFilterPersona(e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">All Personas</option>
                          {[...businessPersonas, ...decisionMakerPersonas].map(persona => (
                            <option key={persona} value={persona}>{persona}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Filter by Level</label>
                        <select
                          value={filterLevel}
                          onChange={(e) => setFilterLevel(e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">All Levels</option>
                          {levels.map(level => (
                            <option key={level} value={level}>{level}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Businesses */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium text-gray-900">Businesses ({filteredBusinesses.length})</h4>
                      <button
                        onClick={handleSelectAllBusinesses}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        {selectedBusinesses.length === filteredBusinesses.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {filteredBusinesses.length > 0 ? (
                        filteredBusinesses.map((business) => (
                          <div
                            key={business.id}
                            onClick={() => handleBusinessToggle(business.id)}
                            className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50"
                          >
                            {selectedBusinesses.includes(business.id) ? (
                              <CheckCircle className="w-5 h-5 text-blue-600" />
                            ) : (
                              <Circle className="w-5 h-5 text-gray-400" />
                            )}
                            <div className="flex-1">
                              <h5 className="font-medium text-gray-900">{business.name}</h5>
                              <p className="text-sm text-gray-600">{business.persona}</p>
                              <p className="text-xs text-gray-500">{business.email}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <Building className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-sm">No businesses found</p>
                          <p className="text-xs">Start a search to discover businesses for your campaigns</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Decision Makers */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium text-gray-900">Decision Makers ({filteredDecisionMakers.length})</h4>
                      <button
                        onClick={handleSelectAllDecisionMakers}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        {selectedDecisionMakers.length === filteredDecisionMakers.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {filteredDecisionMakers.length > 0 ? (
                        filteredDecisionMakers.map((dm) => (
                          <div
                            key={dm.id}
                            onClick={() => handleDecisionMakerToggle(dm.id)}
                            className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50"
                          >
                            {selectedDecisionMakers.includes(dm.id) ? (
                              <CheckCircle className="w-5 h-5 text-blue-600" />
                            ) : (
                              <Circle className="w-5 h-5 text-gray-400" />
                            )}
                            <div className="flex-1">
                              <h5 className="font-medium text-gray-900">{dm.name}</h5>
                              <p className="text-sm text-gray-600">{dm.title}</p>
                              <p className="text-xs text-gray-500">{dm.company} • {dm.email}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-sm">No decision makers found</p>
                          <p className="text-xs">Start a search to discover contacts for your campaigns</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Create Campaign Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleCreateCampaign}
                  disabled={!campaignName || !selectedTemplate || (selectedBusinesses.length === 0 && selectedDecisionMakers.length === 0)}
                  className="flex items-center space-x-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-5 h-5" />
                  <span>Create Campaign</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'campaigns' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">My Campaigns</h3>
                <button
                  onClick={() => setActiveTab('create')}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Campaign</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900">{campaign.name}</h4>
                        <p className="text-gray-600 mt-1">
                          {campaign.recipients.businesses.length} businesses, {campaign.recipients.decisionMakers.length} decision makers
                        </p>
                        {campaign.scheduledDate && (
                          <p className="text-sm text-gray-500 mt-1">
                            Scheduled: {new Date(campaign.scheduledDate).toLocaleDateString()}
                          </p>
                        )}
                        {campaign.sentDate && (
                          <p className="text-sm text-gray-500 mt-1">
                            Sent: {new Date(campaign.sentDate).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(campaign.status)}`}>
                          {campaign.status}
                        </span>
                        <div className="flex space-x-2">
                          <button className="p-2 text-gray-400 hover:text-gray-600">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button className="p-2 text-gray-400 hover:text-gray-600">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button className="p-2 text-gray-400 hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {(campaign.status === 'sent' || campaign.status === 'active') && (
                      <div className="grid grid-cols-4 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-900">{campaign.stats.sent}</div>
                          <div className="text-sm text-gray-600">Sent</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-600">{campaign.stats.opened}</div>
                          <div className="text-sm text-gray-600">Opened</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">{campaign.stats.clicked}</div>
                          <div className="text-sm text-gray-600">Clicked</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-purple-600">{campaign.stats.replied}</div>
                          <div className="text-sm text-gray-600">Replied</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Email Templates</h3>
                <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  <Plus className="w-4 h-4" />
                  <span>New Template</span>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {emailTemplates.map((template) => (
                  <div key={template.id} className="bg-white border border-gray-200 rounded-xl p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="font-semibold text-gray-900">{template.name}</h4>
                        <p className="text-gray-600 mt-1">{template.subject}</p>
                        <div className="flex items-center space-x-2 mt-2">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            template.type === 'customer' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                          }`}>
                            {template.type}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            template.category === 'introduction' ? 'bg-green-100 text-green-800' :
                            template.category === 'follow-up' ? 'bg-blue-100 text-blue-800' :
                            template.category === 'proposal' ? 'bg-purple-100 text-purple-800' :
                            'bg-orange-100 text-orange-800'
                          }`}>
                            {template.category}
                          </span>
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <button className="p-2 text-gray-400 hover:text-gray-600">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-gray-400 hover:text-gray-600">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-700 line-clamp-4">{template.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}