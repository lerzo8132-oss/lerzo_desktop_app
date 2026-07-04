/**
 * Lerzo SaaS - Core JavaScript
 * Premium SaaS UI + GSAP Animations
 */

// ═══════════════════════════════════════════════════════════════
// Toast Notifications
// ═══════════════════════════════════════════════════════════════

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // GSAP Toast Animation
    gsap.fromTo(toast, 
        { x: 100, opacity: 0 }, 
        { x: 0, opacity: 1, duration: 0.4, ease: "power2.out" }
    );

    // Remove toast after 4 seconds
    setTimeout(() => {
        gsap.to(toast, {
            x: 100,
            opacity: 0,
            duration: 0.3,
            onComplete: () => toast.remove()
        });
    }, 4000);
}

// ═══════════════════════════════════════════════════════════════
// GSAP Animations
// ═══════════════════════════════════════════════════════════════

function initAnimations() {
    // 1. Main Container Reveal
    if (document.querySelector('.main-container')) {
        gsap.from(".main-container", {
            opacity: 0,
            y: 20,
            duration: 0.6,
            ease: "power2.out"
        });
    }

    // 2. GSAP Reveal Elements (Generic)
    const revealEls = document.querySelectorAll('.gsap-reveal');
    if (revealEls.length > 0) {
        // Set initial state
        gsap.set(revealEls, { opacity: 0, y: 30 });
        
        // Animate to visible
        gsap.to(revealEls, {
            opacity: 1,
            y: 0,
            duration: 0.5,
            stagger: 0.1,
            ease: "power2.out",
            delay: 0.1,
            clearProps: "all"
        });
    }

    // 3. Cards Stagger (if not already revealed)
    const cards = document.querySelectorAll('.card:not(.gsap-reveal)');
    if (cards.length > 0) {
        gsap.from(cards, {
            opacity: 0,
            y: 30,
            duration: 0.5,
            stagger: 0.1,
            ease: "power2.out",
            delay: 0.2
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Lerzo App Initialized");
    
    // Initialize Animations
    if (typeof gsap !== 'undefined') {
        console.log("✨ GSAP detected, running animations...");
        initAnimations();
    } else {
        console.warn("⚠️ GSAP not found!");
        // Fallback: make everything visible
        document.querySelectorAll('.gsap-reveal, .main-container').forEach(el => {
            el.style.opacity = '1';
            el.style.visibility = 'visible';
        });
    }
    
    // Check if running in Electron
    window.isElectron = document.body.classList.contains('electron-mode');
    console.log("💻 Electron mode:", window.isElectron);
    
    // Navigation active state handled by Jinja2, but backup here
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
        }
    });

    // Handle offline status
    window.addEventListener('online', () => {
        document.getElementById('offline-banner')?.classList.remove('show');
        showToast("You are back online!", "success");
    });
    
    window.addEventListener('offline', () => {
        document.getElementById('offline-banner')?.classList.add('show');
    });
});