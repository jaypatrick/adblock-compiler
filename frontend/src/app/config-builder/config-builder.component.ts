/**
 * ConfigBuilderComponent — Interactive configuration file builder.
 *
 * Features:
 *   - Form-based configuration builder with real-time validation
 *   - Code editor with syntax highlighting for JSON/YAML
 *   - Preview mode to show generated configuration
 *   - Download functionality for validated configurations
 *   - Supports extensions field for custom metadata
 *
 * Angular 21 patterns: signal(), computed(), inject(), reactive forms,
 *   @if/@for control flow, zoneless.
 */

import { Component, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { JsonPipe } from '@angular/common';
import { stringify as yamlStringify } from 'yaml';
import { NotificationService } from '../services/notification.service';
import { LogService } from '../services/log.service';
import { TurnstileComponent } from '../turnstile/turnstile.component';
import { TurnstileService } from '../services/turnstile.service';
import {
    ConfigValidateResponseSchema,
    ConfigCreateResponseSchema,
    ConfigError,
    validateResponse,
} from '../schemas/api-responses';

@Component({
    selector: 'app-config-builder',
    imports: [
        ReactiveFormsModule,
        JsonPipe,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatButtonToggleModule,
        MatIconModule,
        MatCardModule,
        MatSelectModule,
        MatTabsModule,
        MatDividerModule,
        MatChipsModule,
        TurnstileComponent,
    ],
    templateUrl: './config-builder.component.html',
    styleUrls: ['./config-builder.component.scss'],
})
export class ConfigBuilderComponent {
    private readonly fb = inject(FormBuilder);
    private readonly http = inject(HttpClient);
    private readonly notificationService = inject(NotificationService);
    private readonly logService = inject(LogService);
    private readonly _turnstileService = inject(TurnstileService);
    readonly turnstileSiteKey = this._turnstileService.siteKey;

    // Signals
    readonly isValidating = signal(false);
    readonly isCreating = signal(false);
    readonly validationErrors = signal<ConfigError[]>([]);
    readonly configId = signal<string | null>(null);
    readonly selectedTab = signal(0);
    readonly turnstileToken = signal<string | null>(null);

    // Available options
    readonly transformationTypes = [
        'RemoveComments',
        'RemoveModifiers',
        'Compress',
        'Validate',
        'ValidateAllowIp',
        'Deduplicate',
        'InvertAllow',
        'RemoveEmptyLines',
        'TrimLines',
        'InsertFinalNewLine',
        'ConvertToAscii',
    ];

    readonly sourceTypes = ['adblock', 'hosts'];
    readonly outputFormats = [
        { value: 'json', label: 'JSON' },
        { value: 'yaml', label: 'YAML' },
    ];

    // Form groups
    readonly configForm = this.fb.group({
        name: ['My Filter List', [Validators.required, Validators.minLength(1)]],
        description: [''],
        homepage: ['', Validators.pattern(/^https?:\/\/.+/)],
        license: [''],
        version: ['1.0.0', Validators.pattern(/^\d+\.\d+(\.\d+)?$/)],
        transformations: [[] as string[]],
        exclusions: [[] as string[]],
        inclusions: [[] as string[]],
        sources: this.fb.array([this.createSourceGroup()]),
        extensions: this.fb.group({}),
    });

    readonly outputFormat = signal<'json' | 'yaml'>('json');

    // Computed values
    readonly generatedConfig = computed(() => {
        // Use bracket notation throughout to satisfy noPropertyAccessFromIndexSignature
        const raw = this.configForm.value;
        const nameVal = raw['name'] as string | null;
        const descVal = raw['description'] as string | null;
        const homepageVal = raw['homepage'] as string | null;
        const licenseVal = raw['license'] as string | null;
        const versionVal = raw['version'] as string | null;
        const sourcesVal = raw['sources'] as Array<{ name?: string; source?: string; type?: string }> | null;
        const transformationsVal = raw['transformations'] as string[] | null;
        const exclusionsVal = raw['exclusions'] as string[] | null;
        const inclusionsVal = raw['inclusions'] as string[] | null;
        const extensionsVal = raw['extensions'] as Record<string, string> | null;

        const config: Record<string, unknown> = { name: nameVal };

        if (descVal) config['description'] = descVal;
        if (homepageVal) config['homepage'] = homepageVal;
        if (licenseVal) config['license'] = licenseVal;
        if (versionVal) config['version'] = versionVal;

        config['sources'] = sourcesVal ?? [];

        if (transformationsVal && transformationsVal.length > 0) {
            config['transformations'] = transformationsVal;
        }

        if (exclusionsVal && exclusionsVal.length > 0) {
            config['exclusions'] = exclusionsVal;
        }

        if (inclusionsVal && inclusionsVal.length > 0) {
            config['inclusions'] = inclusionsVal;
        }

        if (extensionsVal && Object.keys(extensionsVal).length > 0) {
            config['extensions'] = extensionsVal;
        }

        return config;
    });

    readonly jsonOutput = computed(() => {
        return JSON.stringify(this.generatedConfig(), null, 4);
    });

    readonly previewOutput = computed(() => {
        if (this.outputFormat() === 'yaml') {
            return yamlStringify(this.generatedConfig() as Record<string, unknown>);
        }
        return this.jsonOutput();
    });

    readonly isFormValid = computed(() => {
        return this.configForm.valid && this.sources.length > 0;
    });

    get sources(): FormArray {
        return this.configForm.get('sources') as FormArray;
    }

    get extensions(): FormGroup {
        return this.configForm.get('extensions') as FormGroup;
    }

    private createSourceGroup(): FormGroup {
        return this.fb.group({
            name: [''],
            source: ['', [Validators.required, Validators.minLength(1)]],
            type: ['adblock', Validators.required],
        });
    }

    addSource(): void {
        this.sources.push(this.createSourceGroup());
    }

    removeSource(index: number): void {
        if (this.sources.length > 1) {
            this.sources.removeAt(index);
        } else {
            this.notificationService.showToast('warning', 'Warning', 'At least one source is required');
        }
    }

    addExtension(key: string, value: string): void {
        if (key && !this.extensions.contains(key)) {
            this.extensions.addControl(key, this.fb.control(value));
        }
    }

    removeExtension(key: string): void {
        this.extensions.removeControl(key);
    }

    getExtensionKeys(): string[] {
        return Object.keys(this.extensions.controls);
    }

    getExtensionControl(key: string): FormControl {
        return this.extensions.get(key) as FormControl;
    }

    async validateConfig(): Promise<void> {
        if (!this.isFormValid()) {
            this.notificationService.showToast('warning', 'Validation', 'Please fill in all required fields');
            return;
        }

        this.isValidating.set(true);
        this.validationErrors.set([]);

        try {
            const config = this.generatedConfig();
            const token = this.turnstileToken();

            const raw = await firstValueFrom(
                this.http.post<unknown>('/api/configuration/validate', { config, turnstileToken: token }),
            );
            const result = validateResponse(ConfigValidateResponseSchema, raw, 'POST /configuration/validate');

            if (result.valid) {
                this.notificationService.showToast('success', 'Valid', 'Configuration is valid!');
                this.logService.info('Configuration validated successfully', 'config-builder');
            } else {
                this.validationErrors.set(result.errors ?? []);
                this.notificationService.showToast('error', 'Invalid', 'Configuration has validation errors');
            }
        } catch (error) {
            this.logService.error('Validation failed', 'config-builder', { error: String(error) });
            this.notificationService.showToast('error', 'Error', 'Failed to validate configuration');
        } finally {
            this.isValidating.set(false);
        }
    }

    async createAndStoreConfig(): Promise<void> {
        if (!this.isFormValid()) {
            this.notificationService.showToast('warning', 'Validation', 'Please fill in all required fields');
            return;
        }

        this.isCreating.set(true);

        try {
            const config = this.generatedConfig();
            const format = this.outputFormat();
            const token = this.turnstileToken();

            const raw = await firstValueFrom(
                this.http.post<unknown>('/api/configuration/create', { config, format, turnstileToken: token }),
            );
            const result = validateResponse(ConfigCreateResponseSchema, raw, 'POST /configuration/create');

            if (result.valid === false) {
                this.validationErrors.set(result.errors ?? []);
                this.notificationService.showToast('error', 'Invalid', 'Configuration has validation errors');
                return;
            }

            if (result.id) {
                this.configId.set(result.id);
                this.notificationService.showToast(
                    'success',
                    'Created',
                    `Configuration created! ID: ${result.id} (expires in 24 hours)`,
                );
                this.logService.info('Configuration created', 'config-builder', { id: result.id });
            } else {
                this.notificationService.showToast('error', 'Error', 'Failed to create configuration');
            }
        } catch (error) {
            this.logService.error('Create failed', 'config-builder', { error: String(error) });
            this.notificationService.showToast('error', 'Error', 'Failed to create configuration');
        } finally {
            this.isCreating.set(false);
        }
    }

    downloadConfig(): void {
        const id = this.configId();
        const format = this.outputFormat();

        if (id) {
            const url = `/api/configuration/download/${id}?format=${format}`;
            window.open(url, '_blank');
            this.logService.info('Downloading configuration', 'config-builder', { id, format });
        }
    }

    copyToClipboard(): void {
        const text = this.previewOutput();
        navigator.clipboard.writeText(text).then(
            () => {
                this.notificationService.showToast('success', 'Copied', 'Copied to clipboard');
            },
            () => {
                this.notificationService.showToast('error', 'Error', 'Failed to copy to clipboard');
            },
        );
    }

    onTurnstileToken(token: string): void {
        this.turnstileToken.set(token);
        this.logService.debug('Turnstile token received');
    }

    onTurnstileError(error: unknown): void {
        this.logService.error('Turnstile verification failed', 'config-builder', { error: String(error) });
        this.notificationService.showToast('error', 'Error', 'Turnstile verification failed');
    }
}
