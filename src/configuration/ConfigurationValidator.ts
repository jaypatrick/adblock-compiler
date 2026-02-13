import { z } from 'zod';
import { IConfiguration, IValidationResult } from '../types/index.ts';
import { ConfigurationSchema } from './schemas.ts';

/**
 * Validation error details
 */
interface ValidationError {
    path: string;
    message: string;
}

/**
 * Validates configuration objects against the expected schema.
 * Uses Zod for runtime validation with TypeScript integration.
 */
export class ConfigurationValidator {
    /**
     * Validates a configuration object.
     * @param configuration - Configuration object to validate
     * @returns Validation result with valid flag and error text
     */
    public validate(configuration: unknown): IValidationResult {
        const result = ConfigurationSchema.safeParse(configuration);

        if (result.success) {
            return { valid: true, errorsText: null };
        }

        // Convert Zod errors to path-based format matching original implementation
        const errors = this.formatZodErrors(result.error);
        const errorsText = errors
            .map((e) => `${e.path}: ${e.message}`)
            .join('\n');

        return { valid: false, errorsText };
    }

    /**
     * Validates and returns a typed configuration.
     * @param configuration - Configuration object to validate
     * @returns Validated configuration
     * @throws Error if validation fails
     */
    public validateAndGet(configuration: unknown): IConfiguration {
        const result = this.validate(configuration);

        if (!result.valid) {
            throw new Error(`Configuration validation failed:\n${result.errorsText}`);
        }

        return configuration as IConfiguration;
    }

    /**
     * Converts Zod validation errors to path-based format.
     */
    private formatZodErrors(error: z.ZodError): ValidationError[] {
        return error.issues.map((issue) => {
            // Convert Zod path to slash-separated format like /sources/0/type
            const path = issue.path.length > 0
                ? '/' + issue.path.join('/')
                : '/';

            // Format message based on error code
            let message: string;

            switch (issue.code) {
                case z.ZodIssueCode.invalid_type:
                    if (issue.received === 'undefined') {
                        message = this.getRequiredFieldMessage(issue.path);
                    } else if (issue.expected === 'array') {
                        message = 'must be an array';
                    } else if (issue.expected === 'object') {
                        message = 'must be an object';
                    } else {
                        message = `must be a ${issue.expected}`;
                    }
                    break;

                case z.ZodIssueCode.invalid_enum_value:
                    // For enum errors, provide the valid values
                    if (issue.path[issue.path.length - 1] === 'type') {
                        message = 'type must be one of: adblock, hosts';
                    } else {
                        const validValues = issue.options.join(', ');
                        message = `invalid transformation: ${issue.received}. Valid values: ${validValues}`;
                    }
                    break;

                case z.ZodIssueCode.too_small:
                    if (issue.type === 'string') {
                        message = this.getRequiredFieldMessage(issue.path);
                    } else if (issue.type === 'array') {
                        message = 'sources is required and must be a non-empty array';
                    } else {
                        message = issue.message;
                    }
                    break;

                case z.ZodIssueCode.unrecognized_keys:
                    // Handle unknown properties
                    const keys = issue.keys.join(', ');
                    message = `unknown property: ${keys}`;
                    break;

                default:
                    message = issue.message;
            }

            return { path, message };
        });
    }

    /**
     * Gets appropriate error message for required fields.
     */
    private getRequiredFieldMessage(path: (string | number)[]): string {
        const fieldName = path[path.length - 1];

        if (fieldName === 'name' || fieldName === 'source') {
            return `${fieldName} is required and must be a non-empty string`;
        }

        return 'must be a non-empty string';
    }
}
