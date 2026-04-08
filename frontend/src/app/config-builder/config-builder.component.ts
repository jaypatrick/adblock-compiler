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
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { JsonPipe } from '@angular/common';
import { NotificationService } from '../services/notification.service';
import { LogService } from '../services/log.service';
import { TurnstileComponent } from '../turnstile/turnstile.component';
import { TurnstileService } from '../services/turnstile.service';

interface ConfigError {
    path: string;
    message: string;
    code?: string;
}

@Component({
    selector: 'app-config-builder',
    imports: [
        ReactiveFormsModule,
        JsonPipe,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
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
    private readonly notificationService = inject(NotificationService);
    private readonly logService = inject(LogService);
    private readonly turnstileService = inject(TurnstileService);

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
        transformations: [[]],
        exclusions: [[]],
        inclusions: [[]],
        sources: this.fb.array([this.createSourceGroup()]),
        extensions: this.fb.group({}),
    });

    readonly outputFormat = signal<'json' | 'yaml'>('json');

    // Computed values
    readonly generatedConfig = computed(() => {
        const formValue = this.configForm.value;
        const config: Record<string, unknown> = {
            name: formValue.name,
        };

        if (formValue.description) config.description = formValue.description;
        if (formValue.homepage) config.homepage = formValue.homepage;
        if (formValue.license) config.license = formValue.license;
        if (formValue.version) config.version = formValue.version;

        config.sources = formValue.sources || [];

        if (formValue.transformations && formValue.transformations.length > 0) {
            config.transformations = formValue.transformations;
        }

        if (formValue.exclusions && formValue.exclusions.length > 0) {
            config.exclusions = formValue.exclusions;
        }

        if (formValue.inclusions && formValue.inclusions.length > 0) {
            config.inclusions = formValue.inclusions;
        }

        // Add extensions if any
        const extensions = formValue.extensions;
        if (extensions && Object.keys(extensions).length > 0) {
            config.extensions = extensions;
        }

        return config;
    });

    readonly jsonOutput = computed(() => {
        return JSON.stringify(this.generatedConfig(), null, 4);
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
            this.notificationService.showWarning('At least one source is required');
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

    async validateConfig(): Promise<void> {
        if (!this.isFormValid()) {
            this.notificationService.showWarning('Please fill in all required fields');
            return;
        }

        this.isValidating.set(true);
        this.validationErrors.set([]);

        try {
            const config = this.generatedConfig();
            const token = this.turnstileToken();

            const response = await fetch('/api/configuration/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config, turnstileToken: token }),
            });

            const result = await response.json();

            if (result.valid) {
                this.notificationService.showSuccess('Configuration is valid!');
                this.logService.info('Configuration validated successfully');
            } else {
                this.validationErrors.set(result.errors || []);
                this.notificationService.showError('Configuration has validation errors');
            }
        } catch (error) {
            this.logService.error('Validation failed', error);
            this.notificationService.showError('Failed to validate configuration');
        } finally {
            this.isValidating.set(false);
        }
    }

    async createAndStoreConfig(): Promise<void> {
        if (!this.isFormValid()) {
            this.notificationService.showWarning('Please fill in all required fields');
            return;
        }

        this.isCreating.set(true);

        try {
            const config = this.generatedConfig();
            const format = this.outputFormat();
            const token = this.turnstileToken();

            const response = await fetch('/api/configuration/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config, format, turnstileToken: token }),
            });

            const result = await response.json();

            if (result.valid === false) {
                this.validationErrors.set(result.errors || []);
                this.notificationService.showError('Configuration has validation errors');
                return;
            }

            if (result.id) {
                this.configId.set(result.id);
                this.notificationService.showSuccess(
                    `Configuration created! ID: ${result.id} (expires in 24 hours)`,
                );
                this.logService.info('Configuration created', { id: result.id });
            } else {
                this.notificationService.showError('Failed to create configuration');
            }
        } catch (error) {
            this.logService.error('Create failed', error);
            this.notificationService.showError('Failed to create configuration');
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
            this.logService.info('Downloading configuration', { id, format });
        }
    }

    copyToClipboard(): void {
        const text = this.jsonOutput();
        navigator.clipboard.writeText(text).then(
            () => {
                this.notificationService.showSuccess('Copied to clipboard');
            },
            () => {
                this.notificationService.showError('Failed to copy to clipboard');
            },
        );
    }

    onTurnstileSuccess(token: string): void {
        this.turnstileToken.set(token);
        this.logService.debug('Turnstile token received');
    }

    onTurnstileError(error: unknown): void {
        this.logService.error('Turnstile verification failed', error);
        this.notificationService.showError('Turnstile verification failed');
    }
}
