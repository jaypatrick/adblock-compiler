import { Component } from '@angular/core';

@Component({
    selector: 'app-hero-section',
    standalone: true,
    template: `
    <section class="hero" aria-label="Hero">
        <div class="hero-content">
            <div class="hero-badge" aria-label="Status">
                <span>AI-powered adblock management</span>
            </div>
            <h1 class="hero-headline">
                The internet you always thought you had.
            </h1>
            <p class="hero-subheadline">
                Block ads. Block trackers. Block malware. One account. Zero setup.
            </p>
            <div class="hero-cta-group">
                <a href="#pricing" class="bloqr-btn-primary bloqr-btn-lg">
                    Join the waitlist
                </a>
                <a href="#how-it-works" class="bloqr-btn-ghost bloqr-btn-lg">
                    See how it works
                </a>
            </div>
            <p class="hero-social-proof">Trusted by privacy-conscious users worldwide.</p>
        </div>
    </section>
    `,
    styles: [`
    :host { display: block; }
    .hero {
        min-height: 100dvh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 96px 24px 64px;
        background:
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,85,0,0.12), transparent),
            radial-gradient(ellipse 60% 40% at 80% 60%, rgba(0,212,255,0.06), transparent),
            #070B14;
        text-align: center;
    }
    .hero-content {
        max-width: 800px;
        width: 100%;
    }
    .hero-badge {
        display: inline-block;
        background: rgba(0,212,255,0.10);
        color: #00D4FF;
        border: 1px solid rgba(0,212,255,0.20);
        border-radius: 9999px;
        padding: 4px 14px;
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 24px;
        letter-spacing: 0.01em;
    }
    .hero-headline {
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-size: clamp(2.5rem, 6vw, 4.5rem);
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1.05;
        color: #F1F5F9;
        margin: 0 0 24px;
    }
    .hero-subheadline {
        font-family: 'Space Grotesk', sans-serif;
        font-size: clamp(1rem, 2vw, 1.25rem);
        font-weight: 400;
        color: #94A3B8;
        line-height: 1.6;
        margin: 0 0 40px;
    }
    .hero-cta-group {
        display: flex;
        gap: 16px;
        justify-content: center;
        flex-wrap: wrap;
        margin-bottom: 32px;
    }
    .bloqr-btn-lg { padding: 14px 32px; font-size: 16px; }
    .hero-social-proof {
        font-size: 13px;
        color: #64748B;
        margin: 0;
    }
    `],
})
export class HeroSectionComponent {}
