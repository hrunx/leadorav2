import React, { useState } from 'react';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';

interface OnboardingTourProps {
  onComplete: () => void;
}

const tourSteps = [
  {
    title: 'Welcome to LeadGen Pro',
    description: 'Your comprehensive lead generation platform designed to streamline B2B sales processes across all industries.',
    highlight: 'Get started by building your Ideal Customer Persona'
  },
  {
    title: 'Step-by-Step Process',
    description: 'Our platform guides you through 7 essential modules, each building upon the previous to create a complete lead generation strategy.',
    highlight: 'Each module connects seamlessly to the next'
  },
  {
    title: 'Data-Driven Insights',
    description: 'Make informed decisions with market analysis, TAM/SAM calculations, and performance tracking built into every step.',
    highlight: 'Transform data into actionable strategies'
  }
];

export default function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="bg-white rounded-2xl p-8 max-w-lg mx-4 relative" role="document">
        <button
          onClick={handleSkip}
          aria-label="Skip onboarding tour"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-2xl font-bold text-white">{currentStep + 1}</span>
          </div>

          <h2 id="onboarding-title" className="text-2xl font-bold text-gray-900 mb-4">
            {tourSteps[currentStep].title}
          </h2>

          <p className="text-gray-600 mb-6 leading-relaxed">
            {tourSteps[currentStep].description}
          </p>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-8">
            <p className="text-blue-800 font-medium">
              {tourSteps[currentStep].highlight}
            </p>
          </div>

          <div className="flex justify-between items-center" role="group" aria-label="Onboarding navigation">
            <button
              onClick={handlePrevious}
              disabled={currentStep === 0}
              aria-label="Go to previous step"
              className="flex items-center space-x-2 px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>

            <div className="flex space-x-2" role="group" aria-label="Step indicators">
              {tourSteps.map((_, index) => (
                <div
                  key={index}
                  role="presentation"
                  aria-label={`Step ${index + 1} ${index === currentStep ? 'current' : index < currentStep ? 'completed' : 'upcoming'}`}
                  className={`w-2 h-2 rounded-full ${
                    index === currentStep ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              aria-label={currentStep === tourSteps.length - 1 ? 'Complete onboarding and get started' : 'Go to next step'}
              className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <span>{currentStep === tourSteps.length - 1 ? 'Get Started' : 'Next'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}