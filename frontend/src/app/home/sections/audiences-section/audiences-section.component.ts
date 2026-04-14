import { Component, signal } from '@angular/core';

interface Persona {
    readonly id: string;
    readonly tab: string;
    readonly headline: string;
    readonly body: string;
    readonly cta: string;
}

@Component({
    selector: 'app-audiences-section',
    standalone: true,
    template: `
    <section class="bloqr-section" id="audiences" aria-label="Who It's For">
        <div class="bloqr-container">
            <span class="bloqr-section-label">WHO IT'S FOR</span>
            <h2 class="bloqr-section-title">Built for every kind of user.</h2>
            <!-- Tabs -->
            <div class="persona-tabs" role="tablist" aria-label="User personas">
                @for (persona of personas; track persona.id) {
                    <button
                        class="persona-tab"
                        [class.active]="activePersona() === persona.id"
                        role="tab"
                        [attr.id]="'tab-' + persona.id"
                        [attr.aria-selected]="activePersona() === persona.id"
                        [attr.aria-controls]="'panel-' + persona.id"
                        (click)="activePersona.set(persona.id)">
                        {{ persona.tab }}
                    </button>
                }
            </div>
            <!-- Panels — ALL kept in DOM for SSR/SEO, visibility toggled -->
            <div class="persona-panels">
                @for (persona of personas; track persona.id) {
                    <div
                        class="persona-panel bloqr-card"
                        role="tabpanel"
                        [attr.id]="'panel-' + persona.id"
                        [attr.aria-labelledby]="'tab-' + persona.id"
                        [class.panel-active]="activePersona() === persona.id"
                        [attr.aria-hidden]="activePersona() !== persona.id">
                        <h3 class="persona-headline">{{ persona.headline }}</h3>
                        <p class="persona-body">{{ persona.body }}</p>
                        <a href="#pricing" class="bloqr-btn-primary">{{ persona.cta }}</a>
                    </div>
                }
            </div>
        </div>
    </section>
    `,
    styles: [`
    :host { display: block; }
    .persona-tabs {
        display: flex;
        gap: 4px;
        margin-top: 40px;
        margin-bottom: 0;
        border-bottom: 1px solid #1E2D40;
        flex-wrap: wrap;
    }
    .persona-tab {
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 10px 16px;
        font-family: 'Space Grotesk', sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: #94A3B8;
        cursor: pointer;
        transition: color 0.2s, border-color 0.2s;
        margin-bottom: -1px;
    }
    .persona-tab:hover { color: #F1F5F9; }
    .persona-tab.active {
        color: #FF5500;
        border-bottom-color: #FF5500;
    }
    .persona-panels {
        position: relative;
        margin-top: 0;
    }
    .persona-panel {
        margin-top: 24px;
        display: none;
        flex-direction: column;
        gap: 20px;
        max-width: 700px;
    }
    .persona-panel.panel-active {
        display: flex;
    }
    /* SSR: all panels exist in DOM but only the active one is visible */
    .persona-panel[aria-hidden="true"] {
        visibility: hidden;
        position: absolute;
        pointer-events: none;
        height: 0;
        overflow: hidden;
    }
    .persona-panel[aria-hidden="false"],
    .persona-panel.panel-active {
        visibility: visible;
        position: static;
        height: auto;
        overflow: visible;
        display: flex;
    }
    .persona-headline {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 1.4rem;
        font-weight: 800;
        color: #F1F5F9;
        line-height: 1.2;
        margin: 0;
    }
    .persona-body { font-size: 0.95rem; color: #94A3B8; line-height: 1.65; margin: 0; }
    `],
})
export class AudiencesSectionComponent {
    readonly activePersona = signal('consumer');

    readonly personas: Persona[] = [
        {
            id: 'consumer',
            tab: 'The Beneficiary',
            headline: 'The internet you always thought you had. Now you actually do.',
            body: 'No setup, no acronyms, one switch. AI handles everything. You just browse.',
            cta: 'Join the waitlist',
        },
        {
            id: 'power',
            tab: 'The Advocate',
            headline: 'Keep your vendor. Finally stop managing it in 12 places.',
            body: 'Multi-instance sync, AI rules, one change everywhere. Your filters are finally coherent.',
            cta: 'Get early access',
        },
        {
            id: 'dev',
            tab: 'The Builder',
            headline: 'REST, streaming, or embedded. Running before your next coffee.',
            body: 'TypeScript library, REST API, JSON/YAML config. Fully typed. Works in CI.',
            cta: 'Read the docs',
        },
        {
            id: 'vendor',
            tab: 'The Ally',
            headline: 'Your users trust you. We make that trust more powerful.',
            body: 'Partner with Bloqr to add list intelligence to your platform. White-label available.',
            cta: 'Learn more',
        },
    ];
}
