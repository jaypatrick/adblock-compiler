import { Component } from '@angular/core';

interface Feature {
    readonly icon: string;
    readonly title: string;
    readonly tagline: string;
    readonly body: string;
}

@Component({
    selector: 'app-features-section',
    standalone: true,
    template: `
    <section class="bloqr-section" id="features" aria-label="Features">
        <div class="bloqr-container">
            <span class="bloqr-section-label">FEATURES</span>
            <h2 class="bloqr-section-title">Everything you need. Nothing you don't.</h2>
            <div class="features-grid" role="list">
                @for (feature of features; track feature.title) {
                    <div class="feature-card bloqr-card" role="listitem">
                        <div class="feature-icon-wrap" aria-hidden="true">
                            <span class="material-symbols-outlined">{{ feature.icon }}</span>
                        </div>
                        <div class="feature-content">
                            <h3 class="feature-title">{{ feature.title }}</h3>
                            <p class="feature-tagline">{{ feature.tagline }}</p>
                            <p class="feature-body">{{ feature.body }}</p>
                        </div>
                    </div>
                }
            </div>
        </div>
    </section>
    `,
    styles: [`
    :host { display: block; }
    .features-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 24px;
        margin-top: 48px;
    }
    .feature-card { display: flex; flex-direction: column; gap: 16px; }
    .feature-icon-wrap {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255,85,0,0.08);
        border-radius: 8px;
        color: #FF5500;
        flex-shrink: 0;
    }
    .feature-icon-wrap .material-symbols-outlined { font-size: 22px; }
    .feature-title {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 1.1rem;
        font-weight: 700;
        color: #F1F5F9;
        margin: 0 0 4px;
    }
    .feature-tagline {
        font-size: 0.8rem;
        font-weight: 600;
        color: #FF5500;
        margin: 0 0 8px;
        letter-spacing: 0.02em;
    }
    .feature-body { font-size: 0.9rem; color: #94A3B8; line-height: 1.6; margin: 0; }
    @media (max-width: 640px) {
        .features-grid { grid-template-columns: 1fr; }
    }
    `],
})
export class FeaturesSectionComponent {
    readonly features: Feature[] = [
        {
            icon: 'auto_awesome',
            title: 'AI-maintained lists',
            tagline: 'No setup. No maintenance.',
            body: 'Bloqr builds your filter list automatically and keeps it current.',
        },
        {
            icon: 'dashboard',
            title: 'One pane of glass',
            tagline: 'Manage every instance from one place.',
            body: 'Manage every AdGuard, NextDNS, or Pi-hole instance from a single dashboard.',
        },
        {
            icon: 'device_hub',
            title: 'Coverage that follows you',
            tagline: 'Every device. Every network.',
            body: 'The same rules protect your home network, your phone, and any network you connect to.',
        },
        {
            icon: 'extension',
            title: 'Bring your own vendor',
            tagline: 'Keep what you have. Add intelligence.',
            body: 'Keep AdGuard. Keep NextDNS. Keep Pi-hole. Add intelligence.',
        },
    ];
}
