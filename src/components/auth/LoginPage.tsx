import { useEffect, useState } from 'react';
import { Search, Mail, Lock, Eye, EyeOff, ArrowRight, Building, Users, Target } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface LoginPageProps {
  onSwitchToRegister: () => void;
  onBackToLanding: () => void;
}

export default function LoginPage({ onSwitchToRegister, onBackToLanding }: LoginPageProps) {
  const { login, requestOtp, loginWithOtp, resetPassword } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!otpSent || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(prev => Math.max(prev - 1, 0)), 1000);
    return () => clearTimeout(t);
  }, [otpSent, resendIn]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      if (mode === 'password') {
        const success = await login(formData.email, formData.password);
        if (!success) setError('Invalid email or password');
      } else {
        if (!otpSent) {
          const ok = await requestOtp(formData.email, 'signin');
          if (!ok) setError('Failed to send code. Please try again.');
          else {
            setOtpSent(true);
            setResendIn(60);
          }
        } else {
          if (!otpCode || otpCode.length < 6) {
            setError('Enter the 6-digit code sent to your email.');
          } else {
            const ok = await loginWithOtp(formData.email, otpCode);
            if (!ok) setError('Invalid or expired code.');
          }
        }
      }
      // If successful, AuthContext will automatically redirect to dashboard
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex">
      {/* Left Column - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-6">
              <button 
                onClick={onBackToLanding}
                className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
              >
                <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
                  <Search className="w-6 h-6 text-white" />
                </div>
                <span className="text-2xl font-bold text-gray-900">Leadora</span>
              </button>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Welcome back</h2>
            <p className="text-gray-600">Sign in to your Leadora account</p>
          </div>

          {/* Auth Mode Tabs */}
          <div className="flex items-center justify-center mb-4">
            <div className="inline-flex bg-gray-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => { setMode('password'); setError(null); }}
                className={`px-4 py-2 text-sm font-medium rounded-md ${mode==='password'?'bg-white shadow text-gray-900':'text-gray-600 hover:text-gray-800'}`}
              >Password</button>
              <button
                type="button"
                onClick={() => { setMode('otp'); setError(null); }}
                className={`px-4 py-2 text-sm font-medium rounded-md ${mode==='otp'?'bg-white shadow text-gray-900':'text-gray-600 hover:text-gray-800'}`}
              >OTP</button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your email"
                />
              </div>
            </div>

            {mode === 'password' ? (
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={formData.password}
                    onChange={handleChange}
                    className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">
                  One-Time Passcode
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    id="otp"
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={otpSent ? 'Enter 6-digit code' : 'Request a code'}
                  />
                  <button
                    type="button"
                    disabled={loading || resendIn > 0}
                    onClick={async () => {
                      setError(null);
                      setLoading(true);
                      try {
                        const ok = await requestOtp(formData.email, 'signin');
                        if (ok) {
                          setOtpSent(true);
                          setResendIn(60);
                        } else setError('Failed to send code. Please try again.');
                      } finally { setLoading(false); }
                    }}
                    className={`px-4 py-3 rounded-lg border ${resendIn>0?'border-gray-300 text-gray-400':'border-blue-600 text-blue-600 hover:bg-blue-50'}`}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send code'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">A 6-digit code will be sent to your email.</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-purple-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{mode==='password' ? 'Sign In' : (otpSent ? 'Verify & Sign In' : 'Send Code')}</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            {mode==='password' && (
              <button
                onClick={async ()=>{
                  setError(null);
                  if (!formData.email) { setError('Enter your email to reset password.'); return; }
                  setLoading(true);
                  const ok = await resetPassword(formData.email);
                  setLoading(false);
                  if (!ok) setError('Failed to send reset email.');
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium mr-3"
              >
                Forgot password?
              </button>
            )}
            <p className="text-gray-600">
              Don't have an account?{' '}
              <button
                onClick={onSwitchToRegister}
                className="text-blue-600 hover:text-blue-700 font-semibold"
              >
                Sign up
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* Right Column - Features */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-blue-600 to-purple-700 p-12 text-white items-center">
        <div className="max-w-md">
          <h3 className="text-3xl font-bold mb-6">Welcome back to intelligent lead generation</h3>
          <div className="space-y-6">
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">Precision Targeting</h4>
                <p className="text-blue-100">Find your ideal customers with AI-powered search and analysis.</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">Decision Maker Mapping</h4>
                <p className="text-blue-100">Identify and connect with key decision makers in your target companies.</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold mb-1">Market Intelligence</h4>
                <p className="text-blue-100">Get comprehensive market insights and competitive analysis.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}