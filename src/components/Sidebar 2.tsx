import React from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Clock,
  Tag,
  Book,
  BarChart3,
  Briefcase,
  Crown,
  Settings,
  MapPin,
  Bell,
  LogOut
} from 'lucide-react';

// Mock user - will be replaced by AuthContext
const currentUser = {
  name: 'John Doe',
  unique_id: '12345',
  get_subscription_status: () => 'Active'
};

const Sidebar: React.FC = () => {
  // Assuming 'dashboard' is the active endpoint for now
  const currentEndpoint = 'dashboard';

  return (
    <aside className="sidebar w-64 bg-white border-r border-gray-100 flex flex-col px-4 py-8 h-full" id="sidebar">
      {/* App Logo Section */}
      <div className="flex items-center gap-3 mb-10 px-4">
        <div className="w-10 h-10 flex items-center justify-center">
            {/* Logo placeholder - need to add image import later */}
            <div className="w-10 h-10 bg-accent rounded-lg"></div> 
        </div>
        <span className="text-xl font-black text-gray-900 tracking-tight">Lerzo</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-2">
        <p className="px-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Main Menu</p>

        <SidebarLink icon={LayoutDashboard} label="Dashboard" active={currentEndpoint === 'dashboard'} />
        <SidebarLink icon={Users} label="Students" active={currentEndpoint === 'students'} />
        <SidebarLink icon={ClipboardList} label="Enquiries" active={currentEndpoint === 'enquiries'} />
        <SidebarLink icon={Clock} label="Batches" active={currentEndpoint === 'batches'} />
        <SidebarLink icon={Tag} label="Schemes" active={currentEndpoint === 'schemes'} />
        <SidebarLink icon={Book} label="Courses" active={currentEndpoint === 'courses'} />

        <div className="pt-4 mt-4 border-t border-gray-50">
            <p className="px-4 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Analytics & Tools</p>
            <SidebarLink icon={BarChart3} label="Reports" active={currentEndpoint === 'reports'} />
            <SidebarLink icon={Briefcase} label="Staff" active={currentEndpoint === 'staff'} />
            <SidebarLink icon={Crown} label="Subscription" active={currentEndpoint === 'subscription'} />
            <SidebarLink icon={Settings} label="Settings" active={currentEndpoint === 'settings'} />
            <SidebarLink icon={MapPin} label="Attendance Settings" active={currentEndpoint === 'attendance'} />
            <SidebarLink icon={Bell} label="Notifications" active={currentEndpoint === 'notifications'} />
        </div>
      </nav>

      {/* User Profile Bottom */}
      <div className="mt-auto border-t border-gray-50 pt-6">
        <div className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 rounded-2xl transition-colors cursor-pointer group">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 font-bold border border-gray-200 group-hover:bg-accent-light group-hover:text-accent group-hover:border-accent/20 transition-all">
            {currentUser.name[0].toUpperCase()}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-bold text-gray-900 truncate">{currentUser.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
              <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest">
                {currentUser.get_subscription_status()}
              </p>
            </div>
          </div>
          <button className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Logout">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};

interface SidebarLinkProps {
  icon: React.ElementType;
  label: string;
  active: boolean;
}

const SidebarLink: React.FC<SidebarLinkProps> = ({ icon: Icon, label, active }) => (
  <a
    href="#"
    className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group ${
      active ? 'bg-accent-light text-accent' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
    }`}
  >
    <Icon className={`w-5 h-5 ${active ? 'text-accent' : 'text-gray-400 group-hover:text-gray-600'}`} />
    <span className="font-bold text-sm">{label}</span>
  </a>
);

export default Sidebar;
