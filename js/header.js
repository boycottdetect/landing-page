// Header Navigation JavaScript
document.addEventListener('DOMContentLoaded', function() {
    
    // Get current page path
    const currentPath = window.location.pathname;
    
    // Set active navigation link based on current page
    function setActiveNavLink() {
        const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
        
        navLinks.forEach(link => {
            link.classList.remove('active');
            
            // Check if current page matches the link
            if (link.getAttribute('href') === currentPath.split('/').pop() || 
                (currentPath === '/' && link.getAttribute('href') === 'index.html') ||
                (currentPath.includes(link.getAttribute('href').replace('.html', '')))) {
                link.classList.add('active');
            }
        });
    }
    
    // Add scroll effect to navbar
    function handleNavbarScroll() {
        const navbar = document.querySelector('.navbar');
        
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }
    
    // Smooth scroll for navigation links
    function setupSmoothScroll() {
        const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
        
        navLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                // Only apply smooth scroll for same-page links
                const href = this.getAttribute('href');
                if (href.startsWith('#')) {
                    e.preventDefault();
                    const target = document.querySelector(href);
                    if (target) {
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                }
            });
        });
    }
    
    // Close mobile menu when clicking on a link
    function setupMobileMenuClose() {
        const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
        const navbarCollapse = document.querySelector('.navbar-collapse');
        const bsCollapse = new bootstrap.Collapse(navbarCollapse, {toggle: false});
        
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                // Close mobile menu if it's open
                if (window.innerWidth < 992 && navbarCollapse.classList.contains('show')) {
                    bsCollapse.hide();
                }
            });
        });
    }
    
    // Add loading animation to logo
    function setupLogoAnimation() {
        const logo = document.querySelector('.navbar-brand .logo');
        
        if (logo) {
            // Add loading animation
            logo.style.opacity = '0';
            logo.style.transform = 'scale(0.8)';
            
            setTimeout(() => {
                logo.style.transition = 'all 0.5s ease';
                logo.style.opacity = '1';
                logo.style.transform = 'scale(1)';
            }, 100);
        }
    }
    
    // Initialize all functions
    function init() {
        setActiveNavLink();
        setupSmoothScroll();
        setupMobileMenuClose();
        setupLogoAnimation();
        
        // Add scroll event listener
        window.addEventListener('scroll', handleNavbarScroll);
        
        // Add resize event listener for mobile menu
        window.addEventListener('resize', function() {
            const navbarCollapse = document.querySelector('.navbar-collapse');
            if (window.innerWidth >= 992 && navbarCollapse.classList.contains('show')) {
                const bsCollapse = new bootstrap.Collapse(navbarCollapse, {toggle: false});
                bsCollapse.hide();
            }
        });
    }
    
    // Run initialization
    init();
    
    // Add keyboard navigation support
    document.addEventListener('keydown', function(e) {
        const navbarCollapse = document.querySelector('.navbar-collapse');
        
        // Close mobile menu with Escape key
        if (e.key === 'Escape' && navbarCollapse.classList.contains('show')) {
            const bsCollapse = new bootstrap.Collapse(navbarCollapse, {toggle: false});
            bsCollapse.hide();
        }
    });
    
    // Add touch gesture support for mobile
    let touchStartY = 0;
    let touchEndY = 0;
    
    document.addEventListener('touchstart', function(e) {
        touchStartY = e.changedTouches[0].screenY;
    });
    
    document.addEventListener('touchend', function(e) {
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    });
    
    function handleSwipe() {
        const navbarCollapse = document.querySelector('.navbar-collapse');
        const swipeThreshold = 50;
        
        if (touchEndY < touchStartY - swipeThreshold) {
            // Swipe up - close menu
            if (navbarCollapse.classList.contains('show')) {
                const bsCollapse = new bootstrap.Collapse(navbarCollapse, {toggle: false});
                bsCollapse.hide();
            }
        }
    }
}); 