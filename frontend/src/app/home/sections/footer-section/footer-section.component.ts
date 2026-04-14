import { Component } from '@angular/core';

@Component({
    selector: 'app-footer-section',
    standalone: true,
    template: `
    <footer class="bloqr-footer" role="contentinfo">
        <div class="bloqr-container">
            <div class="footer-grid">
                <div class="footer-brand">
                    <div class="footer-brand-row">
                        <img src="assets/logo.svg"
                             alt="Bloqr logo" width="28" height="28" />
                        <span class="footer-wordmark">Bloqr</span>
                    </div>
                    <p class="footer-tagline">Internet Hygiene. Automated.</p>
                    <p class="footer-copy">&copy; 2026 Bloqr</p>
                </div>
                <div class="footer-col">
                    <h4 class="footer-heading">Product</h4>
                    <ul>
                        <li><a href="#features">Features</a></li>
                        <li><a href="#how-it-works">How It Works</a></li>
                        <li><a href="#pricing">Pricing</a></li>
                        <li><a href="https://github.com/jaypatrick/adblock-compiler/releases" target="_blank" rel="noopener noreferrer">Changelog</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h4 class="footer-heading">Resources</h4>
                    <ul>
                        <li><a href="https://docs.bloqr.jaysonknight.com/" target="_blank" rel="noopener noreferrer">Docs</a></li>
                        <li><a href="https://github.com/jaypatrick/adblock-compiler" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                        <li><a href="https://docs.bloqr.jaysonknight.com/api" target="_blank" rel="noopener noreferrer">API Reference</a></li>
                        <li><a href="https://github.com/jaypatrick/adblock-compiler/discussions" target="_blank" rel="noopener noreferrer">Blog</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h4 class="footer-heading">Company</h4>
                    <ul>
                        <li><a href="https://github.com/jaypatrick/adblock-compiler" target="_blank" rel="noopener noreferrer">About</a></li>
                        <li><a href="https://github.com/jaypatrick/adblock-compiler/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">Privacy</a></li>
                        <li><a href="https://github.com/jaypatrick/adblock-compiler/blob/main/TERMS.md" target="_blank" rel="noopener noreferrer">Terms</a></li>
                        <li><a href="https://github.com/jaypatrick/adblock-compiler/security" target="_blank" rel="noopener noreferrer">Security</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-divider" aria-hidden="true"></div>
            <p class="footer-legal">Built with ♥ for privacy-conscious users worldwide.</p>
        </div>
    </footer>
    `,
    styles: [`
    :host { display: block; }
    .bloqr-footer {
        background: #070B14;
        border-top: 1px solid #1E2D40;
        padding: 48px 0 32px;
    }
    .footer-grid {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr 1fr;
        gap: 40px;
    }
    .footer-brand-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
    }
    .footer-wordmark {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 18px;
        font-weight: 700;
        color: #F1F5F9;
    }
    .footer-tagline { font-size: 13px; color: #94A3B8; margin: 0 0 8px; }
    .footer-copy { font-size: 12px; color: #475569; margin: 0; }
    .footer-heading {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: #F1F5F9;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin: 0 0 16px;
    }
    .footer-col ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .footer-col a {
        font-size: 14px;
        color: #94A3B8;
        text-decoration: none;
        transition: color 0.2s;
    }
    .footer-col a:hover { color: #F1F5F9; }
    .footer-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, #FF5500 50%, transparent);
        opacity: 0.3;
        margin: 32px 0 24px;
    }
    .footer-legal { font-size: 12px; color: #475569; text-align: center; margin: 0; }
    @media (max-width: 768px) {
        .footer-grid { grid-template-columns: 1fr 1fr; gap: 32px; }
        .footer-brand { grid-column: 1 / -1; }
    }
    @media (max-width: 480px) {
        .footer-grid { grid-template-columns: 1fr; }
    }
    `],
})
export class FooterSectionComponent {}
