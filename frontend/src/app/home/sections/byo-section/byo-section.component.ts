import { Component } from '@angular/core';

@Component({
    selector: 'app-byo-section',
    standalone: true,
    template: `
    <section class="bloqr-section" id="byo" aria-label="Bring Your Own or Use Ours">
        <div class="bloqr-container">
            <span class="bloqr-section-label">FLEXIBILITY</span>
            <h2 class="bloqr-section-title">Bring your own. Or use ours.</h2>
            <div class="byo-grid">
                <div class="byo-card bloqr-card">
                    <div class="byo-card-header">
                        <div class="byo-icon" aria-hidden="true">
                            <span class="material-symbols-outlined">extension</span>
                        </div>
                        <h3 class="byo-card-title">Bring Your Own</h3>
                    </div>
                    <p class="byo-card-body">Already on AdGuard, NextDNS, or Pi-hole? Keep it. Bloqr adds AI-maintained lists, natural language rules, and multi-instance sync. Your setup stays yours.</p>
                    <ul class="byo-list">
                        <li>✓ Keep your current vendor</li>
                        <li>✓ AI-enhanced filter lists</li>
                        <li>✓ Multi-instance sync</li>
                        <li>✓ Natural language rules</li>
                    </ul>
                </div>
                <div class="byo-card bloqr-card">
                    <div class="byo-card-header">
                        <div class="byo-icon byo-icon-orange" aria-hidden="true">
                            <span class="material-symbols-outlined">rocket_launch</span>
                        </div>
                        <h3 class="byo-card-title">Use Ours</h3>
                    </div>
                    <p class="byo-card-body">No vendor? No problem. We handle everything — vendor selection, configuration, list maintenance. You flip one switch.</p>
                    <ul class="byo-list">
                        <li>✓ We pick the best vendor for you</li>
                        <li>✓ Zero configuration required</li>
                        <li>✓ Fully managed list maintenance</li>
                        <li>✓ One switch to get started</li>
                    </ul>
                </div>
            </div>
            <p class="byo-footer">Either way, you're not locked in.</p>
        </div>
    </section>
    `,
    styles: [`
    :host { display: block; }
    .byo-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 24px;
        margin-top: 48px;
    }
    .byo-card { display: flex; flex-direction: column; gap: 20px; }
    .byo-card-header { display: flex; align-items: center; gap: 12px; }
    .byo-icon {
        width: 44px; height: 44px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,212,255,0.08);
        border-radius: 8px;
        color: #00D4FF;
        flex-shrink: 0;
    }
    .byo-icon-orange { background: rgba(255,85,0,0.08); color: #FF5500; }
    .byo-icon .material-symbols-outlined { font-size: 22px; }
    .byo-card-title {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 1.1rem;
        font-weight: 700;
        color: #F1F5F9;
        margin: 0;
    }
    .byo-card-body { font-size: 0.9rem; color: #94A3B8; line-height: 1.65; margin: 0; }
    .byo-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .byo-list li { font-size: 0.875rem; color: #94A3B8; }
    .byo-footer {
        margin-top: 32px;
        text-align: center;
        font-size: 1rem;
        font-weight: 600;
        color: #F1F5F9;
        font-style: italic;
    }
    @media (max-width: 640px) {
        .byo-grid { grid-template-columns: 1fr; }
    }
    `],
})
export class ByoSectionComponent {}
