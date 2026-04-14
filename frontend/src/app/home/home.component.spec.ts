import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
    let fixture: ComponentFixture<HomeComponent>;
    let component: HomeComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HomeComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        await fixture.whenStable();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render nav bar', async () => {
        await fixture.whenStable();
        const nav = fixture.nativeElement.querySelector('app-nav-bar');
        expect(nav).toBeTruthy();
    });

    it('should render hero section', async () => {
        await fixture.whenStable();
        const hero = fixture.nativeElement.querySelector('app-hero-section');
        expect(hero).toBeTruthy();
    });

    it('should render landing content wrapper', async () => {
        await fixture.whenStable();
        const wrapper = fixture.nativeElement.querySelector('.landing-content');
        expect(wrapper).toBeTruthy();
    });

    it('should render footer section', async () => {
        await fixture.whenStable();
        const footer = fixture.nativeElement.querySelector('app-footer-section');
        expect(footer).toBeTruthy();
    });
});
