import { Component } from '@angular/core';

interface PricingTier {
    readonly id: string;
    readonly name: string;
    readonly price: string;
    readonly period: string;
    readonly features: string[];
    readonly cta: string;
    readonly ctaHref: string;
    readonly highlighted: boolean;
    readonly badge?: string;
}

@Component({
    selector: 'app-pricing-section',
    standalone: true,
    template: `
    <section class="bloqr-section" id="pricing" aria-label="Pricing">
        <div class="bloqr-container">
            <span class="bloqr-section-label">PRICING</span>
            <h2 class="bloqr-section-title">Start free. Upgrade when you're ready.</h2>
            <p class="bloqr-section-desc">No credit card required. No contract. Cancel anytime.</p>
            <div class="pricing-grid" role="list">
                @for (tier of tiers; track tier.id) {
                    <div class="pricing-card bloqr-card"
                         [class.highlighted]="tier.highlighted"
                         role="listitem">
                        @if (tier.badge) {
                            <div class="pricing-badge">{{ tier.badge }}</div>
                        }
                        <div class="pricing-header">
                            <h3 class="tier-name">{{ tier.name }}</h3>
                            <div class="tier-price">
                                <span class="price-amount">{{ tier.price }}</span>
                                <span class="price-period">{{ tier.period }}</span>
                            </div>
                        </div>
                        <ul class="tier-features" aria-label="Features included">
                            @for (feature of tier.features; track feature) {
                                <li>
                                    <span class="feature-check" aria-hidden="true">✓</span>
                                    {{ feature }}
                                </li>
                            }
                        </ul>
                        <a [href]="tier.ctaHref" class="tier-cta"
                           [class.bloqr-btn-primary]="tier.highlighted"
                           [class.bloqr-btn-ghost]="!tier.highlighted">
                            {{ tier.cta }}
                        </a>
                    </div>
                }
            </div>
        </div>
    </section>
    `,
    styles: [`
    :host { display: block; }
    .pricing-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 24px;
        margin-top: 48px;
        align-items: start;
    }
    .pricing-card {
        display: flex;
        flex-direction: column;
        gap: 24px;
        position: relative;
    }
    .pricing-card.highlighted {
        background: linear-gradient(135deg, #0E1829, #162035);
        border: 1px solid #FF5500 !important;
        box-shadow: 0 0 24px rgba(255,85,0,0.15), 0 0 48px rgba(255,85,0,0.08);
    }
    .pricing-badge {
        position: absolute;
        top: -12px;
        left: 50%;
        transform: translateX(-50%);
        background: #FF5500;
        color: white;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 12px;
        border-radius: 9999px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        white-space: nowrap;
    }
    .pricing-header { display: flex; flex-direction: column; gap: 8px; }
    .tier-name {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 1rem;
        font-weight: 700;
        color: #F1F5F9;
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .tier-price { display: flex; align-items: baseline; gap: 4px; }
    .price-amount {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 2.5rem;
        font-weight: 800;
        color: #F1F5F9;
        line-height: 1;
    }
    .price-period { font-size: 0.875rem; color: #94A3B8; }
    .tier-features {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
    }
    .tier-features li {
        display: flex;
        gap: 8px;
        font-size: 0.875rem;
        color: #94A3B8;
        align-items: flex-start;
    }
    .feature-check { color: #22C55E; font-weight: 700; flex-shrink: 0; }
    .tier-cta {
        display: block;
        text-align: center;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: 'Space Grotesk', sans-serif;
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
        transition: all 0.2s;
    }
    @media (max-width: 768px) {
        .pricing-grid { grid-template-columns: 1fr; }
        .pricing-card.highlighted { margin-top: 12px; }
    }
    `],
})
export class PricingSectionComponent {
    readonly tiers: PricingTier[] = [
        {
            id: 'free',
            name: 'Free',
            price: '$0',
            period: '/month',
            features: [
                'AI-maintained flagship list',
                '1 DNS vendor',
                'Basic config builder',
            ],
            cta: 'Join the waitlist',
            ctaHref: 'https://github.com/jaypatrick/adblock-compiler',
            highlighted: false,
        },
        {
            id: 'pro',
            name: 'Pro',
            price: '$9',
            period: '/month',
            badge: 'Most popular',
            features: [
                'Everything in Free',
                'Multi-instance sync (up to 5 vendors)',
                'Natural language rule builder',
                'AI threat intelligence',
            ],
            cta: 'Get early access',
            ctaHref: 'https://github.com/jaypatrick/adblock-compiler',
            highlighted: true,
        },
        {
            id: 'power',
            name: 'Power',
            price: '$19',
            period: '/month',
            features: [
                'Everything in Pro',
                'Unlimited instances',
                'API access',
                'CLI + CI/CD pipeline integration',
            ],
            cta: 'Get early access',
            ctaHref: 'https://github.com/jaypatrick/adblock-compiler',
            highlighted: false,
        },
    ];
}
