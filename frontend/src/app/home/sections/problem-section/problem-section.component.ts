import { Component } from '@angular/core';

interface ComparisonCard {
    readonly icon: string;
    readonly title: string;
    readonly myth: string;
    readonly reality: string;
}

@Component({
    selector: 'app-problem-section',
    standalone: true,
    template: `
    <section class="bloqr-section" id="problem" aria-label="The Problem">
        <div class="bloqr-container">
            <span class="bloqr-section-label">THE PROBLEM</span>
            <h2 class="bloqr-section-title">You thought you were protected.</h2>
            <div class="problem-desc">
                <p>Most consumer VPNs are expensive proxies — not privacy tools. Your ISP still sees everything. Ads still track you. Malware still loads.</p>
                <p>Bloqr blocks threats at the DNS level, before they reach your device. No rerouting. No trust problem relocated.</p>
            </div>
            <div class="comparison-grid" role="list">
                @for (card of cards; track card.title) {
                    <div class="comparison-card bloqr-card" role="listitem">
                        <div class="comparison-icon">{{ card.icon }}</div>
                        <h3>{{ card.title }}</h3>
                        <div class="comparison-row">
                            <div class="comparison-col myth">
                                <span class="comparison-label">What a VPN does</span>
                                <p>{{ card.myth }}</p>
                            </div>
                            <div class="comparison-col reality">
                                <span class="comparison-label">What Bloqr does</span>
                                <p>{{ card.reality }}</p>
                            </div>
                        </div>
                    </div>
                }
            </div>
        </div>
    </section>
    `,
    styles: [`
    :host { display: block; }
    .problem-desc { max-width: 640px; margin-bottom: 48px; }
    .problem-desc p { font-size: 1.05rem; color: #94A3B8; line-height: 1.65; margin: 0 0 16px; }
    .comparison-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 24px;
    }
    .comparison-card { display: flex; flex-direction: column; gap: 12px; }
    .comparison-icon { font-size: 28px; }
    .comparison-card h3 {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 1rem;
        font-weight: 700;
        color: #F1F5F9;
        margin: 0;
    }
    .comparison-row { display: flex; gap: 16px; flex-direction: column; }
    .comparison-col { flex: 1; }
    .comparison-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        display: block;
        margin-bottom: 6px;
    }
    .myth .comparison-label { color: #EF4444; }
    .reality .comparison-label { color: #22C55E; }
    .comparison-col p { font-size: 0.875rem; color: #94A3B8; line-height: 1.5; margin: 0; }
    @media (max-width: 768px) {
        .comparison-grid { grid-template-columns: 1fr; }
    }
    `],
})
export class ProblemSectionComponent {
    readonly cards: ComparisonCard[] = [
        {
            icon: '👁️',
            title: 'Ad Tracking',
            myth: 'Encrypts your traffic but doesn\'t block tracking pixels, fingerprinters, or ad scripts.',
            reality: 'Blocks ad and tracker domains at the DNS layer before any connection is made.',
        },
        {
            icon: '🛡️',
            title: 'Malware Protection',
            myth: 'Routes traffic through a server — malware domains still resolve and load.',
            reality: 'Known malware domains are blocked before your device ever makes a request.',
        },
        {
            icon: '🔒',
            title: 'Privacy',
            myth: 'Relocates trust from your ISP to the VPN provider — who now sees everything.',
            reality: 'DNS-level blocking leaves no traffic to intercept or log by any third party.',
        },
    ];
}
