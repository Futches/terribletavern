/**
 * TerribleTavern - Main JavaScript
 * Handles smooth scrolling navigation and header scroll effects
 */

document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const header = document.getElementById('header');
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');
    const navLinkItems = document.querySelectorAll('.nav-links a');

    // Header scroll effect
    function handleScroll() {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }

    // Smooth scrolling for navigation links
    function smoothScroll(e) {
        e.preventDefault();

        const targetId = this.getAttribute('href');
        const targetSection = document.querySelector(targetId);

        if (targetSection) {
            const headerHeight = header.offsetHeight;
            const targetPosition = targetSection.offsetTop - headerHeight;

            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });

            // Close mobile menu if open
            navLinks.classList.remove('active');
        }
    }

    // Toggle mobile navigation
    function toggleMobileNav() {
        navLinks.classList.toggle('active');
    }

    // Close mobile menu when clicking outside
    function handleClickOutside(e) {
        if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
            navLinks.classList.remove('active');
        }
    }

    // Event Listeners
    window.addEventListener('scroll', handleScroll);

    navLinkItems.forEach(link => {
        link.addEventListener('click', smoothScroll);
    });

    if (navToggle) {
        navToggle.addEventListener('click', toggleMobileNav);
    }

    document.addEventListener('click', handleClickOutside);

    // Handle form submission (prevent default for demo)
    const reservationForm = document.getElementById('reservation-form');
    if (reservationForm) {
        reservationForm.addEventListener('submit', function(e) {
            e.preventDefault();

            // Get form data
            const formData = new FormData(this);
            const name = formData.get('name');

            // Show confirmation (in a real app, this would submit to a server)
            alert(`Thank you, ${name}! Your reservation request has been received. We'll contact you shortly to confirm.`);

            // Reset form
            this.reset();
        });
    }

    // Initialize scroll state on page load
    handleScroll();

    // Add active class to nav link based on scroll position
    function highlightNavOnScroll() {
        const sections = document.querySelectorAll('section[id]');
        const scrollPosition = window.scrollY + header.offsetHeight + 100;

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute('id');

            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                navLinkItems.forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${sectionId}`) {
                        link.classList.add('active');
                    }
                });
            }
        });
    }

    window.addEventListener('scroll', highlightNavOnScroll);
});
