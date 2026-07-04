import React from 'react';
import Sidebar from '../components/Sidebar';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="app-container">
        {/* Titlebar (Electron Only) - Always show in Desktop App */}
        <header className="titlebar">
            <div className="titlebar-left">
                {/* Logo placeholder - need to add image import later */}
                <div className="w-8 h-8 bg-accent rounded-lg"></div>
                <span className="app-name">Lerzo</span>
            </div>
            {/* Window controls will be handled by Electron or CSS drag region */}
        </header>

        <div className="main-layout bg-white h-full overflow-hidden">
            <Sidebar />
            
            <main className="flex-1 overflow-y-auto bg-gray-50/50 flex flex-col">
                {/* Header Bar with Notifications */}
                <div className="bg-white border-b border-gray-100 px-8 py-4 flex items-center justify-end gap-4">
                    {/* Notification Bell Component */}
                </div>
                
                {/* Content Area */}
                <div className="flex-1 overflow-y-auto">
                    {children}
                </div>
            </main>
        </div>
    </div>
  );
};

export default MainLayout;
