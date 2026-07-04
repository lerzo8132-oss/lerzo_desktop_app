import React from 'react';
import {
  BarChart3,
  Bell,
  Book,
  Briefcase,
  ClipboardList,
  Clock,
  Crown,
  LayoutDashboard,
  LogOut,
  MapPin,
  Settings,
  Tag,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { APP_LOGO_SRC } from '../config/assets';

const navGroups = [
  {
    label: 'Main Menu',
    items: [
      ['Dashboard', '/dashboard', LayoutDashboard],
      ['Students', '/students-list', Users],
      ['Enquiries', '/enquiries-list', ClipboardList],
      ['Batches', '/batches-list', Clock],
      ['Schemes', '/schemes-list', Tag],
      ['Courses', '/courses-list', Book],
    ],
  },
  {
    label: 'Analytics & Tools',
    items: [
      ['Reports', '/reports', BarChart3],
      ['Staff', '/staff-list', Briefcase],
      ['Subscription', '/subscription-plans', Crown],
      ['Settings', '/settings-profile', Settings],
      ['Attendance Settings', '/settings-attendance', MapPin],
      ['Notifications', '/notifications', Bell],
    ],
  },
] as const;

const Sidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const displayName = user?.name || user?.email || 'Account';
  const statusLabel = user?.subscription?.status || user?.role || 'Active';
  const avatar = user?.profile_pic || user?.avatar;

  return (
    <aside className="sidebar w-64 bg-white border-r border-gray-100 flex flex-col px-4 py-8 h-full" id="sidebar">
      <div className="flex items-center gap-3 mb-10 px-4">
        <img src={APP_LOGO_SRC} alt="Lerzo Logo" className="app-logo" />
        <span className="text-xl font-black text-gray-900 tracking-tight">Lerzo</span>
      </div>

      <nav className="flex-1 space-y-2">
        {navGroups.map((group) => (
          <div className="nav-section" key={group.label}>
            <p className="nav-label">{group.label}</p>
            {group.items.map(([label, to, Icon]) => (
              <a key={to} href={to} className="nav-link-item">
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </a>
            ))}
          </div>
        ))}
      </nav>

      {user && (
        <div className="sidebar-footer">
          <div className="user-profile-sidebar">
            <div className="avatar">
              {avatar ? <img src={avatar} alt={displayName} /> : displayName.charAt(0).toUpperCase()}
            </div>
            <div className="user-info">
              <span className="user-name">{displayName}</span>
              <span className="user-role">{statusLabel}</span>
            </div>
            <button className="btn-icon" title="Logout" onClick={() => void logout()}>
              <LogOut />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
