import { Component, signal, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-nav-bar',
    standalone: true,
    imports: [RouterLink],
    template: `
    <nav class="bloqr-nav" [class.scrolled]="scrolled()" role="navigation" aria-label="Main navigation">
        <div class="bloqr-nav-inner">
            <a class="bloqr-nav-brand" routerLink="/" aria-label="Bloqr home">
                <img src="https://raw.githubusercontent.com/jaypatrick/bloqr-landing/main/brand/logo.svg"
                     alt="Bloqr logo" width="32" height="32"
                     (error)="$any($event.target).style.display='none'" />
                <span class="bloqr-wordmark">Bloqr</span>
            </a>
            <div class="bloqr-nav-links" [class.open]="menuOpen()">
                <a href="#features" (click)="closeMenu()">Features</a>
                <a href="#how-it-works" (click)="closeMenu()">How It Works</a>
                <a href="#audiences" (click)="closeMenu()">Audiences</a>
                <a href="#pricing" (click)="closeMenu()">Pricing</a>
            </div>
            <div class="bloqr-nav-cta">
                <a href="#pricing" class="bloqr-btn-primary bloqr-btn-sm" (click)="closeMenu()">
                    Get early access
                </a>
                <button class="hamburger" (click)="toggleMenu()"
                        [attr.aria-expanded]="menuOpen()"
                        aria-label="Toggle navigation menu"
                        aria-controls="mobile-nav">
                    <span></span><span></span><span></span>
                </button>
            </div>
        </div>
        <!-- Mobile menu -->
        <div id="mobile-nav" class="mobile-nav" [class.open]="menuOpen()" role="region" aria-label="Mobile navigation">
            <a href="#features" (click)="closeMenu()">Features</a>
            <a href="#how-it-works" (click)="closeMenu()">How It Works</a>
            <a href="#audiences" (click)="closeMenu()">Audiences</a>
            <a href="#pricing" (click)="closeMenu()">Pricing</a>
            <a href="#pricing" class="bloqr-btn-primary bloqr-btn-sm" (click)="closeMenu()">
                Get early access
            </a>
        </div>
    </nav>
    `,
    styles: [`
    :host { display: block; }
    .bloqr-nav {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 50;
        height: 64px;
        background: rgba(7,11,20,0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-bottom: 1px solid #1E2D40;
        transition: background 0.2s;
    }
    .bloqr-nav.scrolled { background: rgba(7,11,20,0.97); }
    .bloqr-nav-inner {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 24px;
        height: 64px;
        display: flex;
        align-items: center;
        gap: 32px;
    }
    .bloqr-nav-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
        flex-shrink: 0;
    }
    .bloqr-wordmark {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 20px;
        font-weight: 700;
        color: #F1F5F9;
        letter-spacing: -0.02em;
    }
    .bloqr-nav-links {
        display: flex;
        gap: 4px;
        flex: 1;
    }
    .bloqr-nav-links a {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: #94A3B8;
        text-decoration: none;
        padding: 6px 10px;
        border-radius: 6px;
        transition: color 0.2s, background 0.2s;
    }
    .bloqr-nav-links a:hover { color: #F1F5F9; background: rgba(255,255,255,0.04); }
    .bloqr-nav-cta {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-left: auto;
    }
    .bloqr-btn-sm { padding: 8px 16px; font-size: 13px; border-radius: 6px; }
    .hamburger {
        display: none;
        flex-direction: column;
        gap: 4px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px;
    }
    .hamburger span {
        display: block;
        width: 20px;
        height: 2px;
        background: #94A3B8;
        border-radius: 1px;
        transition: background 0.2s;
    }
    .hamburger:hover span { background: #F1F5F9; }
    .mobile-nav {
        display: none;
        flex-direction: column;
        gap: 4px;
        padding: 16px 24px;
        border-top: 1px solid #1E2D40;
        background: rgba(7,11,20,0.97);
    }
    .mobile-nav a {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 15px;
        font-weight: 500;
        color: #94A3B8;
        text-decoration: none;
        padding: 10px 0;
        border-bottom: 1px solid #1E2D40;
        display: block;
    }
    .mobile-nav a:last-child { border-bottom: none; margin-top: 8px; }
    .mobile-nav a:hover { color: #F1F5F9; }
    @media (max-width: 768px) {
        .bloqr-nav { height: auto; min-height: 64px; }
        .bloqr-nav-inner { height: 64px; }
        .bloqr-nav-links { display: none; }
        .hamburger { display: flex; }
        .mobile-nav.open { display: flex; }
        .bloqr-nav-cta .bloqr-btn-primary { display: none; }
    }
    `],
})
export class NavBarComponent {
    readonly scrolled = signal(false);
    readonly menuOpen = signal(false);

    @HostListener('window:scroll')
    onScroll(): void {
        this.scrolled.set(window.scrollY > 10);
    }

    toggleMenu(): void {
        this.menuOpen.update(v => !v);
    }

    closeMenu(): void {
        this.menuOpen.set(false);
    }
}
