import React from 'react';
import { Search, Users, CheckCircle, Star, ArrowRight, Zap, Globe, Target, BarChart3, Mail, Shield, Clock, Award, Brain, ChevronRight } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
  onViewDemo: () => void;
}

const features = [
  {
    icon: Brain,
    title: 'Multi-AI Agent System',
    description: 'Advanced AI agents work together to analyze markets, identify prospects, and generate insights with unprecedented accuracy.'
  },
  {
    icon: Target,
    title: 'Precision Lead Targeting',
    description: 'Find your ideal customers and suppliers with laser precision using our proprietary matching algorithms.'
  },
  {
    icon: BarChart3,
    title: 'Investor-Grade Analysis',
    description: 'Get comprehensive TAM/SAM/SOM analysis and market intelligence that rivals top consulting firms.'
  },
  {
    icon: Users,
    title: 'Decision Maker Mapping',
    description: 'Identify and connect with key decision makers through detailed persona analysis and contact intelligence.'
  },
  {
    icon: Mail,
    title: 'Automated Campaigns',
    description: 'Launch personalized email campaigns with AI-generated content that converts prospects into customers.'
  },
  {
    icon: Globe,
    title: 'Global Market Coverage',
    description: 'Access verified business data across 200+ countries with real-time market intelligence updates.'
  }
];

const testimonials = [
  {
    name: 'Sarah Chen',
    role: 'VP of Sales, TechCorp',
    company: 'Fortune 500 Technology Company',
    content: 'Leadora transformed our lead generation process. We increased qualified leads by 340% and reduced our sales cycle by 60 days.',
    rating: 5
  },
  {
    name: 'Michael Rodriguez',
    role: 'CEO & Founder',
    company: 'GrowthTech Ventures',
    content: 'The market intelligence is incredible. We used Leadora\'s analysis to secure $50M in Series B funding. The ROI is phenomenal.',
    rating: 5
  },
  {
    name: 'Dr. Amanda Foster',
    role: 'Chief Strategy Officer',
    company: 'HealthTech Innovations',
    content: 'Finally, a platform that understands B2B complexity. The AI agents provide insights that would take our team months to compile.',
    rating: 5
  }
];

const pricingPlans = [
  {
    name: 'Starter',
    price: '$2,500',
    period: '/month',
    description: 'Perfect for growing businesses ready to scale their lead generation',
    features: [
      'Up to 10 comprehensive searches per month',
      'Access to 50M+ verified business profiles',
      'Basic market analysis (TAM/SAM)',
      'Up to 1,000 leads per month',
      'Email campaign management',
      'Standard support',
      'Basic integrations'
    ],
    popular: false,
    cta: 'Start Free Trial'
  },
  {
    name: 'Professional',
    price: '$7,500',
    period: '/month',
    description: 'Advanced features for established companies seeking market dominance',
    features: [
      'Unlimited comprehensive searches',
      'Access to 200M+ global business database',
      'Full investor-grade market analysis',
      'Up to 10,000 leads per month',
      'Advanced AI campaign optimization',
      'Priority support & dedicated success manager',
      'Advanced integrations & API access',
      'Custom market reports',
      'Competitive intelligence dashboard'
    ],
    popular: true,
    cta: 'Start Free Trial'
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: 'pricing',
    description: 'Tailored solutions for large organizations with complex requirements',
    features: [
      'Unlimited everything + custom features',
      'Private AI model training',
      'Custom data sources integration',
      'Unlimited leads and campaigns',
      'White-label solutions available',
      '24/7 dedicated support team',
      'Custom integrations & workflows',
      'Advanced security & compliance',
      'On-premise deployment options'
    ],
    popular: false,
    cta: 'Contact Sales'
  }
];

const stats = [
  { value: '500M+', label: 'Business Profiles' },
  { value: '200+', label: 'Countries Covered' },
  { value: '95%', label: 'Data Accuracy' },
  { value: '340%', label: 'Average Lead Increase' }
];

