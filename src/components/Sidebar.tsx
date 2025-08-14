// React import not needed for JSX in modern setups
import { Search, Building, Users, UserCheck, UserCog, TrendingUp, Mail, HelpCircle, Home, User, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  activeModule: string;
  setActiveModule: (module: string) => void;
}

const modules = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, description: 'Overview and quick actions' },
  { id: 'search', label: 'Search Selection', icon: Search, description: 'Choose customer or supplier search' },
  { id: 'personas', label: 'Business Personas', icon: Users, description: 'ICP or Supplier personas' },
  { id: 'results', label: 'Business Results', icon: Building, description: 'View matching businesses' },
  { id: 'decision-maker-profiles', label: 'Decision Maker Profiles', icon: UserCheck, description: 'Top decision maker personas' },
  { id: 'decision-makers', label: 'Decision Makers', icon: UserCog, description: 'Individual decision maker profiles' },
  { id: 'insights', label: 'Market Insights', icon: TrendingUp, description: 'Product/service market analysis' },
  { id: 'campaigns', label: 'Campaign Management', icon: Mail, description: 'Create and manage email campaigns' },
  { id: 'profile', label: 'Profile Settings', icon: User, description: 'Manage your account and preferences' }
];

export default function Sidebar({ activeModule, setActiveModule }: SidebarProps) {
  const { state: authState, logout } = useAuth();

  return (
    <aside className="w-72 bg-white border-r border-gray-200 flex flex-col" role="complementary" aria-label="Navigation sidebar">
      <header className="p-6 border-b border-gray-200" role="banner">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
            <Search className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900" id="app-title">Leadora</h1>
            <p className="text-sm text-gray-500">AI-Powered Lead Intelligence</p>
          </div>
        </div>
        
        {/* User Info */}
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
              {authState.user?.firstName?.[0]}{authState.user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {authState.user?.firstName} {authState.user?.lastName}
              </p>
              <p className="text-xs text-gray-500 truncate">{authState.user?.company}</p>
            </div>
          </div>
        </div>
      </header>

      <nav className="flex-1 px-4 py-6 space-y-2" role="navigation" aria-label="Module navigation">
        <h2 className="sr-only">Navigation Menu</h2>
        {modules.map((module) => {
          const Icon = module.icon;
          const isActive = activeModule === module.id;
          
          return (
            <button
              key={module.id}
              onClick={() => setActiveModule(module.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-describedby={`${module.id}-description`}
              className={`w-full flex items-start space-x-3 px-4 py-3 rounded-xl transition-all duration-200 text-left group ${
                isActive
                  ? 'bg-blue-50 border border-blue-100'
                  : 'hover:bg-gray-50'
              }`}
            >
              <Icon className={`w-5 h-5 mt-0.5 ${
                isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'
              }`} />
              <div className="flex-1">
                <div className={`font-medium ${
                  isActive ? 'text-blue-900' : 'text-gray-900'
                }`}>
                  {module.label}
                </div>
                <div id={`${module.id}-description`} className={`text-sm mt-0.5 ${
                  isActive ? 'text-blue-600' : 'text-gray-500'
                }`}>
                  {module.description}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      <footer className="p-4 border-t border-gray-200" role="contentinfo">
        <div className="space-y-2">
          <button className="w-full flex items-center space-x-3 px-4 py-3 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">
            <HelpCircle className="w-5 h-5" />
            <span className="font-medium">Help & Support</span>
          </button>
          <button 
            onClick={logout}
            className="w-full flex items-center space-x-3 px-4 py-3 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </footer>
    </aside>
  );
}