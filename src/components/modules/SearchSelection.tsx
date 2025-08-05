import React, { useState } from 'react';
import { Search, Users, Building, ArrowRight, Globe, Package, Factory, Heart, Briefcase, Car, Home, Plane, ShoppingBag, Cpu, Zap, Plus, X } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useUserData } from '../../context/UserDataContext';
import { useAuth } from '../../context/AuthContext';
import AgentProgressOverlay from '../AgentProgressOverlay';

const industries = [
  { id: 'technology', name: 'Technology', icon: Cpu, color: 'bg-blue-100 text-blue-600' },
  { id: 'healthcare', name: 'Healthcare', icon: Heart, color: 'bg-red-100 text-red-600' },
  { id: 'manufacturing', name: 'Manufacturing', icon: Factory, color: 'bg-gray-100 text-gray-600' },
  { id: 'finance', name: 'Finance', icon: Briefcase, color: 'bg-green-100 text-green-600' },
  { id: 'automotive', name: 'Automotive', icon: Car, color: 'bg-orange-100 text-orange-600' },
  { id: 'real-estate', name: 'Real Estate', icon: Home, color: 'bg-purple-100 text-purple-600' },
  { id: 'travel', name: 'Travel & Tourism', icon: Plane, color: 'bg-cyan-100 text-cyan-600' },
  { id: 'retail', name: 'Retail', icon: ShoppingBag, color: 'bg-pink-100 text-pink-600' },
  { id: 'energy', name: 'Energy', icon: Zap, color: 'bg-yellow-100 text-yellow-600' }
];

const countries = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  
  // GCC Countries
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait', flag: '🇰🇼' },
  { code: 'BH', name: 'Bahrain', flag: '🇧🇭' },
  { code: 'OM', name: 'Oman', flag: '🇴🇲' }
];