export default function LandingPage({ onGetStarted, onSignIn, onViewDemo }: LandingPageProps) {

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <button 
              onClick={() => window.location.reload()}
              className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
            >
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
                <Search className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Leadora
                </h1>
                <p className="text-xs text-gray-500">AI-Powered Lead Intelligence</p>
              </div>
            </button>
            <div className="flex items-center space-x-4">
              <button
                onClick={onViewDemo}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                View Demo
              </button>
              <button
                onClick={onGetStarted}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Sign Up
              </button>
              <button
                onClick={onSignIn}
                className="px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 font-medium transition-all"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-blue-50 via-white to-purple-50 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center space-x-2 bg-blue-100 text-blue-800 px-4 py-2 rounded-full text-sm font-medium mb-8">
              <Zap className="w-4 h-4" />
              <span>The First of Its Kind Research Tool Powered by AI Agents</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold text-gray-900 mb-6 leading-tight">
              Generate Leads with
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent"> AI Precision</span>
            </h1>
            
            <p className="text-xl text-gray-600 mb-8 leading-relaxed">
              The first-of-its-kind research tool powered by multiple AI agents that delivers investor-grade market analysis, 
              precision lead targeting, and comprehensive business intelligence that transforms how you discover opportunities.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4 mb-12">
              <button
                onClick={onGetStarted}
                className="w-full sm:w-auto flex items-center justify-center space-x-2 px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 font-semibold text-lg transition-all shadow-lg hover:shadow-xl"
              >
                <span>Start Free Trial</span>
                <ArrowRight className="w-5 h-5" />
              </button>
              <button
                onClick={onViewDemo}
                className="w-full sm:w-auto flex items-center justify-center space-x-2 px-8 py-4 border-2 border-gray-300 text-gray-700 rounded-xl hover:border-gray-400 hover:bg-gray-50 font-semibold text-lg transition-all"
              >
                <span>Watch Demo</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
                  <div className="text-sm text-gray-600">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Powered by Multiple AI Research Agents
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Our proprietary multi-agent AI research system works 24/7 to analyze markets, identify opportunities, 
              and generate comprehensive business intelligence that would take research teams months to compile.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div key={index} className="bg-white border border-gray-200 rounded-2xl p-8 hover:shadow-lg transition-all duration-300 hover:border-blue-200">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center mb-6">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">{feature.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Trusted by Industry Leaders
            </h2>
            <p className="text-xl text-gray-600">
              See how companies are transforming their growth with Leadora
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
                <div className="flex items-center space-x-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-400 fill-current" />
                  ))}
                </div>
                <p className="text-gray-700 mb-6 leading-relaxed">"{testimonial.content}"</p>
                <div>
                  <div className="font-semibold text-gray-900">{testimonial.name}</div>
                  <div className="text-sm text-gray-600">{testimonial.role}</div>
                  <div className="text-sm text-gray-500">{testimonial.company}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Choose Your Growth Plan
            </h2>
            <p className="text-xl text-gray-600">
              Transparent pricing designed to scale with your business
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {pricingPlans.map((plan, index) => (
              <div
                key={index}
                className={`relative bg-white rounded-2xl border-2 p-8 ${
                  plan.popular
                    ? 'border-blue-500 shadow-xl scale-105'
                    : 'border-gray-200 hover:border-gray-300'
                } transition-all duration-300`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-2 rounded-full text-sm font-medium">
                      Most Popular
                    </div>
                  </div>
                )}

                <div className="text-center mb-8">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                  <div className="mb-4">
                    <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                    <span className="text-gray-600">{plan.period}</span>
                  </div>
                  <p className="text-gray-600">{plan.description}</p>
                </div>

                <div className="space-y-4 mb-8">
                  {plan.features.map((feature, featureIndex) => (
                    <div key={featureIndex} className="flex items-start space-x-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-700">{feature}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={plan.name === 'Enterprise' ? () => {} : onGetStarted}
                  className={`w-full py-3 px-6 rounded-xl font-semibold transition-all ${
                    plan.popular
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700'
                      : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <p className="text-gray-600 mb-4">All plans include a 14-day free trial. No credit card required.</p>
            <div className="flex items-center justify-center space-x-6 text-sm text-gray-500">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4" />
                <span>Enterprise Security</span>
              </div>
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4" />
                <span>24/7 Support</span>
              </div>
              <div className="flex items-center space-x-2">
                <Award className="w-4 h-4" />
                <span>99.9% Uptime SLA</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-purple-600">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Ready to Transform Your Lead Generation?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Join thousands of companies already using Leadora to accelerate their growth
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4">
            <button
              onClick={onGetStarted}
              className="w-full sm:w-auto flex items-center justify-center space-x-2 px-8 py-4 bg-white text-blue-600 rounded-xl hover:bg-gray-50 font-semibold text-lg transition-all shadow-lg"
            >
              <span>Start Your Free Trial</span>
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={onViewDemo}
              className="w-full sm:w-auto px-8 py-4 border-2 border-white text-white rounded-xl hover:bg-white hover:text-blue-600 font-semibold text-lg transition-all"
            >
              Watch Demo
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <Search className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold">Leadora</span>
              </div>
              <p className="text-gray-400 text-sm">
                The world's first multi-AI research platform delivering investor-grade market intelligence and business insights.
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Integrations</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Press</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Status</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>&copy; 2024 Leadora. All rights reserved. | Privacy Policy | Terms of Service</p>
          </div>
        </div>
      </footer>
    </div>
  );
}