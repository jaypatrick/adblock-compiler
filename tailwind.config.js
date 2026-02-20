/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './public/**/*.html',
        './public/**/*.js',
    ],
    darkMode: ['class', '[data-theme="dark"]'],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#667eea',
                    dark: '#5568d3',
                    light: '#8096ff',
                },
                secondary: {
                    DEFAULT: '#764ba2',
                    dark: '#5c3a80',
                },
            },
        },
    },
    plugins: [],
};
