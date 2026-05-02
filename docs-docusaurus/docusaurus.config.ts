import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import type * as OpenApiPlugin from 'docusaurus-plugin-openapi-docs';

const config: Config = {
    title: 'Bloqr',
    tagline: 'Adblock/AdGuard Hostlist & Rules Compiler',
    // TODO(@jaypatrick): add static/img/favicon.ico to docs-docusaurus/ before deploying
    favicon: 'img/favicon.ico',

    url: 'https://docs.bloqr.dev',
    baseUrl: '/',

    organizationName: 'jaypatrick',
    projectName: 'adblock-compiler',

    onBrokenLinks: 'warn',
    onBrokenMarkdownLinks: 'warn',

    // Enable Mermaid diagram support
    markdown: {
        mermaid: true,
    },

    themes: ['@docusaurus/theme-mermaid', 'docusaurus-theme-openapi-docs'],

    i18n: {
        defaultLocale: 'en',
        locales: ['en'],
    },

    plugins: [
        [
            'docusaurus-plugin-openapi-docs',
            {
                id: 'openapi',
                docsPluginId: 'classic',
                config: {
                    bloqrApi: {
                        specPath: '../docs/api/openapi.yaml',
                        outputDir: 'docs/api/openapi',
                        sidebarOptions: {
                            groupPathsBy: 'tag',
                            categoryLinkSource: 'tag',
                        },
                    } satisfies OpenApiPlugin.Options,
                },
            },
        ],
    ],

    presets: [
        [
            'classic',
            {
                docs: {
                    // Point to the existing docs/ directory at the repo root.
                    // The Markdown source files are NOT moved — Docusaurus reads
                    // them in-place via this relative path.
                    path: '../docs',
                    routeBasePath: '/',
                    sidebarPath: './sidebars.ts',
                    editUrl: 'https://github.com/jaypatrick/adblock-compiler/edit/main/docs/',
                    showLastUpdateTime: true,
                    showLastUpdateAuthor: true,
                    // Docusaurus plugin-openapi-docs integration
                    docItemComponent: '@theme/ApiItem',
                },
                blog: false,
                theme: {
                    customCss: './src/css/custom.css',
                },
                sitemap: {
                    changefreq: 'weekly',
                    priority: 0.5,
                    ignorePatterns: ['/tags/**'],
                    filename: 'sitemap.xml',
                },
            } satisfies Preset.Options,
        ],
    ],

    themeConfig: {
        // Open Graph / social card
        image: 'img/bloqr-social-card.png',

        colorMode: {
            defaultMode: 'dark',
            disableSwitch: false,
            respectPrefersColorScheme: true,
        },

        navbar: {
            title: 'Bloqr',
            logo: {
                alt: 'Bloqr Logo',
                src: 'img/logo.svg',
            },
            items: [
                {
                    type: 'docSidebar',
                    sidebarId: 'docsSidebar',
                    position: 'left',
                    label: 'Guides',
                    docsPluginId: 'classic',
                },
                {
                    to: '/api/README',
                    label: 'API Reference',
                    position: 'left',
                },
                {
                    to: '/architecture/SYSTEM_ARCHITECTURE',
                    label: 'Architecture',
                    position: 'left',
                },
                {
                    to: '/security/ZERO_TRUST_ARCHITECTURE',
                    label: 'Security',
                    position: 'left',
                },
                {
                    to: '/releases/README',
                    label: 'Changelog',
                    position: 'left',
                },
                {
                    href: 'https://github.com/jaypatrick/adblock-compiler',
                    label: 'GitHub',
                    position: 'right',
                },
            ],
        },

        footer: {
            style: 'dark',
            links: [
                {
                    title: 'Docs',
                    items: [
                        { label: 'Introduction', to: '/' },
                        { label: 'Quick Start', to: '/guides/quick-start' },
                        { label: 'API Reference', to: '/api/README' },
                        { label: 'Configuration', to: '/usage/CONFIGURATION' },
                    ],
                },
                {
                    title: 'Platform',
                    items: [
                        { label: 'Architecture', to: '/architecture/SYSTEM_ARCHITECTURE' },
                        { label: 'Security (ZTA)', to: '/security/ZERO_TRUST_ARCHITECTURE' },
                        { label: 'Deployment', to: '/deployment/README' },
                        { label: 'Cloudflare Integration', to: '/cloudflare/README' },
                    ],
                },
                {
                    title: 'Reference',
                    items: [
                        { label: 'Auth & AuthZ', to: '/auth/README' },
                        { label: 'Admin System', to: '/admin/README' },
                        { label: 'Observability', to: '/observability/README' },
                        { label: 'Troubleshooting', to: '/troubleshooting/README' },
                    ],
                },
                {
                    title: 'More',
                    items: [
                        { label: 'Releases', to: '/releases/README' },
                        { label: 'GitHub', href: 'https://github.com/jaypatrick/adblock-compiler' },
                        { label: 'App', href: 'https://app.bloqr.dev' },
                    ],
                },
            ],
            copyright: `Copyright © ${new Date().getFullYear()} Bloqr. Built with Docusaurus.`,
        },

        // Algolia DocSearch — stub configuration ready to fill in once the index is created.
        // These are PLACEHOLDER values only — search will not work until real keys are provided.
        // The search API key is intentionally public (search-only, read-only key).
        // Apply at https://docsearch.algolia.com/apply/ (free for OSS projects).
        // See docs-docusaurus/README.md → "Migration Notes" for setup instructions.
        algolia: {
            // Replace with real Algolia Application ID
            appId: 'REPLACE_WITH_ALGOLIA_APP_ID',
            // Replace with real Algolia search-only API key (public-safe, read-only)
            apiKey: 'REPLACE_WITH_ALGOLIA_SEARCH_API_KEY',
            indexName: 'bloqr-docs',
            contextualSearch: true,
            searchParameters: {},
            searchPagePath: 'search',
        },

        prism: {
            theme: prismThemes.github,
            darkTheme: prismThemes.dracula,
            additionalLanguages: [
                'bash',
                'diff',
                'json',
                'toml',
                'yaml',
                'typescript',
                'tsx',
            ],
        },
    } satisfies Preset.ThemeConfig,
};

export default config;
