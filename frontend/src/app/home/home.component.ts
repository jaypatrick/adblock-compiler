/**
 * HomeComponent — Bloqr Landing Page
 *
 * Full-page landing page at route `/`. Composes all landing page sections:
 *   Nav → Hero → Problem/VPN → Features → HowItWorks → BYO → Audiences → Pricing → CTA → Footer
 *
 * All section panels (e.g. persona tabs) are SSR-rendered in the DOM for SEO/AEO.
 * Angular signals drive reactive state (tab selection, code toggle).
 * No EventEmitter, no zone-based patterns.
 */

import { Component } from '@angular/core';
import { NavBarComponent } from './sections/nav-bar/nav-bar.component';
import { HeroSectionComponent } from './sections/hero-section/hero-section.component';
import { ProblemSectionComponent } from './sections/problem-section/problem-section.component';
import { FeaturesSectionComponent } from './sections/features-section/features-section.component';
import { HowItWorksSectionComponent } from './sections/how-it-works-section/how-it-works-section.component';
import { ByoSectionComponent } from './sections/byo-section/byo-section.component';
import { AudiencesSectionComponent } from './sections/audiences-section/audiences-section.component';
import { PricingSectionComponent } from './sections/pricing-section/pricing-section.component';
import { CtaBannerSectionComponent } from './sections/cta-banner-section/cta-banner-section.component';
import { FooterSectionComponent } from './sections/footer-section/footer-section.component';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [
        NavBarComponent,
        HeroSectionComponent,
        ProblemSectionComponent,
        FeaturesSectionComponent,
        HowItWorksSectionComponent,
        ByoSectionComponent,
        AudiencesSectionComponent,
        PricingSectionComponent,
        CtaBannerSectionComponent,
        FooterSectionComponent,
    ],
    template: `
    <app-nav-bar />
    <div class="landing-content">
        <app-hero-section />
        <app-problem-section />
        <app-features-section />
        <app-how-it-works-section />
        <app-byo-section />
        <app-audiences-section />
        <app-pricing-section />
        <app-cta-banner-section />
    </div>
    <app-footer-section />
    `,
    styles: [`
    :host {
        display: block;
        background: #070B14;
        min-height: 100vh;
    }
    .landing-content {
        background: #070B14;
    }
    `],
})
export class HomeComponent {}
