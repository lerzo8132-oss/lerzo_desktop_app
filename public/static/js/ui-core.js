// State Management
const state = {
    currentPage: 'dashboard',
};

// DOM Helpers
const getEl = (id) => document.getElementById(id);

// --- Navigation ---

async function loadPage(pageName) {
    const mainContent = getEl('main-content');
    const navItems = document.querySelectorAll('.nav-item');
    if (!mainContent) return;

    try {
        // Show skeleton loader
        mainContent.innerHTML = `
            <div class="p-32">
                <div class="skeleton" style="height: 40px; width: 200px; border-radius: 8px; margin-bottom: 24px;"></div>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-bottom: 32px;">
                    <div class="card skeleton" style="height: 120px;"></div>
                    <div class="card skeleton" style="height: 120px;"></div>
                    <div class="card skeleton" style="height: 120px;"></div>
                    <div class="card skeleton" style="height: 120px;"></div>
                </div>
                <div class="card skeleton" style="height: 400px;"></div>
            </div>
        `;

        // Fetch page content
        const response = await fetch(`ui/${pageName}.html`);
        if (!response.ok) throw new Error('Page not found');
        
        const html = await response.text();
        
        // Update content
        setTimeout(() => {
            mainContent.innerHTML = html;
            if (window.lucide) lucide.createIcons();
            state.currentPage = pageName;
            
            // Update active state in sidebar
            navItems.forEach(item => {
                if (item.getAttribute('data-page') === pageName) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }, 300);

    } catch (error) {
        console.error('Error loading page:', error);
        showToast('Error', 'Failed to load page. Please try again.', 'error');
    }
}

// --- Toast System ---

function showToast(title, message, type = 'info') {
    const toastContainer = getEl('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast`;
    
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    if (type === 'warning') icon = 'alert-triangle';

    toast.innerHTML = `
        <i data-lucide="${icon}" style="color: var(--${type === 'info' ? 'accent' : type});"></i>
        <div>
            <div style="font-weight: 600; font-size: 13px;">${title}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${message}</div>
        </div>
    `;

    toastContainer.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = 'all 300ms ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Modal System ---

function openModal(title, contentHtml, onConfirm) {
    const modalOverlay = getEl('modal-overlay');
    const modalConfirmBtn = getEl('modal-confirm');
    if (!modalOverlay || !modalConfirmBtn) return;

    getEl('modal-title').innerText = title;
    getEl('modal-content').innerHTML = contentHtml;
    modalOverlay.classList.add('active');
    
    const confirmHandler = () => {
        if (onConfirm) onConfirm();
        closeModal();
        modalConfirmBtn.removeEventListener('click', confirmHandler);
    };
    
    modalConfirmBtn.addEventListener('click', confirmHandler);
}

function closeModal() {
    const modalOverlay = getEl('modal-overlay');
    if (modalOverlay) modalOverlay.classList.remove('active');
}

// --- Initialize ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Modal listeners
    getEl('close-modal')?.addEventListener('click', closeModal);
    getEl('modal-cancel')?.addEventListener('click', closeModal);
    getEl('modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === getEl('modal-overlay')) closeModal();
    });

    // 2. Sidebar Click Handlers
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const page = item.getAttribute('data-page');
            if (page && page !== state.currentPage) {
                loadPage(page);
            }
        });
    });

    // 3. Initial Page Load
    if (getEl('main-content')) {
        // Only auto-load dashboard if on the home path
        if (window.location.pathname === '/' || window.location.pathname === '/dashboard') {
            loadPage('dashboard');
        }
    }
});

// Global Event Listeners for UI Demos
document.addEventListener('click', (e) => {
    if (e.target.closest('.btn-primary') && !e.target.closest('.modal')) {
        showToast('Success', 'Action completed successfully!', 'success');
    }
});
