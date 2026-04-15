/**
 * Angular - Custom Title Strategy with SEO Meta Description
 *
 * WCAG 2.4.2 (Page Titled) -- Level A
 *
 * Appends the application name to every route title so each page
 * gets a unique, descriptive <title> element. Also updates the
 * <meta name="description"> tag per route for SEO.
 *
 * Route config example:
 *   { path: 'compiler', title: 'Compiler', data: { metaDescription: '...' } }
 *
 * Resulting document title:
 *   "Bloqr — Compiler"
 */

import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';

const APP_NAME = 'Bloqr';
const DEFAULT_DESCRIPTION = 'AI-powered adblock list management and real-time threat intelligence. Block ads, trackers, and malware at the network level — without routing your traffic anywhere.';

@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
    private readonly title = inject(Title);
    private readonly meta = inject(Meta);

    override updateTitle(snapshot: RouterStateSnapshot): void {
        const routeTitle = this.buildTitle(snapshot);
        this.title.setTitle(routeTitle ? `${APP_NAME} \u2014 ${routeTitle}` : APP_NAME);

        const description = this.getDeepestData(snapshot.root, 'metaDescription') ?? DEFAULT_DESCRIPTION;
        this.meta.updateTag({ name: 'description', content: description });
    }

    private getDeepestData(route: ActivatedRouteSnapshot, key: string): string | undefined {
        let value: string | undefined;
        let current: ActivatedRouteSnapshot | null = route;
        while (current) {
            if (Object.prototype.hasOwnProperty.call(current.data, key)) {
                const candidate = current.data[key];
                if (typeof candidate === 'string') {
                    value = candidate;
                }
            }
            current = current.firstChild;
        }
        return value;
    }
}