export default function SearchSelection() {
  const { updateSearchData } = useAppContext();
  const { createSearch, setCurrentSearch } = useUserData();
  const { state: authState } = useAuth();
  const [searchType, setSearchType] = useState<'customer' | 'supplier' | null>(null);
  const [productService, setProductService] = useState('');
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [customIndustries, setCustomIndustries] = useState<string[]>([]);
  const [customCountries, setCustomCountries] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showIndustryModal, setShowIndustryModal] = useState(false);
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [customIndustryInput, setCustomIndustryInput] = useState('');
  const [customCountryInput, setCustomCountryInput] = useState('');
  const [showProgressOverlay, setShowProgressOverlay] = useState(false);
  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null);

  const handleIndustryToggle = (industryId: string) => {
    setSelectedIndustries(prev => 
      prev.includes(industryId) 
        ? prev.filter(id => id !== industryId)
        : [...prev, industryId]
    );
  };

  const handleCountryToggle = (countryCode: string) => {
    setSelectedCountries(prev => 
      prev.includes(countryCode) 
        ? prev.filter(code => code !== countryCode)
        : [...prev, countryCode]
    );
  };

  const handleAddCustomIndustry = () => {
    if (customIndustryInput.trim() && !customIndustries.includes(customIndustryInput.trim())) {
      setCustomIndustries(prev => [...prev, customIndustryInput.trim()]);
      setCustomIndustryInput('');
      setShowIndustryModal(false);
    }
  };

  const handleRemoveCustomIndustry = (industry: string) => {
    setCustomIndustries(prev => prev.filter(item => item !== industry));
  };

  const handleAddCustomCountry = () => {
    if (customCountryInput.trim() && !customCountries.includes(customCountryInput.trim())) {
      setCustomCountries(prev => [...prev, customCountryInput.trim()]);
      setCustomCountryInput('');
      setShowCountryModal(false);
    }
  };

  const handleRemoveCustomCountry = (country: string) => {
    setCustomCountries(prev => prev.filter(item => item !== country));
  };

  const handleSearch = async () => {
    if (!searchType || !productService.trim()) return;
    
    setIsSearching(true);
    
    const searchData = {
      type: searchType,
      productService: productService.trim(),
      industries: [...selectedIndustries, ...customIndustries],
      countries: [...selectedCountries, ...customCountries],
      timestamp: new Date().toISOString()
    };

    updateSearchData(searchData);

    try {
      // Create search in database (for real users) or use demo flow
      if (authState.user && authState.user.id !== 'demo-user') {
        const searchId = await createSearch(searchData);
        setCurrentSearch(searchId);
        setCurrentSearchId(searchId);
        setIsSearching(false);
        setShowProgressOverlay(true);
      } else {
        // Demo flow - simulate processing time
        await new Promise(resolve => setTimeout(resolve, 1500));
        setIsSearching(false);
        // Navigate to business personas (next step in flow)
        window.dispatchEvent(new CustomEvent('navigate', { detail: 'personas' }));
      }
    } catch (error) {
      console.error('Error creating search:', error);
      setIsSearching(false);
    }
  };

  const handleEarlyNavigation = () => {
    // Navigate to personas early when they're ready, but keep overlay in background
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'personas' }));
    // Start background progress tracking
    window.dispatchEvent(new CustomEvent('startBackgroundProgress', { detail: { searchId: currentSearchId } }));
  };

  const handleProgressComplete = () => {
    setShowProgressOverlay(false);
    setCurrentSearchId(null);
    // Final navigation if not already navigated
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'personas' }));
  };

  return (
    <section className="space-y-8" aria-labelledby="search-heading">
      <header className="text-center">
        <h1 id="search-heading" className="text-4xl font-bold text-gray-900 mb-4">Find Your Business Connections</h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto">
          Discover customers who need your products/services or suppliers who can provide what you're looking for
        </p>
      </header>

      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8" role="form" aria-labelledby="search-form-heading">
          <h2 id="search-form-heading" className="sr-only">Business Search Form</h2>
          <div className="space-y-8">
            {/* Search Type Selection */}
            <fieldset>
              <legend className="text-2xl font-semibold text-gray-900 mb-6 text-center">What are you looking for?</legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6" role="radiogroup" aria-labelledby="search-type-legend">
                <button
                  onClick={() => setSearchType('customer')}
                  role="radio"
                  aria-checked={searchType === 'customer'}
                  aria-labelledby="customer-label"
                  aria-describedby="customer-description"
                  className={`p-8 rounded-xl border-2 transition-all duration-200 text-left ${
                    searchType === 'customer'
                      ? 'border-blue-500 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start space-x-4">
                    <div className={`p-3 rounded-lg ${
                      searchType === 'customer' ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      <Users className={`w-8 h-8 ${
                        searchType === 'customer' ? 'text-blue-600' : 'text-gray-600'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <h3 id="customer-label" className={`text-xl font-semibold mb-2 ${
                        searchType === 'customer' ? 'text-blue-900' : 'text-gray-900'
                      }`}>
                        Find Customers
                      </h3>
                      <p id="customer-description" className={`text-sm ${
                        searchType === 'customer' ? 'text-blue-700' : 'text-gray-600'
                      }`}>
                        Search for businesses that need or require your specific product or service
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setSearchType('supplier')}
                  role="radio"
                  aria-checked={searchType === 'supplier'}
                  aria-labelledby="supplier-label"
                  aria-describedby="supplier-description"
                  className={`p-8 rounded-xl border-2 transition-all duration-200 text-left ${
                    searchType === 'supplier'
                      ? 'border-purple-500 bg-purple-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start space-x-4">
                    <div className={`p-3 rounded-lg ${
                      searchType === 'supplier' ? 'bg-purple-100' : 'bg-gray-100'
                    }`}>
                      <Package className={`w-8 h-8 ${
                        searchType === 'supplier' ? 'text-purple-600' : 'text-gray-600'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <h3 id="supplier-label" className={`text-xl font-semibold mb-2 ${
                        searchType === 'supplier' ? 'text-purple-900' : 'text-gray-900'
                      }`}>
                        Find Suppliers
                      </h3>
                      <p id="supplier-description" className={`text-sm ${
                        searchType === 'supplier' ? 'text-purple-700' : 'text-gray-600'
                      }`}>
                        Discover businesses that sell or provide the specific product or service you need
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </fieldset>

            {/* Industry Selection */}
            {searchType && (
              <fieldset className="space-y-4">
                <legend className="text-xl font-semibold text-gray-900">Select Target Industries</legend>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3" role="group" aria-labelledby="industry-selection">
                  {industries.map((industry) => {
                    const Icon = industry.icon;
                    const isSelected = selectedIndustries.includes(industry.id);
                    
                    return (
                      <button
                        key={industry.id}
                        onClick={() => handleIndustryToggle(industry.id)}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? 'Remove' : 'Add'} ${industry.name} industry`}
                        className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 shadow-sm'
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-lg mx-auto mb-2 flex items-center justify-center ${
                          isSelected ? 'bg-blue-100' : industry.color
                        }`}>
                          <Icon className={`w-6 h-6 ${
                            isSelected ? 'text-blue-600' : industry.color.split(' ')[1]
                          }`} />
                        </div>
                        <p className={`text-sm font-medium ${
                          isSelected ? 'text-blue-900' : 'text-gray-700'
                        }`}>
                          {industry.name}
                        </p>
                      </button>
                    );
                  })}
                  
                  {/* Other Industry Button */}
                  <button
                    onClick={() => setShowIndustryModal(true)}
                    aria-label="Add custom industry"
                    className="p-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all duration-200"
                  >
                    <div className="w-12 h-12 rounded-lg mx-auto mb-2 flex items-center justify-center bg-gray-100">
                      <Plus className="w-6 h-6 text-gray-600" />
                    </div>
                    <p className="text-sm font-medium text-gray-700">Other</p>
                  </button>
                </div>
                
                {/* Custom Industries Display */}
                {customIndustries.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">Custom Industries:</p>
                    <div className="flex flex-wrap gap-2">
                      {customIndustries.map((industry, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800 border border-blue-200"
                        >
                          {industry}
                          <button
                            onClick={() => handleRemoveCustomIndustry(industry)}
                            className="ml-2 hover:text-blue-600"
                            aria-label={`Remove ${industry}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-sm text-gray-600">
                  Select multiple industries to broaden your search scope
                </p>
              </fieldset>
            )}

            {/* Country Selection */}
            {searchType && (
              <fieldset className="space-y-4">
                <legend className="text-xl font-semibold text-gray-900">Select Target Countries</legend>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" role="group" aria-labelledby="country-selection">
                  {countries.map((country) => {
                    const isSelected = selectedCountries.includes(country.code);
                    
                    return (
                      <button
                        key={country.code}
                        onClick={() => handleCountryToggle(country.code)}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? 'Remove' : 'Add'} ${country.name}`}
                        className={`p-4 rounded-xl border-2 transition-all duration-200 text-left ${
                          isSelected
                            ? 'border-green-500 bg-green-50 shadow-sm'
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-2xl">{country.flag}</span>
                          <div>
                            <p className={`font-medium ${
                              isSelected ? 'text-green-900' : 'text-gray-900'
                            }`}>
                              {country.name}
                            </p>
                            <p className={`text-sm ${
                              isSelected ? 'text-green-600' : 'text-gray-500'
                            }`}>
                              {country.code}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  
                  {/* Other Country Button */}
                  <button
                    onClick={() => setShowCountryModal(true)}
                    aria-label="Add custom country"
                    className="p-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 transition-all duration-200 text-left"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Plus className="w-5 h-5 text-gray-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-700">Other</p>
                        <p className="text-sm text-gray-500">Custom</p>
                      </div>
                    </div>
                  </button>
                </div>
                
                {/* Custom Countries Display */}
                {customCountries.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">Custom Countries:</p>
                    <div className="flex flex-wrap gap-2">
                      {customCountries.map((country, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-green-100 text-green-800 border border-green-200"
                        >
                          🌍 {country}
                          <button
                            onClick={() => handleRemoveCustomCountry(country)}
                            className="ml-2 hover:text-green-600"
                            aria-label={`Remove ${country}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                <p className="text-sm text-gray-600">
                  Select multiple countries to expand your geographic reach
                </p>
              </fieldset>
            )}

            {/* Product/Service Input */}
            {searchType && (
              <div className="space-y-4">
                <label htmlFor="product-service-input" className="text-xl font-semibold text-gray-900 block">
                  What {searchType === 'customer' ? 'product or service do you offer' : 'product or service do you need'}?
                </label>
                <div className="relative">
                  <input
                    id="product-service-input"
                    type="text"
                    value={productService}
                    onChange={(e) => setProductService(e.target.value)}
                    aria-describedby="product-service-help"
                    placeholder={searchType === 'customer' 
                      ? 'e.g., CRM Software, Digital Marketing Services, Manufacturing Equipment...'
                      : 'e.g., Cloud Storage Solutions, Legal Services, Raw Materials...'
                    }
                    className="w-full px-6 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <Search className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-6 h-6" />
                </div>
                <p id="product-service-help" className="text-sm text-gray-600">
                  Be specific to get the most relevant results. Include key features or industry terms.
                </p>
              </div>
            )}

            {/* Search Button */}
            {searchType && productService.trim() && (
              <div className="text-center">
                <button
                  onClick={handleSearch}
                  disabled={isSearching}
                  aria-describedby="search-button-status"
                  className={`inline-flex items-center space-x-3 px-8 py-4 text-lg font-semibold rounded-xl transition-all duration-200 ${
                    searchType === 'customer'
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-purple-600 hover:bg-purple-700 text-white'
                  } ${isSearching ? 'opacity-75 cursor-not-allowed' : 'shadow-lg hover:shadow-xl'}`}
                >
                  {isSearching ? (
                    <>
                      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Searching...</span>
                    </>
                  ) : (
                    <>
                      <span>
                        Find {searchType === 'customer' ? 'Customers' : 'Suppliers'}
                      </span>
                      <ArrowRight className="w-6 h-6" />
                    </>
                  )}
                </button>
                <div id="search-button-status" className="sr-only">
                  {isSearching ? 'Search in progress' : 'Ready to search'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Info Cards */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8" aria-labelledby="features-heading">
          <h2 id="features-heading" className="sr-only">Platform Features</h2>
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
            <div className="flex items-center space-x-3 mb-3">
              <Globe className="w-6 h-6 text-blue-600" />
              <h4 className="font-semibold text-blue-900">Global Reach</h4>
            </div>
            <p className="text-blue-800 text-sm">
              Search across all countries and industries to find the perfect business matches
            </p>
          </div>

          <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
            <div className="flex items-center space-x-3 mb-3">
              <Building className="w-6 h-6 text-green-600" />
              <h4 className="font-semibold text-green-900">Verified Businesses</h4>
            </div>
            <p className="text-green-800 text-sm">
              Access verified company information with up-to-date contact details and business profiles
            </p>
          </div>

          <div className="bg-gradient-to-r from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
            <div className="flex items-center space-x-3 mb-3">
              <Users className="w-6 h-6 text-purple-600" />
              <h4 className="font-semibold text-purple-900">Decision Makers</h4>
            </div>
            <p className="text-purple-800 text-sm">
              Get direct access to key decision makers and their detailed professional profiles
            </p>
          </div>
        </section>
      </div>

      {/* Custom Industry Modal */}
      {showIndustryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Add Custom Industry</h3>
                <button
                  onClick={() => {
                    setShowIndustryModal(false);
                    setCustomIndustryInput('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="custom-industry" className="block text-sm font-medium text-gray-700 mb-2">
                    Industry Name
                  </label>
                  <input
                    id="custom-industry"
                    type="text"
                    value={customIndustryInput}
                    onChange={(e) => setCustomIndustryInput(e.target.value)}
                    placeholder="e.g., Biotechnology, Renewable Energy"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyPress={(e) => e.key === 'Enter' && handleAddCustomIndustry()}
                  />
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setShowIndustryModal(false);
                      setCustomIndustryInput('');
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddCustomIndustry}
                    disabled={!customIndustryInput.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Add Industry
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Country Modal */}
      {showCountryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Add Custom Country</h3>
                <button
                  onClick={() => {
                    setShowCountryModal(false);
                    setCustomCountryInput('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="custom-country" className="block text-sm font-medium text-gray-700 mb-2">
                    Country Name
                  </label>
                  <input
                    id="custom-country"
                    type="text"
                    value={customCountryInput}
                    onChange={(e) => setCustomCountryInput(e.target.value)}
                    placeholder="e.g., Brazil, South Korea, Nigeria"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    onKeyPress={(e) => e.key === 'Enter' && handleAddCustomCountry()}
                  />
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setShowCountryModal(false);
                      setCustomCountryInput('');
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddCustomCountry}
                    disabled={!customCountryInput.trim()}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Add Country
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Progress Overlay */}
      <AgentProgressOverlay
        searchId={currentSearchId || ''}
        isVisible={showProgressOverlay}
        onComplete={handleProgressComplete}
        onEarlyNavigation={handleEarlyNavigation}
      />
    </section>
  );
}