import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';
import { provideTestBed } from '../../test-utils';

function makeProviders(platformId: 'browser' | 'server' = 'browser') {
    return provideTestBed(platformId);
}

describe('NotificationService', () => {
    let service: NotificationService;

    beforeEach(() => {
        localStorage.clear();
        TestBed.configureTestingModule({ providers: makeProviders() });
        service = TestBed.inject(NotificationService);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should add and dismiss a toast', () => {
        service.showToast('success', 'Title', 'Message');
        expect(service.toasts().length).toBe(1);
        const id = service.toasts()[0].id;
        service.dismissToast(id);
        expect(service.toasts().length).toBe(0);
    });

    it('should add multiple toasts independently', () => {
        service.showToast('info', 'Info', 'Info message');
        service.showToast('error', 'Error', 'Error message');
        expect(service.toasts().length).toBe(2);
        expect(service.toasts()[0].type).toBe('info');
        expect(service.toasts()[1].type).toBe('error');
    });

    it('should initialize with notifications disabled', () => {
        expect(service.isEnabled()).toBe(false);
    });

    it('should track a job', () => {
        service.trackJob('req-1', 'My Config');
        expect(service.trackedJobs().size).toBe(1);
        expect(service.trackedJobs().get('req-1')?.configName).toBe('My Config');
    });

    it('should auto-dismiss a toast after 5 seconds', async () => {
        vi.useFakeTimers();
        service.showToast('info', 'Auto', 'dismiss me');
        expect(service.toasts().length).toBe(1);

        await vi.advanceTimersByTimeAsync(5000);
        expect(service.toasts().length).toBe(0);
        vi.useRealTimers();
    });

    it('should not dismiss a toast before 5 seconds have elapsed', async () => {
        vi.useFakeTimers();
        service.showToast('warning', 'Stays', 'still visible');
        await vi.advanceTimersByTimeAsync(4999);
        expect(service.toasts().length).toBe(1);
        vi.useRealTimers();
    });

    it('toast should include correct type and message text', () => {
        service.showToast('error', 'Oops', 'Something went wrong');
        const toast = service.toasts()[0];
        expect(toast.type).toBe('error');
        expect(toast.title).toBe('Oops');
        expect(toast.message).toBe('Something went wrong');
        expect(toast.id).toMatch(/^toast-/);
    });

    it('dismissToast should be a no-op for an unknown ID', () => {
        service.showToast('info', 'A', 'B');
        service.dismissToast('no-such-id');
        expect(service.toasts().length).toBe(1);
    });

    // -------------------------------------------------------------------------
    // requestPermission()
    // -------------------------------------------------------------------------

    it('should return false and show error toast when Notification API is unavailable', async () => {
        // Actually delete the property so `'Notification' in window` returns false
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Notification');
        Reflect.deleteProperty(globalThis, 'Notification');

        try {
            const result = await service.requestPermission();
            expect(result).toBe(false);
            expect(service.toasts()[0].type).toBe('error');
        } finally {
            if (descriptor) Object.defineProperty(globalThis, 'Notification', descriptor);
        }
    });

    it('should return false and show warning toast when permission is denied', async () => {
        const mockRequestPermission = vi.fn().mockResolvedValue('denied');
        vi.stubGlobal('Notification', Object.assign(vi.fn(), { requestPermission: mockRequestPermission, permission: 'default' }));

        const result = await service.requestPermission();
        expect(result).toBe(false);
        expect(service.isEnabled()).toBe(false);
        const types = service.toasts().map(t => t.type);
        expect(types).toContain('warning');
    });

    it('should return true, set isEnabled, and persist when permission is granted', async () => {
        const mockInstance = vi.fn();
        const MockNotification = Object.assign(mockInstance, {
            requestPermission: vi.fn().mockResolvedValue('granted'),
            permission: 'granted',
        });
        vi.stubGlobal('Notification', MockNotification);

        const result = await service.requestPermission();
        expect(result).toBe(true);
        expect(service.isEnabled()).toBe(true);
        expect(localStorage.getItem('notificationsEnabled')).toBe('true');
        const types = service.toasts().map(t => t.type);
        expect(types).toContain('success');
    });

    // -------------------------------------------------------------------------
    // requestPermission() on SSR platform
    // -------------------------------------------------------------------------

    it('should return false without calling Notification when running on server platform', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: makeProviders('server') });
        const ssrService = TestBed.inject(NotificationService);

        const result = await ssrService.requestPermission();
        expect(result).toBe(false);
        // Error toast shown
        expect(ssrService.toasts()[0].type).toBe('error');
    });

    // -------------------------------------------------------------------------
    // toggleNotifications()
    // -------------------------------------------------------------------------

    it('should disable notifications and show info toast when currently enabled', async () => {
        service.isEnabled.set(true);
        await service.toggleNotifications();
        expect(service.isEnabled()).toBe(false);
        expect(localStorage.getItem('notificationsEnabled')).toBe('false');
        const types = service.toasts().map(t => t.type);
        expect(types).toContain('info');
    });

    it('should call requestPermission when currently disabled', async () => {
        // Provide a mock that returns 'denied' so requestPermission completes safely
        const mockRequestPermission = vi.fn().mockResolvedValue('denied');
        vi.stubGlobal('Notification', Object.assign(vi.fn(), { requestPermission: mockRequestPermission, permission: 'default' }));
        expect(service.isEnabled()).toBe(false);
        await service.toggleNotifications();
        expect(mockRequestPermission).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // loadPreferences()
    // -------------------------------------------------------------------------

    it('should enable notifications on load when localStorage is "true" and permission is granted', () => {
        localStorage.setItem('notificationsEnabled', 'true');
        const GrantedNotification = Object.assign(vi.fn(), { permission: 'granted' });
        vi.stubGlobal('Notification', GrantedNotification);

        // Re-create service so constructor runs loadPreferences() with the primed localStorage
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: makeProviders() });
        const freshService = TestBed.inject(NotificationService);

        expect(freshService.isEnabled()).toBe(true);
    });

    it('should not enable notifications when localStorage is "true" but permission is not granted', () => {
        localStorage.setItem('notificationsEnabled', 'true');
        const DeniedNotification = Object.assign(vi.fn(), { permission: 'denied' });
        vi.stubGlobal('Notification', DeniedNotification);

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: makeProviders() });
        const freshService = TestBed.inject(NotificationService);

        expect(freshService.isEnabled()).toBe(false);
    });

    it('should handle localStorage read errors in loadPreferences gracefully', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('SecurityError'); });

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: makeProviders() });
        expect(() => TestBed.inject(NotificationService)).not.toThrow();
    });

    // -------------------------------------------------------------------------
    // persistPreference()
    // -------------------------------------------------------------------------

    it('should handle localStorage write errors in persistPreference gracefully', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('QuotaExceededError'); });
        vi.stubGlobal('Notification', undefined); // prevent actual Notification usage

        service.isEnabled.set(true);
        await expect(service.toggleNotifications()).resolves.not.toThrow();
    });
});
