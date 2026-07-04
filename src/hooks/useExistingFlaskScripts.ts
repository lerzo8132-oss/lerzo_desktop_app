import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { gsap } from 'gsap';

function runFlaskAnimationFallback() {
  document.querySelectorAll<HTMLElement>('.gsap-reveal, .main-container').forEach((element) => {
    element.style.opacity = '1';
    element.style.visibility = 'visible';
  });
}

function runExistingPageEnhancements() {
  runFlaskAnimationFallback();

  if (window.gsap) {
    const cards = document.querySelectorAll('.template-page .card:not(.gsap-reveal)');
    const revealEls = document.querySelectorAll('.template-page .gsap-reveal');

    if (document.querySelector('.template-page .main-container')) {
      window.gsap.from('.template-page .main-container', {
        opacity: 0,
        y: 20,
        duration: 0.6,
        ease: 'power2.out',
        onComplete: runFlaskAnimationFallback,
      });
    }

    if (revealEls.length > 0) {
      window.gsap.set(revealEls, { opacity: 0, y: 30 });
      window.gsap.to(revealEls, {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.1,
        ease: 'power2.out',
        delay: 0.1,
        clearProps: 'all',
        onComplete: runFlaskAnimationFallback,
      });
    }

    if (cards.length > 0) {
      window.gsap.from(cards, {
        opacity: 0,
        y: 30,
        duration: 0.5,
        stagger: 0.1,
        ease: 'power2.out',
        delay: 0.2,
        onComplete: runFlaskAnimationFallback,
      });
    }
  }
}

export function useExistingFlaskScripts() {
  const location = useLocation();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    document.body.classList.add('electron-mode');
    window.gsap = gsap;
    runExistingPageEnhancements();
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(runExistingPageEnhancements);
    const safety = window.setTimeout(runFlaskAnimationFallback, 900);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(safety);
      runFlaskAnimationFallback();
    };
  }, [location.pathname]);
}
