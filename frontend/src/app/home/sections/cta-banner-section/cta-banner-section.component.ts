import { Component } from '@angular/core';

@Component({
    selector: 'app-cta-banner-section',
    standalone: true,
    template: `
    <section class="cta-banner" aria-label="Call to Action">
        <div class="bloqr-container cta-inner">
            <h2 class="cta-title">Internet Hygiene. Automated.</h2>
            <p class="cta-sub">Join the waitlist. Be first when we launch.</p>
            <a href="#pricing" class="bloqr-btn-primary bloqr-btn-xl">Join the waitlist</a>
        </div>
    </section>
    `,
    styles: [`
    :host { display: block; }
    .cta-banner {
        background:
            radial-gradient(ellipse 60% 80% at 50% 50%, rgba(255,85,0,0.10), transparent),
            #070B14;
        border-top: 1px solid #1E2D40;
        border-bottom: 1px solid #1E2D40;
        padding: 96px 0;
    }
    .cta-inner {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 24px;
    }
    .cta-title {
        font-family: 'Space Grotesk', sans-serif;
        font-size: clamp(2rem, 5vw, 3.5rem);
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1.05;
        color: #F1F5F9;
        margin: 0;
    }
    .cta-sub { font-size: 1.1rem; color: #94A3B8; margin: 0; }
    .bloqr-btn-xl { padding: 14px 32px; font-size: 16px; }
    `],
})
export class CtaBannerSectionComponent {}
